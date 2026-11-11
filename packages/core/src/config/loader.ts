import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';

import { getDefaultConfig } from './defaults.js';

import type { CodeAnalyzerConfig } from '@code-analyzer/shared';

/**
 * Deep merge source into target. Mutates and returns target.
 * Arrays are replaced (not concatenated). Objects are recursively merged.
 *
 * **A key named `__proto__` is an own property of an object parsed from JSON, and assigning it walks the prototype
 * chain.** `JSON.parse('{"__proto__":{"polluted":true}}')` produces a key that `Object.keys` reports, so the loop below
 * would write `target.__proto__.polluted` - a write to `Object.prototype`, which every later object in the process then
 * inherits. The three names are the whole of that class, and they are refused rather than sanitised: a configuration key
 * is a name the schema chose, not a name to be repaired.
 *
 * **The comparison is spelled out at each write rather than hidden in a predicate**, because the property this needs is
 * "no loop reaches an assignment without having compared the key", and that is a property a reader can check line by line
 * and a static analysis can follow. `applyLayer` below carries the same three names for the same reason.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const mutableTarget = target as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const srcVal = source[key];
    const tgtVal = mutableTarget[key];
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      mutableTarget[key] = deepMerge(tgtVal, srcVal);
    } else {
      mutableTarget[key] = srcVal;
    }
  }
  return target;
}

/**
 * Returns true if val is a plain object (not null, not array, not Date, etc.)
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (val === null || typeof val !== 'object') return false;
  if (Array.isArray(val)) return false;
  if (val instanceof Date) return false;
  return true;
}

/**
 * Environment variable name prefix for config overrides.
 */
const ENV_PREFIX = 'CODE_ANALYZER_';

/**
 * Map of environment variable suffix to config key path segments.
 */
type ConfigKeyMapping = {
  rootKey: string;
  subKey?: string;
};

const ENV_TO_CONFIG_KEY: Record<string, ConfigKeyMapping> = {
  PROJECT_ID: { rootKey: 'projectId' },
  ROOT_PATH: { rootKey: 'rootPath' },
  LANGUAGE: { rootKey: 'language' },
  MAX_FILE_SIZE: { rootKey: 'maxFileSize' },
  MAX_FILES: { rootKey: 'maxFiles' },
  PARSE_WORKERS: { rootKey: 'parseWorkers' },
  CACHE_DIR: { rootKey: 'cacheDir' },
  MCP_NAME: { rootKey: 'mcp', subKey: 'name' },
  MCP_VERSION: { rootKey: 'mcp', subKey: 'version' },
  MCP_TOOL_PROFILE: { rootKey: 'mcp', subKey: 'toolProfile' },
  MCP_MAX_RESULTS: { rootKey: 'mcp', subKey: 'maxResults' },
  MCP_ENABLE_STREAMING: { rootKey: 'mcp', subKey: 'enableStreaming' },
  MCP_ENABLE_RESOURCES: { rootKey: 'mcp', subKey: 'enableResources' },
  MCP_ENABLE_PROMPTS: { rootKey: 'mcp', subKey: 'enablePrompts' },
  REVIEW_ENABLED: { rootKey: 'review', subKey: 'enabled' },
  REVIEW_MAX_COMMENTS: { rootKey: 'review', subKey: 'maxComments' },
  EMBED_ENABLED: { rootKey: 'embed', subKey: 'enabled' },
  EMBED_MODEL: { rootKey: 'embed', subKey: 'model' },
  EMBED_BATCH_SIZE: { rootKey: 'embed', subKey: 'batchSize' },
  EMBED_DIMENSIONS: { rootKey: 'embed', subKey: 'dimensions' },
  PRUNER_ENABLED: { rootKey: 'pruner', subKey: 'enabled' },
  PRUNER_KEEP_TESTS: { rootKey: 'pruner', subKey: 'keepTests' },
  PRUNER_KEEP_INTERNAL: { rootKey: 'pruner', subKey: 'keepInternal' },
};

/**
 * Convert a string environment variable value to its appropriate type.
 */
function coerceEnvValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  return raw;
}

// ---------------------------------------------------------------------------
// The schema, which is the list of keys a file may contain
// ---------------------------------------------------------------------------

/**
 * The type a configuration key holds.
 *
 * **This table is the difference between a file that configures something and a file that looks like it does.** The
 * previous loader merged whatever a file contained into the configuration, so a key the product did not have — a typo, a
 * key from a different tool, a key from a version that no longer exists — was accepted and then never read by anybody.
 * Naming every key here makes an unrecognised one reportable, and makes a value of the wrong type an error instead of a
 * `maxFiles: "500"` that compares as a string for the rest of the run.
 */
type FieldType = 'string' | 'count' | 'boolean' | 'strings' | 'object';

const FIELDS: Readonly<Record<string, FieldType>> = {
  projectId: 'string',
  rootPath: 'string',
  language: 'string',
  cacheDir: 'string',
  excludePatterns: 'strings',
  includePatterns: 'strings',
  ignorePaths: 'strings',
  maxFileSize: 'count',
  maxFiles: 'count',
  parseWorkers: 'count',
  mcp: 'object',
  review: 'object',
  embed: 'object',
  pruner: 'object',
};

/** The keys of the nested `mcp`, `review`, `embed` and `pruner` blocks. */
const NESTED_FIELDS: Readonly<Record<string, Readonly<Record<string, FieldType>>>> = {
  mcp: {
    name: 'string',
    version: 'string',
    toolProfile: 'string',
    readOnly: 'boolean',
    maxResults: 'count',
    enableStreaming: 'boolean',
    enableResources: 'boolean',
    enablePrompts: 'boolean',
  },
  review: {
    enabled: 'boolean',
    maxComments: 'count',
    severityFilter: 'strings',
    categoryFilter: 'strings',
  },
  embed: { enabled: 'boolean', model: 'string', batchSize: 'count', dimensions: 'count' },
  pruner: { enabled: 'boolean', keepTests: 'boolean', keepInternal: 'boolean' },
};

/** The sentence a value of the wrong type earns, per type. */
const TYPE_EXPECTATION: Readonly<Record<FieldType, string>> = {
  string: 'a string',
  count: 'a positive integer',
  boolean: 'true or false',
  strings: 'an array of strings',
  object: 'an object',
};

/** Return the type of `key` inside `parent`, or undefined when the schema has never heard of it. */
function fieldType(key: string, parent?: string): FieldType | undefined {
  if (parent === undefined) return FIELDS[key];
  return NESTED_FIELDS[parent]?.[key];
}

/** Does `value` satisfy `type`? */
function satisfies(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'count':
      return (
        typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'strings':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    case 'object':
      return isPlainObject(value);
  }
}

/**
 * The known key closest to a key nobody knows, or undefined when nothing is close.
 *
 * **A suggestion is not politeness here.** `maxFileSizes` is one character from the key that does what the author
 * meant, and a message that only says "unknown" leaves them comparing two words by eye. The match is deliberately
 * conservative — a shared prefix or a shared suffix of at least half the length — because a wrong suggestion is worse
 * than none.
 */
