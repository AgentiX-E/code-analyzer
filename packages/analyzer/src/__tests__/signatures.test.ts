// @code-analyzer/analyzer — declaration signature extraction
//
// **The rule under test is "the declaration minus its body"**, and every case below is a grammar that lays its header
// out differently: a return type before the name, after the parameters, or inside a declarator with the parameters.

import { describe, expect, it } from 'vitest';

import { MAX_SIGNATURE_LENGTH, signatureOf } from '../languages/signatures.js';

import type { SignatureNode } from '../languages/signatures.js';

/**
 * A node built from a layout, so a test reads as the source it is describing.
 *
 * **A string is literal text and an object is a child**, which is the whole of it: the offsets are laid out by
 * concatenation, so `startIndex` and `endIndex` agree with the text by construction and a test cannot pass by arithmetic
 * luck.
 */
type Spec =
  | string
  | {
      readonly type: string;
      readonly parts: readonly Spec[];
      readonly fields?: Record<string, number>;
    };

const NAMED = 0;

function build(spec: Spec, base: number): { node: SignatureNode; end: number } {
  if (typeof spec === 'string') {
    const node: SignatureNode = {
      type: 'token',
      text: spec,
      startIndex: base,
      endIndex: base + spec.length,
      namedChildCount: 0,
      childCount: 0,
      namedChild: () => {
        throw new Error('a token has no children');
      },
      child: () => {
        throw new Error('a token has no children');
      },
      childForFieldName: () => null,
    };
    return { node, end: base + spec.length };
  }

  const children: SignatureNode[] = [];
  const texts: string[] = [];
  let cursor = base;
  for (const part of spec.parts) {
    const built = build(part, cursor);
    texts.push(built.node.text);
    if (typeof part !== 'string') children.push(built.node);
    cursor = built.end;
  }

  const node: SignatureNode = {
    type: spec.type,
    text: texts.join(''),
    startIndex: base,
    endIndex: cursor,
    namedChildCount: children.length,
    childCount: spec.parts.length,
    namedChild: (index) => children[index]!,
    child: (index) => children[index]!,
    childForFieldName: (fieldName) => {
      const index = spec.fields?.[fieldName];
      return index === undefined ? null : (children[index] ?? null);
    },
  };
  return { node, end: cursor };
}

/** The signature of one hand-built declaration. */
function signatureOfSpec(spec: Spec, limit?: number): string | undefined {
  const { node } = build(spec, 0);
  return limit === undefined ? signatureOf(node) : signatureOf(node, limit);
}

void NAMED;

describe('the header of a declaration', () => {
  it('is the declaration with the body removed, whatever order the grammar writes the return type in', () => {
    // Java: the result type comes before the name, and the modifiers are part of what a reader recognises.
    expect(
      signatureOfSpec({
        type: 'method_declaration',
        parts: [
          'public void ',
          { type: 'identifier', parts: ['run'] },
          { type: 'formal_parameters', parts: ['(', 'String a', ')'] },
          ' ',
          { type: 'block', parts: ['{ return; }'] },
        ],
        fields: { parameters: 1, body: 2 },
      }),
    ).toBe('public void run(String a)');

    // TypeScript: the result type comes after the parameters, and cutting at the body keeps it.
    expect(
      signatureOfSpec({
        type: 'function_declaration',
        parts: [
          'function ',
          { type: 'identifier', parts: ['run'] },
          { type: 'formal_parameters', parts: ['(', 'a: number', ')'] },
          { type: 'type_annotation', parts: [': void'] },
          ' ',
          { type: 'statement_block', parts: ['{ }'] },
        ],
        fields: { parameters: 1, return_type: 2, body: 3 },
      }),
    ).toBe('function run(a: number): void');
  });

  it('is the same cut reached from the other side when there is no body', () => {
    // A contract has no body, so the parameters and the result type are where the header ends.
    expect(
      signatureOfSpec({
        type: 'method_declaration',
        parts: [
          'void ',
          { type: 'identifier', parts: ['run'] },
          { type: 'formal_parameters', parts: ['(', 'String a', ')'] },
          ';',
        ],
        fields: { parameters: 1 },
      }),
    ).toBe('void run(String a)');
  });

  it('keeps the parameters a grammar nests inside a declarator, because the body is the cut', () => {
    // C writes `int add(int a, int b)` as a `type`, a declarator holding the parameters, and a body.
    expect(
      signatureOfSpec({
        type: 'function_definition',
        parts: [
          'static int ',
          {
            type: 'function_declarator',
            parts: [
              { type: 'identifier', parts: ['add'] },
              { type: 'parameter_list', parts: ['(', 'int a, int b', ')'] },
            ],
          },
          ' ',
          { type: 'compound_statement', parts: ['{ }'] },
        ],
        fields: { declarator: 0, body: 1 },
      }),
    ).toBe('static int add(int a, int b)');
  });

  it('collapses a header written over several lines, and drops the token that only existed to be followed', () => {
    expect(
      signatureOfSpec({
        type: 'function_definition',
        parts: [
          'def ',
          { type: 'identifier', parts: ['parse'] },
          { type: 'parameters', parts: ['(\n    self,\n    source: str,\n)'] },
          { type: 'type', parts: [' -> Program'] },
          ':',
          { type: 'block', parts: ['\n    return parse(source)\n'] },
        ],
        fields: { parameters: 1, return_type: 2, body: 3 },
      }),
    ).toBe('def parse(self, source: str) -> Program');

    // The arrow of an arrow function is the same kind of token: it introduces the body, which is what was cut.
    expect(
      signatureOfSpec({
        type: 'arrow_function',
        parts: [
          { type: 'formal_parameters', parts: ['(', 'x: number', ')'] },
          ' =>',
          { type: 'binary_expression', parts: ['x * 2'] },
        ],
        fields: { parameters: 0, body: 1 },
      }),
    ).toBe('(x: number)');
  });

  it('refuses a name, an empty header, and a header that is really a table', () => {
    // A capture whose node is a bare identifier has no header to report.
    expect(signatureOfSpec({ type: 'identifier', parts: ['run'] })).toBeUndefined();
    // Nothing but noise: the token that would have followed the header.
    expect(signatureOfSpec({ type: 'block', parts: ['{'] })).toBeUndefined();
    // **A generated table is not a signature**, and letting one into the field would let a single line dominate every
    // document's length in the index.
    const enormous = `void run(${Array.from({ length: 200 }, (_, i) => `String a${i}`).join(', ')})`;
    expect(
      signatureOfSpec({
        type: 'method_declaration',
        parts: [
          'void ',
          { type: 'identifier', parts: ['run'] },
          { type: 'formal_parameters', parts: [enormous.slice(9)] },
          ';',
        ],
        fields: { parameters: 1 },
      }),
    ).toBeUndefined();
    expect(enormous.length).toBeGreaterThan(MAX_SIGNATURE_LENGTH);
  });
});
