'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Override XDG_CACHE_HOME to use a temp dir for tests
let tmpDir;
const origXDG = process.env.XDG_CACHE_HOME;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
  process.env.XDG_CACHE_HOME = tmpDir;
});

afterEach(() => {
  if (origXDG !== undefined) {
    process.env.XDG_CACHE_HOME = origXDG;
  } else {
    delete process.env.XDG_CACHE_HOME;
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Re-require cache module after env setup — but since require caches modules,
// we use the exported functions which read env at call time via getCacheDir()
const { getCached, putCached, clearCache, getCacheDir } = require('../lib/cache');

describe('cache', () => {
  const spec = 'react@18.2.0';
  const flags = { gzipLevel: 9, brotli: false };
  const result = {
    name: 'react',
    version: '18.2.0',
    sizes: { raw: 1000, minified: 500, gzipped: 200 },
    dependencies: [],
    fileCount: 1,
    treeshake: true,
  };

  it('returns null on cache miss', () => {
    assert.equal(getCached(spec, flags), null);
  });

  it('round-trips put and get', () => {
    putCached(spec, flags, result);
    const cached = getCached(spec, flags);
    assert.deepEqual(cached, result);
  });

  it('returns null after TTL expires', async () => {
    putCached(spec, flags, result);
    // Verify it's cached
    assert.deepEqual(getCached(spec, flags, 100000), result);
    // Use 0ms TTL — any file older than 0ms is expired
    // We need a tiny delay so mtime is in the past
    await new Promise(r => setTimeout(r, 10));
    assert.equal(getCached(spec, flags, 1), null);
  });

  it('clearCache removes the cache directory', () => {
    putCached(spec, flags, result);
    const dir = getCacheDir();
    assert.ok(fs.existsSync(dir));
    clearCache();
    assert.ok(!fs.existsSync(dir));
  });

  it('uses different keys for different flags', () => {
    const flags2 = { gzipLevel: 6, brotli: true };
    putCached(spec, flags, result);
    assert.equal(getCached(spec, flags2), null);
  });
});