function nearestKey(key: string, candidates: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  return candidates.find((candidate) => {
    const other = candidate.toLowerCase();
    if (lower === other) return true;
    const [shorter, longer] = lower.length <= other.length ? [lower, other] : [other, lower];
    if (longer.startsWith(shorter) || longer.endsWith(shorter)) {
      return shorter.length >= Math.ceil(longer.length / 2);
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// What a load produces
// ---------------------------------------------------------------------------

/** Which layer of the configuration a value came from. */
export type ConfigLayerName = 'default' | 'global' | 'project' | 'explicit';

/** One layer of the merge, and whether it was actually there. */
export interface ConfigLayer {
  name: ConfigLayerName;
  /** The file this layer read, or null when there was nothing to read. */
  path: string | null;
  found: boolean;
}

/** A key a file contained and this product does not have. */
export interface IgnoredSetting {
  /** Dotted key path, e.g. `index.maxFileSize`. */
  key: string;
  /** The file that contained it. */
  file: string;
  message: string;
}

/** The result of reading the configuration, with the answers a reader needs to trust it. */
export interface LoadedConfig {
  config: CodeAnalyzerConfig;
  /**
   * For every leaf key that any layer set, the layer that set it — `default`, `project`, `global`, `explicit`, or
   * `env:CODE_ANALYZER_MAX_FILES`. Absent keys were never set by anything, which for this schema means the default.
   */
  origin: Record<string, string>;
  layers: ConfigLayer[];
  /** Keys that were present in a file and are not part of the schema. */
  ignored: IgnoredSetting[];
  /** Things the reader wants the user to know that are not errors, such as two project files. */
  warnings: string[];
}

export interface LoadConfigOptions {
  /** An explicit configuration file. **Replaces discovery** rather than adding a layer to it. */
  file?: string;
  /**
   * The global file, or null to skip the global layer entirely.
   *
   * Defaults to `~/.code-analyzer/config.json`. The override exists because a test that has to write into the real home
   * directory is a test that cannot run twice and cannot run in parallel.
   */
  globalFile?: string | null;
  /** Whether to apply `CODE_ANALYZER_*` overrides. Defaults to true. */
  env?: boolean;
}

/** The path `init` writes, and the one a project configuration belongs in. */
export function canonicalProjectConfigPath(rootPath: string): string {
  return path.join(rootPath, '.code-analyzer', 'config.json');
}

/** The root-level spelling an earlier version documented. Read, but never preferred. */
export function legacyProjectConfigPath(rootPath: string): string {
  return path.join(rootPath, '.code-analyzer.json');
}

/** The global file. */
export function globalConfigPath(): string {
  return path.join(os.homedir(), '.code-analyzer', 'config.json');
}

/** Does `file` exist as a regular file? */
async function isFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Find the project configuration file.
 *
 * **The canonical path wins outright; the two are not merged.** A project with both files would otherwise have a
 * configuration that is the deep merge of two documents, and neither of them would say what the run was going to do. The
 * ignored file is named in a warning, so the person who edited it finds out here rather than by watching a setting have
 * no effect.
 */
async function discoverProjectFile(
  rootPath: string,
  warnings: string[],
): Promise<string | undefined> {
  const canonical = canonicalProjectConfigPath(rootPath);
  const legacy = legacyProjectConfigPath(rootPath);

  if (await isFile(canonical)) {
    if (await isFile(legacy)) {
      warnings.push(
        `${legacy} is ignored: ${canonical} is the project configuration. Move its settings there and delete it, ` +
          'because two files cannot both say what a run does.',
      );
    }
    return canonical;
  }
  return (await isFile(legacy)) ? legacy : undefined;
}

/**
 * Read one JSON file, refusing everything that is not a configuration object.
 */
async function readConfigFile(file: string): Promise<Record<string, unknown> | undefined> {
  let content: string;
  try {
    content = await fs.readFile(file, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${file}: not valid JSON — ${reason}`);
  }

  if (Array.isArray(parsed)) {
    throw new Error(`${file}: must contain a JSON object, got an array`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `${file}: must contain a JSON object, got ${parsed === null ? 'null' : typeof parsed}`,
    );
  }
  return parsed;
}

/**
 * Merge `source` into `target`, recording where every leaf came from and what nobody recognised.
 *
 * Only keys the schema knows are merged. **That is the point**: a key that is not in the schema cannot silently become
 * part of the configuration, which is how `.code-analyzer/config.json` came to be a file full of settings that nothing
 * read.
 */
function applyLayer(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  layerName: string,
  file: string,
  origin: Record<string, string>,
  ignored: IgnoredSetting[],
  prefix = '',
  parent?: string,
): void {
  for (const key of Object.keys(source)) {
    // **The schema would drop these as unknown settings; the comparison is here so that the property is local.** A
    // reader of this loop can see that no key reaches `target` without having been compared, and a later change that
    // loosens `fieldType` cannot reopen the prototype write `deepMerge` documents.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const value = source[key];
    const dotted = prefix === '' ? key : `${prefix}.${key}`;
    const type = fieldType(key, parent);

    if (type === undefined) {
      const suggestion = nearestKey(
        key,
        Object.keys(parent === undefined ? FIELDS : (NESTED_FIELDS[parent] ?? {})),
      );
      ignored.push({
        key: dotted,
        file,
        message:
          suggestion === undefined
            ? `unknown setting, and this version has no such key`
            : `unknown setting, did you mean ${prefix === '' ? suggestion : `${prefix}.${suggestion}`}?`,
      });
      continue;
    }

    if (!satisfies(value, type)) {
      throw new Error(
        `${file}: ${dotted} must be ${TYPE_EXPECTATION[type]}, got ${describeValue(value)}`,
      );
    }

    if (type === 'object') {
      const nested = value as Record<string, unknown>;
      const existing = target[key];
      const into = isPlainObject(existing) ? existing : {};
      target[key] = into;
      applyLayer(into, nested, layerName, file, origin, ignored, dotted, key);
      continue;
    }

    target[key] = value;
    origin[dotted] = layerName;
  }
}

/** A short description of a value, for an error message. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value);
  return `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Apply environment variable overrides to the config. Mutates in place.
 */
function applyEnvOverrides(config: Record<string, unknown>, origin: Record<string, string>): void {
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (!envKey.startsWith(ENV_PREFIX) || envVal === undefined) continue;

    const suffix = envKey.slice(ENV_PREFIX.length);
    const mapping = ENV_TO_CONFIG_KEY[suffix];
    if (!mapping) continue;

    const coerced = coerceEnvValue(envVal);
    const dotted =
      mapping.subKey === undefined ? mapping.rootKey : `${mapping.rootKey}.${mapping.subKey}`;
    const type = fieldType(
      mapping.subKey ?? mapping.rootKey,
      mapping.subKey === undefined ? undefined : mapping.rootKey,
    );

    // **A variable that does not parse is not a silent no-op.** `CODE_ANALYZER_MAX_FILES=none` used to travel through
    // the whole run as the string `none`, compared against a number, and lose.
    if (type !== undefined && !satisfies(coerced, type)) {
      throw new Error(`${envKey} must be ${TYPE_EXPECTATION[type]}, got ${JSON.stringify(envVal)}`);
    }

    if (mapping.subKey) {
      const existing = config[mapping.rootKey];
      const nested: Record<string, unknown> = isPlainObject(existing) ? existing : {};
      nested[mapping.subKey] = coerced;
      config[mapping.rootKey] = nested;
    } else {
      config[mapping.rootKey] = coerced;
    }
    origin[dotted] = `env:${envKey}`;
  }

  // Handle comma-separated list env vars
  const lists: Array<[string, string]> = [
    ['CODE_ANALYZER_EXCLUDE_PATTERNS', 'excludePatterns'],
    ['CODE_ANALYZER_INCLUDE_PATTERNS', 'includePatterns'],
    ['CODE_ANALYZER_IGNORE_PATHS', 'ignorePaths'],
  ];
  for (const [envKey, key] of lists) {
    const raw = process.env[envKey];
    if (raw === undefined) continue;
    config[key] = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    origin[key] = `env:${envKey}`;
  }
}

/**
 * Give every key that no layer set the origin `default`.
 *
 * **This runs at the end rather than at the beginning**, which is the difference between a report that is right about
 * nested blocks and one that is only right about the flat keys it happened to be tested with. Run first, it would stamp
 * `default` on `mcp`'s leaves before a file could claim them; run last, it fills only the gaps — so a file that sets
 * `mcp.maxResults` gets `mcp.maxResults → project`, while a key the defaults never had and no file set simply does not
 * appear. That is the honest answer: absent, not "default to nothing".
 */
function markDefaults(
  config: Record<string, unknown>,
  origin: Record<string, string>,
  prefix = '',
): void {
  for (const key of Object.keys(config)) {
    const value = config[key];
    const dotted = prefix === '' ? key : `${prefix}.${key}`;
    if (isPlainObject(value)) {
      markDefaults(value, origin, dotted);
    } else if (!(dotted in origin)) {
      origin[dotted] = 'default';
    }
  }
}

/**
 * Load the configuration and everything a reader needs to trust it: the layers, where each value came from, and what was
 * ignored.
 *
 * Layers, in increasing precedence: **defaults → global → project → environment → (the caller's flags)**. Flags are not
 * part of this function because a library does not know the command line; every command applies them to the object this
 * returns, which is why `origin` is keyed by the same names the flags are.
 *
 * @param rootPath - The project directory. The project layer is looked for inside it.
 * @param options - Explicit file, global file override, and whether environment variables apply.
 */
export async function loadConfigWithDiagnostics(
  rootPath: string,
  options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
  const warnings: string[] = [];
  const ignored: IgnoredSetting[] = [];
  const origin: Record<string, string> = {};
  const layers: ConfigLayer[] = [];

  const config = getDefaultConfig() as unknown as Record<string, unknown>;
  layers.push({ name: 'default', path: null, found: true });

  const globalFile = options.globalFile === undefined ? globalConfigPath() : options.globalFile;
  const globalConfig = globalFile === null ? undefined : await readConfigFile(globalFile);
  if (globalConfig !== undefined && globalFile !== null) {
    applyLayer(config, globalConfig, 'global', globalFile, origin, ignored);
  }
  layers.push({
    name: 'global',
    path: globalConfig === undefined ? null : globalFile,
    found: globalConfig !== undefined,
  });

  const explicit = options.file === undefined ? undefined : path.resolve(options.file);
  const explicitConfig = explicit === undefined ? undefined : await readConfigFile(explicit);
  if (explicit !== undefined) {
    if (explicitConfig === undefined) {
      throw new Error(`${explicit}: no such file`);
    }
    applyLayer(config, explicitConfig, 'explicit', explicit, origin, ignored);
  }

  const projectFile =
    options.file === undefined ? await discoverProjectFile(rootPath, warnings) : undefined;
  const projectConfig = projectFile === undefined ? undefined : await readConfigFile(projectFile);
  if (projectFile !== undefined && projectConfig !== undefined) {
    applyLayer(config, projectConfig, 'project', projectFile, origin, ignored);
  }
  layers.push({
    name: 'project',
    path: projectFile ?? null,
    found: projectConfig !== undefined,
  });
  layers.push({ name: 'explicit', path: explicit ?? null, found: explicitConfig !== undefined });

  if (options.env !== false) {
    applyEnvOverrides(config, origin);
  }
  markDefaults(config, origin);

  return { config: config as unknown as CodeAnalyzerConfig, origin, layers, ignored, warnings };
}

/**
 * Load the Code Analyzer configuration using layered merging:
 * 1. Defaults from `getDefaultConfig()`
 * 2. Global config from `~/.code-analyzer/config.json` (deep merge)
 * 3. Project config from `{rootPath}/.code-analyzer/config.json`, or the older `{rootPath}/.code-analyzer.json`
 * 4. Environment variables (`CODE_ANALYZER_*`)
 *
 * **This function had no caller for the whole life of the feature**, which is why the answer to "where does the
 * configuration come from" was, for a while, "nowhere". The caller that makes it true is `code-analyzer config`, which
 * prints the result of `loadConfigWithDiagnostics` — layers, origins and ignored keys included — and the commands that
 * apply it to their own flags.
 *
 * @param rootPath - The root directory of the project to analyze.
 * @returns The fully merged configuration.
 */
export async function loadConfig(rootPath: string): Promise<CodeAnalyzerConfig> {
  const loaded = await loadConfigWithDiagnostics(rootPath);
  // **A warning goes to stderr, never to stdout.** `loadConfig` is used by commands whose stdout is JSON somebody
  // parses; a diagnostic printed there would corrupt the answer.
  for (const warning of loaded.warnings) console.error(`[code-analyzer] ${warning}`);
  for (const entry of loaded.ignored)
    console.error(`[code-analyzer] ${entry.file}: ${entry.key} ${entry.message}`);
  return loaded.config;
}
