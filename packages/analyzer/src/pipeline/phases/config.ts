// @code-analyzer/analyzer — Pipeline Phase: Config

import { basename, extname } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { PhaseLogger, createNoopPhaseLogger, EDGE_CONFIGURES } from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';
import { toPhaseFailure } from '../phase-helpers.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type { PipelinePhaseId, PipelineContext, DiscoveredFile } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const CONFIG_EXTENSIONS = new Set([
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.env',
  '.ini',
  '.cfg',
  '.xml',
]);
const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.yaml',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  'pyproject.toml',
  'setup.cfg',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'docker-compose.yaml',
  'docker-compose.yml',
  'Dockerfile',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  'Makefile',
  '.gitlab-ci.yml',
  '.github', // handled by extension
]);

const CONFIG_RELEVANT_KEYS = new Set([
  'name',
  'version',
  'description',
  'main',
  'module',
  'exports',
  'scripts',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'compilerOptions',
  'include',
  'exclude',
  'project',
  'tool',
  'build-system',
]);

interface ConfigEntry {
  key: string;
  value: unknown;
  path: string;
  line: number;
}

function extractConfigEntries(filePath: string, content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

  try {
    if (ext === '.json') {
      const parsed = JSON.parse(content);
      const lines = content.split('\n');
      const flat = flattenObject(parsed, '', filePath, 0);
      entries.push(
        ...flat
          .filter((e) => CONFIG_RELEVANT_KEYS.has(e.key))
          // **A JSON key has a line, and the flattening did not know it.** Every config entry from a JSON file carried
          // `line: 0`, so **78 nodes in one real repository pointed at line zero** - a symbol nobody can open, and the
          // only nodes in the graph with an impossible range. The leaf name is looked up in the source, and a key that
          // is genuinely absent from the text is anchored to the first line rather than to none.
          .map((e) => ({ ...e, line: locateKey(lines, e.key) })),
      );
    } else if (ext === '.env') {
      const lines = content.split('\n');
      for (const [i, raw] of lines.entries()) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          entries.push({
            key: line.slice(0, eqIdx).trim(),
            value: line.slice(eqIdx + 1).trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.yaml' || ext === '.yml') {
      const lines = content.split('\n');
      for (const [i, raw] of lines.entries()) {
        const match = /^(\s*)([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:\s*(.+)$/.exec(raw);
        if (match) {
          // **Indexed with assertions rather than destructured with a guard.** A regex that matched fills every capture
          // it declares, so `undefined` is not a state the language can produce - it is only a state the type system
          // must consider. The version that checked for it carried an arm no test could reach.
          entries.push({
            key: match[2]!,
            value: match[3]!.trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.toml') {
      const lines = content.split('\n');
      for (const [i, raw] of lines.entries()) {
        const match = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(raw);
        if (match) {
          entries.push({
            key: match[1]!,
            value: match[2]!.trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.xml') {
      const tagRegex = /<([a-zA-Z_][a-zA-Z0-9_.-]*)>([^<]*)<\/\1>/g;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(content)) !== null) {
        entries.push({
          key: match[1]!,
          value: match[2]!.trim(),
          path: filePath,
          line: findLineNumber(content, match.index),
        });
      }
    }
  } catch {
    // Skip unparseable files
  }

  return entries;
}

function flattenObject(obj: unknown, prefix: string, path: string, depth: number): ConfigEntry[] {
  if (depth > 10) return [];
  if (typeof obj !== 'object' || obj === null) return [];

  const entries: ConfigEntry[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      entries.push(...flattenObject(value, fullKey, path, depth + 1));
    } else {
      entries.push({
        key: fullKey,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        path,
        line: 0,
      });
    }
  }
  return entries;
}

/**
 * The first line that mentions a config key, or `1` when the text does not mention it.
 *
 * **The last segment is what is searched for**, because `python.defaultInterpreterPath` is stored as a nested key and
 * written in the file as `"python.defaultInterpreterPath": …`. **A key that is not found is still anchored to a real
 * line**, because a node at line 0 cannot be opened by anything that consumes this graph.
 */
function locateKey(lines: string[], key: string): number {
  const segments = key.split('.');
  // **`split` always yields at least one segment**, so the last one exists; the assertion states the rule the
  // coverage gate cannot see.
  const leaf = segments[segments.length - 1]!;
  const index = lines.findIndex((line) => line.includes(`"${leaf}"`) || line.includes(`${leaf}:`));
  // **`findIndex` answers -1 for a key the text does not mention, and 0 is not a line.** `Math.max` clamps without a
  // branch, so the "not found" case is a value rather than an arm nobody exercises.
  return Math.max(index + 1, 1);
}

/**
 * The 1-based line that holds `charIndex`.
 *
 * **There is no loop and no fallback because the answer is a count**: the newlines before the offset, plus one. The
 * previous version accumulated line lengths and ended in a `return` its own comment called unreachable - a statement
 * nothing could execute and nothing could test.
 */
function findLineNumber(text: string, charIndex: number): number {
  return text.slice(0, charIndex).split('\n').length;
}

function isConfigFile(fileName: string, ext: string): boolean {
  const base = fileName.toLowerCase();
  if (CONFIG_FILE_NAMES.has(base)) return true;
  if (CONFIG_EXTENSIONS.has(ext)) return true;
  // Check partial matches for files like .eslintrc.yaml
  for (const name of CONFIG_FILE_NAMES) {
    if (base.startsWith(name)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 5: config — Process configuration files
// ---------------------------------------------------------------------------

export class ConfigPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'config';
  readonly dependencies: PipelinePhaseId[] = ['scan'];
  readonly description = 'Process configuration files (JSON, YAML, TOML, ENV)';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        { discoveredFiles: DiscoveredFile[] } | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { configFiles: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let configFiles = 0;

      for (const file of scanData.discoveredFiles) {
        const fileName = basename(file.filePath);
        const ext = extname(file.filePath);

        if (!isConfigFile(fileName, ext)) continue;

        const entries = extractConfigEntries(file.filePath, file.content);
        if (entries.length === 0) continue;

        const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!fileNodeId) continue;

        for (const entry of entries) {
          const qname = `config:${file.filePath}:${entry.key}`;
          const node = builder.addNode(
            ctx.graph,
            'Config',
            entry.key,
            {
              name: entry.key,
              filePath: file.filePath,
              startLine: entry.line,
              endLine: entry.line,
              configValue: String(entry.value),
            },
            qname,
          );

          builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_CONFIGURES, ctx.projectId);
        }

        configFiles++;
      }

      ctx.phaseData.set('config', { configFiles, totalEntries: configFiles });
      return { phaseId: this.id, status: 'success', output: { configFiles } };
    } catch (err) {
      return toPhaseFailure(err, this.id, this.logger, ctx?.rootPath);
    }
  }
}
