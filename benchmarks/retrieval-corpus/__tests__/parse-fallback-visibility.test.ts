// Whether a parse used the grammar or gave up on it.
//
// **The defect this exists for.** When a grammar cannot read a file, the provider quietly switches to a regex reader
// that finds **a smaller and differently-shaped set of symbols** - no comments, no imports, no annotations. **The
// caller sees a successful parse and a shorter list**, and there has been no way to tell the two apart.
//
// **It surfaced as a mystery rather than as a bug.** Groovy returned different results from every other language in a
// twenty-language scan, and the reason was not about groovy or about the scan's question: **`def name(a) { ... }`
// reports a parse error**, so the fallback ran. **A fact that changes what the symbols are belongs where a caller can
// read it**, and this is the guard that keeps it there.
//
// **And the assertion is the pair.** A flag that is always `true` would pass a test that only checked groovy; a flag
// that is always `false` would pass one that only checked typescript. **Both directions are asserted**, because a
// boolean with one side tested is a boolean nobody has tested.

import { describe, expect, it } from 'vitest';

import { getOrLoadProvider } from '../../pipeline/phase-helpers.js';

/** Source the groovy grammar rejects: `def name(args) { ... }` reports a parse error. */
const GROOVY_THAT_FAILS = 'def myFunction(a) {\n  return a\n}\n';
/** Source the typescript grammar reads. */
const TYPESCRIPT_THAT_PARSES = 'export function myFunction(a: number): number {\n  return a;\n}\n';

describe('a parse says whether it read the file or gave up on it', () => {
  it('reports the fallback for a grammar that cannot read the source', async () => {
    const groovy = (await getOrLoadProvider('groovy')) as unknown as {
      parse(s: string, f: string): unknown[];
      lastParseWasARegularExpressionFallback: boolean;
    };
    expect(groovy).not.toBeNull();

    const captures = groovy.parse(GROOVY_THAT_FAILS, '/f.groovy');
    // **The parse still returns symbols** - that is the point: it is not a failure, it is a *different* extraction,
    // and the short list it returns is what made it invisible.
    expect(captures.length).toBeGreaterThan(0);
    expect(groovy.lastParseWasARegularExpressionFallback).toBe(true);
  });

  it('reports no fallback when the grammar read the source', async () => {
    const typescript = (await getOrLoadProvider('typescript')) as unknown as {
      parse(s: string, f: string): unknown[];
      lastParseWasARegularExpressionFallback: boolean;
    };

    expect(typescript).not.toBeNull();
    const captures = typescript.parse(TYPESCRIPT_THAT_PARSES, '/f.ts');
    expect(captures.length).toBeGreaterThan(0);
    // **The other direction.** Without this line the flag could be `true` for everything and this file would pass.
    expect(typescript.lastParseWasARegularExpressionFallback).toBe(false);
  });
});
