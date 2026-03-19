'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatSize, formatMs, formatTime, formatJson, format, formatTable, formatDiff, formatEntry, formatDepBreakdown, formatMarkdownTable, formatMarkdownSingle, formatMarkdownDiff, formatMarkdownDeps, formatMarkdownEntry } = require('../lib/formatter');

describe('formatSize', () => {
  it('formats bytes', () => {
    assert.equal(formatSize(0), '0 B');
    assert.equal(formatSize(999), '999 B');
  });

  it('formats kilobytes', () => {
    assert.equal(formatSize(1000), '1.0 kB');
    assert.equal(formatSize(1500), '1.5 kB');
    assert.equal(formatSize(999999), '1000.0 kB');
  });

  it('formats megabytes', () => {
    assert.equal(formatSize(1000000), '1.00 MB');
    assert.equal(formatSize(2500000), '2.50 MB');
  });
});

describe('formatMs', () => {
  it('handles sub-millisecond', () => {
    assert.equal(formatMs(0.5), '< 1 ms');
  });

  it('formats milliseconds', () => {
    assert.equal(formatMs(500), '500 ms');
  });

  it('formats seconds', () => {
    assert.equal(formatMs(1500), '1.5 s');
  });

  it('formats minutes', () => {
    assert.equal(formatMs(90000), '1.5 min');
  });
});

describe('formatTime', () => {
  it('returns slow3g and fast4g strings', () => {
    const t = formatTime(50000); // 50 kB
    assert.ok(typeof t.slow3g === 'string');
    assert.ok(typeof t.fast4g === 'string');
  });
});

describe('formatJson', () => {
  it('pretty-prints JSON', () => {
    const data = { a: 1, b: [2, 3] };
    assert.equal(formatJson(data), JSON.stringify(data, null, 2));
  });
});

describe('format', () => {
  it('includes package name and sizes', () => {
    const result = {
      name: 'test-pkg',
      version: '1.0.0',
      sizes: { raw: 1000, minified: 500, gzipped: 200 },
      dependencies: ['dep-a'],
      fileCount: 3,
      treeshake: true,
    };
    const out = format(result);
    assert.ok(out.includes('test-pkg'));
    assert.ok(out.includes('1.0.0'));
  });

  it('includes brotli line when present', () => {
    const result = {
      name: 'test-pkg',
      version: '1.0.0',
      sizes: { raw: 1000, minified: 500, gzipped: 200, brotli: 180 },
      dependencies: [],
      fileCount: 1,
      treeshake: false,
    };
    const out = format(result);
    assert.ok(out.includes('Brotli'));
  });
});

describe('formatTable', () => {
  it('formats multiple results into a table', () => {
    const results = [
      { name: 'a', version: '1.0.0', sizes: { raw: 1000, minified: 500, gzipped: 200 }, dependencies: [], fileCount: 1, treeshake: true },
      { name: 'b', version: '2.0.0', sizes: { raw: 2000, minified: 1000, gzipped: 400 }, dependencies: [], fileCount: 2, treeshake: false },
    ];
    const out = formatTable(results);
    assert.ok(out.includes('Package'));
    assert.ok(out.includes('Total'));
  });
});

describe('formatDiff', () => {
  it('shows before and after', () => {
    const a = { name: 'pkg', version: '1.0.0', sizes: { raw: 1000, minified: 500, gzipped: 200 }, dependencies: [], fileCount: 1, treeshake: true };
    const b = { name: 'pkg', version: '2.0.0', sizes: { raw: 2000, minified: 1000, gzipped: 400 }, dependencies: ['x'], fileCount: 2, treeshake: true };
    const out = formatDiff(a, b);
    assert.ok(out.includes('Before'));
    assert.ok(out.includes('After'));
  });
});

describe('formatEntry', () => {
  it('shows entry path and sizes', () => {
    const result = {
      entry: './src/index.js',
      sizes: { raw: 1000, minified: 500, gzipped: 200 },
      fileCount: 1,
      externals: ['react'],
    };
    const out = formatEntry(result);
    assert.ok(out.includes('./src/index.js'));
    assert.ok(out.includes('react'));
  });
});

describe('formatMarkdownTable', () => {
  it('produces valid markdown with headers and rows', () => {
    const results = [
      { name: 'a', version: '1.0.0', sizes: { raw: 1000, minified: 500, gzipped: 200 }, dependencies: [], fileCount: 1, treeshake: true },
      { name: 'b', version: '2.0.0', sizes: { raw: 2000, minified: 1000, gzipped: 400 }, dependencies: [], fileCount: 2, treeshake: false },
    ];
    const out = formatMarkdownTable(results);
    assert.ok(out.includes('| Package |'));
    assert.ok(out.includes('| :--- |'));
    assert.ok(out.includes('| b |'));
    assert.ok(out.includes('| a |'));
    assert.ok(out.includes('| **Total** |'));
  });

  it('sorts by gzipped size descending', () => {
    const results = [
      { name: 'small', version: '1.0.0', sizes: { raw: 100, minified: 50, gzipped: 20 }, dependencies: [], fileCount: 1, treeshake: true },
      { name: 'big', version: '1.0.0', sizes: { raw: 5000, minified: 3000, gzipped: 1000 }, dependencies: [], fileCount: 1, treeshake: true },
    ];
    const out = formatMarkdownTable(results);
    const bigIdx = out.indexOf('| big |');
    const smallIdx = out.indexOf('| small |');
    assert.ok(bigIdx < smallIdx);
  });

  it('includes brotli column when present', () => {
    const results = [
      { name: 'a', version: '1.0.0', sizes: { raw: 1000, minified: 500, gzipped: 200, brotli: 180 }, dependencies: [], fileCount: 1, treeshake: true },
    ];
    const out = formatMarkdownTable(results);
    assert.ok(out.includes('Brotli'));
  });
});

