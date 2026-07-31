// @code-analyzer/analyzer — JSON Provider (tree-sitter AST walker)
// Full tree-sitter AST walker for JSON/JSONC/JSON5: objects, arrays, strings, numbers, booleans.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class JsonProvider extends TreeSitterBaseProvider {
  readonly language = 'json';
  readonly displayName = 'JSON';
  readonly extensions = ['.json', '.jsonc', '.json5'];
  readonly globs = ['**/*.json', '**/*.jsonc', '**/*.json5'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-json') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'string' },
      { nodeType: 'object', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'pair') {
      let keyName = '';
      let valueType = '';
      let valueText = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'string') {
          if (!keyName) {
            keyName = child.text.slice(1, -1); // strip quotes from key
          } else {
            // This is the value string
            valueType = 'string'; valueText = child.text.slice(1, -1);
          }
        } else if (child.type === 'number') {
          valueType = 'number'; valueText = child.text;
        } else if (child.type === 'true' || child.type === 'false') {
          valueType = 'boolean'; valueText = child.text;
        } else if (child.type === 'null') {
          valueType = 'null'; valueText = 'null';
        } else if (child.type === 'object') {
          valueType = 'object'; valueText = `{${child.namedChildCount} keys}`;
        } else if (child.type === 'array') {
          valueType = 'array'; valueText = `[${child.namedChildCount} items]`;
        }
      }
      if (keyName) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: valueText ? `${keyName}: ${valueText}` : keyName,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: keyName,
          properties: { valueType, filePath: this.filePath },
        });
      }
    }

    if (nt === 'object') {
      const pairCount = this.countChildren(node, 'pair');
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `object(${pairCount} keys)`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: `object_${node.startPosition.row + 1}`,
        properties: { keyCount: String(pairCount), filePath: this.filePath },
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private countChildren(node: TreeSitterSyntaxNode, type: string): number {
    let count = 0;
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) count++;
    }
    return count;
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    try {
      const obj = JSON.parse(source);
      const walk = (value: unknown, path: string) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          captures.push({
            tag: CAPTURE_TAGS.CLASS_DEF, text: `${path} (object)`,
            startLine: 1, endLine: 1, startByte: 0, endByte: 0,
            name: path || 'root', properties: { keyCount: String(Object.keys(value).length), filePath },
          });
          for (const [k, v] of Object.entries(value)) {
            captures.push({
              tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${k}: ${typeof v === 'object' ? `[${typeof v}]` : String(v)}`,
              startLine: 1, endLine: 1, startByte: 0, endByte: 0,
              name: k, properties: { valueType: typeof v === 'object' ? (Array.isArray(v) ? 'array' : 'object') : typeof v, filePath },
            });
            if (v && typeof v === 'object') walk(v, `${path}.${k}`);
          }
        }
      };
      walk(obj, '');
    } catch { /* invalid JSON, skip */ }
    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
