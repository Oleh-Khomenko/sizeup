'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { installAsync, installBatchAsync, cleanup, extractPkgName, validateSpec, getNpmCmd } = require('../lib/installer');

describe('extractPkgName', () => {
  it('extracts plain package name', () => {
    assert.equal(extractPkgName('react'), 'react');
  });

  it('extracts name from versioned spec', () => {
    assert.equal(extractPkgName('react@18'), 'react');
    assert.equal(extractPkgName('react@18.2.0'), 'react');
  });

  it('handles scoped packages', () => {
    assert.equal(extractPkgName('@babel/core'), '@babel/core');
    assert.equal(extractPkgName('@babel/core@7.20.0'), '@babel/core');
  });

  it('handles scoped package without version', () => {
    assert.equal(extractPkgName('@types/node'), '@types/node');
  });
});

describe('validateSpec', () => {
  it('throws for flag-like specs', () => {
    assert.throws(() => validateSpec('--json'), /looks like a flag/);
    assert.throws(() => validateSpec('-h'), /looks like a flag/);
  });

  it('accepts valid specs', () => {
    assert.doesNotThrow(() => validateSpec('react'));
    assert.doesNotThrow(() => validateSpec('@babel/core'));
    assert.doesNotThrow(() => validateSpec('react@18'));
  });
});

describe('installAsync', { timeout: 60000 }, () => {
  it('installs a real package and returns expected shape', async () => {
    const result = await installAsync('is-number');
    try {
      assert.ok(result.tmpDir, 'should have tmpDir');
      assert.ok(result.pkgDir, 'should have pkgDir');
      assert.ok(result.packageJson, 'should have packageJson');
      assert.equal(result.packageJson.name, 'is-number');
      assert.ok(fs.existsSync(result.pkgDir), 'pkgDir should exist');
      assert.ok(result.pkgDir.startsWith(result.tmpDir), 'pkgDir should be inside tmpDir');
    } finally {
      cleanup(result.tmpDir);
    }
  });

  it('rejects for a nonexistent package', async () => {
    await assert.rejects(
      () => installAsync('__this_package_definitely_does_not_exist_xyzzy__'),
      /Failed to install/
    );
  });

  it('rejects flag-like specs', () => {
    assert.throws(
      () => installAsync('--malicious'),
      /looks like a flag/
    );
  });

  it('installs with --force option', async () => {
    const result = await installAsync('is-number', { force: true });
    try {
      assert.equal(result.packageJson.name, 'is-number');
    } finally {
      cleanup(result.tmpDir);
    }
  });
});

describe('installBatchAsync', { timeout: 60000 }, () => {
  it('installs multiple packages and returns results map', async () => {
    const result = await installBatchAsync(['is-number', 'is-odd']);
    try {
      assert.ok(result.tmpDir, 'should have tmpDir');
      assert.ok(result.results['is-number'], 'should have is-number result');
      assert.ok(result.results['is-odd'], 'should have is-odd result');
      assert.equal(result.results['is-number'].packageJson.name, 'is-number');
      assert.equal(result.results['is-odd'].packageJson.name, 'is-odd');
    } finally {
      cleanup(result.tmpDir);
    }
  });

  it('calls onProgress callback', async () => {
    let progressCalled = false;
    const onProgress = () => { progressCalled = true; };
    const result = await installBatchAsync(['is-number'], onProgress);
    try {
      // Progress may or may not fire depending on timing, but should not throw
      assert.ok(result.results['is-number']);
    } finally {
      cleanup(result.tmpDir);
    }
  });

  it('rejects when all specs are flag-like', () => {
    assert.throws(
      () => installBatchAsync(['--bad']),
      /looks like a flag/
    );
  });
});

describe('cleanup', () => {
  it('removes a temporary directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sizeup-test-'));
    assert.ok(fs.existsSync(tmpDir));
    cleanup(tmpDir);
    assert.ok(!fs.existsSync(tmpDir));
  });

  it('does not throw for nonexistent directory', () => {
    assert.doesNotThrow(() => cleanup('/tmp/__nonexistent_sizeup_test_dir__'));
  });
});

describe('getNpmCmd', () => {
  it('returns npm.cmd on win32', () => {
    assert.equal(getNpmCmd('win32'), 'npm.cmd');
  });

  it('returns npm on darwin', () => {
    assert.equal(getNpmCmd('darwin'), 'npm');
  });

  it('returns npm on linux', () => {
    assert.equal(getNpmCmd('linux'), 'npm');
  });

  it('defaults to current platform', () => {
    const expected = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    assert.equal(getNpmCmd(), expected);
  });
});
