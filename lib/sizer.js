'use strict';

const zlib = require('zlib');

function measure(raw, minified) {
  const rawBuf = Buffer.from(raw, 'utf8');
  const minBuf = Buffer.from(minified, 'utf8');
  const gzipped = zlib.gzipSync(minBuf, { level: 9 });

  return {
    raw: rawBuf.length,
    minified: minBuf.length,
    gzipped: gzipped.length,
  };
}

module.exports = { measure };
