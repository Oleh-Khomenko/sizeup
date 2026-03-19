#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

process.stdout.on('error', () => {});
const { installAsync, installBatchAsync, cleanup, extractPkgName } = require('./lib/installer');
const { bundleEntry } = require('./lib/bundler');
const { measure } = require('./lib/sizer');
const { format, formatTable, formatJson, formatDiff, formatDepBreakdown, formatEntry, formatSize, formatMarkdownTable, formatMarkdownSingle, formatMarkdownDiff, formatMarkdownDeps, formatMarkdownEntry } = require('./lib/formatter');
const { clearCache } = require('./lib/cache');
const { Spinner } = require('./lib/spinner');
const { parseArgs, isPath, printHelp } = require('./lib/cli');
const { parseBudget, checkBudget } = require('./lib/budget');
const { parsePackageSpec, buildResult, analyzeOne, analyzeFromInstalled, pool } = require('./lib/analyzer');

function isMd(flags) {
  return flags.format === 'md' || flags.format === 'markdown';
}

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

async function analyzePool(items, batchResult, flags, spinner, isQuiet) {
  const concurrency = Math.min(flags.concurrency || os.cpus().length, 8);
  const total = items.length;
  let started = 0;
  let done = 0;
  let failCount = 0;

  const tasks = items.map(({ label, lookupKey }) => async () => {
    const installed = batchResult.results[lookupKey];
    if (!installed) {
      const num = ++done;
      failCount++;
      if (!isQuiet) {
        spinner.log(`  \x1b[31m✗\x1b[0m [${num}/${total}] Failed: ${label} - not found after install`);
      }
      return null;
    }
    try {
      const buildNum = ++started;
      if (!isQuiet) spinner.update(`[${buildNum}/${total}] Building ${label}...`);
      const result = await analyzeFromInstalled(installed.pkgDir, installed.packageJson, label, flags);
      const num = ++done;
      if (!isQuiet) {
        if (!spinner._isTTY) {
          spinner.log(`  [${num}/${total}] Done: ${result.name} (gzipped: ${formatSize(result.sizes.gzipped)})`);
        } else {
          spinner.update(`[${num}/${total}] Building next...`);
        }
      }
      return result;
    } catch (err) {
      const num = ++done;
      failCount++;
      if (!isQuiet) {
        spinner.log(`  \x1b[31m✗\x1b[0m [${num}/${total}] Failed: ${label} - ${err.message}`);
      }
      return null;
    }
  });

  let results;
  try {
    results = await pool(tasks, concurrency);
  } finally {
    if (batchResult.tmpDir) cleanup(batchResult.tmpDir);
    spinner._stop();
  }

  if (!isQuiet) {
    const succeeded_ = results.filter(r => r !== null).length;
    spinner.done(`Analyzed ${succeeded_}/${total} packages${failCount ? ` (${failCount} failed)` : ''}`);
    process.stdout.write('\n');
  }

  return results.filter(r => r !== null);
}

