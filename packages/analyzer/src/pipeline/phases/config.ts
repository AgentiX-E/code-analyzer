// @code-analyzer/analyzer — Pipeline Phase: Config

import { basename, extname } from 'node:path';

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger , EDGE_CONFIGURES } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.env', '.ini', '.cfg', '.xml']);
const CONFIG_FILE_NAMES = new Set([
  'package.json', 'tsconfig.json', 'tsconfig.base.json',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml',
  '.prettierrc', '.prettierrc.json', '.prettierrc.yaml',
  'pyproject.toml', 'setup.cfg', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'docker-compose.yaml', 'docker-compose.yml', 'Dockerfile',
  '.env', '.env.local', '.env.development', '.env.production',
  'Makefile', '.gitlab-ci.yml', '.github', // handled by extension
]);

const CONFIG_RELEVANT_KEYS = new Set([
  'name', 'version', 'description', 'main', 'module', 'exports',
  'scripts', 'dependencies', 'devDependencies', 'peerDependencies',
  'compilerOptions', 'include', 'exclude',
  'project', 'tool', 'build-system',
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
      const flat = flattenObject(parsed, '', filePath, 0);
      entries.push(...flat.filter((e) => CONFIG_RELEVANT_KEYS.has(e.key)));
    } else if (ext === '.env') {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
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
      for (let i = 0; i < lines.length; i++) {
        const match = /^(\s*)([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:\s*(.+)$/.exec(lines[i]);
        if (match) {
          entries.push({
            key: match[2],
            value: match[3].trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.toml') {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(lines[i]);
        if (match) {
          entries.push({
            key: match[1],
            value: match[2].trim(),
            path: filePath,
            line: i + 1,
          });
        }
      }
    } else if (ext === '.xml') {
      const tagRegex = /<([a-zA-Z_][a-zA-Z0-9_.-]*)>([^<]*)<\/\1>/g;
      let match: RegExpExecArray | null;
      const lines = content.split('\n');
      while ((match = tagRegex.exec(content)) !== null) {
        const lineNum = findLineNumber(lines, match.index);
        entries.push({
          key: match[1],
          value: match[2].trim(),
          path: filePath,
          line: lineNum,
        });
      }
    }
  } catch {
    // Skip unparseable files
  }

  return entries;
}

function flattenObject(
  obj: unknown,
  prefix: string,
  path: string,
  depth: number,
): ConfigEntry[] {
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

function findLineNumber(lines: string[], charIndex: number): number {
  let accumulated = 0;
  for (let i = 0; i < lines.length; i++) {
    accumulated += lines[i].length + 1; // +1 for newline
    if (accumulated > charIndex) return i + 1;
  }
  return lines.length;
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
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

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
          const node = builder.addNode(ctx.graph, 'Config', entry.key, {
            name: entry.key,
            filePath: file.filePath,
            startLine: entry.line,
            endLine: entry.line,
            configValue: String(entry.value),
          }, qname);

          builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_CONFIGURES, ctx.projectId);
        }

        configFiles++;
      }

      ctx.phaseData.set('config', { configFiles, totalEntries: configFiles });
      return { phaseId: this.id, status: 'success', output: { configFiles } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}