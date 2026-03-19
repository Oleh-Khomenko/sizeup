'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../lib/analyzer');

describe('pool', () => {
  it('executes tasks and returns results in order', async () => {
    const tasks = [
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
      () => Promise.resolve('c'),
    ];
    const results = await pool(tasks, 2);
    assert.deepEqual(results, ['a', 'b', 'c']);
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 10));
      running--;
      return true;
    });
    await pool(tasks, 2);
    assert.ok(maxRunning <= 2, `max concurrency was ${maxRunning}, expected <= 2`);
  });

  it('propagates errors after all workers complete', async () => {
    const completed = [];
    const tasks = [
      async () => { await new Promise(r => setTimeout(r, 20)); completed.push('a'); return 'ok'; },
      () => Promise.reject(new Error('fail')),
      async () => { await new Promise(r => setTimeout(r, 10)); completed.push('c'); return 'ok2'; },
    ];
    await assert.rejects(() => pool(tasks, 2), /fail/);
    // All non-failing tasks should have completed
    assert.ok(completed.includes('a'), 'first task should complete');
    assert.ok(completed.includes('c'), 'third task should complete');
  });

  it('attaches poolErrors to thrown error', async () => {
    const tasks = [
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('fail1')),
      () => Promise.reject(new Error('fail2')),
    ];
    try {
      await pool(tasks, 3);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(Array.isArray(err.poolErrors));
      assert.ok(err.poolErrors.length >= 1);
      assert.equal(err.poolErrors[0].error.message, 'fail1');
    }
  });

  it('handles empty task list', async () => {
    const results = await pool([], 4);
    assert.deepEqual(results, []);
  });

  it('works with concurrency 1 (serial)', async () => {
    const order = [];
    const tasks = [1, 2, 3].map(n => async () => { order.push(n); return n; });
    const results = await pool(tasks, 1);
    assert.deepEqual(results, [1, 2, 3]);
    assert.deepEqual(order, [1, 2, 3]);
  });
});
