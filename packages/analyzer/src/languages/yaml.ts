// @code-analyzer/analyzer — YAML Provider (tree-sitter AST walker)
// Full tree-sitter AST walker for YAML documents: mappings, sequences, scalars, anchors, aliases, tags.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class YamlProvider extends TreeSitterBaseProvider {
  readonly language = 'yaml';
  readonly displayName = 'YAML';
  readonly extensions = ['.yaml', '.yml'];
  readonly globs = ['**/*.yaml', '**/*.yml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      const mod = require('tree-sitter-yaml') as TreeSitterLanguage;
      return mod;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'block_mapping_pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'flow_node' },
      { nodeType: 'flow_pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'flow_node' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    // block_mapping_pair: key: value pairs
    if (nt === 'block_mapping_pair' || nt === 'flow_pair') {
      let keyName = '';
      let valueText = '';
      let anchorName: string | undefined;
      let aliasTarget: string | undefined;
      let tagName: string | undefined;

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'flow_node') {
          // Flow node contains the key - try to get scalar text
          for (let j = 0; j < child.childCount; j++) {
            const sub = child.child(j);
            if (sub.type === 'plain_scalar' || sub.type === 'double_quote_scalar' ||
                sub.type === 'single_quote_scalar' || sub.type === 'block_scalar') {
              if (!keyName) {
                keyName = sub.text;
                if (sub.type === 'double_quote_scalar' || sub.type === 'single_quote_scalar') {
                  keyName = sub.text.slice(1, -1);
                }
              } else {
                valueText = sub.text;
              }
            } else if (sub.type === 'integer_scalar' || sub.type === 'float_scalar' ||
                       sub.type === 'boolean_scalar' || sub.type === 'null_scalar') {
              valueText = sub.text;
            } else if (sub.type === 'block_sequence' || sub.type === 'flow_sequence') {
              valueText = `[${sub.namedChildCount} items]`;
            } else if (sub.type === 'block_mapping' || sub.type === 'flow_mapping') {
              valueText = `{${sub.namedChildCount} pairs}`;
            } else if (sub.type === 'anchor') {
              anchorName = sub.text;
            } else if (sub.type === 'alias') {
              aliasTarget = sub.text.slice(1); // remove *
            } else if (sub.type === 'tag') {
              tagName = sub.text;
            }
          }
        }
      }

      if (!keyName) {
        keyName = node.text.split(':')[0]?.trim() ?? 'unknown';
      }

      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: valueText ? `${keyName}: ${valueText}` : keyName,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: keyName,
        properties: {
          key: keyName,
          value: valueText ?? '',
          anchor: anchorName ?? '',
          alias: aliasTarget ?? '',
          tag: tagName ?? '',
          filePath: this.filePath,
        },
      });
    }

    // Anchor definitions: &name
    if (nt === 'anchor') {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: node.text.slice(1), // remove &
        properties: { anchor: 'true', filePath: this.filePath },
      });
    }

    // Alias references: *name
    if (nt === 'alias') {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: node.text.slice(1),
        properties: { alias: 'true', filePath: this.filePath },
      });
    }

    // Sequence items
    if (nt === 'block_sequence_item') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'flow_node') {
          const text = child.text.trim();
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_DEF,
            text: `- ${text}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: text,
            properties: { isListItem: 'true', filePath: this.filePath },
          });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const lines = source.split('\n');
    let inBlockScalar = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') continue;
      if (trimmed === '|' || trimmed === '>' || trimmed === '|-' || trimmed === '>-') { inBlockScalar = true; continue; }
      if (inBlockScalar) { if (line.startsWith(' ') || line.startsWith('\t')) continue; inBlockScalar = false; }
      // Anchor: &name
      const anchorMatch = trimmed.match(/^\s*&(\w+)/);
      if (anchorMatch) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: anchorMatch[0]!,
          startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length,
          name: anchorMatch[1]!, properties: { anchor: 'true', filePath },
        });
      }
      // Alias: *name
      const aliasMatch = trimmed.match(/^\s*\*(\w+)/);
      if (aliasMatch && !anchorMatch) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: aliasMatch[0]!,
          startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length,
          name: aliasMatch[1]!, properties: { alias: 'true', filePath },
        });
      }
      // Key-value pairs
      const kvMatch = trimmed.match(/^(\s*)([\w.\-]+)\s*:\s*(.*)/);
      if (kvMatch) {
        const indent = kvMatch[1]!.length;
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${kvMatch[2]}: ${kvMatch[3]}`,
          startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length,
          name: kvMatch[2]!, properties: { indent: String(indent), filePath },
        });
      }
      // Sequence items
      const seqMatch = trimmed.match(/^\s*-\s+(.+)/);
      if (seqMatch) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF, text: `- ${seqMatch[1]}`,
          startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length,
          name: seqMatch[1]!, properties: { isListItem: 'true', filePath },
        });
      }
    }
    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
