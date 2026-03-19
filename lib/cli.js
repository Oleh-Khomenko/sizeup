'use strict';

const path = require('path');

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };

  function requireValue(flag, i, argv) {
    if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`);
    return argv[++i];
  }

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') args.flags.help = true;
    else if (argv[i] === '--version' || argv[i] === '-v') args.flags.version = true;
    else if (argv[i] === '--json') args.flags.json = true;
    else if (argv[i] === '--budget') { args.flags.budget = requireValue('--budget', i, argv); i++; }
    else if (argv[i] === '--diff') args.flags.diff = true;
    else if (argv[i] === '--deps') args.flags.deps = true;
    else if (argv[i] === '--entry') { args.flags.entry = requireValue('--entry', i, argv); i++; }
    else if (argv[i] === '--concurrency') { const v = requireValue('--concurrency', i, argv); i++; args.flags.concurrency = parseInt(v, 10); }
    else if (argv[i] === '--local') args.flags.local = true;
    else if (argv[i] === '--force') args.flags.force = true;
    else if (argv[i] === '--gzip-level') { const v = requireValue('--gzip-level', i, argv); i++; args.flags.gzipLevel = parseInt(v, 10); }
    else if (argv[i] === '--brotli') args.flags.brotli = true;
    else if (argv[i] === '--budget-brotli') { args.flags.budgetBrotli = requireValue('--budget-brotli', i, argv); i++; }
    else if (argv[i] === '--top') { const v = requireValue('--top', i, argv); i++; args.flags.top = parseInt(v, 10); }
    else if (argv[i] === '--format') { args.flags.format = requireValue('--format', i, argv); i++; }
    else if (argv[i] === '--exclude') {
      const v = requireValue('--exclude', i, argv);
      i++;
      if (!args.flags.exclude) args.flags.exclude = [];
      args.flags.exclude.push(...v.split(','));
    }
    else if (argv[i] === '--no-cache') args.flags.noCache = true;
    else if (argv[i] === '--clear-cache') args.flags.clearCache = true;
    else args.positional.push(argv[i]);
  }

  if (args.flags.gzipLevel !== undefined && (isNaN(args.flags.gzipLevel) || args.flags.gzipLevel < 1 || args.flags.gzipLevel > 9)) {
    throw new Error('--gzip-level must be an integer between 1 and 9');
  }
  if (args.flags.concurrency !== undefined && (isNaN(args.flags.concurrency) || args.flags.concurrency < 1)) {
    throw new Error('--concurrency must be a positive integer');
  }
  if (args.flags.top !== undefined && (isNaN(args.flags.top) || args.flags.top < 1)) {
    throw new Error('--top must be a positive integer');
  }
  if (args.flags.format !== undefined && args.flags.format !== 'md' && args.flags.format !== 'markdown') {
    throw new Error('--format must be "md" or "markdown"');
  }

  return args;
}

function isPath(arg) {
  if (arg.startsWith('@') && !arg.startsWith('@/')) return false;
  return arg.startsWith('.') || arg.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(arg) || arg.includes(path.sep);
}

function printHelp() {
  const useColor = !!process.stdout.isTTY;
  const { bold, dim, cyan, green, yellow, reset } = useColor
    ? { bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' }
    : { bold: '', dim: '', cyan: '', green: '', yellow: '', reset: '' };

  process.stdout.write(`
${bold}sizeup${reset} \u2014 Fast npm package size analyzer

${bold}USAGE${reset}
  ${cyan}sizeup${reset} ${dim}<package...>${reset}           Analyze one or more packages
  ${cyan}sizeup${reset} ${dim}[path]${reset}                 Scan all deps in package.json
  ${cyan}sizeup${reset} ${dim}--diff <a> <b>${reset}         Compare two package versions
  ${cyan}sizeup${reset} ${dim}--deps <package>${reset}        Dependency size breakdown
  ${cyan}sizeup${reset} ${dim}--entry <file|dir>${reset}      Analyze local source code

${bold}OPTIONS${reset}
  ${green}--json${reset}              Output results as JSON
  ${green}--budget ${dim}<size>${reset}      Set a gzip size budget (exit code 1 if exceeded)
                      Supports: B, kB, KB, MB (e.g. ${dim}50kB${reset}, ${dim}1MB${reset}, case-insensitive)
  ${green}--budget-brotli ${dim}<size>${reset} Set a Brotli size budget (implies --brotli)
  ${green}--diff${reset}              Compare two packages side-by-side
  ${green}--deps${reset}              Show per-dependency size breakdown
  ${green}--entry ${dim}<path>${reset}      Analyze local file/directory (skips npm install)
  ${green}--local${reset}             Use project's node_modules instead of installing to temp dir
                      ${dim}(sizes may differ slightly from fresh install due to resolved versions)${reset}
  ${green}--force${reset}             Pass --force to npm install (bypass peer dep conflicts)
  ${green}--brotli${reset}            Show Brotli compressed size alongside Gzip
  ${green}--gzip-level ${dim}<N>${reset}   Gzip compression level 1-9 (default: 9)
  ${green}--concurrency ${dim}<N>${reset}  Max parallel analyses (default: CPU count, max 8)
  ${green}--top ${dim}<N>${reset}           Show only the N largest packages
  ${green}--exclude ${dim}<pkg,...>${reset}  Skip packages in scan mode (comma-separated, repeatable)
  ${green}--format ${dim}md${reset}         Output as Markdown table (for CI/PR comments)
  ${green}--no-cache${reset}           Bypass the result cache
  ${green}--clear-cache${reset}        Clear the cache directory and exit
  ${green}-h, --help${reset}          Show this help message
  ${green}-v, --version${reset}       Show version number

${bold}EXAMPLES${reset}
  ${dim}$${reset} sizeup react                    ${dim}# single package${reset}
  ${dim}$${reset} sizeup react vue svelte          ${dim}# multiple packages${reset}
  ${dim}$${reset} sizeup react --json              ${dim}# JSON output${reset}
  ${dim}$${reset} sizeup react --budget 5kB        ${dim}# fail if > 5kB gzipped${reset}
  ${dim}$${reset} sizeup --diff react@17 react@18  ${dim}# version comparison${reset}
  ${dim}$${reset} sizeup express --deps            ${dim}# dependency breakdown${reset}
  ${dim}$${reset} sizeup --entry ./src/index.js    ${dim}# local file analysis${reset}
  ${dim}$${reset} sizeup ./my-project              ${dim}# scan project deps${reset}
  ${dim}$${reset} sizeup ./my-project --local      ${dim}# use existing node_modules${reset}
  ${dim}$${reset} sizeup . --exclude webpack,eslint  ${dim}# skip specific deps${reset}
  ${dim}$${reset} sizeup . --top 10                 ${dim}# top 10 largest deps${reset}
  ${dim}$${reset} sizeup . --format md              ${dim}# Markdown table for CI${reset}
  ${dim}$${reset} sizeup                           ${dim}# scan cwd deps${reset}

`);
}

module.exports = { parseArgs, isPath, printHelp };
