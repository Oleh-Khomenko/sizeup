'use strict';

const { analyzeOne, analyzeFromInstalled, pool } = require('./analyzer');
const { bundleEntry } = require('./bundler');
const { measure } = require('./sizer');

/**
 * Analyze an npm package by spec (e.g. "react", "react@18", "@babel/core@7").
 * Returns { name, version, sizes, dependencies, fileCount, treeshake }.
 */
async function analyze(spec, opts = {}) {
  const flags = {
    gzipLevel: opts.gzipLevel ?? 9,
    brotli: !!opts.brotli,
    noCache: !!opts.noCache,
    force: !!opts.force,
  };
  return analyzeOne(spec, flags);
}

/**
 * Analyze multiple npm packages in parallel.
 * Returns an array of results (same shape as analyze()).
 */
async function analyzeMany(specs, opts = {}) {
  const { installBatchAsync, cleanup, extractPkgName } = require('./installer');
  const flags = {
    gzipLevel: opts.gzipLevel ?? 9,
    brotli: !!opts.brotli,
    noCache: !!opts.noCache,
    force: !!opts.force,
    concurrency: opts.concurrency,
  };
  const concurrency = Math.min(flags.concurrency ?? require('os').cpus().length, 8);
  const batchResult = await installBatchAsync(specs, undefined, { force: flags.force });

  const tasks = specs.map(spec => async () => {
    const key = extractPkgName(spec);
    const installed = batchResult.results[key];
    if (!installed) return null;
    try {
      return await analyzeFromInstalled(installed.pkgDir, installed.packageJson, key, flags);
    } catch {
      return null;
    }
  });

  let results;
  try {
    results = await pool(tasks, concurrency);
  } finally {
    if (batchResult.tmpDir) cleanup(batchResult.tmpDir);
  }
  return results.filter(r => r !== null);
}

/**
 * Analyze a local entry point (file or directory).
 * Returns { entry, sizes, fileCount, externals }.
 */
async function analyzeEntry(entryPath, opts = {}) {
  const path = require('path');
  const fs = require('fs');
  const resolved = path.resolve(entryPath);

  let entry = resolved;
  if (fs.statSync(resolved).isDirectory()) {
    const pkgPath = path.join(resolved, 'package.json');
    let pkg = { main: 'index.js' };
    if (fs.existsSync(pkgPath)) {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    }
    entry = pkg.main ? path.resolve(resolved, pkg.main) : path.join(resolved, 'index.js');
    if (!entry.startsWith(resolved + path.sep) && entry !== resolved) {
      throw new Error('pkg.main escapes package directory');
    }
  }

  const { raw, minified, fileCount, externals } = await bundleEntry(entry);
  const sizes = await measure(raw, minified, opts.gzipLevel ?? 9, { brotli: !!opts.brotli });

  return { entry: entryPath, sizes, fileCount, externals };
}

module.exports = { analyze, analyzeMany, analyzeEntry };
