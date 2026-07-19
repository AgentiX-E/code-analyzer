// @ts-nocheck
// @code-analyzer/mcp — Cypher Parser
// Recursive-descent parser that builds an AST from a token stream.

import type {
  CypherToken,
  CypherExpression,
  MatchClause,
  WhereClause,
  ReturnClause,
  ReturnItem,
  OrderByItem,
  NodePattern,
  RelationshipPattern,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// AST Node Types
// ---------------------------------------------------------------------------

export interface CypherQuery {
  type: 'query';
  match: MatchClause[];
  where?: WhereClause;
  withClause?: WithClause;
  returnClause: ReturnClause;
  union?: CypherQuery;
  orderBy?: OrderByItem[];
  limit?: number;
  skip?: number;
}

export interface WithClause {
  type: 'with';
  items: ReturnItem[];
  where?: WhereClause;
}

// ---------------------------------------------------------------------------
// Parser State
// ---------------------------------------------------------------------------

class ParserState {
  tokens: CypherToken[];
  pos: number;

  constructor(tokens: CypherToken[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  current(): CypherToken | undefined {
    return this.tokens[this.pos];
  }

  advance(): CypherToken | undefined {
    return this.tokens[this.pos++];
  }

  peek(): CypherToken | undefined {
    return this.tokens[this.pos + 1];
  }

  expect(type: CypherToken['type'], value?: string): CypherToken {
    const tok = this.advance();
    if (!tok) throw new Error(`Expected ${type}${value ? ` "${value}"` : ''} but got end of input`);
    if (tok.type !== type) {
      throw new Error(`Expected ${type} but got ${tok.type} "${tok.value}" at position ${tok.position}`);
    }
    if (value !== undefined && tok.value.toUpperCase() !== value.toUpperCase()) {
      throw new Error(`Expected "${value}" but got "${tok.value}" at position ${tok.position}`);
    }
    return tok;
  }

  isKeyword(value: string): boolean {
    const tok = this.current();
    return tok?.type === 'KEYWORD' && tok.value.toUpperCase() === value.toUpperCase();
  }

  isType(value: CypherToken['type']): boolean {
    return this.current()?.type === value;
  }

  isEOF(): boolean {
    return this.pos >= this.tokens.length;
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Parse a list of Cypher tokens into a query AST. */
export function parse(tokens: CypherToken[]): CypherQuery {
  const state = new ParserState(tokens);
  return parseQuery(state);
}

function parseQuery(state: ParserState): CypherQuery {
  const matchs: MatchClause[] = [];
  let whereClause: WhereClause | undefined;
  let withClause: WithClause | undefined;
  let orderByItems: OrderByItem[] | undefined;
  let limit: number | undefined;
  let skip: number | undefined;

  // Parse MATCH clauses (at least one)
  while (state.isKeyword('OPTIONAL') || state.isKeyword('MATCH')) {
    matchs.push(parseMatch(state));
  }

  // Optional WHERE clause
  if (state.isKeyword('WHERE')) {
    whereClause = parseWhere(state);
  }

  // Optional WITH clause
  if (state.isKeyword('WITH')) {
    withClause = parseWith(state);
  }

  // RETURN clause (required)
  const returnClause = parseReturn(state);

  // Optional ORDER BY
  if (state.isKeyword('ORDER')) {
    orderByItems = parseOrderBy(state);
  }

  // Optional SKIP
  if (state.isKeyword('SKIP')) {
    state.advance();
    skip = parseNumber(state);
  }

  // Optional LIMIT
  if (state.isKeyword('LIMIT')) {
    state.advance();
    limit = parseNumber(state);
  }

  // Optional UNION
  let union: CypherQuery | undefined;
  if (state.isKeyword('UNION')) {
    state.advance();
    if (state.isKeyword('ALL')) state.advance();
    union = parseQuery(state);
  }

  const query: CypherQuery = {
    type: 'query',
    match: matchs,
    returnClause,
  };
  if (whereClause) query.where = whereClause;
  if (withClause) query.withClause = withClause;
  if (orderByItems) query.orderBy = orderByItems;
  if (limit !== undefined) query.limit = limit;
  if (skip !== undefined) query.skip = skip;
  if (union) query.union = union;

  return query;
}

// ---------------------------------------------------------------------------
// MATCH
// ---------------------------------------------------------------------------

function parseMatch(state: ParserState): MatchClause {
  const isOptional = state.isKeyword('OPTIONAL');
  if (isOptional) state.advance();

  state.expect('KEYWORD', 'MATCH');

  const patterns: NodePattern[] = [];
  patterns.push(parseNodePattern(state));

  while (state.current()?.value === ',') {
    state.advance();
    patterns.push(parseNodePattern(state));
  }

  return { type: 'match', patterns };
}

function parseNodePattern(state: ParserState): NodePattern {
  state.expect('PUNCTUATION', '(');

  let variable = '';
  let labels: string[] = [];
  let properties: Record<string, unknown> = {};

  // Variable (optional)
  if (state.isType('IDENTIFIER')) {
    variable = state.advance()!.value;

    // Check for colon (label)
    if (state.current()?.value === ':') {
      state.advance();
      // Collect labels separated by : or |
      while (state.isType('IDENTIFIER') || state.isType('KEYWORD')) {
        labels.push(state.advance()!.value);
        if (state.current()?.value === '|') {
          state.advance();
        } else if (state.current()?.value === ':') {
          state.advance();
        } else {
          break;
        }
      }
    }

    // Properties block { key: value }
    if (state.current()?.value === '{') {
      properties = parsePropertyBlock(state);
    }
  } else if (state.current()?.value === ':') {
    // Anonymous node with label
    state.advance();
    while (state.isType('IDENTIFIER') || state.isType('KEYWORD')) {
      labels.push(state.advance()!.value);
      if (state.current()?.value === '|') {
        state.advance();
      } else if (state.current()?.value === ':') {
        state.advance();
      } else {
        break;
      }
    }
    if (state.current()?.value === '{') {
      properties = parsePropertyBlock(state);
    }
  }

  state.expect('PUNCTUATION', ')');

  // Check for relationship patterns
  const relationships: RelationshipPattern[] = [];
  while (state.current()?.value === '-' || state.current()?.value === '<') {
    relationships.push(parseRelationship(state));
  }

  const pattern: NodePattern = { variable, labels, properties };
  if (relationships.length > 0) pattern.relationships = relationships;
  return pattern;
}

function parseRelationship(state: ParserState): RelationshipPattern {
  let direction: 'left' | 'right' | 'both' = 'right';

  if (state.current()?.value === '<') {
    direction = 'left';
    state.advance();
    state.expect('OPERATOR', '-');
    if (state.current()?.value === '[') {
      state.advance();
    } else {
      // Simple reversed: <-(b)
      const target = parseNodePattern(state);
      return { types: [], direction: 'left', target };
    }
  } else if (state.current()?.type === 'OPERATOR' && state.current()?.value === '-') {
    state.advance(); // consume -
    if (state.current()?.value === '[') {
      state.advance();
    } else if (state.current()?.value === '>') {
      // Simple forward: -->(b)
      state.advance();
      const target = parseNodePattern(state);
      return { types: [], direction: 'right', target };
    } else {
      // Simple: --(b)
      const target = parseNodePattern(state);
      return { types: [], direction: 'both', target };
    }
  } else {
    throw new Error(`Expected relationship pattern, got ${state.current()?.value ?? 'EOF'}`);
  }

  // Parse relationship details inside [...]
  let types: string[] = [];
  let variable: string | undefined;
  let props: Record<string, unknown> = {};
  let minHops: number | undefined;
  let maxHops: number | undefined;

  // Colon + relationship type
  if (state.current()?.value === ':') {
    state.advance();
    while (state.isType('IDENTIFIER') || state.isType('KEYWORD')) {
      types.push(state.advance()!.value);
      if (state.current()?.value === '|') {
        state.advance();
      } else {
        break;
      }
    }
  }

  // Variable binding (after type, e.g. [r:CALLS*..])
  if (state.isType('IDENTIFIER') && types.length > 0) {
    variable = state.advance()!.value;
  }

  // Hop range *min..max
  if (state.current()?.value === '*') {
    state.advance();
    if (state.isType('NUMBER')) {
      minHops = parseNumber(state);
      if (state.current()?.value === '.' && state.peek()?.value === '.') {
        state.advance(); // first dot
        state.advance(); // second dot
        if (state.isType('NUMBER')) {
          maxHops = parseNumber(state);
        }
      }
    } else if (state.current()?.value === '.' && state.peek()?.value === '.') {
      state.advance();
      state.advance();
      if (state.isType('NUMBER')) {
        maxHops = parseNumber(state);
      }
    }
  }

  // Properties inside relationship
  if (state.current()?.value === '{') {
    props = parsePropertyBlock(state);
  }

  state.expect('PUNCTUATION', ']');

  // Handle direction after ]
  if (state.current()?.value === '>' || (state.current()?.type === 'OPERATOR' && state.current()?.value === '-' && state.peek()?.value === '>')) {
    if (state.current()?.value === '-') state.advance();
    if (direction === 'left') direction = 'both';
    else direction = 'right';
    state.advance(); // consume >
  } else if (state.current()?.type === 'OPERATOR' && state.current()?.value === '-') {
    // Just -- without arrow: keep initial direction; if no initial, it's bidirectional
    if (direction === 'right') direction = 'both';
    state.advance();
  }

  const target = parseNodePattern(state);

  const rel: RelationshipPattern = { types, direction, target };
  if (variable) rel.variable = variable;
  if (minHops !== undefined) rel.minHops = minHops;
  if (maxHops !== undefined) rel.maxHops = maxHops;
  return rel;
}

// ---------------------------------------------------------------------------
// Property Block
// ---------------------------------------------------------------------------

function parsePropertyBlock(state: ParserState): Record<string, unknown> {
  state.expect('PUNCTUATION', '{');
  const props: Record<string, unknown> = {};

  while (state.current() && state.current()?.value !== '}') {
    const key = state.expect('IDENTIFIER').value;
    state.expect('PUNCTUATION', ':');
    const value = parseExpression(state);
    props[key] = value;
    if (state.current()?.value === ',') state.advance();
  }

  state.expect('PUNCTUATION', '}');
  return props;
}

// ---------------------------------------------------------------------------
// WHERE
// ---------------------------------------------------------------------------

function parseWhere(state: ParserState): WhereClause {
  state.expect('KEYWORD', 'WHERE');
  const condition = parseExpression(state);
  return { type: 'where', condition };
}

// ---------------------------------------------------------------------------
// RETURN
// ---------------------------------------------------------------------------

function parseReturn(state: ParserState): ReturnClause {
  state.expect('KEYWORD', 'RETURN');

  let distinct = false;
  if (state.isKeyword('DISTINCT')) {
    distinct = true;
    state.advance();
  }

  const items: ReturnItem[] = [];

  // Check for wildcard *
  if (state.current()?.value === '*') {
    state.advance();
    items.push({ expression: { type: 'variable', name: '*' }, alias: undefined });
  } else {
    items.push(parseReturnItem(state));
    while (state.current()?.value === ',') {
      state.advance();
      items.push(parseReturnItem(state));
    }
  }

  return {
    type: 'return',
    items,
    distinct,
  };
}

function parseReturnItem(state: ParserState): ReturnItem {
  const expr = parseExpression(state);

  let alias: string | undefined;
  if (state.isKeyword('AS')) {
    state.advance();
    alias = state.expect('IDENTIFIER').value;
  }

  return { expression: expr, alias };
}

// ---------------------------------------------------------------------------
// WITH
// ---------------------------------------------------------------------------

function parseWith(state: ParserState): WithClause {
  state.expect('KEYWORD', 'WITH');
  const items: ReturnItem[] = [];

  items.push(parseReturnItem(state));
  while (state.current()?.value === ',') {
    state.advance();
    items.push(parseReturnItem(state));
  }

  let where: WhereClause | undefined;
  if (state.isKeyword('WHERE')) {
    where = parseWhere(state);
  }

  return { type: 'with', items, where };
}

// ---------------------------------------------------------------------------
// ORDER BY
// ---------------------------------------------------------------------------

function parseOrderBy(state: ParserState): OrderByItem[] {
  state.expect('KEYWORD', 'ORDER');
  state.expect('KEYWORD', 'BY');

  const items: OrderByItem[] = [];
  items.push(parseOrderByItem(state));

  while (state.current()?.value === ',') {
    state.advance();
    items.push(parseOrderByItem(state));
  }

  return items;
}

function parseOrderByItem(state: ParserState): OrderByItem {
  const expr = parseExpression(state);
  let direction: 'asc' | 'desc' = 'asc';

  if (state.isKeyword('ASC')) {
    state.advance();
  } else if (state.isKeyword('DESC')) {
    direction = 'desc';
    state.advance();
  }

  return { expression: expr, direction };
}

// ---------------------------------------------------------------------------
// Expression Parsing (Pratt-style with precedence levels)
// ---------------------------------------------------------------------------

/** Get precedence for an operator (higher = binds tighter). */
function precedence(op: string): number {
  switch (op.toUpperCase()) {
    case 'OR':
      return 1;
    case 'AND':
      return 2;
    case '=':
    case '==':
    case '!=':
    case '<>':
    case '<':
    case '<=':
    case '>':
    case '>=':
    case 'IS':
    case 'IS NOT':
    case 'IN':
    case 'CONTAINS':
    case 'STARTS':
    case 'STARTS WITH':
    case 'ENDS':
    case 'ENDS WITH':
    case 'REGEX':
    case '=~':
      return 3;
    case '+':
    case '-':
      return 4;
    case '*':
    case '/':
    case '%':
      return 5;
    default:
      return 0;
  }
}

function parseExpression(state: ParserState, minPrecedence = 0): CypherExpression {
  let left = parsePrimary(state);

  while (true) {
    const tok = state.current();
    if (!tok) break;

    // Determine the operator and its precedence BEFORE consuming
    let opValue: string | null = null;
    let prec: number = 0;

    if (tok.type === 'OPERATOR') {
      opValue = tok.value.toUpperCase();
      prec = precedence(opValue);
    } else if (tok.type === 'KEYWORD') {
      const upper = tok.value.toUpperCase();
      const binopKeywords = ['AND', 'OR', 'IN', 'IS', 'CONTAINS', 'STARTS', 'ENDS', 'REGEX', 'WITH'];
      if (binopKeywords.includes(upper)) {
        opValue = upper;
        prec = precedence(opValue);
      }
    }

    // If not a binary operator, or precedence too low, stop here
    if (!opValue || prec < minPrecedence) break;

    // Now consume the operator
    if (opValue === 'IS') {
      state.advance(); // consume 'IS'
      let not = false;
      if (state.isKeyword('NOT')) {
        not = true;
        state.advance();
      }
      if (state.isKeyword('NULL')) {
        state.advance();
        left = { type: 'binary', operator: not ? 'IS NOT' : 'IS', left, right: { type: 'literal', value: null } };
      } else {
        const right = parsePrimary(state);
        left = { type: 'binary', operator: 'IS', left, right };
      }
      continue;
    }

    // Handle multi-word operators (STARTS WITH, ENDS WITH)
    if (opValue === 'STARTS' && state.peek()?.value.toUpperCase() === 'WITH') {
      state.advance(); // consume STARTS
      if (state.isKeyword('WITH')) state.advance(); // consume WITH
      opValue = 'STARTS WITH';
    } else if (opValue === 'ENDS' && state.peek()?.value.toUpperCase() === 'WITH') {
      state.advance(); // consume ENDS
      if (state.isKeyword('WITH')) state.advance(); // consume WITH
      opValue = 'ENDS WITH';
    } else {
      state.advance(); // consume the operator token
    }

    const right = parseExpression(state, prec + 1);
    left = { type: 'binary', operator: opValue, left, right };
  }

  return left;
}

function parsePrimary(state: ParserState): CypherExpression {
  // NOT unary
  if (state.isKeyword('NOT')) {
    state.advance();
    const operand = parsePrimary(state);
    return { type: 'unary', operator: 'NOT', operand };
  }

  // Number literal
  if (state.isType('NUMBER')) {
    const value = Number(state.advance()!.value);
    return { type: 'literal', value };
  }

  // String literal
  if (state.isType('STRING')) {
    return { type: 'literal', value: state.advance()!.value };
  }

  // Boolean literals
  if (state.isKeyword('TRUE')) {
    state.advance();
    return { type: 'literal', value: true };
  }
  if (state.isKeyword('FALSE')) {
    state.advance();
    return { type: 'literal', value: false };
  }
  if (state.isKeyword('NULL')) {
    state.advance();
    return { type: 'literal', value: null };
  }

  // Function calls: COUNT(expr), SUM(expr), etc.
  if (state.isKeyword('COUNT') || state.isKeyword('SUM') || state.isKeyword('AVG') ||
      state.isKeyword('MIN') || state.isKeyword('MAX')) {
    const funcName = state.advance()!.value;
    state.expect('PUNCTUATION', '(');
    const args: CypherExpression[] = [];
    if (state.current()?.value !== ')') {
      args.push(parseExpression(state));
    }
    state.expect('PUNCTUATION', ')');
    return { type: 'function', name: funcName, args };
  }

  // Parenthesized expression
  if (state.current()?.value === '(') {
    state.advance();
    const expr = parseExpression(state);
    state.expect('PUNCTUATION', ')');
    return expr;
  }

  // Identifier or property access (e.g., n.name)
  if (state.isType('IDENTIFIER')) {
    const name = state.advance()!.value;
    if (state.current()?.value === '.') {
      state.advance();
      const prop = state.expect('IDENTIFIER').value;
      return { type: 'property', object: name, property: prop };
    }
    return { type: 'variable', name };
  }

  // Wildcard
  if (state.current()?.value === '*') {
    state.advance();
    return { type: 'variable', name: '*' };
  }

  // Array literal: ["val1", "val2"]
  if (state.current()?.value === '[') {
    state.advance();
    const items: unknown[] = [];
    while (state.current() && state.current()?.value !== ']') {
      if (state.isType('STRING')) {
        items.push(state.advance()!.value);
      } else if (state.isType('NUMBER')) {
        items.push(Number(state.advance()!.value));
      } else if (state.isKeyword('TRUE')) {
        state.advance();
        items.push(true);
      } else if (state.isKeyword('FALSE')) {
        state.advance();
        items.push(false);
      } else {
        // Fallback: push the raw value
        items.push(state.advance()!.value);
      }
      if (state.current()?.value === ',') state.advance();
    }
    state.expect('PUNCTUATION', ']');
    return { type: 'literal', value: items };
  }

  // Nested expression with dot access on function result
  if (state.current()?.value === '.') {
    throw new Error(`Unexpected "." at position ${state.current()!.position}`);
  }

  throw new Error(`Unexpected token: ${state.current()?.value ?? 'EOF'} at position ${state.current()?.position ?? 'end'}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumber(state: ParserState): number {
  if (!state.isType('NUMBER')) {
    throw new Error(`Expected NUMBER but got ${state.current()?.value}`);
  }
  return Number(state.advance()!.value);
}
