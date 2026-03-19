'use strict';

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

/**
 * Run esbuild with metafile, retrying with unresolved bare imports marked
 * as external. Metafile is only serialized on success, so requesting it
 * on every attempt is safe — failed builds throw before producing output.
 */
async function buildWithRetry(baseOpts, maxRetries = 5) {
  const externals = new Set(baseOpts.external || []);
  const emptyFiles = new Set();
  const loadedFiles = new Set();

  const emptyPlugin = {
    name: 'empty-non-js',
    setup(build) {
      build.onLoad({ filter: /.*/ }, (args) => {
        if (emptyFiles.has(args.path)) {
          return { contents: '', loader: 'js' };
        }
        loadedFiles.add(args.path);
        return null;
      });
    },
  };

  for (let i = 0; i <= maxRetries; i++) {
    try {
      loadedFiles.clear();
      const result = await esbuild.build({
        ...baseOpts,
        external: [...externals],
        plugins: [emptyPlugin, ...(baseOpts.plugins || [])],
      });
      result.fileCount = loadedFiles.size;
      return result;
    } catch (err) {
      if (!err.errors || !Array.isArray(err.errors)) throw err;

      let found = false;
      for (const e of err.errors) {
        const m = e.text && e.text.match(/Could not resolve "([^"]+)"/);
        if (m && m[1][0] !== '.' && m[1][0] !== '/') {
          externals.add(m[1]);
          found = true;
        }
        // Handle "No loader" errors for native addons (.node) and other binary files
        const loaderMatch = e.text && e.text.match(/No loader is configured for "([^"]+)" files: (.+)/);
        if (loaderMatch) {
          const abs = path.resolve(loaderMatch[2]);
          emptyFiles.add(abs);
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
  const raw = rawResult.outputFiles[0].text;
  const fileCount = rawResult.fileCount;

  const minResult = await esbuild.transform(raw, { minify: true, loader: 'js' });

  return { raw, minified: minResult.code, fileCount };
}

/**
 * Bundle a local entry point, treating bare imports as external.
 * Returns { raw, minified, fileCount, externals }.
 */
async function bundleEntry(entryPoint) {
  const externals = new Set();
  const loadedFiles = new Set();

  const externalPlugin = {
    name: 'external-packages',
    setup(build) {
      build.onResolve({ filter: /^[^./\\]/ }, (args) => {
        // Skip Windows absolute paths (e.g. C:\...)
        if (/^[a-zA-Z]:/.test(args.path)) return null;
        const pkgName = args.path.startsWith('@')
          ? args.path.split('/').slice(0, 2).join('/')
          : args.path.split('/')[0];
        externals.add(pkgName);
        return { path: args.path, external: true };
      });
    },
  };

  const fileCountPlugin = {
    name: 'file-counter',
    setup(build) {
      build.onLoad({ filter: /.*/ }, (args) => {
        loadedFiles.add(args.path);
        return null;
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
    plugins: [externalPlugin, fileCountPlugin],
  };

  const rawResult = await esbuild.build(baseOpts);
  const raw = rawResult.outputFiles[0].text;
  const fileCount = loadedFiles.size;

  const minResult = await esbuild.transform(raw, { minify: true, loader: 'js' });

  return { raw, minified: minResult.code, fileCount, externals: [...externals] };
}

function safePkgResolve(pkgDir, relPath) {
  const resolved = path.resolve(pkgDir, relPath);
  if (!resolved.startsWith(pkgDir + path.sep) && resolved !== pkgDir) return null;
  return resolved;
}

function findEntryPoint(pkgDir, pkg) {
  if (pkg.exports) {
    const entry = resolveExport(pkg.exports);
    if (entry) {
      const resolved = safePkgResolve(pkgDir, entry);
      if (resolved && fs.existsSync(resolved)) return resolved;
    }
  }

  if (pkg.module) {
    const resolved = safePkgResolve(pkgDir, pkg.module);
    if (resolved && fs.existsSync(resolved)) return resolved;
  }

  if (pkg.main) {
    const resolved = safePkgResolve(pkgDir, pkg.main);
    if (resolved && fs.existsSync(resolved)) return resolved;
    for (const ext of ['.js', '.mjs', '.cjs']) {
      if (resolved && fs.existsSync(resolved + ext)) return resolved + ext;
    }
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
      if (key.startsWith('.') || key === 'types') continue;
      if (['import', 'default', 'require', 'node', 'browser'].includes(key)) continue;
      const result = resolveExport(val);
      if (result) return result;
    }
  }

  return null;
}

module.exports = { bundlePackage, bundleEntry, buildWithRetry, resolveExport, safePkgResolve, findEntryPoint };
