'use strict';

const zlib = require('zlib');

function measure(raw, minified, gzipLevel = 9, opts = {}) {
  const rawBuf = Buffer.from(raw, 'utf8');
  const minBuf = Buffer.from(minified, 'utf8');
  const gzipped = zlib.gzipSync(minBuf, { level: gzipLevel });

  const sizes = {
    raw: rawBuf.length,
    minified: minBuf.length,
    gzipped: gzipped.length,
  };

  if (opts.brotli) {
    sizes.brotli = zlib.brotliCompressSync(minBuf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY },
    }).length;
  }

  return sizes;
}

module.exports = { measure };
