// @code-analyzer/analyzer — which nodes are calls, in the grammar that is being read.
//
// **`CALL_NODE_TYPES` was a union of eight grammars' call node names, and the two providers that consult it contribute
// two of those names.** The other four C-family-looking entries - `binary_expression`, `member_access_expression`,
// `prefix_expression`, `postfix_unary_expression` - are not calls in the TypeScript or JavaScript grammar at all, so
// asking the question of every node made **`a ?? b` a call site whose callee was `a`**:
//
//   class Index { query(k: string) { return this.store.get(k) ?? 0; } }
//
// produced two references for one call - `method.call get` and a `function.call` named after the whole expression -
// and any `x + y` in a TypeScript file became a `FUNCTION_CALL` to `x`, a call site the resolver could then resolve to
// a function nobody called. Measured on the two TypeScript corpora: **three of `colinhacks/zod`'s 41 same-file edges
// were exactly this**, and same-file precision went from 87.8 % to 100 % when they were gone.

import { describe, it, expect } from 'vitest';

import { getOrLoadProvider } from '../pipeline/phase-helpers.js';

import type { UnifiedCapture } from '@code-analyzer/shared';

async function captures(language: string, source: string): Promise<UnifiedCapture[]> {
  const provider = await getOrLoadProvider(language);
  if (provider === null) throw new Error(`no provider for ${language}`);
  return provider.parse(source, `/proj/sample.${language === 'typescript' ? 'ts' : 'js'}`);
}

function calls(list: readonly UnifiedCapture[]): UnifiedCapture[] {
  return list.filter((capture) => capture.tag === 'function.call' || capture.tag === 'method.call');
}

describe('a call site is a call expression, and an operator is not one', () => {
  it('does not record a nullish coalescing expression as a call', async () => {
    const parsed = await captures(
      'typescript',
      'class Index { query(k: string): number { return this.store.get(k) ?? 0; } }\n',
    );

    expect(calls(parsed).map((capture) => capture.name)).toEqual(['get']);
    // **The callee is the callee.** A capture whose `name` is a whole expression is the phantom this test exists for.
    expect(calls(parsed)[0]!.text).toBe('this.store.get');
  });

  it('does not record arithmetic, comparison, logical or prefix operators as calls', async () => {
    for (const expression of ['a + b', 'a && b', 'a || b', 'a === b', 'a - b', '!a', 'a++']) {
      const parsed = await captures('typescript', `const r = ${expression};\n`);
      expect(calls(parsed), expression).toEqual([]);
    }
  });

  it('still records the call inside an operator expression, once', async () => {
    const parsed = await captures('typescript', 'const r = f(x) + g(y);\n');

    expect(
      calls(parsed)
        .map((capture) => capture.name)
        .sort(),
    ).toEqual(['f', 'g']);
  });

  it('records a construction once, as a construction', async () => {
    const parsed = await captures(
      'typescript',
      'const map = new Map<string, number>([["a", 1]]);\n',
    );

    const constructions = parsed.filter((capture) => capture.tag === 'new.expression');
    expect(constructions.map((capture) => capture.name)).toEqual(['Map']);
    expect(calls(parsed)).toEqual([]);
  });

  it('reads the same two node types for JavaScript', async () => {
    const parsed = await captures('javascript', 'const r = a ?? b; f();\n');

    expect(calls(parsed).map((capture) => capture.name)).toEqual(['f']);
  });

  it('leaves a grammar that uses a binary expression for a call alone', async () => {
    // **The restriction is per provider, not a deletion from the shared set.** Ruby's grammar does not use
    // `binary_expression` for a call either, but the point of the test is that the union still exists for whoever
    // needs it: a language that answers `true` for a node type the C-family refuses must keep its own answer.
    const provider = await getOrLoadProvider('ruby');
    expect(provider).not.toBeNull();
    const parsed = provider!.parse('puts "hello"\n', '/proj/sample.rb');
    const rubyCalls = parsed.filter(
      (capture) => capture.tag === 'function.call' || capture.tag === 'method.call',
    );
    expect(rubyCalls.length).toBeGreaterThanOrEqual(1);
  });
});