describe('formatDepBreakdown', () => {
  it('shows dependency percentages', () => {
    const main = { name: 'pkg', version: '1.0.0', sizes: { raw: 10000, minified: 5000, gzipped: 2000 }, dependencies: ['a'], fileCount: 5, treeshake: false };
    const deps = [{ name: 'a', version: '1.0.0', sizes: { raw: 5000, minified: 2500, gzipped: 1000 }, dependencies: [], fileCount: 2, treeshake: false }];
    const out = formatDepBreakdown(main, deps);
    assert.ok(out.includes('Dependency'));
    assert.ok(out.includes('Own code'));
  });
});

describe('formatMarkdownSingle', () => {
  it('produces markdown key-value table', () => {
    const result = {
      name: 'react', version: '18.0.0',
      sizes: { raw: 10000, minified: 5000, gzipped: 2000 },
      dependencies: ['dep-a'], fileCount: 3, treeshake: true,
    };
    const out = formatMarkdownSingle(result);
    assert.ok(out.includes('## react@18.0.0'));
    assert.ok(out.includes('| Metric | Value |'));
    assert.ok(out.includes('| Minified |'));
    assert.ok(out.includes('| Gzipped |'));
    assert.ok(out.includes('| Tree Shake | Yes |'));
  });

  it('includes brotli when present', () => {
    const result = {
      name: 'pkg', version: '1.0.0',
      sizes: { raw: 1000, minified: 500, gzipped: 200, brotli: 180 },
      dependencies: [], fileCount: 1, treeshake: false,
    };
    const out = formatMarkdownSingle(result);
    assert.ok(out.includes('| Brotli |'));
  });
});

describe('formatMarkdownDiff', () => {
  it('shows before/after with delta', () => {
    const a = { name: 'pkg', version: '1.0.0', sizes: { raw: 1000, minified: 500, gzipped: 200 }, dependencies: [], fileCount: 1, treeshake: true };
    const b = { name: 'pkg', version: '2.0.0', sizes: { raw: 2000, minified: 1000, gzipped: 400 }, dependencies: ['x'], fileCount: 2, treeshake: true };
    const out = formatMarkdownDiff(a, b);
    assert.ok(out.includes('## pkg: 1.0.0'));
    assert.ok(out.includes('| Metric | Before | After | Delta |'));
    assert.ok(out.includes('| Minified |'));
    assert.ok(out.includes(':red_circle:'));
  });

  it('shows green circle for size decrease', () => {
    const a = { name: 'pkg', version: '2.0.0', sizes: { raw: 2000, minified: 1000, gzipped: 400 }, dependencies: [], fileCount: 2, treeshake: true };
    const b = { name: 'pkg', version: '3.0.0', sizes: { raw: 1000, minified: 500, gzipped: 200 }, dependencies: [], fileCount: 1, treeshake: true };
    const out = formatMarkdownDiff(a, b);
    assert.ok(out.includes(':green_circle:'));
  });
});

describe('formatMarkdownDeps', () => {
  it('shows dependency breakdown as markdown', () => {
    const main = { name: 'pkg', version: '1.0.0', sizes: { raw: 10000, minified: 5000, gzipped: 2000 }, dependencies: ['a'], fileCount: 5, treeshake: false };
    const deps = [{ name: 'a', version: '1.0.0', sizes: { raw: 5000, minified: 2500, gzipped: 1000 }, dependencies: [], fileCount: 2, treeshake: false }];
    const out = formatMarkdownDeps(main, deps);
    assert.ok(out.includes('## pkg@1.0.0'));
    assert.ok(out.includes('| Dependency | Gzipped | % of Total |'));
    assert.ok(out.includes('| a |'));
    assert.ok(out.includes('| **Own code** |'));
  });
});

describe('formatMarkdownEntry', () => {
  it('shows entry analysis as markdown', () => {
    const result = {
      entry: './src/index.js',
      sizes: { raw: 1000, minified: 500, gzipped: 200 },
      fileCount: 1,
      externals: ['react'],
    };
    const out = formatMarkdownEntry(result);
    assert.ok(out.includes('## ./src/index.js'));
    assert.ok(out.includes('| Metric | Value |'));
    assert.ok(out.includes('| Files | 1 |'));
    assert.ok(out.includes('**External dependencies:**'));
    assert.ok(out.includes('react'));
  });

  it('omits externals section when empty', () => {
    const result = {
      entry: './app.js',
      sizes: { raw: 500, minified: 300, gzipped: 100 },
      fileCount: 1,
      externals: [],
    };
    const out = formatMarkdownEntry(result);
    assert.ok(!out.includes('External dependencies'));
  });
});
