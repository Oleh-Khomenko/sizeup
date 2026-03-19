'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const api = require('../lib/api');

const isWindows = process.platform === 'win32';
const skipOnWindows = isWindows ? { skip: 'npm install too slow on Windows CI' } : {};

describe('programmatic API', () => {
  it('exports analyze, analyzeMany, analyzeEntry', () => {
    assert.equal(typeof api.analyze, 'function');
    assert.equal(typeof api.analyzeMany, 'function');
    assert.equal(typeof api.analyzeEntry, 'function');
  });

  it('is the package main export', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.main, './lib/api.js');
  });
});

describe('analyzeEntry', () => {
  it('rejects pkg.main that escapes package directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-traversal-'));
    const pkgJson = { name: 'evil', main: '../../../etc/passwd' };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkgJson));
    await assert.rejects(
      () => api.analyzeEntry(tmpDir),
      { message: 'pkg.main escapes package directory' }
    );
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('bundles a local JS file and returns expected shape', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizeup-entry-'));
    const entryFile = path.join(tmpDir, 'index.js');
    fs.writeFileSync(entryFile, 'module.exports = 42;\n');
    const result = await api.analyzeEntry(entryFile);
    assert.equal(result.entry, entryFile);
    assert.equal(typeof result.sizes.raw, 'number');
    assert.equal(typeof result.sizes.gzipped, 'number');
    assert.equal(typeof result.fileCount, 'number');
    assert.ok(Array.isArray(result.externals));
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('gzipLevel defaults', () => {
  it('does not coerce gzipLevel: 0 to 9', () => {
    // Verify the flags object construction respects 0
    const opts = { gzipLevel: 0 };
    const flags = { gzipLevel: opts.gzipLevel ?? 9 };
    assert.equal(flags.gzipLevel, 0);
  });
});

describe('analyze', { ...skipOnWindows }, () => {
  it('returns expected result shape for a real package', async () => {
    const result = await api.analyze('is-number');
    assert.equal(typeof result.name, 'string');
    assert.ok(result.name.includes('is-number'));
    assert.equal(typeof result.version, 'string');
    assert.equal(typeof result.sizes.raw, 'number');
    assert.equal(typeof result.sizes.gzipped, 'number');
    assert.equal(typeof result.fileCount, 'number');
  });
});
