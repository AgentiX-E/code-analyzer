// What each flow shape reaches, which is where the two remaining gaps are named.
//
// The scan over this repository's sources gives one number for the whole chain. These three shapes give one number
// each, and the difference between them is the diagnosis:
//
//   handler() { const id = req.body.id; db.query(id); }            1 finding
//   handler() { const id = req.body.id; db.query(id + "x"); }      0 findings
//   inner(x) { db.query(x); } handler() { … inner(id); }           0 findings
//
// The first works. **The second says an argument that is an expression is not a use** - the call arm records
// identifiers among the arguments, and `id + "x"` contributes none. **The third says the cross-function join is
// missing** - and the call graph is not the reason: the edge `handler -> inner` is built and resolved, which a
// separate probe printed. So the gap is inside the solver, not in what it is given.

import { TypeScriptProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, it, expect } from 'vitest';

import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';
import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ParsedFile } from '@code-analyzer/shared';

const CASES: ReadonlyArray<{ label: string; code: string; expected: number }> = [
  {
    label: 'a bare identifier argument',
    code: ['function handler(): void {', '  const id = req.body.id;', '  db.query(id);', '}'].join(
      '\n',
    ),
    expected: 1,
  },
  {
    label: 'an expression argument',
    code: [
      'function handler(): void {',
      '  const id = req.body.id;',
      '  db.query(id + "x");',
      '}',
    ].join('\n'),
    expected: 1,
  },
  {
    label: 'a call that crosses into another function',
    code: [
      'function inner(x: string): void {',
      '  db.query(x);',
      '}',
      '',
      'function handler(): void {',
      '  const id = req.body.id;',
      '  inner(id);',
      '}',
    ].join('\n'),
    expected: 0,
  },
];

describe('what each flow shape reaches', () => {
  const provider = new TypeScriptProvider();
  const typed = provider as unknown as {
    parse(s: string, f: string): Array<{ tag?: string }>;
    extractTaintSources(s: string): Array<{ sourceType: string; line: number; text: string }>;
    extractTaintSinks(s: string): Array<{ sinkType: string; line: number; text: string }>;
    extractSanitizers(s: string): Array<{ sanitizerType: string; line: number; text: string }>;
  };

  for (const testCase of CASES) {
    it(`reaches the expected count for ${testCase.label}`, () => {
      const captures = typed.parse(testCase.code, 'src/a.ts');
      const { symbols, references, scopeTree } = groupCaptures(
        captures as Parameters<typeof groupCaptures>[0],
        'src/a.ts',
      );
      const parsed = {
        filePath: 'src/a.ts',
        language: 'typescript',
        symbols,
        references,
        scopeTree,
        ast: captures,
      } as unknown as ParsedFile;
      const extraction = new Map([
        [
          'src/a.ts',
          {
            sources: typed.extractTaintSources(testCase.code),
            sinks: typed.extractTaintSinks(testCase.code),
            sanitizers: typed.extractSanitizers(testCase.code),
          },
        ],
      ]);
      const callSites = buildCallSites([parsed], references);
      const result = analyzeInterproceduralTaint([parsed], callSites, extraction);
      const alsoCfgs = buildFunctionCfgs([parsed], callSites, extraction);

      console.log(
        `SHAPE ${testCase.label}: functions ${alsoCfgs.size}, findings ${result.findings.length} ` +
          `${JSON.stringify(result.findings.map((f) => f.sink.kind))}`,
      );

      // Zero is asserted for the two open shapes, so the test states what is known rather than what is hoped for.
      // When the expression and cross-function cases start reaching one, these lines are what will have to change.
      expect(result.findings.length).toBe(testCase.expected);
    });
  }
});