function outputMultipleResults(succeeded, flags) {
  let display = succeeded;
  if (flags.top && display.length > flags.top) {
    display = [...display].sort((a, b) => b.sizes.gzipped - a.sizes.gzipped).slice(0, flags.top);
  }

  if (flags.json) {
    const output = { packages: display };
    if (flags.budget || flags.budgetBrotli) {
      output.budget = checkBudget(succeeded, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else if (flags.format === 'md' || flags.format === 'markdown') {
    process.stdout.write(formatMarkdownTable(display));
  } else {
    if (display.length > 0) {
      process.stdout.write(formatTable(display));
    }
    if (flags.budget || flags.budgetBrotli) {
      process.stdout.write('\n');
      checkBudget(succeeded, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, false);
    }
  }
}

async function scanLocalDeps(dir, flags) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new CliError(`No package.json found in ${dir}\nEither provide a package name or a directory with a package.json.`);
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    throw new CliError(`Failed to parse package.json in ${dir}: ${e.message}`);
  }
  const allDeps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
  const typesOnly = allDeps.filter(d => d.startsWith('@types/'));
  const excludeSet = new Set(flags.exclude || []);
  const excluded = allDeps.filter(d => excludeSet.has(d));
  const deps = allDeps.filter(d => !d.startsWith('@types/') && !excludeSet.has(d));

  if (deps.length === 0) {
    if (flags.json) {
      process.stdout.write(formatJson([]));
    } else {
      console.error('No dependencies found in package.json.');
    }
    return;
  }

  const spinner = new Spinner();
  const isQuiet = !!flags.json;

  if (!isQuiet) {
    const skips = [];
    if (typesOnly.length) skips.push(`${typesOnly.length} @types`);
    if (excluded.length) skips.push(`${excluded.length} excluded`);
    const skipMsg = skips.length ? ` (skipped ${skips.join(', ')})` : '';
    process.stdout.write(`\nScanning ${deps.length} dependencies from package.json...${skipMsg}\n\n`);
  }

  let batchResult;
  if (flags.local) {
    const nodeModulesDir = path.join(dir, 'node_modules');
    const results = {};
    for (const dep of deps) {
      const pkgDir = path.join(nodeModulesDir, dep);
      if (!pkgDir.startsWith(nodeModulesDir + path.sep)) continue;
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          results[dep] = { pkgDir, packageJson: JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) };
        } catch (e) {
            if (!isQuiet) process.stderr.write(`  Warning: could not read ${dep}: ${e.message}\n`);
          }
      }
    }
    batchResult = { tmpDir: null, results };
  } else {
    if (!isQuiet) {
      spinner.update(`Installing ${deps.length} packages...`);
    }
    try {
      const onProgress = isQuiet ? undefined : (count) => {
        spinner.update(`Installing packages... (${count}/${deps.length})`);
      };
      batchResult = await installBatchAsync(deps, onProgress, { force: flags.force });
    } catch (err) {
      if (!isQuiet) spinner.done(`Install failed`);
      throw new CliError(err.message);
    }

    if (!isQuiet) {
      spinner.done(`Installed ${deps.length} packages`);
      process.stdout.write('\n');
    }
  }

  const items = deps.map(dep => ({ label: dep, lookupKey: dep }));
  const succeeded = await analyzePool(items, batchResult, flags, spinner, isQuiet);
  outputMultipleResults(succeeded, flags);
}

