// One pass, and the statement line it has to reproduce.
//
// **The recursive collector carried the outermost expression's line down as a parameter**, which is what files a
// neutraliser on the line its statement starts on. A cursor pass has no parameter, so the line is tracked by depth -
// and **the only thing worth testing is that the two agree**: a misplaced neutraliser silently marks a live flow safe.

import { describe, expect, it } from 'vitest';

import { scanTaint } from '../taint-scan.js';

import type { TaintSite } from '../taint-scan.js';

/** TypeScript's names for the two shapes, which are the C family's. */
const RULES = {
  memberTypes: ['member_expression'],
  callTypes: ['call_expression', 'new_expression'],
};

function parse(source: string): { rootNode: { walk(): unknown } } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Parser = require('tree-sitter') as new () => {
    setLanguage(language: unknown): void;
    parse(text: string): unknown;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const grammar = require('tree-sitter-typescript') as { typescript: unknown };
  const parser = new Parser();
  parser.setLanguage(grammar.typescript);
  return parser.parse(source) as { rootNode: { walk(): unknown } };
}

/** Every site the scan reports, in the order it reports them. */
function scan(source: string): TaintSite[] {
  const sites: TaintSite[] = [];
  const tree = parse(source);
  scanTaint(tree.rootNode as Parameters<typeof scanTaint>[0], {
    memberTypes: RULES.memberTypes,
    callTypes: RULES.callTypes,
    onMember: (site) => sites.push(site),
    onCall: (site) => sites.push(site),
  });
  return sites;
}

describe('scanTaint', () => {
  it('reports calls and member reads in source order, once each', () => {
    const sites = scan(['const a = request.query.get("x");', 'db.query(a);'].join('\n'));
    // **Every nested expression is a candidate**, and the outermost arrives first: the call, the member that names its
    // callee, and the member inside that one. The collectors decide which of them they want; the scan does not.
    expect(sites.map((s) => s.text)).toEqual([
      'request.query.get("x")',
      'request.query.get',
      'request.query',
      'db.query(a)',
      'db.query',
    ]);
    // **And nothing that is neither shape is handed over**, which is why the walk costs a string comparison per node
    // rather than a node per node.
    expect(sites.every((s) => s.type === 'call_expression' || s.type === 'member_expression')).toBe(
      true,
    );
  });

  it('files a statement on the line it starts on', () => {
    const sites = scan('const a = db.query(x);');
    expect(sites.map((s) => s.line)).toEqual([1, 1]);
    expect(sites.map((s) => s.statementLine)).toEqual([1, 1]);
  });

  it('gives every nested expression its statement line, not its own', () => {
    // **One statement across three lines**: the neutraliser on the third is filed on the first, which is the line the
    // sink and the tainted use are filed on.
    const sites = scan(
      ['response.getWriter()', '  .println(', '    "v: " + ESCAPE.encode(param));'].join('\n'),
    );
    const lines = sites.map((s) => s.text);
    expect(lines.length).toBeGreaterThan(1);
    // Every site in this statement carries line 1 as its statement line, whichever line it starts on.
    expect(new Set(sites.map((s) => s.statementLine))).toEqual(new Set([1]));
  });

  it('starts a new statement after the first one ends', () => {
    const sites = scan(['first();', 'second();'].join('\n'));
    expect(sites.map((s) => [s.line, s.statementLine])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('reports nothing when the rules name no type in the tree', () => {
    const sites = scan('const a = 1;');
    expect(sites).toEqual([]);
  });
});
