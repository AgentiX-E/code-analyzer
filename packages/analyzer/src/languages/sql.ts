// @code-analyzer/analyzer — SQL Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `tree-sitter-sql` package only
// ships `nodeTypeInfo` metadata (no compiled `Language` object), so a
// tree-sitter path is unreachable dead code. The regex parser below handles
// DDL/DML/CTE statements plus SQL-injection taint sink and parameterization
// sanitizer detection.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TaintSource, TaintSink, TaintSanitizer } from './tree-sitter-base.js';
import { sanitizeSource, lineNumber } from './regex-helpers.js';

const SQL_EXTENSIONS = ['.sql', '.psql', '.ddl', '.dml'];
const SQL_GLOBS = ['**/*.sql', '**/*.psql', '**/*.ddl', '**/*.dml'];

/** Regexes that flag dynamic-SQL construction as a sql_exec taint sink. */
const SQL_SINK_PATTERNS = [
  /CONCAT\b/gi,
  /\|\|/g,
  /CONCAT_WS\s*\(/gi,
  /sp_executesql/gi,
  /EXEC(?:UTE)?\s+/gi,
  /PREPARE\s+/gi,
];

/** Regexes that flag parameterized queries as a sql_parameterization sanitizer. */
const SQL_SANITIZER_PATTERNS = [/\$\d+/g, /\?/g, /PREPARE\s+/gi];

export class SqlProvider implements LanguageProvider {
  readonly language = 'sql';
  readonly displayName = 'SQL';
  readonly extensions = SQL_EXTENSIONS;
  readonly globs = SQL_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = sanitizeSource(source);
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => lineNumber(sanitized, off);
    let m: RegExpExecArray | null;

    // DDL: CREATE [OR REPLACE] [TEMP] {TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER} name
    const createRx =
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi;
    while ((m = createRx.exec(sanitized)) !== null) {
      const type = m[1]!.toUpperCase();
      const tag =
        type === 'FUNCTION' || type === 'PROCEDURE'
          ? CAPTURE_TAGS.FUNCTION_DEF
          : CAPTURE_TAGS.CLASS_DEF;
      captures.push({
        tag,
        text: `CREATE ${type} ${m[2]}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[2]!,
        properties: { sqlType: type.toLowerCase(), filePath },
      });
    }

    // DML: SELECT/INSERT INTO/UPDATE/DELETE FROM
    const dmlRx = /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?(\w+)["`]?/gi;
    while ((m = dmlRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[0]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[2]!,
        properties: { dmlType: m[1]!.replace(/\s+/g, ' ').toLowerCase(), filePath },
      });
    }

    // Common Table Expressions: WITH name AS (
    const cteRx = /WITH\s+(\w+)\s+AS\s*\(/gi;
    while ((m = cteRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `WITH ${m[1]} AS (...)`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isCTE: 'true', filePath },
      });
    }

    // DDL: DROP/ALTER TABLE name
    const dropRx = /(DROP|ALTER)\s+TABLE\s+["`]?(\w+)["`]?/gi;
    while ((m = dropRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `${m[1]} TABLE ${m[2]}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[2]!,
        properties: { sqlType: 'ddl', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(_source: string): ParsedImport[] {
    return [];
  }

  isExported(_source: string, _symbolName: string): boolean {
    return false;
  }

  extractTaintSources(_source: string): TaintSource[] {
    return [];
  }

  /** Flag dynamic-SQL construction (CONCAT / || / EXEC / PREPARE) as sql_exec sinks. */
  extractTaintSinks(source: string): TaintSink[] {
    const sanitized = sanitizeSource(source);
    const sinks: TaintSink[] = [];
    for (const pattern of SQL_SINK_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(sanitized)) !== null) {
        sinks.push({
          name: 'dynamic_sql',
          sinkType: 'sql_exec',
          line: lineNumber(sanitized, m.index),
          text: m[0],
          properties: {},
        });
      }
    }
    return sinks;
  }

  /** Flag parameterized queries ($1 / ? / PREPARE) as sql_parameterization sanitizers. */
  extractSanitizers(source: string): TaintSanitizer[] {
    const sanitized = sanitizeSource(source);
    const sanitizers: TaintSanitizer[] = [];
    for (const pattern of SQL_SANITIZER_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(sanitized)) !== null) {
        sanitizers.push({
          name: 'parameterized_query',
          sanitizerType: 'sql_parameterization',
          line: lineNumber(sanitized, m.index),
          text: m[0],
          properties: {},
        });
      }
    }
    return sanitizers;
  }
}
