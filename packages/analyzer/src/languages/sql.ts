// @code-analyzer/analyzer — SQL Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: SELECT/INSERT/UPDATE/DELETE, CREATE TABLE/FUNCTION/VIEW, CTEs, JOINs, subqueries.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

export class SqlProvider extends TreeSitterBaseProvider {
  readonly language = 'sql';
  readonly displayName = 'SQL';
  readonly extensions = ['.sql', '.psql', '.ddl', '.dml'];
  readonly globs = ['**/*.sql', '**/*.psql', '**/*.ddl', '**/*.dml'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { const m = require('tree-sitter-sql') as TreeSitterLanguage; return m; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'create_table_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_view_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_function_statement', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_procedure_statement', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'object_reference' },
      { nodeType: 'select', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
    ];
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    // CREATE TABLE / CREATE VIEW / CREATE INDEX
    if (nt === 'create_table_statement' || nt === 'create_view_statement') {
      const tableName = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      if (tableName) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: `CREATE ${nt.includes('view') ? 'VIEW' : 'TABLE'} ${tableName}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: tableName,
          properties: { sqlType: nt.includes('view') ? 'view' : 'table', filePath: this.filePath },
        });
      }
    }

    // CREATE FUNCTION / CREATE PROCEDURE
    if (nt === 'create_function_statement' || nt === 'create_procedure_statement') {
      const funcName = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      if (funcName) {
        const isProc = nt.includes('procedure');
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_DEF,
          text: `CREATE ${isProc ? 'PROCEDURE' : 'FUNCTION'} ${funcName}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: funcName,
          properties: { sqlType: isProc ? 'procedure' : 'function', filePath: this.filePath },
        });
      }
    }

    // CREATE INDEX / CREATE TRIGGER
    if (nt === 'create_index_statement' || nt === 'create_trigger_statement') {
      const name = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      if (name) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: nt.replace('_statement', ''),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name,
          properties: { sqlType: nt.includes('index') ? 'index' : 'trigger', filePath: this.filePath },
        });
      }
    }

    // SELECT statement
    if (nt === 'select') {
      const tables: string[] = [];
      this.collectTableReferences(node, tables);
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `SELECT${tables.length > 0 ? ' FROM ' + tables.join(', ') : ''}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: `select_${node.startPosition.row + 1}`,
        properties: { tables: tables.join(','), filePath: this.filePath },
      });
    }

    // INSERT / UPDATE / DELETE
    if (nt === 'insert' || nt === 'update' || nt === 'delete') {
      const tableName = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `${nt.toUpperCase()}${tableName ? ' ' + tableName : ''}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: tableName ?? `${nt}_${node.startPosition.row + 1}`,
        properties: { dmlType: nt, filePath: this.filePath },
      });
    }

    // CTE
    if (nt === 'cte') {
      const cteName = this.findChildText(node, ['identifier', 'name']);
      if (cteName) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: `WITH ${cteName} AS (...)`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: cteName,
          properties: { isCTE: 'true', filePath: this.filePath },
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private findChildText(node: TreeSitterSyntaxNode, types: string[]): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (types.includes(child.type)) return child.text;
      // Check named children too for deeper matches
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (types.includes(child.type)) return child.text;
    }
    return undefined;
  }

  private collectTableReferences(node: TreeSitterSyntaxNode, tables: string[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'relation' || child.type === 'table_reference' || child.type === 'object_reference') {
        tables.push(child.text);
      }
      if (child.type === 'join' || child.type === 'from_clause') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'relation' || sub.type === 'object_reference') {
            tables.push(sub.text);
          }
        }
      }
    }
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const createRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi;
    while ((m = createRegex.exec(source)) !== null) {
      const type = m[1]!.toUpperCase();
      const tag = type === 'FUNCTION' || type === 'PROCEDURE' ? CAPTURE_TAGS.FUNCTION_DEF : CAPTURE_TAGS.CLASS_DEF;
      captures.push({ tag, text: `CREATE ${type} ${m[2]}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!, properties: { sqlType: type.toLowerCase(), filePath } });
    }
    const dmlRegex = /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)["`]?/gi;
    while ((m = dmlRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[0]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!, properties: { dmlType: m[1]!.replace(/\s+/g, ' ').toLowerCase(), filePath } });
    }
    const cteRegex = /WITH\s+(\w+)\s+AS\s*\(/gi;
    while ((m = cteRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: `WITH ${m[1]} AS (...)`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isCTE: 'true', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
}
