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
  if (bytes < 1000) return bytes + ' B';
  if (bytes < 1000 * 1000) return (bytes / 1000).toFixed(1) + ' kB';
  return (bytes / (1000 * 1000)).toFixed(2) + ' MB';
}

function formatMs(ms) {
  if (ms < 1) return '< 1 ms';
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  return (ms / 60000).toFixed(1) + ' min';
}

function formatTime(bytes) {
  // Slow 3G: ~50 kB/s, Fast 4G: ~4 MB/s
  const slow3g = (bytes / (50 * 1000)) * 1000; // ms
  const fast4g = (bytes / (4 * 1000 * 1000)) * 1000; // ms

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
  ];
  if (sizes.brotli != null) {
    lines.push(`  ${bold}${green}Brotli:${reset}       ${formatSize(sizes.brotli)}`);
  }
  lines.push(
    `  ${bold}${yellow}Files:${reset}        ${fileCount}`,
    `  ${bold}${yellow}Dependencies:${reset} ${dependencies.length}${dependencies.length > 0 ? ` (${depList})` : ''}`,
    `  ${bold}${yellow}Tree Shake:${reset}   ${treeshakeLabel}`,
    '',
    `  ${dim}Download time:${reset}`,
    `    ${magenta}Slow 3G${reset} (50 kB/s):   ${bold}${times.slow3g}${reset}`,
    `    ${magenta}Fast 4G${reset} (4 MB/s):    ${bold}${times.fast4g}${reset}`,
    '',
  );

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
  const hasBrotli = sorted.some(r => r.sizes.brotli != null);
  const maxBr = hasBrotli ? Math.max(1, ...sorted.map(r => r.sizes.brotli || 0)) : 1;

  // Calculate column widths
  const nameWidth = Math.max(7, ...sorted.map(r => r.name.length));
  const minWidth = 10;
  const gzWidth = 10;
  const brWidth = 10;
  const slow3gWidth = 10;
  const fast4gWidth = 10;
  const tsWidth = 10;

  let header = `  ${bold}${'Package'.padEnd(nameWidth)}  ${'Minified'.padStart(minWidth)}  ${'Gzipped'.padStart(gzWidth)}`;
  let separator = `  ${dim}${'─'.repeat(nameWidth)}  ${'─'.repeat(minWidth)}  ${'─'.repeat(gzWidth)}`;
  if (hasBrotli) {
    header += `  ${'Brotli'.padStart(brWidth)}`;
    separator += `  ${'─'.repeat(brWidth)}`;
  }
  header += `  ${'Slow 3G'.padStart(slow3gWidth)}  ${'Fast 4G'.padStart(fast4gWidth)}  ${'Tree Shake'.padStart(tsWidth)}${reset}`;
  separator += `  ${'─'.repeat(slow3gWidth)}  ${'─'.repeat(fast4gWidth)}  ${'─'.repeat(tsWidth)}${reset}`;

  const lines = ['', header, separator];

  for (const r of sorted) {
    const sc = sizeColor(r.sizes.gzipped, maxGz);
    const times = formatTime(r.sizes.gzipped);
    const tsLabel = r.treeshake ? `${green}${'yes'.padStart(tsWidth)}${reset}` : `${yellow}${'no'.padStart(tsWidth)}${reset}`;
    let row = `  ${cyan}${r.name.padEnd(nameWidth)}${reset}  ${formatSize(r.sizes.minified).padStart(minWidth)}  ${sc}${bold}${formatSize(r.sizes.gzipped).padStart(gzWidth)}${reset}`;
    if (hasBrotli) {
      const bc = sizeColor(r.sizes.brotli || 0, maxBr);
      row += `  ${bc}${bold}${formatSize(r.sizes.brotli || 0).padStart(brWidth)}${reset}`;
    }
    row += `  ${magenta}${times.slow3g.padStart(slow3gWidth)}${reset}  ${magenta}${times.fast4g.padStart(fast4gWidth)}${reset}  ${tsLabel}`;
    lines.push(row);
  }

  const totalMin = results.reduce((s, r) => s + r.sizes.minified, 0);
  const totalGz = results.reduce((s, r) => s + r.sizes.gzipped, 0);
  const totalTimes = formatTime(totalGz);

  let footSep = `  ${dim}${'─'.repeat(nameWidth)}  ${'─'.repeat(minWidth)}  ${'─'.repeat(gzWidth)}`;
  let footRow = `  ${bold}${'Total'.padEnd(nameWidth)}  ${formatSize(totalMin).padStart(minWidth)}  ${formatSize(totalGz).padStart(gzWidth)}`;
  if (hasBrotli) {
    const totalBr = results.reduce((s, r) => s + (r.sizes.brotli || 0), 0);
    footSep += `  ${'─'.repeat(brWidth)}`;
    footRow += `  ${formatSize(totalBr).padStart(brWidth)}`;
  }
  footSep += `  ${'─'.repeat(slow3gWidth)}  ${'─'.repeat(fast4gWidth)}  ${'─'.repeat(tsWidth)}${reset}`;
  footRow += `  ${totalTimes.slow3g.padStart(slow3gWidth)}  ${totalTimes.fast4g.padStart(fast4gWidth)}${reset}`;

  lines.push(footSep);
  lines.push(footRow);
  lines.push('');

  return lines.join('\n');
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function formatDiff(resultA, resultB) {
  const { bold, dim, green, yellow, cyan, reset } = colors;
  const red = isTTY ? '\x1b[31m' : '';

  function delta(a, b, isCount) {
    const diff = b - a;
    const pct = a === 0 ? (b === 0 ? 0 : 100) : ((diff / a) * 100);
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    const color = diff > 0 ? red : diff < 0 ? green : dim;
    const diffStr = isCount ? String(Math.abs(diff)) : formatSize(Math.abs(diff));
    return `${color}${sign}${diffStr} (${sign}${Math.abs(pct).toFixed(1)}%)${reset}`;
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
  ];
  if (resultA.sizes.brotli != null && resultB.sizes.brotli != null) {
    lines.push(row('Brotli', formatSize(resultA.sizes.brotli), formatSize(resultB.sizes.brotli), delta(resultA.sizes.brotli, resultB.sizes.brotli)));
  }
  lines.push(
    row('Files', resultA.fileCount, resultB.fileCount, delta(resultA.fileCount, resultB.fileCount, true)),
    row('Dependencies', resultA.dependencies.length, resultB.dependencies.length, delta(resultA.dependencies.length, resultB.dependencies.length, true)),
    row('Tree Shake', resultA.treeshake ? 'yes' : 'no', resultB.treeshake ? 'yes' : 'no',
      resultA.treeshake === resultB.treeshake ? `${dim}unchanged${reset}` : `${yellow}changed${reset}`),
    '',
  );

  return lines.join('\n');
}

