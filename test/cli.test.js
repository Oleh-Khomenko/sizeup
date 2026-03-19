'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../lib/cli');

function parse(...args) {
  return parseArgs(['node', 'index.js', ...args]);
}

describe('parseArgs validation', () => {
  it('throws when --gzip-level is 0', () => {
    assert.throws(() => parse('--gzip-level', '0'), /--gzip-level must be an integer between 1 and 9/);
  });

  it('throws when --gzip-level is 10', () => {
    assert.throws(() => parse('--gzip-level', '10'), /--gzip-level must be an integer between 1 and 9/);
  });

  it('throws when --gzip-level is not a number', () => {
    assert.throws(() => parse('--gzip-level', 'abc'), /--gzip-level must be an integer between 1 and 9/);
  });

  it('accepts --gzip-level 1', () => {
    assert.equal(parse('--gzip-level', '1').flags.gzipLevel, 1);
  });

  it('accepts --gzip-level 9', () => {
    assert.equal(parse('--gzip-level', '9').flags.gzipLevel, 9);
  });

  it('throws when --concurrency is 0', () => {
    assert.throws(() => parse('--concurrency', '0'), /--concurrency must be a positive integer/);
  });

  it('throws when --concurrency is negative', () => {
    assert.throws(() => parse('--concurrency', '-1'), /--concurrency must be a positive integer/);
  });

  it('throws when --concurrency is not a number', () => {
    assert.throws(() => parse('--concurrency', 'abc'), /--concurrency must be a positive integer/);
  });

  it('accepts --concurrency 4', () => {
    assert.equal(parse('--concurrency', '4').flags.concurrency, 4);
  });

  it('throws when --budget has no value', () => {
    assert.throws(() => parse('--budget'), /--budget requires a value/);
  });

  it('throws when --budget-brotli has no value', () => {
    assert.throws(() => parse('--budget-brotli'), /--budget-brotli requires a value/);
  });

  it('throws when --entry has no value', () => {
    assert.throws(() => parse('--entry'), /--entry requires a value/);
  });

  it('throws when --gzip-level has no value', () => {
    assert.throws(() => parse('--gzip-level'), /--gzip-level requires a value/);
  });

  it('throws when --concurrency has no value', () => {
    assert.throws(() => parse('--concurrency'), /--concurrency requires a value/);
  });

  it('parses --version', () => {
    assert.equal(parse('--version').flags.version, true);
  });

  it('parses -v', () => {
    assert.equal(parse('-v').flags.version, true);
  });

  it('parses --top with value', () => {
    assert.equal(parse('--top', '10').flags.top, 10);
  });

  it('throws when --top is 0', () => {
    assert.throws(() => parse('--top', '0'), /--top must be a positive integer/);
  });

  it('throws when --top is not a number', () => {
    assert.throws(() => parse('--top', 'abc'), /--top must be a positive integer/);
  });

  it('throws when --top has no value', () => {
    assert.throws(() => parse('--top'), /--top requires a value/);
  });

  it('parses --format md', () => {
    assert.equal(parse('--format', 'md').flags.format, 'md');
  });

  it('parses --format markdown', () => {
    assert.equal(parse('--format', 'markdown').flags.format, 'markdown');
  });

  it('throws when --format is invalid', () => {
    assert.throws(() => parse('--format', 'csv'), /--format must be "md" or "markdown"/);
  });

  it('throws when --format has no value', () => {
    assert.throws(() => parse('--format'), /--format requires a value/);
  });

  it('parses --exclude with comma-separated values', () => {
    const { flags } = parse('--exclude', 'webpack,eslint');
    assert.deepEqual(flags.exclude, ['webpack', 'eslint']);
  });

  it('parses --exclude used multiple times', () => {
    const { flags } = parse('--exclude', 'webpack', '--exclude', 'eslint');
    assert.deepEqual(flags.exclude, ['webpack', 'eslint']);
  });

  it('parses --exclude with single value', () => {
    const { flags } = parse('--exclude', 'webpack');
    assert.deepEqual(flags.exclude, ['webpack']);
  });

  it('throws when --exclude has no value', () => {
    assert.throws(() => parse('--exclude'), /--exclude requires a value/);
  });
});
