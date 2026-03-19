'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.join(__dirname, '..', 'index.js');
const isWindows = process.platform === 'win32';
const skipOnWindows = isWindows ? { skip: 'npm install too slow on Windows CI' } : {};

function run(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile('node', [CLI, ...args], { timeout }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr, exitCode: err ? err.code : 0 });
    });
  });
}

describe('runDiff (--diff)', { timeout: 120000, ...skipOnWindows }, () => {
  it('compares two package versions in JSON mode', async () => {
    const { stdout, exitCode } = await run(['--diff', 'is-number@7.0.0', 'is-number@7.0.0', '--json']);
    assert.equal(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.ok(output.before, 'should have before');
    assert.ok(output.after, 'should have after');
    assert.ok(output.delta, 'should have delta');
    assert.equal(typeof output.delta.gzipped, 'number');
    assert.equal(output.delta.gzipped, 0, 'same version should have zero delta');
  });

  it('rejects --diff with wrong argument count', async () => {
    const { stderr, exitCode } = await run(['--diff', 'react']);
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes('exactly 2'));
  });
});

describe('runDeps (--deps)', { timeout: 120000, ...skipOnWindows }, () => {
  it('shows dependency breakdown in JSON mode', async () => {
    const { stdout, exitCode } = await run(['--deps', 'is-odd', '--json']);
    assert.equal(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.ok(output.name, 'should have name');
    assert.ok(output.sizes, 'should have sizes');
    assert.ok(Array.isArray(output.breakdown), 'should have breakdown array');
  });

  it('rejects --deps with no arguments', async () => {
    const { stderr, exitCode } = await run(['--deps']);
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes('exactly 1'));
  });
});

describe('runMultiplePackages', { timeout: 120000, ...skipOnWindows }, () => {
  it('analyzes multiple packages in JSON mode', async () => {
    const { stdout, exitCode } = await run(['is-number', 'is-odd', '--json']);
    assert.equal(exitCode, 0);
    const output = JSON.parse(stdout);
    assert.ok(output.packages, 'should have packages array');
    assert.ok(output.packages.length >= 1, 'should have at least one result');
    for (const pkg of output.packages) {
      assert.ok(pkg.name);
      assert.ok(pkg.sizes);
      assert.ok(typeof pkg.sizes.gzipped === 'number');
    }
  });
});

describe('runEntry (--entry)', { timeout: 60000 }, () => {
  it('analyzes a local file in JSON mode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-orch-'));
    const entryFile = path.join(tmpDir, 'index.js');
    fs.writeFileSync(entryFile, 'module.exports = function() { return 42; };');
    try {
      const { stdout, exitCode } = await run(['--entry', entryFile, '--json']);
      assert.equal(exitCode, 0);
      const output = JSON.parse(stdout);
      assert.ok(output.entry);
      assert.ok(output.sizes);
      assert.equal(typeof output.sizes.gzipped, 'number');
      assert.ok(output.sizes.gzipped > 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('rejects nonexistent entry path', async () => {
    const { stderr, exitCode } = await run(['--entry', '/tmp/__nonexistent_sizeup_entry__']);
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.includes('does not exist'));
  });

  it('analyzes a directory with package.json in JSON mode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-orch-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ main: './index.js' }));
    fs.writeFileSync(path.join(tmpDir, 'index.js'), 'module.exports = "hello";');
    try {
      const { stdout, exitCode } = await run(['--entry', tmpDir, '--json']);
      assert.equal(exitCode, 0);
      const output = JSON.parse(stdout);
      assert.ok(output.sizes);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('scanLocalDeps', { timeout: 120000, ...skipOnWindows }, () => {
  it('scans a project directory in JSON mode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-scan-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: { 'is-number': '*' },
    }));
    try {
      const { stdout, exitCode } = await run([tmpDir, '--json']);
      assert.equal(exitCode, 0);
      const output = JSON.parse(stdout);
      assert.ok(output.packages, 'should have packages');
      assert.ok(output.packages.length >= 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('excludes packages with --exclude', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-scan-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: { 'is-number': '*', 'is-odd': '*' },
    }));
    try {
      const { stdout, exitCode } = await run([tmpDir, '--exclude', 'is-odd', '--json']);
      assert.equal(exitCode, 0);
      const output = JSON.parse(stdout);
      assert.ok(output.packages);
      const names = output.packages.map(p => p.name);
      assert.ok(!names.includes('is-odd'), 'is-odd should be excluded');
      assert.ok(names.some(n => n.includes('is-number')), 'is-number should be included');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('reports error for directory without package.json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-scan-'));
    try {
      const { stderr, exitCode } = await run([tmpDir]);
      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('No package.json'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('printHelp', () => {
  it('outputs help text without ANSI codes when piped', async () => {
    const { stdout, exitCode } = await run(['--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('sizeup'));
    assert.ok(stdout.includes('USAGE'));
    // When piped (non-TTY), should not contain ANSI escape codes
    assert.ok(!stdout.includes('\x1b['), 'should not contain ANSI codes when piped');
  });
});
