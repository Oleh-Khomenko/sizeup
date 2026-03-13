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

Scanning 56 dependencies from package.json...

  ✓ Installed 56 packages
  ✓ Analyzed 52/56 packages (4 failed)

  Package                             Minified     Gzipped  ...
  ────────────────────────────────  ──────────  ──────────
  ...
```

Use `--local` to skip the install step and read directly from the project's existing `node_modules`:

```bash
$ sizeup ./my-project --local
```

> Sizes may differ slightly from a fresh install due to resolved dependency versions.

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
| `--budget <size>` | Set a size budget — exit code 1 if exceeded. Supports: B, kB, KB, MB (case-insensitive) |
| `--diff` | Compare two packages side-by-side |
| `--deps` | Show per-dependency size breakdown |
| `--entry <path>` | Analyze local file/directory (skips npm install) |
| `--local` | Use project's `node_modules` instead of installing to a temp dir |
| `--concurrency <N>` | Max parallel analyses (default: CPU count, max 8) |
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
sizeup                          # scan cwd deps
```

## License

MIT