function formatDepBreakdown(mainResult, depResults) {
  const { bold, dim, green, yellow, cyan, reset } = colors;

  const sorted = [...depResults].sort((a, b) => b.sizes.gzipped - a.sizes.gzipped);
  const totalGz = mainResult.sizes.gzipped;
  const depGz = sorted.reduce((s, r) => s + r.sizes.gzipped, 0);
  const pctBase = Math.max(totalGz, depGz) || 1;
  const ownGz = Math.max(0, totalGz - depGz);
  const hasBrotli = mainResult.sizes.brotli != null;

  const nameWidth = Math.max(12, ...sorted.map(r => r.name.length));

  let headerLine = `  ${bold}${'Dependency'.padEnd(nameWidth)}  ${'Gzipped'.padStart(10)}`;
  let sepLine = `  ${dim}${'─'.repeat(nameWidth)}  ${'─'.repeat(10)}`;
  if (hasBrotli) {
    headerLine += `  ${'Brotli'.padStart(10)}`;
    sepLine += `  ${'─'.repeat(10)}`;
  }
  headerLine += `  ${'% of Total'.padStart(10)}${reset}`;
  sepLine += `  ${'─'.repeat(10)}${reset}`;

  const lines = [
    '',
    `  ${bold}${cyan}Package:${reset} ${bold}${mainResult.name}@${mainResult.version}${reset}  (${formatSize(totalGz)} gzipped)`,
    '',
    headerLine,
    sepLine,
  ];

  for (const r of sorted) {
    const pct = (r.sizes.gzipped / pctBase) * 100;
    let row = `  ${cyan}${r.name.padEnd(nameWidth)}${reset}  ${formatSize(r.sizes.gzipped).padStart(10)}`;
    if (hasBrotli) row += `  ${formatSize(r.sizes.brotli || 0).padStart(10)}`;
    row += `  ${(pct.toFixed(1) + '%').padStart(10)}`;
    lines.push(row);
  }

  const ownPct = (ownGz / pctBase) * 100;
  let footRow = `  ${bold}${'Own code'.padEnd(nameWidth)}  ${formatSize(ownGz).padStart(10)}`;
  if (hasBrotli) {
    const depBr = sorted.reduce((s, r) => s + (r.sizes.brotli || 0), 0);
    const ownBr = Math.max(0, (mainResult.sizes.brotli || 0) - depBr);
    footRow += `  ${formatSize(ownBr).padStart(10)}`;
  }
  footRow += `  ${(ownPct.toFixed(1) + '%').padStart(10)}${reset}`;
  lines.push(sepLine);
  lines.push(footRow);
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
  ];
  if (result.sizes.brotli != null) {
    lines.push(`  ${bold}${green}Brotli:${reset}       ${formatSize(result.sizes.brotli)}`);
  }
  lines.push(
    `  ${bold}${yellow}Files:${reset}        ${result.fileCount}`,
    '',
    `  ${dim}Download time:${reset}`,
    `    ${magenta}Slow 3G${reset} (50 kB/s):   ${bold}${times.slow3g}${reset}`,
    `    ${magenta}Fast 4G${reset} (4 MB/s):    ${bold}${times.fast4g}${reset}`,
  );

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

