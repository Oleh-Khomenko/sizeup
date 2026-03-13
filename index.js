#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { install, installAsync, installBatchAsync, cleanup } = require('./lib/installer');
const { bundlePackage, bundleEntry } = require('./lib/bundler');
const { measure } = require('./lib/sizer');
const { format, formatTable, formatJson, formatDiff, formatDepBreakdown, formatEntry } = require('./lib/formatter');

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  constructor() {
    this._isTTY = !!process.stdout.isTTY;
    this._frame = 0;
    this._timer = null;
    this._text = '';
  }

  update(text) {
    this._text = text;
    if (!this._isTTY) return;
    if (!this._timer) {
      this._timer = setInterval(() => {
        this._frame = (this._frame + 1) % SPINNER_FRAMES.length;
        this._render();
      }, 80);
    }
    this._render();
  }

  _render() {
    process.stdout.write(`\x1b[2K\r  ${SPINNER_FRAMES[this._frame]} ${this._text}`);
  }

  log(text) {
    if (this._isTTY) {
      process.stdout.write(`\x1b[2K\r${text}\n`);
      if (this._text) this._render();
    } else {
      process.stdout.write(`${text}\n`);
    }
  }

  done(text) {
    this._stop();
    if (this._isTTY) {
      process.stdout.write(`\x1b[2K\r  \x1b[32m✓\x1b[0m ${text}\n`);
    } else {
      process.stdout.write(`  ${text}\n`);
    }
    this._text = '';
  }

  _stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') args.flags.help = true;
    else if (argv[i] === '--json') args.flags.json = true;
    else if (argv[i] === '--budget') args.flags.budget = argv[++i];
    else if (argv[i] === '--diff') args.flags.diff = true;
    else if (argv[i] === '--deps') args.flags.deps = true;
    else if (argv[i] === '--entry') args.flags.entry = argv[++i];
    else if (argv[i] === '--concurrency') args.flags.concurrency = parseInt(argv[++i], 10);
    else if (argv[i] === '--local') args.flags.local = true;
    else args.positional.push(argv[i]);
  }
  return args;
}

function parseBudget(str) {
  const match = str.match(/^([\d.]+)\s*(B|kB|KB|MB)$/i);
  if (!match) throw new Error(`Invalid budget format: "${str}". Use e.g. 50kB, 100KB, 1MB`);
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'B') return num;
  if (unit === 'KB') return num * 1024;
  if (unit === 'MB') return num * 1024 * 1024;
  return num;
}

function checkBudget(results, budgetStr, jsonMode) {
  const budgetBytes = parseBudget(budgetStr);
  const items = Array.isArray(results) ? results : [results];
  let failed = false;

  const budgetResults = items.map(r => {
    const over = r.sizes.gzipped > budgetBytes;
    if (over) failed = true;
    return { name: r.name, gzipped: r.sizes.gzipped, budget: budgetBytes, pass: !over };
  });

  if (jsonMode) return { budgetResults, failed };

  for (const b of budgetResults) {
    const icon = b.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const status = b.pass ? 'PASS' : 'FAIL';
    process.stdout.write(`  ${icon} ${status}: ${b.name} (${formatSizeInline(b.gzipped)} / ${formatSizeInline(b.budget)})\n`);
  }

  if (failed) process.exitCode = 1;
  return { budgetResults, failed };
}

function parsePackageSpec(raw) {
  let name, version;

  if (raw.startsWith('@')) {
    const rest = raw.slice(1);
    const atIdx = rest.indexOf('@');
    if (atIdx === -1) {
      name = raw;
      version = 'latest';
    } else {
      name = '@' + rest.slice(0, atIdx);
      version = rest.slice(atIdx + 1);
    }
  } else {
    const atIdx = raw.indexOf('@');
    if (atIdx === -1) {
      name = raw;
      version = 'latest';
    } else {
      name = raw.slice(0, atIdx);
      version = raw.slice(atIdx + 1);
    }
  }

  return { name, version, spec: version === 'latest' ? name : `${name}@${version}` };
}

