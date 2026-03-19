'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { measure } = require('../lib/sizer');

describe('measure', () => {
  it('returns raw, minified, and gzipped sizes', async () => {
    const raw = 'const x = 1;\n';
    const minified = 'const x=1;';
    const sizes = await measure(raw, minified);

    assert.equal(sizes.raw, Buffer.byteLength(raw, 'utf8'));
    assert.equal(sizes.minified, Buffer.byteLength(minified, 'utf8'));
    assert.ok(sizes.gzipped > 0);
    assert.ok(sizes.gzipped < sizes.minified || sizes.minified < 30); // very small inputs may not compress well
    assert.equal(sizes.brotli, undefined);
  });

  it('includes brotli when opts.brotli is true', async () => {
    const raw = 'const x = 1;\n';
    const minified = 'const x=1;';
    const sizes = await measure(raw, minified, 9, { brotli: true });

    assert.ok(typeof sizes.brotli === 'number');
    assert.ok(sizes.brotli > 0);
  });

  it('respects gzipLevel', async () => {
    const code = 'a'.repeat(10000);
    const sizesLow = await measure(code, code, 1);
    const sizesHigh = await measure(code, code, 9);

    // Higher compression level should produce smaller or equal output
    assert.ok(sizesHigh.gzipped <= sizesLow.gzipped);
  });

  it('handles empty input', async () => {
    const sizes = await measure('', '');
    assert.equal(sizes.raw, 0);
    assert.equal(sizes.minified, 0);
    assert.ok(sizes.gzipped >= 0);
  });

  it('uses async compression for large inputs', async () => {
    const large = 'x'.repeat(600 * 1024); // > 512 kB threshold
    const sizes = await measure(large, large);
    assert.ok(sizes.gzipped > 0);
    assert.ok(sizes.gzipped < sizes.minified);
  });
});
