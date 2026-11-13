// @code-analyzer/analyzer — YAML Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter). The reason used to be structural:
// `tree-sitter-yaml@0.5.0` is a 2020 grammar whose binding predates the
// `Language` ABI tree-sitter 0.25 requires, so `Parser#setLanguage` rejected it
// and this parser was the only reachable path. Iteration 132 measured the
// maintained grammar (`@tree-sitter-grammars/tree-sitter-yaml@0.7.1`): it does
// produce a `Language` - and the old package does not even compile against Node
// 22.23.4, which the repository pins - but the rule engine's capture walker
// recognises none of YAML's node types, so a syntax-tree path would set
// `hasAst` and return nothing where this parser finds the quoted scalars a
// secret rule reads. The regex parser below therefore stays, and it handles
// mappings, sequences, anchors/aliases, block scalars and config-secret taint
// detection.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { extractSecretSources } from './regex-helpers.js';

import type { ParsedImport, LanguageProvider } from './provider.js';
import type { TaintSource, TaintSink, TaintSanitizer } from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

/** Secret-bearing keys that mark a YAML value as a config-secret taint source. */
const SECRET_KEYWORDS = [
  'password',
  'secret',
  'token',
  'api_key',
  'api-key',
  'credential',
  'private_key',
];

const YAML_EXTENSIONS = ['.yaml', '.yml'];
const YAML_GLOBS = ['**/*.yaml', '**/*.yml'];

export class YamlProvider implements LanguageProvider {
  readonly language = 'yaml';
  readonly displayName = 'YAML';
  readonly extensions = YAML_EXTENSIONS;
  readonly globs = YAML_GLOBS;
  readonly importSemantics = 'none' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const lines = source.split('\n');
    let inBlockScalar = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') continue;
      if (trimmed === '|' || trimmed === '>' || trimmed === '|-' || trimmed === '>-') {
        inBlockScalar = true;
        continue;
      }
      if (inBlockScalar) {
        if (line.startsWith(' ') || line.startsWith('\t')) continue;
        inBlockScalar = false;
      }
      const anchorMatch = trimmed.match(/(?:^|\s)&(\w+)/);
      if (anchorMatch) {
        captures.push(
          this.makeCapture(CAPTURE_TAGS.VARIABLE_DEF, anchorMatch[1]!, i + 1, filePath, {
            anchor: 'true',
          }),
        );
      }
      const aliasMatch = trimmed.match(/(?:^|\s)\*(\w+)/);
      if (aliasMatch && !anchorMatch) {
        captures.push(
          this.makeCapture(CAPTURE_TAGS.VARIABLE_DEF, aliasMatch[1]!, i + 1, filePath, {
            alias: 'true',
          }),
        );
      }
      const kvMatch = trimmed.match(/^(\s*)([\w.\-]+)\s*:\s*(.*)/);
      if (kvMatch) {
        captures.push(
          this.makeCapture(CAPTURE_TAGS.VARIABLE_DEF, kvMatch[2]!, i + 1, filePath, {
            indent: String(kvMatch[1]!.length),
          }),
        );
      }
      const seqMatch = trimmed.match(/^\s*-\s+(.+)/);
      if (seqMatch) {
        captures.push(
          this.makeCapture(CAPTURE_TAGS.VARIABLE_DEF, seqMatch[1]!, i + 1, filePath, {
            isListItem: 'true',
          }),
        );
      }
    }
    return captures;
  }

  extractImports(_source: string): ParsedImport[] {
    // YAML has no import mechanism.
    return [];
  }

  isExported(_source: string, _symbolName: string): boolean {
    // YAML keys are not exported symbols.
    return false;
  }

  /** Detect config secrets (password/token/api_key/...) as taint sources. */
  extractTaintSources(source: string): TaintSource[] {
    return extractSecretSources(source, 'config_secret', SECRET_KEYWORDS);
  }

  extractTaintSinks(_source: string): TaintSink[] {
    // YAML has no code-level sinks.
    return [];
  }

  extractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }

  private makeCapture(
    tag: (typeof CAPTURE_TAGS)[keyof typeof CAPTURE_TAGS],
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