async function analyzeOne(spec) {
  const { name } = parsePackageSpec(spec);
  const installResult = await installAsync(spec);
  try {
    const { pkgDir, packageJson: pkg } = installResult;
    const { raw, minified, fileCount } = await bundlePackage(pkgDir, pkg);
    const sizes = measure(raw, minified);
    const deps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
    const treeshake = !!(pkg.module || pkg.exports || pkg.sideEffects === false);

    return {
      name: pkg.name || name,
      version: pkg.version || 'unknown',
      sizes,
      dependencies: deps,
      fileCount,
      treeshake,
    };
  } finally {
    cleanup(installResult.tmpDir);
  }
}

async function analyzeFromInstalled(pkgDir, pkg, name) {
  const { raw, minified, fileCount } = await bundlePackage(pkgDir, pkg);
  const sizes = measure(raw, minified);
  const deps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
  const treeshake = !!(pkg.module || pkg.exports || pkg.sideEffects === false);

  return {
    name: pkg.name || name,
    version: pkg.version || 'unknown',
    sizes,
    dependencies: deps,
    fileCount,
    treeshake,
  };
}

async function pool(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function scanLocalDeps(dir, flags) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`Error: No package.json found in ${dir}`);
    console.error('Either provide a package name or a directory with a package.json.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];

  if (deps.length === 0) {
    if (flags.json) {
      process.stdout.write(formatJson([]));
    } else {
      console.error('No dependencies found in package.json.');
    }
    process.exit(0);
  }

  const spinner = new Spinner();
  const isQuiet = !!flags.json;

  if (!isQuiet) {
    process.stdout.write(`\nScanning ${deps.length} dependencies from package.json...\n\n`);
  }

  let batchResult;
  if (flags.local) {
    const nodeModulesDir = path.join(dir, 'node_modules');
    const results = {};
    for (const dep of deps) {
      const pkgDir = path.join(nodeModulesDir, dep);
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          results[dep] = { pkgDir, packageJson: JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) };
        } catch { /* skip */ }
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
      batchResult = await installBatchAsync(deps, onProgress);
    } catch (err) {
      if (!isQuiet) spinner.done(`Install failed`);
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }

    if (!isQuiet) {
      spinner.done(`Installed ${deps.length} packages`);
      process.stdout.write('\n');
    }
  }

  const concurrency = Math.min(flags.concurrency || os.cpus().length, 8);
  const total = deps.length;
  let done = 0;
  let failCount = 0;

  const tasks = deps.map(dep => async () => {
    const installed = batchResult.results[dep];
    if (!installed) {
      done++;
      failCount++;
      if (!isQuiet) {
        spinner.log(`  \x1b[31m✗\x1b[0m [${done}/${total}] Failed: ${dep} - not found ${flags.local ? 'in node_modules' : 'after batch install'}`);
      }
      return null;
    }
    try {
      if (!isQuiet) {
        spinner.update(`[${done}/${total}] Building ${dep}...`);
      }
      const result = await analyzeFromInstalled(installed.pkgDir, installed.packageJson, dep);
      done++;
      if (!isQuiet) {
        if (!spinner._isTTY) {
          spinner.log(`  [${done}/${total}] Done: ${result.name} (gzipped: ${formatSizeInline(result.sizes.gzipped)})`);
        } else {
          spinner.update(`[${done}/${total}] Building next...`);
        }
      }
      return result;
    } catch (err) {
      done++;
      failCount++;
      if (!isQuiet) {
        spinner.log(`  \x1b[31m✗\x1b[0m [${done}/${total}] Failed: ${dep} - ${err.message}`);
      }
      return null;
    }
  });

  let results;
  try {
    results = await pool(tasks, concurrency);
  } finally {
    if (batchResult.tmpDir) cleanup(batchResult.tmpDir);
  }

  if (!isQuiet) {
    const succeeded_ = results.filter(r => r !== null).length;
    spinner.done(`Analyzed ${succeeded_}/${total} packages${failCount ? ` (${failCount} failed)` : ''}`);
    process.stdout.write('\n');
  }

  const succeeded = results.filter(r => r !== null);

  if (flags.json) {
    const output = { packages: succeeded };
    if (flags.budget) {
      output.budget = checkBudget(succeeded, flags.budget, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else {
    if (succeeded.length > 0) {
      process.stdout.write(formatTable(succeeded));
    }
    if (flags.budget) {
      process.stdout.write('\n');
      checkBudget(succeeded, flags.budget, false);
    }
  }
}

function isPath(arg) {
  return arg.startsWith('.') || arg.startsWith('/') || arg.includes(path.sep);
}

function formatSizeInline(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function runDiff(positional, flags) {
  if (positional.length !== 2) {
    console.error('Error: --diff requires exactly 2 package specs (e.g. --diff react@17 react@18)');
    process.exit(1);
  }

  const [specA, specB] = positional;

  if (!flags.json) {
    process.stdout.write(`\nComparing ${specA} vs ${specB}...\n`);
  }

  const [resultA, resultB] = await Promise.all([
    analyzeOne(specA),
    analyzeOne(specB),
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
    if (flags.budget) {
      output.budget = checkBudget([resultA, resultB], flags.budget, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else {
    process.stdout.write(formatDiff(resultA, resultB));
    if (flags.budget) {
      process.stdout.write('\n');
      checkBudget([resultA, resultB], flags.budget, false);
    }
  }
}

async function runDeps(spec, flags) {
  if (!flags.json) {
    process.stdout.write(`\nAnalyzing dependencies of ${spec}...\n`);
  }

  const { name } = parsePackageSpec(spec);
  const installResult = await installAsync(spec);
  try {
    const { pkgDir, packageJson: pkg } = installResult;
    const { raw, minified, fileCount } = await bundlePackage(pkgDir, pkg);
    const sizes = measure(raw, minified);
    const deps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
    const treeshake = !!(pkg.module || pkg.exports || pkg.sideEffects === false);

    const mainResult = {
      name: pkg.name || name,
      version: pkg.version || 'unknown',
      sizes,
      dependencies: deps,
      fileCount,
      treeshake,
    };

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

    let batchResult;
    try {
      batchResult = await installBatchAsync(deps);
    } catch {
      // Fall back to empty results if batch install fails
      batchResult = { tmpDir: null, results: {} };
    }

    const depResults = [];
    try {
      for (const dep of deps) {
        const installed = batchResult.results[dep];
        if (!installed) continue;
        try {
          const result = await analyzeFromInstalled(installed.pkgDir, installed.packageJson, dep);
          if (!flags.json) {
            process.stdout.write(`  Done: ${result.name}\n`);
          }
          depResults.push(result);
        } catch {
          // skip failed analysis
        }
      }
    } finally {
      if (batchResult.tmpDir) cleanup(batchResult.tmpDir);
    }

    if (flags.json) {
      const output = {
        ...mainResult,
        breakdown: depResults.map(r => ({
          name: r.name,
          version: r.version,
          gzipped: r.sizes.gzipped,
          percentOfTotal: mainResult.sizes.gzipped === 0 ? 0
            : parseFloat(((r.sizes.gzipped / mainResult.sizes.gzipped) * 100).toFixed(1)),
        })),
      };
      if (flags.budget) {
        output.budget = checkBudget(mainResult, flags.budget, true);
      }
      process.stdout.write(formatJson(output) + '\n');
      if (output.budget && output.budget.failed) process.exitCode = 1;
    } else {
      process.stdout.write(formatDepBreakdown(mainResult, depResults));
      if (flags.budget) {
        process.stdout.write('\n');
        checkBudget(mainResult, flags.budget, false);
      }
    }
  } finally {
    cleanup(installResult.tmpDir);
  }
}

async function runEntry(entryPath, flags) {
  const resolved = path.resolve(entryPath);

  if (!fs.existsSync(resolved)) {
    console.error(`Error: ${entryPath} does not exist.`);
    process.exit(1);
  }

  if (!flags.json) {
    process.stdout.write(`\nAnalyzing local entry: ${resolved}...\n`);
  }

  const isDir = fs.statSync(resolved).isDirectory();

  if (isDir) {
    const pkgPath = path.join(resolved, 'package.json');
    const pkg = fs.existsSync(pkgPath)
      ? JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      : { main: 'index.js' };
    const entry = pkg.main ? path.resolve(resolved, pkg.main) : path.join(resolved, 'index.js');
    const { raw, minified, fileCount, externals } = await bundleEntry(entry);
    await outputEntryResult(raw, minified, fileCount, externals, resolved, flags);
  } else {
    const { raw, minified, fileCount, externals } = await bundleEntry(resolved);
    await outputEntryResult(raw, minified, fileCount, externals, entryPath, flags);
  }
}

async function outputEntryResult(raw, minified, fileCount, externals, entryLabel, flags) {
  const sizes = measure(raw, minified);

  const result = {
    entry: entryLabel,
    sizes,
    fileCount,
    externals,
  };

  if (flags.json) {
    const output = { ...result };
    if (flags.budget) {
      output.budget = checkBudget({ name: entryLabel, sizes }, flags.budget, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else {
    process.stdout.write(formatEntry(result));
    if (flags.budget) {
      process.stdout.write('\n');
      checkBudget({ name: entryLabel, sizes }, flags.budget, false);
    }
  }
}

async function runSinglePackage(spec, flags) {
  const { name } = parsePackageSpec(spec);
  let tmpDir;
  try {
    if (!flags.json) {
      process.stdout.write(`\nAnalyzing ${spec}...\n`);
    }

    const installResult = install(spec);
    tmpDir = installResult.tmpDir;
    const { pkgDir, packageJson: pkg } = installResult;

    const { raw, minified, fileCount } = await bundlePackage(pkgDir, pkg);
    const sizes = measure(raw, minified);

    const deps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
    const treeshake = !!(pkg.module || pkg.exports || pkg.sideEffects === false);

    const result = {
      name: pkg.name || name,
      version: pkg.version || 'unknown',
      sizes,
      dependencies: deps,
      fileCount,
      treeshake,
    };

    if (flags.json) {
      const output = { ...result };
      if (flags.budget) {
        output.budget = checkBudget(result, flags.budget, true);
      }
      process.stdout.write(formatJson(output) + '\n');
      if (output.budget && output.budget.failed) process.exitCode = 1;
    } else {
      process.stdout.write(format(result));
      if (flags.budget) {
        process.stdout.write('\n');
        checkBudget(result, flags.budget, false);
      }
    }
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  } finally {
    if (tmpDir) cleanup(tmpDir);
  }
}

function printHelp() {
  const { bold, dim, cyan, green, yellow, reset } = {
    bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m',
    green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m',
  };

  process.stdout.write(`
${bold}sizeup${reset} — Fast npm package size analyzer

${bold}USAGE${reset}
  ${cyan}sizeup${reset} ${dim}<package...>${reset}           Analyze one or more packages
  ${cyan}sizeup${reset} ${dim}[path]${reset}                 Scan all deps in package.json
  ${cyan}sizeup${reset} ${dim}--diff <a> <b>${reset}         Compare two package versions
  ${cyan}sizeup${reset} ${dim}--deps <package>${reset}        Dependency size breakdown
  ${cyan}sizeup${reset} ${dim}--entry <file|dir>${reset}      Analyze local source code

${bold}OPTIONS${reset}
  ${green}--json${reset}              Output results as JSON
  ${green}--budget ${dim}<size>${reset}      Set a size budget (exit code 1 if exceeded)
                      Supports: B, kB, KB, MB (e.g. ${dim}50kB${reset}, ${dim}1MB${reset}, case-insensitive)
  ${green}--diff${reset}              Compare two packages side-by-side
  ${green}--deps${reset}              Show per-dependency size breakdown
  ${green}--entry ${dim}<path>${reset}      Analyze local file/directory (skips npm install)
  ${green}--local${reset}             Use project's node_modules instead of installing to temp dir
                      ${dim}(sizes may differ slightly from fresh install due to resolved versions)${reset}
  ${green}--concurrency ${dim}<N>${reset}  Max parallel analyses (default: CPU count, max 8)
  ${green}-h, --help${reset}          Show this help message

${bold}EXAMPLES${reset}
  ${dim}$${reset} sizeup react                    ${dim}# single package${reset}
  ${dim}$${reset} sizeup react vue svelte          ${dim}# multiple packages${reset}
  ${dim}$${reset} sizeup react --json              ${dim}# JSON output${reset}
  ${dim}$${reset} sizeup react --budget 5kB        ${dim}# fail if > 5kB gzipped${reset}
  ${dim}$${reset} sizeup --diff react@17 react@18  ${dim}# version comparison${reset}
  ${dim}$${reset} sizeup express --deps            ${dim}# dependency breakdown${reset}
  ${dim}$${reset} sizeup --entry ./src/index.js    ${dim}# local file analysis${reset}
  ${dim}$${reset} sizeup ./my-project              ${dim}# scan project deps${reset}
  ${dim}$${reset} sizeup ./my-project --local      ${dim}# use existing node_modules${reset}
  ${dim}$${reset} sizeup                           ${dim}# scan cwd deps${reset}

`);
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
    batchResult = await installBatchAsync(specs, onProgress);
  } catch (err) {
    if (!isQuiet) spinner.done(`Install failed`);
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (!isQuiet) {
    spinner.done(`Installed ${specs.length} packages`);
    process.stdout.write('\n');
  }

  const concurrency = Math.min(flags.concurrency || os.cpus().length, 8);
  const total = specs.length;
  let done = 0;
  let failCount = 0;

  const tasks = specs.map(spec => async () => {
    const installed = batchResult.results[spec];
    if (!installed) {
      done++;
      failCount++;
      if (!isQuiet) {
        spinner.log(`  \x1b[31m✗\x1b[0m [${done}/${total}] Failed: ${spec} - not found after install`);
      }
      return null;
    }
    try {
      if (!isQuiet) {
        spinner.update(`[${done}/${total}] Building ${spec}...`);
      }
      const result = await analyzeFromInstalled(installed.pkgDir, installed.packageJson, spec);
      done++;
      if (!isQuiet) {
        if (!spinner._isTTY) {
          spinner.log(`  [${done}/${total}] Done: ${result.name} (gzipped: ${formatSizeInline(result.sizes.gzipped)})`);
        } else {
          spinner.update(`[${done}/${total}] Building next...`);
        }
      }
      return result;
    } catch (err) {
      done++;
      failCount++;
      if (!isQuiet) {
        spinner.log(`  \x1b[31m✗\x1b[0m [${done}/${total}] Failed: ${spec} - ${err.message}`);
      }
      return null;
    }
  });

  let results;
  try {
    results = await pool(tasks, concurrency);
  } finally {
    if (batchResult.tmpDir) cleanup(batchResult.tmpDir);
  }

  if (!isQuiet) {
    const succeeded_ = results.filter(r => r !== null).length;
    spinner.done(`Analyzed ${succeeded_}/${total} packages${failCount ? ` (${failCount} failed)` : ''}`);
    process.stdout.write('\n');
  }

  const succeeded = results.filter(r => r !== null);

  if (flags.json) {
    const output = { packages: succeeded };
    if (flags.budget) {
      output.budget = checkBudget(succeeded, flags.budget, true);
    }
    process.stdout.write(formatJson(output) + '\n');
    if (output.budget && output.budget.failed) process.exitCode = 1;
  } else {
    if (succeeded.length > 0) {
      process.stdout.write(formatTable(succeeded));
    }
    if (flags.budget) {
      process.stdout.write('\n');
      checkBudget(succeeded, flags.budget, false);
    }
  }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv);

  if (flags.help) {
    printHelp();
    return;
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
      console.error('Error: --deps requires exactly 1 package spec (e.g. --deps express)');
      process.exit(1);
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
      console.error(`Error: ${positional[0]} is not a valid directory.`);
      process.exit(1);
    }
  }
  return scanLocalDeps(dir, flags);
}

main();
