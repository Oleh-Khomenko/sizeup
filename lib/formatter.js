'use strict';

const isTTY = process.stdout.isTTY;

const colors = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  white: isTTY ? '\x1b[37m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
};

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatMs(ms) {
  if (ms < 1) return '< 1 ms';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  return (ms / 60000).toFixed(1) + ' min';
}

function formatTime(bytes) {
  // Slow 3G: ~50 kB/s, Fast 4G: ~4 MB/s
  const slow3g = (bytes / (50 * 1024)) * 1000; // ms
  const fast4g = (bytes / (4 * 1024 * 1024)) * 1000; // ms

  return {
    slow3g: formatMs(slow3g),
    fast4g: formatMs(fast4g),
  };
}

function format({ name, version, sizes, dependencies, fileCount, treeshake }) {
  const { bold, dim, green, yellow, cyan, magenta, reset } = colors;
  const times = formatTime(sizes.gzipped);

  const depList = dependencies.length > 0
    ? dependencies.join(', ')
    : 'none';

  const treeshakeLabel = treeshake ? `${green}yes${reset}` : `${yellow}no${reset}`;

  const lines = [
    '',
    `  ${bold}${cyan}Package:${reset}      ${bold}${name}@${version}${reset}`,
    `  ${bold}${green}Minified:${reset}     ${formatSize(sizes.minified)}`,
    `  ${bold}${green}Gzipped:${reset}      ${formatSize(sizes.gzipped)}`,
    `  ${bold}${yellow}Files:${reset}        ${fileCount}`,
    `  ${bold}${yellow}Dependencies:${reset} ${dependencies.length}${dependencies.length > 0 ? ` (${depList})` : ''}`,
    `  ${bold}${yellow}Tree Shake:${reset}   ${treeshakeLabel}`,
    '',
    `  ${dim}Download time:${reset}`,
    `    ${magenta}Slow 3G${reset} (50 kB/s):   ${bold}${times.slow3g}${reset}`,
    `    ${magenta}Fast 4G${reset} (4 MB/s):    ${bold}${times.fast4g}${reset}`,
    '',
  ];

  return lines.join('\n');
}

function sizeColor(bytes, maxBytes) {
  if (!isTTY) return '';
  // green(100,200,100) -> yellow(200,180,80) -> red(180,60,60)
  const t = Math.min(bytes / maxBytes, 1);
  let r, g, b;
  if (t < 0.5) {
    const p = t * 2;
    r = Math.round(100 + p * 100);
    g = Math.round(200 - p * 20);
    b = Math.round(100 - p * 20);
  } else {
    const p = (t - 0.5) * 2;
    r = Math.round(200 - p * 20);
    g = Math.round(180 - p * 120);
    b = Math.round(80 - p * 20);
  }
  return `\x1b[38;2;${r};${g};${b}m`;
}

