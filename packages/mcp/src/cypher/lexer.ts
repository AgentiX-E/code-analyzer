// @code-analyzer/mcp — Cypher Lexer
// Tokenizes a Cypher-like query string into a stream of tokens.

import type { CypherToken } from '@code-analyzer/shared';

const KEYWORDS = new Set([
  'MATCH', 'OPTIONAL', 'WHERE', 'RETURN', 'WITH', 'ORDER', 'BY',
  'ASC', 'DESC', 'LIMIT', 'SKIP', 'UNION', 'ALL', 'DISTINCT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
  'AS', 'ON', 'CREATE', 'DELETE', 'SET', 'MERGE', 'DETACH',
  'CONTAINS', 'STARTS', 'ENDS', 'WITH', 'REGEX',
  'CALLS', 'IMPLEMENTS', 'EXTENDS', 'IMPORTS',
  'HANDLES', 'EXPOSES', 'TESTS',
  '*', // wildcard
]);

const AGGREGATION_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

/** Tokenize a Cypher query string into tokens. */
export function tokenize(query: string): CypherToken[] {
  const tokens: CypherToken[] = [];
  let pos = 0;
  const len = query.length;

  while (pos < len) {
    const ch = query[pos]!;

    // Whitespace
    if (/\s/.test(ch)) {
      pos++;
      continue;
    }

    // Single-line comment
    if (ch === '/' && pos + 1 < len && query[pos + 1] === '/') {
      while (pos < len && query[pos]! !== '\n') pos++;
      continue;
    }

    // Block comment
    if (ch === '/' && pos + 1 < len && query[pos + 1] === '*') {
      pos += 2;
      while (pos + 1 < len && !(query[pos]! === '*' && query[pos + 1]! === '/')) pos++;
      if (pos + 1 < len) pos += 2;
      continue;
    }

    // String literals (single or double quotes)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let value = '';
      pos++;
      while (pos < len && query[pos]! !== quote) {
        if (query[pos]! === '\\' && pos + 1 < len) {
          pos++;
          value += query[pos]!;
        } else {
          value += query[pos]!;
        }
        pos++;
      }
      pos++; // skip closing quote
      tokens.push({ type: 'STRING', value, position: pos - value.length - 2 });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && pos + 1 < len && /[0-9]/.test(query[pos + 1]!))) {
      let value = '';
      while (pos < len && /[0-9.]/.test(query[pos]!)) {
        value += query[pos]!;
        pos++;
      }
      tokens.push({ type: 'NUMBER', value, position: pos - value.length });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_`]/.test(ch)) {
      const isBacktick = ch === '`';
      let value = '';
      if (isBacktick) pos++;
      while (pos < len && (isBacktick ? query[pos]! !== '`' : /[a-zA-Z0-9_]/.test(query[pos]!))) {
        value += query[pos]!;
        pos++;
      }
      if (isBacktick && pos < len) pos++; // skip closing backtick

      const upper = value.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'KEYWORD', value: upper, position: pos - value.length - (isBacktick ? 2 : 0) });
      } else {
        tokens.push({ type: 'IDENTIFIER', value, position: pos - value.length - (isBacktick ? 2 : 0) });
      }
      continue;
    }

    // Wildcard asterisk (tokenize as KEYWORD for RETURN * etc.)
    if (ch === '*' && (pos + 1 >= len || /\s/.test(query[pos + 1]!) || query[pos + 1] === ',')) {
      tokens.push({ type: 'KEYWORD', value: '*', position: pos });
      pos++;
      continue;
    }

    // Operators and punctuation
    if ('=<>!+-*/%|&'.includes(ch)) {
      let op: string = ch;
      pos++;
      // Two-character operators
      if (pos < len && '=>'.includes(query[pos]!) && ch === '<') {
        op += query[pos]!;
        pos++;
      }
      if (pos < len && query[pos]! === '=' && '=!<>'.includes(ch)) {
        op += query[pos]!;
        pos++;
      }
      tokens.push({ type: 'OPERATOR', value: op, position: pos - op.length });
      continue;
    }

    // Punctuation
    if ('.,:;()[]{}'.includes(ch)) {
      tokens.push({ type: 'PUNCTUATION', value: ch, position: pos });
      pos++;
      continue;
    }

    // Unknown character — skip
    pos++;
  }

  return tokens;
}

/** Check if a keyword is an aggregation function. */
export function isAggregationFunc(keyword: string): boolean {
  return AGGREGATION_FUNCTIONS.has(keyword.toUpperCase());
}

export { KEYWORDS, AGGREGATION_FUNCTIONS };
