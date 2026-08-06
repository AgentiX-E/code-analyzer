// @code-analyzer/analyzer — TOML Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, tables, keys, values,
// taint source analysis for config secrets and credentials.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class TomlProvider extends TreeSitterBaseProvider {
  readonly language = 'toml';
  readonly displayName = 'TOML';
  readonly extensions = ['.toml'];
  readonly globs = ['**/*.toml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('tree-sitter-toml') as TreeSitterLanguage;
      return m;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'bare_key' },
      { nodeType: 'table', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'bare_key' },
      { nodeType: 'table_array_element', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'bare_key' },
      { nodeType: 'bare_key', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'quoted_key', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'dotted_key', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'string', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'integer', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'float', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'boolean', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'array', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'inline_table', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'date_time', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'local_date', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'local_time', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'local_date_time', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.COMMENT, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'table') {
      this.captureTable(node, captures, false);
    } else if (nt === 'table_array_element') {
      this.captureTable(node, captures, true);
    } else if (nt === 'pair') {
      this.capturePair(node, captures);
    } else if (nt === 'comment') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', node.text.trim(),
        { isComment: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private captureTable(node: TreeSitterSyntaxNode, captures: UnifiedCapture[], isArray: boolean): void {
    let tableName = '';
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'bare_key' || child.type === 'dotted_key' || child.type === 'quoted_key') {
        tableName = child.text;
      }
    }
    if (tableName) {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, tableName,
        isArray ? `[[${tableName}]]` : `[${tableName}]`, {
          isTable: 'true', isArrayTable: String(isArray),
        }));
    }
  }

  private capturePair(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    let keyName = '';
    let valueText = '';
    let valueType = '';
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      const ct = child.type;
      if (ct === 'bare_key' || ct === 'quoted_key' || ct === 'dotted_key') {
        keyName = (ct === 'quoted_key') ? child.text.slice(1, -1) : child.text;
      }
      if (ct === 'string') { valueText = child.text; valueType = 'string'; }
      if (ct === 'integer') { valueText = child.text; valueType = 'integer'; }
      if (ct === 'float') { valueText = child.text; valueType = 'float'; }
      if (ct === 'boolean') { valueText = child.text; valueType = 'boolean'; }
      if (ct === 'array') { valueText = `[${child.namedChildCount} items]`; valueType = 'array'; }
      if (ct === 'inline_table') { valueText = `{inline table}`; valueType = 'table'; }
      if (ct === 'date_time' || ct === 'local_date' || ct === 'local_time' || ct === 'local_date_time') {
        valueText = child.text; valueType = ct;
      }
    }
    if (keyName) {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF, keyName,
        valueText ? `${keyName} = ${valueText}` : keyName, { valueType }));
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'pair') {
      const text = node.text.toLowerCase();
      const line = node.startPosition.row + 1;
      const secretKeys = ['password', 'secret', 'token', 'api_key', 'api-key', 'apikey',
        'credential', 'private_key', 'private-key', 'access_key', 'access-key', 'auth_token', 'auth-token'];
      for (const key of secretKeys) {
        if (text.includes(key)) {
          sources.push({ name: key, sourceType: 'config_secret', line, text: node.text, properties: {} });
          return;
        }
      }
      if (text.includes('dsn') || text.includes('connection_string') || text.includes('database_url')) {
        sources.push({ name: 'db_connection', sourceType: 'config_secret', line, text: node.text, properties: {} });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    if (node.type === 'pair') {
      const text = node.text.toLowerCase();
      if (text.includes('validation') || text.includes('sanitize') || text.includes('allowed')) {
        sanitizers.push({ name: 'validation_config', sanitizerType: 'config_validation',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Helpers ----

  private makeCapture(
    node: TreeSitterSyntaxNode, tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, text: string, extra: Record<string, string> = {},
  ): UnifiedCapture {
    return {
      tag, text,
      startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      startByte: node.startIndex, endByte: node.endIndex,
      name,
      properties: { filePath: this.filePath, ...extra },
    };
  }

  // ---- Fallback ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let currentTable = '';
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith('#')) continue;
      const tableMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (tableMatch) {
        currentTable = tableMatch[1]!;
        captures.push(this.makeFallbackCapture(CAPTURE_TAGS.CLASS_DEF, currentTable, i + 1, filePath, { isTable: 'true' }));
        continue;
      }
      const arrMatch = line.match(/^\s*\[\[([^\]]+)\]\]\s*$/);
      if (arrMatch) {
        captures.push(this.makeFallbackCapture(CAPTURE_TAGS.CLASS_DEF, arrMatch[1]!, i + 1, filePath, { isArrayTable: 'true' }));
        continue;
      }
      const kvMatch = line.match(/^\s*([\w.-]+)\s*=\s*(.+?)\s*$/);
      if (kvMatch) {
        captures.push(this.makeFallbackCapture(CAPTURE_TAGS.VARIABLE_DEF, kvMatch[1]!, i + 1, filePath, { section: currentTable }));
      }
    }
    return captures;
  }

  private makeFallbackCapture(tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, line: number, filePath: string, extra: Record<string, string> = {}): UnifiedCapture {
    return { tag, text: name, startLine: line, endLine: line, startByte: 0, endByte: 0, name, properties: { filePath, ...extra } };
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    return this.fallbackTaintExtract(source, 'config_secret', ['password', 'secret', 'token', 'api_key', 'credential', 'private_key']);
  }
  protected override fallbackExtractTaintSinks(_source: string): TaintSink[] { return []; }
  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }

  private fallbackTaintExtract(
    source: string, sourceType: string, keywords: string[],
  ): TaintSource[] {
    const sources: TaintSource[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i]!.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          sources.push({ name: kw, sourceType, line: i + 1, text: lines[i]!.trim(), properties: {} });
          break;
        }
      }
    }
    return sources;
  }
}
