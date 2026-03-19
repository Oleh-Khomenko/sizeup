'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeOne } = require('../lib/analyzer');

describe('analyzeOne integration', { timeout: 60000 }, () => {
  it('analyzes a real package end-to-end', async () => {
    const result = await analyzeOne('is-number', { noCache: true });
    assert.equal(result.name, 'is-number');
    assert.ok(result.version, 'should have a version');
    assert.ok(result.sizes.raw > 0, 'raw size should be positive');
    assert.ok(result.sizes.minified > 0, 'minified size should be positive');
    assert.ok(result.sizes.gzipped > 0, 'gzipped size should be positive');
    assert.ok(result.sizes.minified <= result.sizes.raw, 'minified should be <= raw');
    assert.ok(result.sizes.gzipped <= result.sizes.minified, 'gzipped should be <= minified');
    assert.equal(typeof result.fileCount, 'number');
    assert.ok(result.fileCount >= 1, 'should have at least 1 file');
    assert.ok(Array.isArray(result.dependencies));
    assert.equal(typeof result.treeshake, 'boolean');
  });
});
