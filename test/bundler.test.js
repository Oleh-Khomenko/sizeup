'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveExport, safePkgResolve, findEntryPoint, buildWithRetry, bundleEntry } = require('../lib/bundler');

describe('resolveExport', () => {
  it('resolves a string export', () => {
    assert.equal(resolveExport('./index.js'), './index.js');
  });

  it('filters .d.ts files', () => {
    assert.equal(resolveExport('./index.d.ts'), null);
  });

  it('filters .d.mts files', () => {
    assert.equal(resolveExport('./index.d.mts'), null);
  });

  it('resolves .css files', () => {
    assert.equal(resolveExport('./style.css'), './style.css');
  });

  it('filters .scss files', () => {
    assert.equal(resolveExport('./style.scss'), null);
  });

  it('filters .less files', () => {
    assert.equal(resolveExport('./style.less'), null);
  });

  it('resolves first valid item in an array', () => {
    assert.equal(resolveExport(['./index.d.ts', './index.js']), './index.js');
  });

  it('resolves .css from array of mixed items', () => {
    assert.equal(resolveExport(['./index.d.ts', './style.css']), './style.css');
  });

  it('resolves "." key in object', () => {
    assert.equal(resolveExport({ '.': './main.js' }), './main.js');
  });

  it('resolves "import" key', () => {
    assert.equal(resolveExport({ import: './esm.js', require: './cjs.js' }), './esm.js');
  });

  it('resolves "default" key', () => {
    assert.equal(resolveExport({ default: './main.js' }), './main.js');
  });

  it('resolves nested objects', () => {
    assert.equal(resolveExport({ '.': { import: './esm.js', require: './cjs.js' } }), './esm.js');
  });

  it('skips "types" key', () => {
    assert.equal(resolveExport({ types: './index.d.ts', default: './index.js' }), './index.js');
  });

  it('returns null for null input', () => {
    assert.equal(resolveExport(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(resolveExport(undefined), null);
  });

  it('returns null for number input', () => {
    assert.equal(resolveExport(42), null);
  });

  it('resolves fallback keys after priority keys', () => {
    assert.equal(resolveExport({ node: './node.js' }), './node.js');
  });

  it('skips sub-path exports when no main entry exists', () => {
    assert.equal(resolveExport({ './foo': './foo.js' }), null);
  });

  it('resolves non-standard condition keys', () => {
    assert.equal(resolveExport({ development: './dev.js' }), './dev.js');
  });
});

describe('safePkgResolve', () => {
  // Use path.resolve to get platform-correct absolute paths
  const pkgDir = path.resolve('/pkg');
  const deepPkgDir = path.resolve('/a/b/pkg');

  it('resolves path within package', () => {
    const result = safePkgResolve(pkgDir, './index.js');
    assert.equal(result, path.resolve(pkgDir, './index.js'));
  });

  it('rejects path traversal', () => {
    const result = safePkgResolve(pkgDir, '../../../etc/passwd');
    assert.equal(result, null);
  });

  it('returns null when resolved escapes pkgDir', () => {
    const result = safePkgResolve(deepPkgDir, '../../outside.js');
    assert.equal(result, null);
  });

  it('allows path equal to pkgDir', () => {
    const result = safePkgResolve(pkgDir, '.');
    assert.equal(result, path.resolve(pkgDir));
  });
});

describe('findEntryPoint', () => {
  let tmpDir;

  function setup(files, pkg) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundler-test-'));
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(tmpDir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
    return { pkgDir: tmpDir, pkg };
  }

  function teardown() {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  it('finds entry from exports field', () => {
    const { pkgDir, pkg } = setup(
      { 'dist/index.js': '' },
      { exports: { '.': './dist/index.js' } }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'dist/index.js'));
    } finally { teardown(); }
  });

  it('finds entry from module field', () => {
    const { pkgDir, pkg } = setup(
      { 'esm/index.js': '' },
      { module: './esm/index.js' }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'esm/index.js'));
    } finally { teardown(); }
  });

  it('finds entry from main field', () => {
    const { pkgDir, pkg } = setup(
      { 'lib/main.js': '' },
      { main: './lib/main.js' }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'lib/main.js'));
    } finally { teardown(); }
  });

  it('finds entry from main field with .js appended', () => {
    const { pkgDir, pkg } = setup(
      { 'lib/main.js': '' },
      { main: './lib/main' }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'lib/main.js'));
    } finally { teardown(); }
  });

  it('falls back to index.js', () => {
    const { pkgDir, pkg } = setup(
      { 'index.js': '' },
      {}
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'index.js'));
    } finally { teardown(); }
  });

  it('throws when no entry found', () => {
    const { pkgDir, pkg } = setup({}, {});
    try {
      assert.throws(() => findEntryPoint(pkgDir, pkg), /Could not find entry point/);
    } finally { teardown(); }
  });

  it('finds entry from main field with .mjs appended', () => {
    const { pkgDir, pkg } = setup(
      { 'lib/main.mjs': '' },
      { main: './lib/main' }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'lib/main.mjs'));
    } finally { teardown(); }
  });

  it('finds entry from main field with .cjs appended', () => {
    const { pkgDir, pkg } = setup(
      { 'lib/main.cjs': '' },
      { main: './lib/main' }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'lib/main.cjs'));
    } finally { teardown(); }
  });

  it('prefers .js over .mjs when both exist', () => {
    const { pkgDir, pkg } = setup(
      { 'lib/main.js': '', 'lib/main.mjs': '' },
      { main: './lib/main' }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'lib/main.js'));
    } finally { teardown(); }
  });

  it('prefers exports over module', () => {
    const { pkgDir, pkg } = setup(
      { 'exports.js': '', 'module.js': '' },
      { exports: './exports.js', module: './module.js' }
    );
    try {
      assert.equal(findEntryPoint(pkgDir, pkg), path.join(pkgDir, 'exports.js'));
    } finally { teardown(); }
  });
});

