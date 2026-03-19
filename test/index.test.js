'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, parseBudget, parsePackageSpec, checkBudget, isPath, formatSizeInline } = require('../index');

describe('parseArgs', () => {
  function parse(...args) {
    return parseArgs(['node', 'index.js', ...args]);
  }

  it('parses --help', () => {
    assert.equal(parse('--help').flags.help, true);
    assert.equal(parse('-h').flags.help, true);
  });

  it('parses --json', () => {
    assert.equal(parse('--json').flags.json, true);
  });

  it('parses --budget with value', () => {
    assert.equal(parse('--budget', '50kB').flags.budget, '50kB');
  });

  it('parses --budget-brotli with value', () => {
    assert.equal(parse('--budget-brotli', '40kB').flags.budgetBrotli, '40kB');
  });

  it('parses --no-cache', () => {
    assert.equal(parse('--no-cache').flags.noCache, true);
  });

  it('parses --clear-cache', () => {
    assert.equal(parse('--clear-cache').flags.clearCache, true);
  });

  it('parses --brotli', () => {
    assert.equal(parse('--brotli').flags.brotli, true);
  });

  it('parses --gzip-level', () => {
    assert.equal(parse('--gzip-level', '6').flags.gzipLevel, 6);
  });

  it('collects positional arguments', () => {
    const { positional } = parse('react', 'vue');
    assert.deepEqual(positional, ['react', 'vue']);
  });

  it('mixes flags and positional', () => {
    const { flags, positional } = parse('react', '--json', '--budget', '50kB');
    assert.deepEqual(positional, ['react']);
    assert.equal(flags.json, true);
    assert.equal(flags.budget, '50kB');
  });
});

describe('parseBudget', () => {
  it('parses bytes', () => {
    assert.equal(parseBudget('100B'), 100);
  });

  it('parses kilobytes', () => {
    assert.equal(parseBudget('50kB'), 50000);
    assert.equal(parseBudget('50KB'), 50000);
  });

  it('parses megabytes', () => {
    assert.equal(parseBudget('1MB'), 1000000);
  });

  it('handles decimal values', () => {
    assert.equal(parseBudget('1.5MB'), 1500000);
  });

  it('throws on invalid format', () => {
    assert.throws(() => parseBudget('abc'), /Invalid budget format/);
    assert.throws(() => parseBudget('50'), /Invalid budget format/);
    assert.throws(() => parseBudget('50GB'), /Invalid budget format/);
  });
});

describe('parsePackageSpec', () => {
  it('parses plain name', () => {
    const { name, version, spec } = parsePackageSpec('react');
    assert.equal(name, 'react');
    assert.equal(version, 'latest');
    assert.equal(spec, 'react');
  });

  it('parses name@version', () => {
    const { name, version, spec } = parsePackageSpec('react@18.2.0');
    assert.equal(name, 'react');
    assert.equal(version, '18.2.0');
    assert.equal(spec, 'react@18.2.0');
  });

  it('parses scoped package', () => {
    const { name, version } = parsePackageSpec('@babel/core');
    assert.equal(name, '@babel/core');
    assert.equal(version, 'latest');
  });

  it('parses scoped package with version', () => {
    const { name, version, spec } = parsePackageSpec('@babel/core@7.20.0');
    assert.equal(name, '@babel/core');
    assert.equal(version, '7.20.0');
    assert.equal(spec, '@babel/core@7.20.0');
  });
});

describe('checkBudget', () => {
  const makeResult = (name, gzipped, brotli) => ({
    name,
    sizes: { raw: gzipped * 3, minified: gzipped * 2, gzipped, ...(brotli != null ? { brotli } : {}) },
  });

  it('passes when under gzip budget', () => {
    const r = makeResult('pkg', 5000);
    const { budgetResults, failed } = checkBudget(r, { budget: '10kB' }, true);
    assert.equal(failed, false);
    assert.equal(budgetResults[0].pass, true);
    assert.equal(budgetResults[0].type, 'gzip');
  });

  it('fails when over gzip budget', () => {
    const r = makeResult('pkg', 15000);
    const { budgetResults, failed } = checkBudget(r, { budget: '10kB' }, true);
    assert.equal(failed, true);
    assert.equal(budgetResults[0].pass, false);
  });

  it('checks brotli budget independently', () => {
    const r = makeResult('pkg', 5000, 4000);
    const { budgetResults, failed } = checkBudget(r, { budgetBrotli: '3kB' }, true);
    assert.equal(failed, true);
    assert.equal(budgetResults.length, 1);
    assert.equal(budgetResults[0].type, 'brotli');
  });

  it('checks both gzip and brotli budgets', () => {
    const r = makeResult('pkg', 5000, 4000);
    const { budgetResults } = checkBudget(r, { budget: '10kB', budgetBrotli: '5kB' }, true);
    assert.equal(budgetResults.length, 2);
    assert.equal(budgetResults[0].type, 'gzip');
    assert.equal(budgetResults[1].type, 'brotli');
  });

  it('handles arrays of results', () => {
    const results = [makeResult('a', 5000), makeResult('b', 15000)];
    const { budgetResults, failed } = checkBudget(results, { budget: '10kB' }, true);
    assert.equal(budgetResults.length, 2);
    assert.equal(failed, true);
    assert.equal(budgetResults[0].pass, true);
    assert.equal(budgetResults[1].pass, false);
  });

  it('returns empty results when no budget set', () => {
    const r = makeResult('pkg', 5000);
    const { budgetResults, failed } = checkBudget(r, {}, true);
    assert.equal(budgetResults.length, 0);
    assert.equal(failed, false);
  });
});

describe('isPath', () => {
  it('detects relative paths', () => {
    assert.equal(isPath('./src'), true);
    assert.equal(isPath('../lib'), true);
  });

  it('detects absolute paths', () => {
    assert.equal(isPath('/usr/local'), true);
  });

  it('rejects package names', () => {
    assert.equal(isPath('react'), false);
    assert.equal(isPath('react@18'), false);
  });

  it('rejects scoped packages', () => {
    assert.equal(isPath('@babel/core'), false);
  });

  it('detects Windows drive letter paths', () => {
    assert.equal(isPath('C:\\Users\\foo'), true);
    assert.equal(isPath('D:/projects'), true);
  });
});

describe('formatSizeInline', () => {
  it('formats bytes', () => {
    assert.equal(formatSizeInline(500), '500 B');
  });

  it('formats kilobytes', () => {
    assert.equal(formatSizeInline(1500), '1.5 kB');
  });

  it('formats megabytes', () => {
    assert.equal(formatSizeInline(1500000), '1.50 MB');
  });
});
