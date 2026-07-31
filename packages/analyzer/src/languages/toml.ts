// @code-analyzer/analyzer — TOML Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: tables, key-value pairs, arrays, inline tables, array of tables.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class TomlProvider extends TreeSitterBaseProvider {
  readonly language = 'toml';
  readonly displayName = 'TOML';
  readonly extensions = ['.toml'];
  readonly globs = ['**/*.toml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-toml') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'bare_key' },
      { nodeType: 'table', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'bare_key' },
      { nodeType: 'table_array_element', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'bare_key' },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    // Tables: [section] or [section.subsection]
    if (nt === 'table') {
      let tableName = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'bare_key' || child.type === 'dotted_key') {
          tableName = child.text;
        }
      }
      if (tableName) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `[${tableName}]`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: tableName,
          properties: { isTable: 'true', filePath: this.filePath },
        });
      }
    }

    // Array of tables: [[array]]
    if (nt === 'table_array_element') {
      let tableName = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'bare_key' || child.type === 'dotted_key') {
          tableName = child.text;
        }
      }
      if (tableName) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `[[${tableName}]]`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: tableName,
          properties: { isArrayTable: 'true', filePath: this.filePath },
        });
      }
    }

    // Key-value pairs: key = value
    if (nt === 'pair') {
      let keyName = '';
      let valueText = '';
      let valueType = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'bare_key' || child.type === 'quoted_key' || child.type === 'dotted_key') {
          keyName = child.text;
        }
        if (child.type === 'string') { valueText = child.text; valueType = 'string'; }
        if (child.type === 'integer') { valueText = child.text; valueType = 'integer'; }
        if (child.type === 'float') { valueText = child.text; valueType = 'float'; }
        if (child.type === 'boolean') { valueText = child.text; valueType = 'boolean'; }
        if (child.type === 'array') { valueText = `[${child.namedChildCount} items]`; valueType = 'array'; }
        if (child.type === 'inline_table') { valueText = `{inline table}`; valueType = 'table'; }
        if (child.type === 'date_time' || child.type === 'local_date' || child.type === 'local_time') {
          valueText = child.text; valueType = child.type;
        }
      }
      if (keyName) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: valueText ? `${keyName} = ${valueText}` : keyName,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: keyName,
          properties: { valueType, filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let currentTable = '';
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith('#')) continue;
      // Table: [section]
      const tableMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (tableMatch) { currentTable = tableMatch[1]!; captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `[${currentTable}]`, startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length, name: currentTable, properties: { isTable: 'true', filePath } }); continue; }
      // Array of tables: [[array]]
      const arrMatch = line.match(/^\s*\[\[([^\]]+)\]\]\s*$/);
      if (arrMatch) { captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: `[[${arrMatch[1]}]]`, startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length, name: arrMatch[1]!, properties: { isArrayTable: 'true', filePath } }); continue; }
      // Key-value: key = value
      const kvMatch = line.match(/^\s*(\w+(?:\.\w+)*)\s*=\s*(.+?)\s*$/);
      if (kvMatch) { captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: kvMatch[1]!, startLine: i + 1, endLine: i + 1, startByte: 0, endByte: line.length, name: kvMatch[1]!, properties: { section: currentTable, filePath } }); }
    }
    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