function formatMarkdownTable(results) {
  const sorted = [...results].sort((a, b) => b.sizes.gzipped - a.sizes.gzipped);
  const hasBrotli = sorted.some(r => r.sizes.brotli != null);

  let header = '| Package | Minified | Gzipped |';
  let align = '| :--- | ---: | ---: |';
  if (hasBrotli) {
    header += ' Brotli |';
    align += ' ---: |';
  }
  header += ' Slow 3G | Fast 4G | Tree Shake |';
  align += ' ---: | ---: | :---: |';

  const lines = [header, align];

  for (const r of sorted) {
    const times = formatTime(r.sizes.gzipped);
    const ts = r.treeshake ? 'Yes' : 'No';
    let row = `| ${r.name} | ${formatSize(r.sizes.minified)} | ${formatSize(r.sizes.gzipped)} |`;
    if (hasBrotli) {
      row += ` ${formatSize(r.sizes.brotli || 0)} |`;
    }
    row += ` ${times.slow3g} | ${times.fast4g} | ${ts} |`;
    lines.push(row);
  }

  const totalMin = results.reduce((s, r) => s + r.sizes.minified, 0);
  const totalGz = results.reduce((s, r) => s + r.sizes.gzipped, 0);
  const totalTimes = formatTime(totalGz);
  let totalRow = `| **Total** | **${formatSize(totalMin)}** | **${formatSize(totalGz)}** |`;
  if (hasBrotli) {
    const totalBr = results.reduce((s, r) => s + (r.sizes.brotli || 0), 0);
    totalRow += ` **${formatSize(totalBr)}** |`;
  }
  totalRow += ` **${totalTimes.slow3g}** | **${totalTimes.fast4g}** | |`;
  lines.push(totalRow);

  return lines.join('\n') + '\n';
}

function formatMarkdownSingle(result) {
  const times = formatTime(result.sizes.gzipped);
  const ts = result.treeshake ? 'Yes' : 'No';
  const lines = [
    `## ${result.name}@${result.version}`,
    '',
    '| Metric | Value |',
    '| :--- | ---: |',
    `| Minified | ${formatSize(result.sizes.minified)} |`,
    `| Gzipped | ${formatSize(result.sizes.gzipped)} |`,
  ];
  if (result.sizes.brotli != null) {
    lines.push(`| Brotli | ${formatSize(result.sizes.brotli)} |`);
  }
  lines.push(
    `| Files | ${result.fileCount} |`,
    `| Dependencies | ${result.dependencies.length} |`,
    `| Tree Shake | ${ts} |`,
    `| Slow 3G | ${times.slow3g} |`,
    `| Fast 4G | ${times.fast4g} |`,
    '',
  );
  return lines.join('\n');
}

