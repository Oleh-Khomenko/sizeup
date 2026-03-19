'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cache entries are keyed by name@version, so a specific version's
// bundle size never changes. Use a 30-day TTL just to prune stale entries.
const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000;

function getCacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(require('os').homedir(), '.cache');
  return path.join(base, 'sizeup');
}

function cacheKey(spec, flags) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ spec, gzipLevel: flags.gzipLevel || 9, brotli: !!flags.brotli }))
    .digest('hex');
  return hash + '.json';
}

function getCached(spec, flags, ttlMs = DEFAULT_TTL) {
  try {
    const filePath = path.join(getCacheDir(), cacheKey(spec, flags));
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > ttlMs) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function putCached(spec, flags, result) {
  try {
    const dir = getCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, cacheKey(spec, flags));
    fs.writeFileSync(filePath, JSON.stringify(result));
  } catch {
    // Best effort — cache write failure is non-fatal
  }
}

function clearCache() {
  try {
    const dir = getCacheDir();
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Already clean or inaccessible
  }
}

module.exports = { getCached, putCached, clearCache, getCacheDir };
