// @code-analyzer/cli — config command
// Prints the configuration a run would actually use, and where every value came from.

import { EOL } from 'node:os';

import { loadConfigWithDiagnostics, type LoadedConfig } from '@code-analyzer/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigCommandOptions {
  /** Project directory whose configuration is being asked about. */
  path?: string;
  /** Read this file instead of discovering one. */
  file?: string;
  /** Machine-readable output: the configuration, the layers, the origins, the ignored keys. */
  json?: boolean;
  /** Treat an unrecognised key as an error rather than a warning. */
  strict?: boolean;
  /** Apply `CODE_ANALYZER_*` overrides. Defaults to true. */
  env?: boolean;
}

export interface ConfigCommandResult {
  exitCode: number;
  output: string;
  /** Diagnostics for stderr, kept separate so that `--json` on stdout stays parseable. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * A value a JSON document can hold.
 *
 * **The type is the argument.** `renderValue` used to take `unknown` and narrow with `typeof`, which left the compiler
 * unable to prove that the value reaching the scalar branch was a scalar — so the branch that prints `[object Object]`
 * stayed reachable. Naming what JSON can hold makes the impossible case unrepresentable and the possible ones exhaustive.
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * How a value reads in a table cell.
 *
 * **Exported because it is the one place this report can say something untrue**, and the last branch is the one that
 * matters: a table cell that printed `[object Object]` would be worse than the empty cell a reader would report as a bug.
 * The schema forbids an object at a leaf, so that branch is defensive — and a defensive branch nobody executes is a
 * branch that will be wrong the day it is reached.
 */
export function renderValue(value: JsonValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const shown = value.slice(0, 3).map((entry) => renderValue(entry));
    const rest = value.length - shown.length;
    return rest === 0 ? shown.join(', ') : `${shown.join(', ')}, … (${value.length} items)`;
  }
  if (value === null) return 'null';
  if (typeof value === 'object') return '{…}';
  return asText(value);
}

/**
 * A JSON scalar as display text.
 *
 * **`String(value)` alone is not enough, and the linter is right about why**: handed an object it prints
 * `[object Object]`, which is the one thing a configuration report must never say. Typing the parameter as the scalars a
 * JSON document can hold makes the object case unrepresentable here instead of unreachable there.
 */
function asText(value: string | number | boolean): string {
  if (typeof value === 'string') return value === '' ? '""' : value;
  return `${value}`;
}

/** Every leaf key of the configuration, dotted, sorted. */
function leaves(value: Record<string, unknown>, prefix = ''): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    const dotted = prefix === '' ? key : `${prefix}.${key}`;
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      out.push(...leaves(entry as Record<string, unknown>, dotted));
    } else {
      out.push([dotted, entry]);
    }
  }
  return out;
}

/**
 * Pad a cell to `width`.
 *
 * **`String.prototype.padEnd` counts UTF-16 code units, not columns**, and a value holding a non-BMP character would
 * shift every column after it. Nothing in this schema is expected to hold one, so the plain pad is used deliberately
 * rather than a width calculator that would need its own tests.
 */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** The human-readable report: what a run would use, and why. */
function formatText(loaded: LoadedConfig, rootPath: string): string {
  const lines: string[] = [];
  lines.push(`Configuration for ${rootPath}`);
  lines.push('');

  lines.push('Layers, in increasing precedence:');
  for (const layer of loaded.layers) {
    const where =
      layer.path === null ? (layer.name === 'default' ? 'built in' : 'not found') : layer.path;
    lines.push(`  ${pad(layer.name, 9)} ${layer.found ? '✓' : '·'} ${where}`);
  }
  lines.push('');
  lines.push('  flags on the command line win over every layer above.');
  lines.push('');

  // **One assertion at the boundary**, where every value is known to have come from `JSON.parse`: what reaches the
  // renderer is a JSON value by construction, and saying so once is better than narrowing `unknown` four times.
  const rows: Array<[key: string, value: string, source: string]> = leaves(
    loaded.config as unknown as Record<string, unknown>,
  ).map(([key, value]) => [key, renderValue(value as JsonValue), loaded.origin[key] ?? '?']);
  const keyWidth = Math.max('key'.length, ...rows.map((row) => row[0].length));
  // **Wide enough for the longest thing a value can be before it stops being worth printing in full**: three globs and
  // the count of the ones that were left out. Narrower columns truncated the list's *count*, which is the part that says
  // how much was hidden.
  const valueWidth = Math.min(Math.max('value'.length, ...rows.map((row) => row[1].length)), 56);

  lines.push(`${pad('key', keyWidth)}  ${pad('value', valueWidth)}  source`);
  lines.push(`${'-'.repeat(keyWidth)}  ${'-'.repeat(valueWidth)}  ${'-'.repeat(12)}`);
  for (const [key, value, source] of rows) {
    const cell = value.length > valueWidth ? `${value.slice(0, valueWidth - 1)}…` : value;
    lines.push(`${pad(key, keyWidth)}  ${pad(cell, valueWidth)}  ${source}`);
  }

  if (loaded.ignored.length > 0) {
    lines.push('');
    lines.push(`Ignored ${loaded.ignored.length} setting(s) — this version has no such key:`);
    for (const entry of loaded.ignored) {
      lines.push(`  ${entry.file}: ${entry.key} — ${entry.message}`);
    }
  }

  if (loaded.warnings.length > 0) {
    lines.push('');
    for (const warning of loaded.warnings) lines.push(`  warning: ${warning}`);
  }

  return lines.join(EOL);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * Print the configuration a run would use.
 *
 * **This command is the consumer `loadConfig` never had.** Every page that documented the configuration described a
 * four-layer merge — and for the whole life of the feature nothing performed it, so the honest answer to "which value
 * wins" was "there is no run that could tell you". `code-analyzer config` runs the merge and prints, for every leaf key,
 * the layer that set it; the layers that were looked for and not found; and every key the files contained that this
 * version does not have.
 *
 * It exits 1 only for `--strict` with an unrecognised key, because in every other case the configuration is usable and
 * the point of printing it is to let the reader decide.
 */
export async function runConfigCommand(
  options: ConfigCommandOptions = {},
): Promise<ConfigCommandResult> {
  const rootPath = options.path ?? process.cwd();
  const warnings: string[] = [];

  let loaded: LoadedConfig;
  try {
    loaded = await loadConfigWithDiagnostics(rootPath, {
      ...(options.file === undefined ? {} : { file: options.file }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 2, output: `[code-analyzer] ${message}${EOL}`, warnings };
  }

  warnings.push(...loaded.warnings);
  for (const entry of loaded.ignored) warnings.push(`${entry.file}: ${entry.key} ${entry.message}`);

  if (options.json === true) {
    const payload = {
      rootPath,
      config: loaded.config,
      origin: loaded.origin,
      layers: loaded.layers,
      ignored: loaded.ignored,
      warnings: loaded.warnings,
    };
    return { exitCode: 0, output: `${JSON.stringify(payload, null, 2)}${EOL}`, warnings };
  }

  const strictFailure = options.strict === true && loaded.ignored.length > 0;
  return {
    exitCode: strictFailure ? 1 : 0,
    output: `${formatText(loaded, rootPath)}${EOL}`,
    warnings,
  };
}