function formatMarkdownDiff(resultA, resultB) {
  function delta(a, b, isCount) {
    const diff = b - a;
    const pct = a === 0 ? (b === 0 ? 0 : 100) : ((diff / a) * 100);
    const sign = diff > 0 ? '+' : '';
    const diffStr = isCount ? String(diff) : (diff >= 0 ? '+' : '') + formatSize(Math.abs(diff));
    if (diff > 0) return `**${diffStr}** (${sign}${pct.toFixed(1)}%) :red_circle:`;
    if (diff < 0) return `${formatSize(Math.abs(diff))} (${pct.toFixed(1)}%) :green_circle:`;
    return 'unchanged';
  }

  const lines = [
    `## ${resultA.name}: ${resultA.version} → ${resultB.version}`,
    '',
    '| Metric | Before | After | Delta |',
    '| :--- | ---: | ---: | ---: |',
    `| Minified | ${formatSize(resultA.sizes.minified)} | ${formatSize(resultB.sizes.minified)} | ${delta(resultA.sizes.minified, resultB.sizes.minified)} |`,
    `| Gzipped | ${formatSize(resultA.sizes.gzipped)} | ${formatSize(resultB.sizes.gzipped)} | ${delta(resultA.sizes.gzipped, resultB.sizes.gzipped)} |`,
  ];
  if (resultA.sizes.brotli != null && resultB.sizes.brotli != null) {
    lines.push(`| Brotli | ${formatSize(resultA.sizes.brotli)} | ${formatSize(resultB.sizes.brotli)} | ${delta(resultA.sizes.brotli, resultB.sizes.brotli)} |`);
  }
  lines.push(
    `| Files | ${resultA.fileCount} | ${resultB.fileCount} | ${delta(resultA.fileCount, resultB.fileCount, true)} |`,
    `| Dependencies | ${resultA.dependencies.length} | ${resultB.dependencies.length} | ${delta(resultA.dependencies.length, resultB.dependencies.length, true)} |`,
    '',
  );
  return lines.join('\n');
}

function formatMarkdownDeps(mainResult, depResults) {
  const sorted = [...depResults].sort((a, b) => b.sizes.gzipped - a.sizes.gzipped);
  const totalGz = mainResult.sizes.gzipped;
  const depGz = sorted.reduce((s, r) => s + r.sizes.gzipped, 0);
  const pctBase = Math.max(totalGz, depGz) || 1;
  const ownGz = Math.max(0, totalGz - depGz);
  const ownPct = (ownGz / pctBase) * 100;
  const hasBrotli = mainResult.sizes.brotli != null;

  let header = '| Dependency | Gzipped |';
  let align = '| :--- | ---: |';
  if (hasBrotli) { header += ' Brotli |'; align += ' ---: |'; }
  header += ' % of Total |';
  align += ' ---: |';

  const lines = [
    `## ${mainResult.name}@${mainResult.version} — ${formatSize(totalGz)} gzipped`,
    '',
    header,
    align,
  ];
  for (const r of sorted) {
    const pct = (r.sizes.gzipped / pctBase) * 100;
    let row = `| ${r.name} | ${formatSize(r.sizes.gzipped)} |`;
    if (hasBrotli) row += ` ${formatSize(r.sizes.brotli || 0)} |`;
    row += ` ${pct.toFixed(1)}% |`;
    lines.push(row);
  }
  let ownRow = `| **Own code** | **${formatSize(ownGz)}** |`;
  if (hasBrotli) {
    const depBr = sorted.reduce((s, r) => s + (r.sizes.brotli || 0), 0);
    const ownBr = Math.max(0, (mainResult.sizes.brotli || 0) - depBr);
    ownRow += ` **${formatSize(ownBr)}** |`;
  }
  ownRow += ` **${ownPct.toFixed(1)}%** |`;
  lines.push(ownRow);
  lines.push('');
  return lines.join('\n');
}

function formatMarkdownEntry(result) {
  const times = formatTime(result.sizes.gzipped);
  const lines = [
    `## ${result.entry}`,
    '',
    '| Metric | Value |',
    '| :--- | ---: |',
    `| Minified | ${formatSize(result.sizes.minified)} |`,
    `| Gzipped | ${formatSize(result.sizes.gzipped)} |`,
  ];
  if (result.sizes.brotli != null) {
    lines.push(`| Brotli | ${formatSize(result.sizes.brotli)} |`);
  }
  lines.push(
    `| Files | ${result.fileCount} |`,
    `| Slow 3G | ${times.slow3g} |`,
    `| Fast 4G | ${times.fast4g} |`,
  );
  if (result.externals && result.externals.length > 0) {
    lines.push('', '**External dependencies:** ' + result.externals.join(', '));
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { format, formatTable, formatJson, formatDiff, formatDepBreakdown, formatEntry, formatSize, formatMs, formatTime, formatMarkdownTable, formatMarkdownSingle, formatMarkdownDiff, formatMarkdownDeps, formatMarkdownEntry };