describe('buildWithRetry', () => {
  let tmpDir;

  function writeTmpFile(name, content) {
    const filePath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildretry-'));
  }

  function teardown() {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  it('bundles a simple JS file', async () => {
    setup();
    try {
      const entry = writeTmpFile('index.js', 'export const x = 42;');
      const result = await buildWithRetry({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'esm',
        logLevel: 'silent',
      });
      assert.ok(result.outputFiles.length > 0);
      assert.ok(result.outputFiles[0].text.includes('42'));
      assert.equal(typeof result.fileCount, 'number');
      assert.ok(result.fileCount >= 1);
    } finally { teardown(); }
  });

  it('marks unresolvable bare imports as external on retry', async () => {
    setup();
    try {
      const entry = writeTmpFile('index.js', 'import foo from "nonexistent-pkg-xyzzy"; export default foo;');
      const result = await buildWithRetry({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'esm',
        logLevel: 'silent',
      });
      assert.ok(result.outputFiles.length > 0);
    } finally { teardown(); }
  });

  it('replaces non-JS files with empty content on retry', async () => {
    setup();
    try {
      const license = writeTmpFile('LICENSE', 'MIT License blah blah');
      const entry = writeTmpFile('index.js', `import "./LICENSE";\nexport const x = 1;`);
      const result = await buildWithRetry({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'esm',
        logLevel: 'silent',
      });
      assert.ok(result.outputFiles.length > 0);
    } finally { teardown(); }
  });

  it('throws after maxRetries exceeded', async () => {
    setup();
    try {
      const entry = writeTmpFile('index.js', 'this is not valid {{{{ javascript}}}}');
      await assert.rejects(
        () => buildWithRetry({
          entryPoints: [entry],
          bundle: true,
          write: false,
          format: 'esm',
          logLevel: 'silent',
        }, 1),
        /Build failed/
      );
    } finally { teardown(); }
  });

  it('handles .node native addon files on retry', async () => {
    setup();
    try {
      const addon = writeTmpFile('native.node', '\x00\x01\x02binary');
      const entry = writeTmpFile('index.js', `require("${addon.replace(/\\/g, '/')}");\nexport const x = 1;`);
      const result = await buildWithRetry({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'esm',
        logLevel: 'silent',
      });
      assert.ok(result.outputFiles.length > 0);
    } finally { teardown(); }
  });

  it('throws immediately for non-esbuild errors', async () => {
    await assert.rejects(
      () => buildWithRetry({
        entryPoints: ['/nonexistent/__does_not_exist__.js'],
        bundle: true,
        write: false,
        format: 'esm',
        logLevel: 'silent',
      }),
      (err) => err.errors && err.errors.length > 0
    );
  });
});

describe('bundleEntry', () => {
  let tmpDir;

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundleentry-'));
  }

  function teardown() {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  it('bundles a local file and detects externals', async () => {
    setup();
    try {
      const entry = path.join(tmpDir, 'index.js');
      fs.writeFileSync(entry, 'import path from "path";\nexport default path.join("a", "b");');
      const result = await bundleEntry(entry);
      assert.equal(typeof result.raw, 'string');
      assert.equal(typeof result.minified, 'string');
      assert.ok(result.minified.length <= result.raw.length);
      assert.ok(Array.isArray(result.externals));
      assert.ok(result.externals.includes('path'));
      assert.equal(typeof result.fileCount, 'number');
    } finally { teardown(); }
  });

  it('returns empty externals for self-contained code', async () => {
    setup();
    try {
      const entry = path.join(tmpDir, 'index.js');
      fs.writeFileSync(entry, 'export const x = 1 + 2;');
      const result = await bundleEntry(entry);
      assert.deepEqual(result.externals, []);
    } finally { teardown(); }
  });
});