async function runDiff(positional, flags) {
  if (positional.length !== 2) {
    throw new CliError('--diff requires exactly 2 package specs (e.g. --diff react@17 react@18)');
  }

  const [specA, specB] = positional;

  if (!flags.json) {
    process.stdout.write(`\nComparing ${specA} vs ${specB}...\n`);
  }

  const [resultA, resultB] = await Promise.all([
    analyzeOne(specA, flags),
    analyzeOne(specB, flags),
  ]);

  if (flags.json) {
    const output = {
      before: resultA,
      after: resultB,
      delta: {
        minified: resultB.sizes.minified - resultA.sizes.minified,
        gzipped: resultB.sizes.gzipped - resultA.sizes.gzipped,
        fileCount: resultB.fileCount - resultA.fileCount,
        dependencies: resultB.dependencies.length - resultA.dependencies.length,
      },
    };
    if (flags.budget || flags.budgetBrotli) {
      output.budget = checkBudget([resultA, resultB], { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else if (isMd(flags)) {
    process.stdout.write(formatMarkdownDiff(resultA, resultB));
  } else {
    process.stdout.write(formatDiff(resultA, resultB));
    if (flags.budget || flags.budgetBrotli) {
      process.stdout.write('\n');
      checkBudget([resultA, resultB], { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, false);
    }
  }
}

async function runDeps(spec, flags) {
  if (!flags.json) {
    process.stdout.write(`\nAnalyzing dependencies of ${spec}...\n`);
  }

  const { name } = parsePackageSpec(spec);
  const installResult = await installAsync(spec, { force: flags.force });
  try {
    const { pkgDir, packageJson: pkg } = installResult;
    const mainResult = await buildResult(pkgDir, pkg, name, flags);
    const deps = mainResult.dependencies;

    if (deps.length === 0) {
      if (flags.json) {
        process.stdout.write(formatJson({ ...mainResult, breakdown: [] }) + '\n');
      } else {
        process.stdout.write(format(mainResult));
        process.stdout.write('\n  No dependencies to break down.\n\n');
      }
      return;
    }

    if (!flags.json) {
      process.stdout.write(`  Found ${deps.length} dependencies, analyzing individually...\n`);
    }

    let batchResult2;
    try {
      batchResult2 = await installBatchAsync(deps, undefined, { force: flags.force });
    } catch (err) {
      if (!flags.json) process.stderr.write(`  Warning: failed to install dependencies: ${err.message}\n`);
      batchResult2 = { tmpDir: null, results: {} };
    }

    const concurrency = Math.min(flags.concurrency || os.cpus().length, 8);
    let doneCount = 0;

    const tasks = deps.map(dep => async () => {
      const installed = batchResult2.results[dep];
      if (!installed) return null;
      try {
        const result = await analyzeFromInstalled(installed.pkgDir, installed.packageJson, dep, flags);
        doneCount++;
        if (!flags.json) {
          process.stdout.write(`  [${doneCount}/${deps.length}] Done: ${result.name}\n`);
        }
        return result;
      } catch (err) {
        doneCount++;
        if (!flags.json) process.stderr.write(`  Warning: failed to analyze ${dep}: ${err.message}\n`);
        return null;
      }
    });

    let poolResults;
    try {
      poolResults = await pool(tasks, concurrency);
    } finally {
      if (batchResult2.tmpDir) cleanup(batchResult2.tmpDir);
    }
    const depResults = poolResults.filter(r => r !== null);

    if (flags.json) {
      const output = {
        ...mainResult,
        breakdown: depResults.map(r => {
          const depGz = depResults.reduce((s, d) => s + d.sizes.gzipped, 0);
          const pctBase = Math.max(mainResult.sizes.gzipped, depGz) || 1;
          const entry = {
            name: r.name,
            version: r.version,
            gzipped: r.sizes.gzipped,
            percentOfTotal: parseFloat(((r.sizes.gzipped / pctBase) * 100).toFixed(1)),
          };
          if (r.sizes.brotli != null) entry.brotli = r.sizes.brotli;
          return entry;
        }),
      };
      if (flags.budget || flags.budgetBrotli) {
        output.budget = checkBudget(mainResult, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, true);
      }
      process.stdout.write(formatJson(output) + '\n');
      if (output.budget && output.budget.failed) process.exitCode = 1;
    } else if (isMd(flags)) {
      process.stdout.write(formatMarkdownDeps(mainResult, depResults));
    } else {
      process.stdout.write(formatDepBreakdown(mainResult, depResults));
      if (flags.budget || flags.budgetBrotli) {
        process.stdout.write('\n');
        checkBudget(mainResult, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, false);
      }
    }
  } finally {
    cleanup(installResult.tmpDir);
  }
}

async function runEntry(entryPath, flags) {
  const resolved = path.resolve(entryPath);

  if (!fs.existsSync(resolved)) {
    throw new CliError(`${entryPath} does not exist.`);
  }

  if (!flags.json) {
    process.stdout.write(`\nAnalyzing local entry: ${resolved}...\n`);
  }

  const isDir = fs.statSync(resolved).isDirectory();

  if (isDir) {
    const pkgPath = path.join(resolved, 'package.json');
    let pkg = { main: 'index.js' };
    if (fs.existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch (e) {
        throw new CliError(`Failed to parse package.json: ${e.message}`);
      }
    }
    let entry = pkg.main ? path.resolve(resolved, pkg.main) : path.join(resolved, 'index.js');
    if (!entry.startsWith(resolved + path.sep) && entry !== resolved) {
      throw new CliError(`pkg.main escapes package directory: ${pkg.main}`);
    }
    const { raw, minified, fileCount, externals } = await bundleEntry(entry);
    await outputEntryResult(raw, minified, fileCount, externals, resolved, flags);
  } else {
    const { raw, minified, fileCount, externals } = await bundleEntry(resolved);
    await outputEntryResult(raw, minified, fileCount, externals, entryPath, flags);
  }
}

async function outputEntryResult(raw, minified, fileCount, externals, entryLabel, flags) {
  const sizes = await measure(raw, minified, flags.gzipLevel, { brotli: flags.brotli });

  const result = {
    entry: entryLabel,
    sizes,
    fileCount,
    externals,
  };

  if (flags.json) {
    const output = { ...result };
    if (flags.budget || flags.budgetBrotli) {
      output.budget = checkBudget({ name: entryLabel, sizes }, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else if (isMd(flags)) {
    process.stdout.write(formatMarkdownEntry(result));
  } else {
    process.stdout.write(formatEntry(result));
    if (flags.budget || flags.budgetBrotli) {
      process.stdout.write('\n');
      checkBudget({ name: entryLabel, sizes }, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, false);
    }
  }
}

async function runSinglePackage(spec, flags) {
  const spinner = new Spinner();
  if (!flags.json) {
    process.stdout.write('\n');
    spinner.update(`Analyzing ${spec}...`);
  }

  const result = await analyzeOne(spec, flags);

  if (!flags.json) {
    spinner.done(`Analyzed ${result.name}@${result.version}`);
  }

  if (flags.json) {
    const output = { ...result };
    if (flags.budget || flags.budgetBrotli) {
      output.budget = checkBudget(result, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else if (isMd(flags)) {
    process.stdout.write(formatMarkdownSingle(result));
  } else {
    process.stdout.write(format(result));
    if (flags.budget || flags.budgetBrotli) {
      process.stdout.write('\n');
      checkBudget(result, { budget: flags.budget, budgetBrotli: flags.budgetBrotli }, false);
    }
  }
}

async function runMultiplePackages(specs, flags) {
  const spinner = new Spinner();
  const isQuiet = !!flags.json;

  if (!isQuiet) {
    process.stdout.write(`\nAnalyzing ${specs.length} packages...\n\n`);
    spinner.update(`Installing ${specs.length} packages...`);
  }

  let batchResult;
  try {
    const onProgress = isQuiet ? undefined : (count) => {
      spinner.update(`Installing packages... (${count}/${specs.length})`);
    };
    batchResult = await installBatchAsync(specs, onProgress, { force: flags.force });
  } catch (err) {
    if (!isQuiet) spinner.done(`Install failed`);
    throw new CliError(err.message);
  }

  if (!isQuiet) {
    spinner.done(`Installed ${specs.length} packages`);
    process.stdout.write('\n');
  }

  const items = specs.map(spec => ({ label: spec, lookupKey: extractPkgName(spec) }));
  const succeeded = await analyzePool(items, batchResult, flags, spinner, isQuiet);
  outputMultipleResults(succeeded, flags);
}

async function main() {
  try {
    const { flags, positional } = parseArgs(process.argv);

    if (flags.help) {
      printHelp();
      return;
    }

    if (flags.version) {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
      process.stdout.write(`${pkg.version}\n`);
      return;
    }

    if (flags.clearCache) {
      clearCache();
      process.stdout.write('Cache cleared.\n');
      return;
    }

    // --budget-brotli implies --brotli
    if (flags.budgetBrotli) {
      flags.brotli = true;
    }

    // --entry <path>: local file analysis
    if (flags.entry) {
      return runEntry(flags.entry, flags);
    }

    // --diff: version comparison
    if (flags.diff) {
      return runDiff(positional, flags);
    }

    // --deps: dependency breakdown
    if (flags.deps) {
      if (positional.length !== 1) {
        throw new CliError('--deps requires exactly 1 package spec (e.g. --deps express)');
      }
      return runDeps(positional[0], flags);
    }

    // Package(s) by name
    if (positional.length >= 1 && positional.every(p => !isPath(p))) {
      if (positional.length === 1) {
        return runSinglePackage(positional[0], flags);
      }
      return runMultiplePackages(positional, flags);
    }

    // Scan mode: 0 positional or a path
    const dir = positional.length === 0 ? process.cwd() : path.resolve(positional[0]);
    if (positional.length > 0) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new CliError(`${positional[0]} is not a valid directory.`);
      }
    }
    return scanLocalDeps(dir, flags);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exit(err.exitCode);
    } else if (err.message && err.message.includes('Failed to install')) {
      console.error(`\nInstall failed: ${err.message}`);
      console.error('\nTips:');
      console.error('  - Check the package name for typos');
      console.error('  - Try --force to bypass peer dependency conflicts');
      console.error('  - Ensure you have network access and npm is configured');
      process.exit(1);
    } else if (err.message && err.message.includes('Could not find entry point')) {
      console.error(`\nBundle failed: ${err.message}`);
      console.error('\nThis package may not have a standard entry point.');
      console.error('Try --entry with a specific file instead.');
      process.exit(1);
    } else {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  }
}

if (require.main === module) main();

module.exports = { parseArgs, parseBudget, parsePackageSpec, checkBudget, isPath, formatSizeInline: formatSize, CliError };