function formatTable(results) {
  const { bold, dim, green, yellow, cyan, magenta, reset } = colors;

  // Sort by gzipped size descending
  const sorted = [...results].sort((a, b) => b.sizes.gzipped - a.sizes.gzipped);
  const maxGz = sorted.length > 0 ? sorted[0].sizes.gzipped : 1;

  // Calculate column widths
  const nameWidth = Math.max(7, ...sorted.map(r => r.name.length));
  const minWidth = 10;
  const gzWidth = 10;
  const slow3gWidth = 10;
  const fast4gWidth = 10;
  const tsWidth = 10;

  const lines = [
    '',
    `  ${bold}${'Package'.padEnd(nameWidth)}  ${'Minified'.padStart(minWidth)}  ${'Gzipped'.padStart(gzWidth)}  ${'Slow 3G'.padStart(slow3gWidth)}  ${'Fast 4G'.padStart(fast4gWidth)}  ${'Tree Shake'.padStart(tsWidth)}${reset}`,
    `  ${dim}${'─'.repeat(nameWidth)}  ${'─'.repeat(minWidth)}  ${'─'.repeat(gzWidth)}  ${'─'.repeat(slow3gWidth)}  ${'─'.repeat(fast4gWidth)}  ${'─'.repeat(tsWidth)}${reset}`,
  ];

  for (const r of sorted) {
    const sc = sizeColor(r.sizes.gzipped, maxGz);
    const times = formatTime(r.sizes.gzipped);
    const tsLabel = r.treeshake ? `${green}${'yes'.padStart(tsWidth)}${reset}` : `${yellow}${'no'.padStart(tsWidth)}${reset}`;
    lines.push(
      `  ${cyan}${r.name.padEnd(nameWidth)}${reset}  ${formatSize(r.sizes.minified).padStart(minWidth)}  ${sc}${bold}${formatSize(r.sizes.gzipped).padStart(gzWidth)}${reset}  ${magenta}${times.slow3g.padStart(slow3gWidth)}${reset}  ${magenta}${times.fast4g.padStart(fast4gWidth)}${reset}  ${tsLabel}`
    );
  }

  const totalMin = results.reduce((s, r) => s + r.sizes.minified, 0);
  const totalGz = results.reduce((s, r) => s + r.sizes.gzipped, 0);
  const totalTimes = formatTime(totalGz);

  lines.push(`  ${dim}${'─'.repeat(nameWidth)}  ${'─'.repeat(minWidth)}  ${'─'.repeat(gzWidth)}  ${'─'.repeat(slow3gWidth)}  ${'─'.repeat(fast4gWidth)}  ${'─'.repeat(tsWidth)}${reset}`);
  lines.push(
    `  ${bold}${'Total'.padEnd(nameWidth)}  ${formatSize(totalMin).padStart(minWidth)}  ${formatSize(totalGz).padStart(gzWidth)}  ${totalTimes.slow3g.padStart(slow3gWidth)}  ${totalTimes.fast4g.padStart(fast4gWidth)}${reset}`
  );
  lines.push('');

  return lines.join('\n');
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function formatDiff(resultA, resultB) {
  const { bold, dim, green, yellow, cyan, reset } = colors;
  const red = isTTY ? '\x1b[31m' : '';

  function delta(a, b) {
    const diff = b - a;
    const pct = a === 0 ? (b === 0 ? 0 : 100) : ((diff / a) * 100);
    const sign = diff > 0 ? '+' : '';
    const color = diff > 0 ? red : diff < 0 ? green : dim;
    return `${color}${sign}${formatSize(diff)} (${sign}${pct.toFixed(1)}%)${reset}`;
  }

  function row(label, valA, valB, deltaStr) {
    return `  ${bold}${label.padEnd(14)}${reset} ${String(valA).padStart(12)}  →  ${String(valB).padStart(12)}  ${deltaStr}`;
  }

  const lines = [
    '',
    `  ${bold}${cyan}Before:${reset} ${resultA.name}@${resultA.version}`,
    `  ${bold}${cyan}After:${reset}  ${resultB.name}@${resultB.version}`,
    '',
    row('Minified', formatSize(resultA.sizes.minified), formatSize(resultB.sizes.minified), delta(resultA.sizes.minified, resultB.sizes.minified)),
    row('Gzipped', formatSize(resultA.sizes.gzipped), formatSize(resultB.sizes.gzipped), delta(resultA.sizes.gzipped, resultB.sizes.gzipped)),
    row('Files', resultA.fileCount, resultB.fileCount, delta(resultA.fileCount, resultB.fileCount)),
    row('Dependencies', resultA.dependencies.length, resultB.dependencies.length, delta(resultA.dependencies.length, resultB.dependencies.length)),
    row('Tree Shake', resultA.treeshake ? 'yes' : 'no', resultB.treeshake ? 'yes' : 'no',
      resultA.treeshake === resultB.treeshake ? `${dim}unchanged${reset}` : `${yellow}changed${reset}`),
    '',
  ];

  return lines.join('\n');
}

function formatDepBreakdown(mainResult, depResults) {
  const { bold, dim, green, yellow, cyan, reset } = colors;

  const sorted = [...depResults].sort((a, b) => b.sizes.gzipped - a.sizes.gzipped);
  const totalGz = mainResult.sizes.gzipped;
  const depGz = sorted.reduce((s, r) => s + r.sizes.gzipped, 0);
  const ownGz = Math.max(0, totalGz - depGz);

  const nameWidth = Math.max(12, ...sorted.map(r => r.name.length));

  const lines = [
    '',
    `  ${bold}${cyan}Package:${reset} ${bold}${mainResult.name}@${mainResult.version}${reset}  (${formatSize(totalGz)} gzipped)`,
    '',
    `  ${bold}${'Dependency'.padEnd(nameWidth)}  ${'Gzipped'.padStart(10)}  ${'% of Total'.padStart(10)}${reset}`,
    `  ${dim}${'─'.repeat(nameWidth)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}${reset}`,
  ];

  for (const r of sorted) {
    const pct = totalGz === 0 ? 0 : ((r.sizes.gzipped / totalGz) * 100);
    lines.push(
      `  ${cyan}${r.name.padEnd(nameWidth)}${reset}  ${formatSize(r.sizes.gzipped).padStart(10)}  ${(pct.toFixed(1) + '%').padStart(10)}`
    );
  }

  const ownPct = totalGz === 0 ? 0 : ((ownGz / totalGz) * 100);
  lines.push(`  ${dim}${'─'.repeat(nameWidth)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}${reset}`);
  lines.push(`  ${bold}${'Own code'.padEnd(nameWidth)}  ${formatSize(ownGz).padStart(10)}  ${(ownPct.toFixed(1) + '%').padStart(10)}${reset}`);
  lines.push('');

  return lines.join('\n');
}

function formatEntry(result) {
  const { bold, dim, green, yellow, cyan, magenta, reset } = colors;
  const times = formatTime(result.sizes.gzipped);

  const lines = [
    '',
    `  ${bold}${cyan}Entry:${reset}        ${bold}${result.entry}${reset}`,
    `  ${bold}${green}Minified:${reset}     ${formatSize(result.sizes.minified)}`,
    `  ${bold}${green}Gzipped:${reset}      ${formatSize(result.sizes.gzipped)}`,
    `  ${bold}${yellow}Files:${reset}        ${result.fileCount}`,
    '',
    `  ${dim}Download time:${reset}`,
    `    ${magenta}Slow 3G${reset} (50 kB/s):   ${bold}${times.slow3g}${reset}`,
    `    ${magenta}Fast 4G${reset} (4 MB/s):    ${bold}${times.fast4g}${reset}`,
  ];

  if (result.externals && result.externals.length > 0) {
    lines.push('');
    lines.push(`  ${bold}${yellow}External dependencies (not included in size):${reset}`);
    for (const ext of result.externals) {
      lines.push(`    ${dim}•${reset} ${ext}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = { format, formatTable, formatJson, formatDiff, formatDepBreakdown, formatEntry };
