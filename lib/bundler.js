'use strict';

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

/**
 * Run esbuild, retrying with unresolved bare imports marked as external.
 * First probes without metafile (to avoid IPC crash on error responses),
 * then does the final build with metafile once we know it will succeed.
 */
async function buildWithRetry(baseOpts, maxRetries = 5) {
  const externals = new Set(baseOpts.external || []);
  const emptyFiles = new Set();

  const emptyPlugin = {
    name: 'empty-non-js',
    setup(build) {
      build.onLoad({ filter: /.*/ }, (args) => {
        if (emptyFiles.has(args.path)) {
          return { contents: '', loader: 'js' };
        }
        return null;
      });
    },
  };

  // Phase 1: probe without metafile, collecting missing externals
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await esbuild.build({
        ...baseOpts,
        external: [...externals],
        plugins: [emptyPlugin, ...(baseOpts.plugins || [])],
      });
      break; // success
    } catch (err) {
      if (!err.errors || !Array.isArray(err.errors)) throw err;

      let found = false;
      for (const e of err.errors) {
        const m = e.text && e.text.match(/Could not resolve "([^"]+)"/);
        if (m && m[1][0] !== '.' && m[1][0] !== '/') {
          externals.add(m[1]);
          found = true;
        }
        // Handle syntax errors in non-JS files (e.g. LICENSE, .txt)
        if (e.location && e.location.file && !/\.(m?[jt]sx?|cjs|json)$/.test(e.location.file)) {
          const abs = path.resolve(e.location.file);
          emptyFiles.add(abs);
          found = true;
        }
      }
      if (!found || i === maxRetries) throw err;
    }
  }

  // Phase 2: final build with metafile enabled
  return await esbuild.build({
    ...baseOpts,
    external: [...externals],
    plugins: [emptyPlugin, ...(baseOpts.plugins || [])],
    metafile: true,
  });
}

/**
 * Bundle a package using esbuild from its installed directory.
 * Returns { raw, minified, fileCount } where raw/minified are code strings.
 */
async function bundlePackage(pkgDir, pkg) {
  const entryPoint = findEntryPoint(pkgDir, pkg);
  const peerDeps = pkg.peerDependencies ? Object.keys(pkg.peerDependencies) : [];
  const baseOpts = {
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'esnext',
    logLevel: 'silent',
    external: peerDeps,
    define: { 'process.env.NODE_ENV': '"production"' },
  };

  const rawResult = await buildWithRetry(baseOpts);
  const minResult = await buildWithRetry({ ...baseOpts, minify: true });

  const raw = rawResult.outputFiles[0].text;
  const minified = minResult.outputFiles[0].text;
  const fileCount = Object.keys(minResult.metafile.inputs).length;

  return { raw, minified, fileCount };
}

/**
 * Bundle a local entry point, treating bare imports as external.
 * Returns { raw, minified, fileCount, externals }.
 */
async function bundleEntry(entryPoint) {
  const externals = new Set();

  const externalPlugin = {
    name: 'external-packages',
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        const pkgName = args.path.startsWith('@')
          ? args.path.split('/').slice(0, 2).join('/')
          : args.path.split('/')[0];
        externals.add(pkgName);
        return { path: args.path, external: true };
      });
    },
  };

  const baseOpts = {
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'esnext',
    logLevel: 'silent',
    plugins: [externalPlugin],
  };

  const rawResult = await esbuild.build({ ...baseOpts, metafile: true });
  const minResult = await esbuild.build({ ...baseOpts, metafile: true, minify: true });

  const raw = rawResult.outputFiles[0].text;
  const minified = minResult.outputFiles[0].text;
  const fileCount = Object.keys(minResult.metafile.inputs).length;

  return { raw, minified, fileCount, externals: [...externals] };
}

function findEntryPoint(pkgDir, pkg) {
  if (pkg.exports) {
    const entry = resolveExport(pkg.exports);
    if (entry) {
      const resolved = path.resolve(pkgDir, entry);
      if (fs.existsSync(resolved)) return resolved;
    }
  }

  if (pkg.module) {
    const resolved = path.resolve(pkgDir, pkg.module);
    if (fs.existsSync(resolved)) return resolved;
  }

  if (pkg.main) {
    const resolved = path.resolve(pkgDir, pkg.main);
    if (fs.existsSync(resolved)) return resolved;
    if (fs.existsSync(resolved + '.js')) return resolved + '.js';
  }

  const indexJs = path.join(pkgDir, 'index.js');
  if (fs.existsSync(indexJs)) return indexJs;

  throw new Error(`Could not find entry point for package in ${pkgDir}`);
}

function resolveExport(exports) {
  if (typeof exports === 'string') {
    return /\.(d\.ts|d\.mts|css|scss|less)$/.test(exports) ? null : exports;
  }

  if (Array.isArray(exports)) {
    for (const item of exports) {
      const result = resolveExport(item);
      if (result) return result;
    }
    return null;
  }

  if (typeof exports === 'object' && exports !== null) {
    if (exports['.'] !== undefined) return resolveExport(exports['.']);

    for (const key of ['import', 'default', 'require', 'node', 'browser']) {
      if (exports[key] !== undefined) {
        const result = resolveExport(exports[key]);
        if (result) return result;
      }
    }

    for (const [key, val] of Object.entries(exports)) {
      if (key === 'types' || key === '.' || ['import', 'default', 'require', 'node', 'browser'].includes(key)) continue;
      const result = resolveExport(val);
      if (result) return result;
    }
  }

  return null;
}

module.exports = { bundlePackage, bundleEntry };
