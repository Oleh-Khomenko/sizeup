'use strict';

const { formatSize } = require('./formatter');

function parseBudget(str) {
  const match = str.match(/^([\d.]+)\s*(B|kB|KB|MB)$/i);
  if (!match) throw new Error(`Invalid budget format: "${str}". Use e.g. 50kB, 100KB, 1MB`);
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'B') return num;
  if (unit === 'KB') return num * 1000;
  if (unit === 'MB') return num * 1000 * 1000;
  return num;
}

function checkBudget(results, budgetFlags, jsonMode) {
  const { budget: budgetStr, budgetBrotli: budgetBrotliStr } = budgetFlags;
  const items = Array.isArray(results) ? results : [results];
  let failed = false;
  const budgetResults = [];

  if (budgetStr) {
    const budgetBytes = parseBudget(budgetStr);
    for (const r of items) {
      const over = r.sizes.gzipped > budgetBytes;
      if (over) failed = true;
      budgetResults.push({ name: r.name, type: 'gzip', size: r.sizes.gzipped, budget: budgetBytes, pass: !over });
    }
  }

  if (budgetBrotliStr) {
    const budgetBytes = parseBudget(budgetBrotliStr);
    for (const r of items) {
      const size = r.sizes.brotli || 0;
      const over = size > budgetBytes;
      if (over) failed = true;
      budgetResults.push({ name: r.name, type: 'brotli', size, budget: budgetBytes, pass: !over });
    }
  }

  if (jsonMode) return { budgetResults, failed };

  const passing = budgetResults.filter(b => b.pass);
  const failing = budgetResults.filter(b => !b.pass);

  if (passing.length > 0) {
    process.stdout.write(`  \x1b[32mPASS (${passing.length})\x1b[0m\n`);
    for (const b of passing) {
      process.stdout.write(`  \x1b[32m\u2713\x1b[0m ${b.name} [${b.type}] (${formatSize(b.size)} / ${formatSize(b.budget)})\n`);
    }
  }

  if (failing.length > 0) {
    if (passing.length > 0) process.stdout.write('\n');
    process.stdout.write(`  \x1b[31mFAIL (${failing.length})\x1b[0m\n`);
    for (const b of failing) {
      process.stdout.write(`  \x1b[31m\u2717\x1b[0m ${b.name} [${b.type}] (${formatSize(b.size)} / ${formatSize(b.budget)})\n`);
    }
  }

  if (failed) process.exitCode = 1;
  return { budgetResults, failed };
}

module.exports = { parseBudget, checkBudget };
