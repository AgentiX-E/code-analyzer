// @code-analyzer/analyzer — SQL Provider (regex fallback)
// Detects SELECT, INSERT, UPDATE, DELETE, CREATE statements and table/view references.
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class SqlProvider extends TreeSitterBaseProvider {
  readonly language = 'sql';
  readonly displayName = 'SQL';
  readonly extensions = ['.sql', '.psql', '.ddl', '.dml'];
  readonly globs = ['**/*.sql', '**/*.psql', '**/*.ddl', '**/*.dml'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-sql') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'create_table_statement', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'object_reference' },
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'object_reference' },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // CREATE TABLE/FUNCTION/PROCEDURE/VIEW/INDEX
    const createRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi;
    while ((m = createRegex.exec(source)) !== null) {
      const type = m[1]!.toUpperCase();
      const tag = type === 'FUNCTION' || type === 'PROCEDURE' ? CAPTURE_TAGS.FUNCTION_DEF : CAPTURE_TAGS.CLASS_DEF;
      captures.push({
        tag, text: `CREATE ${type} ${m[2]}`,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[2]!, properties: { sqlType: type.toLowerCase(), filePath },
      });
    }

    // SELECT/INSERT/UPDATE/DELETE statements
    const dmlRegex = /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)["`]?/gi;
    while ((m = dmlRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[0]!, startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[2]!, properties: { dmlType: m[1]!.replace(/\s+/g, ' ').toLowerCase(), filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
