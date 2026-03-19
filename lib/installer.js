'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';

function getNpmCmd(platform) {
  return (platform || process.platform) === 'win32' ? 'npm.cmd' : 'npm';
}

const NPM_CMD = getNpmCmd();

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

function extractPkgName(spec) {
  return parsePackageSpec(spec).name;
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
    execFile(NPM_CMD, args, {
      cwd: tmpDir,
      timeout: 60000,
      shell: IS_WIN,
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
    execFile(NPM_CMD, args, {
      cwd: tmpDir,
      timeout: 120000,
      shell: IS_WIN,
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

module.exports = { installAsync, installBatchAsync, cleanup, extractPkgName, validateSpec, parsePackageSpec, getNpmCmd };
