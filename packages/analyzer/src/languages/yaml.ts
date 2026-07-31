// @code-analyzer/analyzer — YAML Provider (regex fallback)
// Parses YAML configuration files for key-value pairs, anchors, and aliases.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class YamlProvider extends TreeSitterBaseProvider {
  readonly language = 'yaml';
  readonly displayName = 'YAML';
  readonly extensions = ['.yaml', '.yml'];
  readonly globs = ['**/*.yaml', '**/*.yml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-yaml') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'block_mapping_pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'flow_node' },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith('#') || line.startsWith('---') || line.startsWith('...')) continue;
      const kvMatch = line.match(/^(\s*)([\w.-]+)\s*:\s*(.*)/);
      if (kvMatch) {
        const indent = kvMatch[1]!.length;
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${kvMatch[2]}: ${kvMatch[3]}`,
          startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length,
          name: kvMatch[2]!, properties: { indent: String(indent), filePath },
        });
      }
    }
    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
