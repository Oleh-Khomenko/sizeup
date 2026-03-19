'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Spinner } = require('../lib/spinner');

describe('Spinner (non-TTY)', () => {
  let output;
  let origWrite;

  beforeEach(() => {
    output = [];
    origWrite = process.stdout.write;
    process.stdout.write = (chunk) => { output.push(chunk); return true; };
  });

  afterEach(() => {
    process.stdout.write = origWrite;
  });

  it('does not start timer in non-TTY', () => {
    const s = new Spinner();
    s.update('working...');
    assert.equal(s._timer, null);
  });

  it('log() writes text with newline', () => {
    const s = new Spinner();
    s.log('hello');
    assert.equal(output.length, 1);
    assert.equal(output[0], 'hello\n');
  });

  it('done() writes text with prefix', () => {
    const s = new Spinner();
    s.done('finished');
    assert.equal(output.length, 1);
    assert.ok(output[0].includes('finished'));
    assert.ok(output[0].endsWith('\n'));
  });

  it('_isTTY is false in test environment', () => {
    const s = new Spinner();
    assert.equal(s._isTTY, false);
  });
});
