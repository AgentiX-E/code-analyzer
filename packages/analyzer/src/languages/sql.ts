// @code-analyzer/analyzer — SQL Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, DDL/DML tracking,
// SQL injection taint sinks, stored procedure taint sources.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class SqlProvider extends TreeSitterBaseProvider {
  readonly language = 'sql';
  readonly displayName = 'SQL';
  readonly extensions = ['.sql', '.psql', '.ddl', '.dml'];
  readonly globs = ['**/*.sql', '**/*.psql', '**/*.ddl', '**/*.dml'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('tree-sitter-sql') as TreeSitterLanguage;
      return m;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'create_table_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_view_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_function_statement', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_procedure_statement', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_index_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'object_reference' },
      { nodeType: 'create_trigger_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'object_reference' },
      { nodeType: 'select', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'insert', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'update', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'delete', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'cte', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'drop_table_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'object_reference' },
      { nodeType: 'alter_table_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'object_reference' },
      { nodeType: 'object_reference', captureTag: CAPTURE_TAGS.TYPE_REFERENCE, useFirstNamedChild: true },
      { nodeType: 'relation', captureTag: CAPTURE_TAGS.TYPE_REFERENCE, useFirstNamedChild: true },
      { nodeType: 'column_definition', captureTag: CAPTURE_TAGS.PROPERTY_DEF, useFirstNamedChild: true },
      { nodeType: 'join', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'create_table_statement' || nt === 'create_view_statement') {
      const name = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      if (name) {
        captures.push(this.makeCapture(node,
          CAPTURE_TAGS.CLASS_DEF, name,
          `CREATE ${nt.includes('view') ? 'VIEW' : 'TABLE'} ${name}`,
          { sqlType: nt.includes('view') ? 'view' : 'table' }));
      }
    } else if (nt === 'create_function_statement' || nt === 'create_procedure_statement') {
      const name = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      if (name) {
        const isProc = nt.includes('procedure');
        captures.push(this.makeCapture(node,
          CAPTURE_TAGS.FUNCTION_DEF, name,
          `CREATE ${isProc ? 'PROCEDURE' : 'FUNCTION'} ${name}`,
          { sqlType: isProc ? 'procedure' : 'function' }));
      }
    } else if (nt === 'create_index_statement' || nt === 'create_trigger_statement') {
      const name = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      if (name) {
        captures.push(this.makeCapture(node,
          CAPTURE_TAGS.VARIABLE_DEF, name, nt.replace('_statement', ''),
          { sqlType: nt.includes('index') ? 'index' : 'trigger' }));
      }
    } else if (nt === 'drop_table_statement' || nt === 'alter_table_statement') {
      const name = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      if (name) {
        captures.push(this.makeCapture(node,
          CAPTURE_TAGS.VARIABLE_DEF, name,
          `${nt.includes('drop') ? 'DROP' : 'ALTER'} TABLE ${name}`,
          { sqlType: 'ddl' }));
      }
    } else if (nt === 'select') {
      const tables: string[] = [];
      this.collectTableRefs(node, tables);
      captures.push(this.makeCapture(node,
        CAPTURE_TAGS.VARIABLE_DEF, `select_${node.startPosition.row + 1}`,
        `SELECT${tables.length > 0 ? ' FROM ' + tables.join(', ') : ''}`,
        { tables: tables.join(',') }));
    } else if (nt === 'insert' || nt === 'update' || nt === 'delete') {
      const tableName = this.findChildText(node, ['object_reference', 'identifier', 'name']);
      captures.push(this.makeCapture(node,
        CAPTURE_TAGS.VARIABLE_DEF, tableName ?? `${nt}_${node.startPosition.row + 1}`,
        `${nt.toUpperCase()}${tableName ? ' ' + tableName : ''}`,
        { dmlType: nt }));
    } else if (nt === 'cte') {
      const cteName = this.findChildText(node, ['identifier', 'name']);
      if (cteName) {
        captures.push(this.makeCapture(node,
          CAPTURE_TAGS.VARIABLE_DEF, cteName, `WITH ${cteName} AS (...)`,
          { isCTE: 'true' }));
      }
    } else if (nt === 'join') {
      captures.push(this.makeCapture(node,
        CAPTURE_TAGS.VARIABLE_DEF, `join_${node.startPosition.row + 1}`, node.text,
        { isJoin: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // ---- Taint Analysis (SQL injection focus) ----

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    const nt = node.type;
    const line = node.startPosition.row + 1;

    // Dynamic SQL via string concatenation is a high-severity sink
    if (nt === 'select' || nt === 'insert' || nt === 'update' || nt === 'delete') {
      const text = node.text.toLowerCase();
      if (text.includes('concat(') || text.includes('||') || text.includes('concat_ws(') ||
          text.includes('format(') || text.includes('case when') || text.includes('union')) {
        sinks.push({ name: 'dynamic_sql', sinkType: 'sql_exec',
          line, text: node.text.substring(0, 200), properties: {} });
      }
    }

    // EXEC / PREPARE / sp_executesql
    if (nt === 'call_statement' || nt === 'execute_statement') {
      sinks.push({ name: 'sql_exec', sinkType: 'sql_exec',
        line, text: node.text, properties: {} });
    }

    // INSERT with subquery from untrusted table
    if (nt === 'insert') {
      const text = node.text.toLowerCase();
      if (text.includes('select') && text.includes('from')) {
        sinks.push({ name: 'insert_from_select', sinkType: 'data_flow',
          line, text: node.text.substring(0, 200), properties: {} });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    // Stored procedures/functions that accept external parameters
    if (node.type === 'create_function_statement' || node.type === 'create_procedure_statement') {
      const text = node.text.toLowerCase();
      if (text.includes('parameter') || text.includes('@') || text.includes('in ') || text.includes('out ')) {
        sources.push({ name: 'sp_param', sourceType: 'external_input',
          line: node.startPosition.row + 1, text: node.text.substring(0, 200), properties: {} });
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    const nt = node.type;
    const line = node.startPosition.row + 1;

    // Parameterized queries sanitize SQL
    if (nt === 'select' || nt === 'insert' || nt === 'update' || nt === 'delete') {
      const text = node.text.toLowerCase();
      if (text.includes('parameter') || text.includes('prepare') || text.includes('placeholder') ||
          text.includes('$1') || text.includes('$2') || text.includes('?')) {
        sanitizers.push({ name: 'parameterized_query', sanitizerType: 'sql_parameterization',
          line, text: node.text.substring(0, 200), properties: {} });
      }
    }

    // CAST / CONVERT as sanitization
    if (textContains(nt, 'cast') || textContains(nt, 'convert')) {
      sanitizers.push({ name: 'type_casting', sanitizerType: 'type_enforcement',
        line, text: node.text, properties: {} });
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Helpers ----

  private findChildText(node: TreeSitterSyntaxNode, types: string[]): string | undefined {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (types.includes(child.type)) return child.text;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (types.includes(child.type)) return child.text;
    }
    return undefined;
  }

  private collectTableRefs(node: TreeSitterSyntaxNode, tables: string[]): void {
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

  private makeCapture(
    node: TreeSitterSyntaxNode, tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, text: string, extra: Record<string, string> = {},
  ): UnifiedCapture {
    return { tag, text,
      startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      startByte: node.startIndex, endByte: node.endIndex,
      name, properties: { filePath: this.filePath, ...extra } };
  }

  // ---- Fallback ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi;
    while ((m = rx.exec(source)) !== null) {
      const type = m[1]!.toUpperCase();
      const tag = type === 'FUNCTION' || type === 'PROCEDURE' ? CAPTURE_TAGS.FUNCTION_DEF : CAPTURE_TAGS.CLASS_DEF;
      captures.push({ tag, text: `CREATE ${type} ${m[2]}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!, properties: { sqlType: type.toLowerCase(), filePath } });
    }
    const dml = /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)["`]?/gi;
    while ((m = dml.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[0]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!, properties: { dmlType: m[1]!.replace(/\s+/g, ' ').toLowerCase(), filePath } });
    }
    const cte = /WITH\s+(\w+)\s+AS\s*\(/gi;
    while ((m = cte.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: `WITH ${m[1]} AS (...)`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { isCTE: 'true', filePath } });
    }
    const drop = /(DROP|ALTER)\s+TABLE\s+["`]?(\w+)["`]?/gi;
    while ((m = drop.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: `${m[1]} TABLE ${m[2]}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[2]!, properties: { sqlType: 'ddl', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }

  protected override fallbackExtractTaintSinks(source: string): TaintSink[] {
    const sinks: TaintSink[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const patterns = [/CONCAT\s*\(/gi, /\|\|/g, /CONCAT_WS\s*\(/gi, /sp_executesql/gi, /EXEC(?:UTE)?\s+/gi, /PREPARE\s+/gi];
    for (const p of patterns) {
      while ((m = p.exec(source)) !== null) {
        sinks.push({ name: 'dynamic_sql', sinkType: 'sql_exec', line: ln(m.index), text: m[0], properties: {} });
      }
    }
    return sinks;
  }

  protected override fallbackExtractTaintSources(_source: string): TaintSource[] {
    return [];
  }

  protected override fallbackExtractSanitizers(source: string): TaintSanitizer[] {
    const sanitizers: TaintSanitizer[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const patterns = [/\$\d+/g, /\?/g, /PREPARE\s+/gi];
    for (const p of patterns) {
      while ((m = p.exec(source)) !== null) {
        sanitizers.push({ name: 'parameterized_query', sanitizerType: 'sql_parameterization', line: ln(m.index), text: m[0], properties: {} });
      }
    }
    return sanitizers;
  }
}

function textContains(nodeType: string, substr: string): boolean {
  return nodeType.toLowerCase().includes(substr);
}
