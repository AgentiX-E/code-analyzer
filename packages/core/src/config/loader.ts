import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';

import { getDefaultConfig } from './defaults.js';

import type { CodeAnalyzerConfig } from '@code-analyzer/shared';

/**
 * Deep merge source into target. Mutates and returns target.
 * Arrays are replaced (not concatenated). Objects are recursively merged.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>
): T {
  const mutableTarget = target as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = mutableTarget[key];
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      mutableTarget[key] = deepMerge(
        tgtVal,
        srcVal
      );
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

/**
 * Apply environment variable overrides to the config. Mutates in place.
 */
function applyEnvOverrides(config: Record<string, unknown>): void {
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (!envKey.startsWith(ENV_PREFIX) || envVal === undefined) continue;

    const suffix = envKey.slice(ENV_PREFIX.length);
    const mapping = ENV_TO_CONFIG_KEY[suffix];
    if (!mapping) continue;

    const coerced = coerceEnvValue(envVal);

    if (mapping.subKey) {
      const existing = config[mapping.rootKey];
      const nested: Record<string, unknown> = isPlainObject(existing) ? existing : {};
      nested[mapping.subKey] = coerced;
      config[mapping.rootKey] = nested;
    } else {
      config[mapping.rootKey] = coerced;
    }
  }

  // Handle comma-separated list env vars
  const excludeVal = process.env['CODE_ANALYZER_EXCLUDE_PATTERNS'];
  if (excludeVal !== undefined) {
    config['excludePatterns'] = excludeVal
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const includeVal = process.env['CODE_ANALYZER_INCLUDE_PATTERNS'];
  if (includeVal !== undefined) {
    config['includePatterns'] = includeVal
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const ignoreVal = process.env['CODE_ANALYZER_IGNORE_PATHS'];
  if (ignoreVal !== undefined) {
    config['ignorePaths'] = ignoreVal
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

/**
 * Load and parse a JSON configuration file.
 * Returns undefined if the file does not exist. Throws on parse errors.
 */
async function loadJsonFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

/**
 * Get the global config file path (~/.code-analyzer/config.json).
 */
function getGlobalConfigPath(): string {
  const home = os.homedir();
  return path.join(home, '.code-analyzer', 'config.json');
}

/**
 * Get the project config file path ({rootPath}/.code-analyzer.json).
 */
function getProjectConfigPath(rootPath: string): string {
  return path.join(rootPath, '.code-analyzer.json');
}

/**
 * Load the Code Analyzer configuration using layered merging:
 * 1. Defaults from getDefaultConfig()
 * 2. Global config from ~/.code-analyzer/config.json (deep merge)
 * 3. Project config from {rootPath}/.code-analyzer.json (deep merge)
 * 4. Environment variables (CODE_ANALYZER_*)
 *
 * @param rootPath - The root directory of the project to analyze.
 * @returns The fully merged and validated configuration.
 */
export async function loadConfig(rootPath: string): Promise<CodeAnalyzerConfig> {
  // Layer 1: defaults
  const config = getDefaultConfig() as unknown as Record<string, unknown>;

  // Layer 2: global config
  const globalPath = getGlobalConfigPath();
  const globalConfig = await loadJsonFile(globalPath);
  if (globalConfig) {
    deepMerge(config, globalConfig);
  }

  // Layer 3: project config
  const projectPath = getProjectConfigPath(rootPath);
  const projectConfig = await loadJsonFile(projectPath);
  if (projectConfig) {
    deepMerge(config, projectConfig);
  }

  // Layer 4: environment variables
  applyEnvOverrides(config);

  return config as unknown as CodeAnalyzerConfig;
}
