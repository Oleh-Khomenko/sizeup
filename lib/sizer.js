'use strict';

const zlib = require('zlib');

// Threshold above which we use async compression to avoid blocking the event loop
const ASYNC_THRESHOLD = 512 * 1024; // 512 kB

function gzipAsync(buf, opts) {
  return new Promise((resolve, reject) => {
    zlib.gzip(buf, opts, (err, result) => err ? reject(err) : resolve(result));
  });
}

function brotliAsync(buf, opts) {
  return new Promise((resolve, reject) => {
    zlib.brotliCompress(buf, opts, (err, result) => err ? reject(err) : resolve(result));
  });
}

async function measure(raw, minified, gzipLevel = 9, opts = {}) {
  const rawSize = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.length;
  const minBuf = typeof minified === 'string' ? Buffer.from(minified, 'utf8') : minified;

  let gzipped;
  if (minBuf.length > ASYNC_THRESHOLD) {
    gzipped = await gzipAsync(minBuf, { level: gzipLevel });
  } else {
    gzipped = zlib.gzipSync(minBuf, { level: gzipLevel });
  }

  const sizes = {
    raw: rawSize,
    minified: minBuf.length,
    gzipped: gzipped.length,
  };

  if (opts.brotli) {
    const brotliOpts = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY } };
    if (minBuf.length > ASYNC_THRESHOLD) {
      sizes.brotli = (await brotliAsync(minBuf, brotliOpts)).length;
    } else {
      sizes.brotli = zlib.brotliCompressSync(minBuf, brotliOpts).length;
    }
  }

  return sizes;
}

module.exports = { measure };
