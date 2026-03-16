'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');

const activeTmpDirs = new Set();

function trackDir(tmpDir) {
  activeTmpDirs.add(tmpDir);
}

function untrackDir(tmpDir) {
  activeTmpDirs.delete(tmpDir);
}

function cleanupAll() {
  for (const dir of activeTmpDirs) {
    cleanup(dir);
  }
  activeTmpDirs.clear();
}

process.on('SIGINT', () => {
  cleanupAll();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupAll();
  process.exit(143);
});
process.on('exit', () => {
  cleanupAll();
});

function validateSpec(spec) {
  if (spec.startsWith('-')) {
    throw new Error(`Invalid package spec: "${spec}" (looks like a flag, not a package name)`);
  }
}

function extractPkgName(spec) {
  if (spec.startsWith('@')) {
    const rest = spec.slice(1);
    const atIdx = rest.indexOf('@');
    return atIdx === -1 ? spec : '@' + rest.slice(0, atIdx);
  }
  const atIdx = spec.indexOf('@');
  return atIdx === -1 ? spec : spec.slice(0, atIdx);
}

function install(spec, opts = {}) {
  validateSpec(spec);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-'));
  trackDir(tmpDir);

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'sizeup-tmp', version: '1.0.0', private: true })
  );

  const args = ['install', '--ignore-scripts', '--production'];
  if (opts.force) args.push('--force');
  args.push(spec);
  try {
    execFileSync('npm', args, {
      cwd: tmpDir,
      timeout: 60000,
      stdio: 'pipe',
    });
  } catch (err) {
    cleanup(tmpDir);
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`Failed to install ${spec}: ${stderr.split('\n').filter(l => l.includes('ERR!')).join(' ') || err.message}`);
  }

  // Find the installed package directory
  const nodeModules = path.join(tmpDir, 'node_modules');

  const pkgName = extractPkgName(spec);

  const pkgDir = path.join(nodeModules, pkgName);

  if (!fs.existsSync(pkgDir)) {
    cleanup(tmpDir);
    throw new Error(`Package directory not found: ${pkgDir}`);
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')
  );

  return { tmpDir, pkgDir, packageJson };
}

function cleanup(tmpDir) {
  untrackDir(tmpDir);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

function installAsync(spec, opts = {}) {
  validateSpec(spec);
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-'));
    trackDir(tmpDir);

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'sizeup-tmp', version: '1.0.0', private: true })
    );

    const args = ['install', '--ignore-scripts', '--production'];
    if (opts.force) args.push('--force');
    args.push(spec);
    execFile('npm', args, {
      cwd: tmpDir,
      timeout: 60000,
    }, (err, _stdout, stderr) => {
      if (err) {
        cleanup(tmpDir);
        const lines = stderr ? stderr.split('\n').filter(l => l.includes('ERR!')).join(' ') : '';
        return reject(new Error(`Failed to install ${spec}: ${lines || err.message}`));
      }

      const pkgName = extractPkgName(spec);

      const pkgDir = path.join(tmpDir, 'node_modules', pkgName);

      if (!fs.existsSync(pkgDir)) {
        cleanup(tmpDir);
        return reject(new Error(`Package directory not found: ${pkgDir}`));
      }

      const packageJson = JSON.parse(
        fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')
      );

      resolve({ tmpDir, pkgDir, packageJson });
    });
  });
}

function installBatchAsync(specs, onProgress, opts = {}) {
  for (const spec of specs) validateSpec(spec);
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-'));
    trackDir(tmpDir);

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'sizeup-tmp', version: '1.0.0', private: true })
    );

    const nodeModules = path.join(tmpDir, 'node_modules');
    const targetNames = specs.map(s => extractPkgName(s));
    let pollTimer;
    if (onProgress) {
      pollTimer = setInterval(() => {
        try {
          if (!fs.existsSync(nodeModules)) return;
          let count = 0;
          for (const name of targetNames) {
            if (fs.existsSync(path.join(nodeModules, name, 'package.json'))) {
              count++;
            }
          }
          onProgress(count);
        } catch { /* ignore */ }
      }, 500);
    }

    const args = ['install', '--ignore-scripts', '--production'];
    if (opts.force) args.push('--force');
    args.push(...specs);
    execFile('npm', args, {
      cwd: tmpDir,
      timeout: 120000,
    }, (err, _stdout, stderr) => {
      if (pollTimer) clearInterval(pollTimer);

      if (err) {
        cleanup(tmpDir);
        const lines = stderr ? stderr.split('\n').filter(l => l.includes('ERR!')).join(' ') : '';
        return reject(new Error(`Batch install failed: ${lines || err.message}`));
      }

      const results = {};
      for (const spec of specs) {
        const pkgName = extractPkgName(spec);
        const pkgDir = path.join(tmpDir, 'node_modules', pkgName);
        if (fs.existsSync(pkgDir)) {
          try {
            const packageJson = JSON.parse(
              fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')
            );
            results[pkgName] = { pkgDir, packageJson };
          } catch {
            // skip packages with unreadable package.json
          }
        }
      }

      resolve({ tmpDir, results });
    });
  });
}

module.exports = { install, installAsync, installBatchAsync, cleanup, extractPkgName };
