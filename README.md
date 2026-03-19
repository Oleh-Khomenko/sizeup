# sizeup

Fast CLI tool to analyze npm package bundle sizes. Powered by [esbuild](https://esbuild.github.io/).

## Install

```bash
npm install -g sizeup
```

## Usage

```
sizeup <package...>           Analyze one or more packages
sizeup [path]                 Scan all deps in package.json
sizeup --diff <a> <b>         Compare two package versions
sizeup --deps <package>       Dependency size breakdown
sizeup --entry <file|dir>     Analyze local source code
```

### Analyze a single package

```bash
$ sizeup react

  ✓ Analyzed react@19.1.0

  Package:  react@19.1.0
  Minified: 7.7 kB
  Gzipped:  3.0 kB
```

### Analyze multiple packages

```bash
$ sizeup react vue svelte

  Package    Minified     Gzipped     Slow 3G     Fast 4G  Tree Shake
  ───────  ──────────  ──────────  ──────────  ──────────  ──────────
  vue        124.1 kB     48.2 kB      963 ms       12 ms         yes
  svelte      13.9 kB      5.4 kB      108 ms        1 ms         yes
  react        7.7 kB      3.0 kB       60 ms      < 1 ms         yes
```

### Scan project dependencies

```bash
$ sizeup ./my-project

Scanning 53 dependencies from package.json... (skipped 3 @types packages)

  ✓ Installed 53 packages
  ✓ Analyzed 53/53 packages

  Package                             Minified     Gzipped  ...
  ────────────────────────────────  ──────────  ──────────
  ...
```

Use `--local` to skip the install step and read directly from the project's existing `node_modules`:

```bash
$ sizeup ./my-project --local
```

> `@types/*` packages are automatically skipped since they contain no runtime code.
>
> Sizes may differ slightly from a fresh install due to resolved dependency versions.

### Show only the largest packages

```bash
$ sizeup ./my-project --top 5

  Package                    Minified     Gzipped  ...
  ───────────────────────  ──────────  ──────────
  next                       13.50 MB     3.50 MB  ...
  anychart                    2.53 MB    771.9 kB  ...
  sass                        3.30 MB    697.6 kB  ...
  @iconify-json/hugeicons     2.57 MB    643.4 kB  ...
  echarts                     1.13 MB    376.3 kB  ...
```

### Markdown output for CI/PR comments

```bash
$ sizeup ./my-project --top 5 --format md

| Package | Minified | Gzipped | Slow 3G | Fast 4G | Tree Shake |
| :--- | ---: | ---: | ---: | ---: | :---: |
| next | 13.50 MB | 3.50 MB | 1.2 min | 874 ms | No |
| anychart | 2.53 MB | 771.9 kB | 15.4 s | 193 ms | No |
| sass | 3.30 MB | 697.6 kB | 14.0 s | 174 ms | Yes |
| ...  | ... | ... | ... | ... | ... |
| **Total** | **23.03 MB** | **5.99 MB** | **2.0 min** | **1.5 s** | |
```

### Compare versions

```bash
$ sizeup --diff react@17 react@18
```

### Dependency breakdown

```bash
$ sizeup express --deps
```

### Analyze local source

```bash
$ sizeup --entry ./src/index.js
```

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output results as JSON |
| `--budget <size>` | Set a gzip size budget — exit code 1 if exceeded. Supports: B, kB, KB, MB |
| `--budget-brotli <size>` | Set a Brotli size budget (implies `--brotli`) |
| `--diff` | Compare two packages side-by-side |
| `--deps` | Show per-dependency size breakdown |
| `--entry <path>` | Analyze local file/directory (skips npm install) |
| `--local` | Use project's `node_modules` instead of installing to a temp dir |
| `--force` | Pass `--force` to npm install (bypass peer dep conflicts) |
| `--brotli` | Show Brotli compressed size alongside Gzip |
| `--gzip-level <N>` | Gzip compression level 1–9 (default: 9) |
| `--concurrency <N>` | Max parallel analyses (default: CPU count, max 8) |
| `--top <N>` | Show only the N largest packages |
| `--format md` | Output as Markdown table (for CI/PR comments) |
| `--no-cache` | Bypass the result cache |
| `--clear-cache` | Clear the cache directory and exit |
| `-v, --version` | Show version number |
| `-h, --help` | Show help message |

## Examples

```bash
sizeup react                    # single package
sizeup react vue svelte         # multiple packages
sizeup react --json             # JSON output
sizeup react --budget 5kB       # fail if > 5kB gzipped
sizeup --diff react@17 react@18 # version comparison
sizeup express --deps           # dependency breakdown
sizeup --entry ./src/index.js   # local file analysis
sizeup ./my-project             # scan project deps
sizeup ./my-project --local     # use existing node_modules
sizeup . --top 10               # top 10 largest deps
sizeup . --format md            # Markdown table for CI
sizeup                          # scan cwd deps
```

## License

MIT
