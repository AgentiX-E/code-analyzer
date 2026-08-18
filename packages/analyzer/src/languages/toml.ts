// @code-analyzer/analyzer — TOML Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `tree-sitter-toml` package only
// ships `nodeTypeInfo` metadata (no compiled `Language` object), so a
// tree-sitter path is unreachable dead code. The regex parser below handles
// tables, array tables, key/value pairs, and config-secret taint detection.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TaintSource, TaintSink, TaintSanitizer } from './tree-sitter-base.js';
import { extractSecretSources } from './regex-helpers.js';

/** Secret-bearing keys that mark a TOML value as a config-secret taint source. */
const SECRET_KEYWORDS = ['password', 'secret', 'token', 'api_key', 'credential', 'private_key'];

export class TomlProvider implements LanguageProvider {
  readonly language = 'toml';
  readonly displayName = 'TOML';
  readonly extensions = ['.toml'];
  readonly globs = ['**/*.toml'];
  readonly importSemantics = 'none' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let currentTable = '';
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith('#')) continue;
      const tableMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (tableMatch) {
        currentTable = tableMatch[1]!;
        captures.push(this.makeCapture(CAPTURE_TAGS.CLASS_DEF, currentTable, i + 1, filePath, { isTable: 'true' }));
        continue;
      }
      const arrMatch = line.match(/^\s*\[\[([^\]]+)\]\]\s*$/);
      if (arrMatch) {
        captures.push(this.makeCapture(CAPTURE_TAGS.CLASS_DEF, arrMatch[1]!, i + 1, filePath, { isArrayTable: 'true' }));
        continue;
      }
      const kvMatch = line.match(/^\s*([\w.-]+)\s*=\s*(.+?)\s*$/);
      if (kvMatch) {
        captures.push(this.makeCapture(CAPTURE_TAGS.VARIABLE_DEF, kvMatch[1]!, i + 1, filePath, { section: currentTable }));
      }
    }
    return captures;
  }

  extractImports(_source: string): ParsedImport[] {
    // TOML has no import mechanism.
    return [];
  }

  isExported(_source: string, _symbolName: string): boolean {
    // TOML keys are not exported symbols.
    return false;
  }

  /** Detect config secrets (password/token/api_key/...) as taint sources. */
  extractTaintSources(source: string): TaintSource[] {
    return extractSecretSources(source, 'config_secret', SECRET_KEYWORDS);
  }

  extractTaintSinks(_source: string): TaintSink[] {
    return [];
  }

  extractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }

  private makeCapture(
    tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string,
    line: number,
    filePath: string,
    extra: Record<string, string> = {},
  ): UnifiedCapture {
    return {
      tag,
      text: name,
      startLine: line,
      endLine: line,
      startByte: 0,
      endByte: 0,
      name,
      properties: { filePath, ...extra },
    };
  }
}
