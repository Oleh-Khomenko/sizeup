'use strict';

const { installAsync, cleanup, parsePackageSpec } = require('./installer');
const { bundlePackage } = require('./bundler');
const { measure } = require('./sizer');
const { getCached, putCached } = require('./cache');

async function buildResult(pkgDir, pkg, name, flags) {
  const cacheSpec = `${pkg.name || name}@${pkg.version || 'unknown'}`;

  if (!flags.noCache) {
    const cached = getCached(cacheSpec, flags);
    if (cached) return cached;
  }

  const { raw, minified, fileCount } = await bundlePackage(pkgDir, pkg);
  const sizes = await measure(raw, minified, flags.gzipLevel, { brotli: flags.brotli });
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

  putCached(cacheSpec, flags, result);
  return result;
}

async function analyzeOne(spec, flags = {}) {
  const { name } = parsePackageSpec(spec);
  const installResult = await installAsync(spec, { force: flags.force });
  try {
    return await buildResult(installResult.pkgDir, installResult.packageJson, name, flags);
  } finally {
    cleanup(installResult.tmpDir);
  }
}

async function analyzeFromInstalled(pkgDir, pkg, name, flags = {}) {
  return buildResult(pkgDir, pkg, name, flags);
}

async function pool(tasks, concurrency) {
  const results = [];
  const errors = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await tasks[idx]();
      } catch (err) {
        results[idx] = undefined;
        errors.push({ index: idx, error: err });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (errors.length > 0) {
    const err = errors[0].error;
    err.poolErrors = errors;
    throw err;
  }
  return results;
}

module.exports = { parsePackageSpec, buildResult, analyzeOne, analyzeFromInstalled, pool };
