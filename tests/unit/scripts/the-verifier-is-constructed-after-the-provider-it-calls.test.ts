// **A `const` in its temporal dead zone is a crash, and the harness had one on the only path that turns the verifier on.**
//
// §167 shipped the two-sided verifier into `.github/scripts/run-martian-harness.mjs` behind `SYMBOL_CROSSCHECK`, and the
// block that constructs it was written above the block that constructs the provider it is handed. The script is a module
// body, so `const provider` is hoisted uninitialised and read at its declaration site order - which means that with the
// switch on, `new SymbolCrosscheck(provider, …)` throws `ReferenceError: Cannot access 'provider' before initialization`
// **before the first model call**, while with the switch off nothing at all is observable. Every test in the tree was
// green: the standalone `scripts/symbol-crosscheck.mjs` was what the paid run and the e2e had exercised, and the harness
// path had only ever been read.
//
// **CodeQL found it** (`js/use-before-declaration`, alert 1718), which is the right instrument for this class of defect
// and not one a test can replace: nothing executes the harness inside CI, because running it buys model calls. What a
// test *can* hold is the property that makes the crash impossible - the order of the two declarations - and that is what
// this file does. It is a source check, like `a-switch-that-is-off-does-not-spend.test.ts` beside it, because the thing
// being asserted is the shape of a program the test cannot run.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'run-martian-harness.mjs',
);
const SOURCE = readFileSync(PATH, 'utf8');

/** Where the provider the verifier is handed is constructed. */
const PROVIDER_AT = SOURCE.indexOf('const provider = new DeepSeekProvider(');

/** Where the verifier that reads it is constructed. */
const VERIFIER_AT = SOURCE.indexOf('new CORRECTION.SymbolCrosscheck(provider,');

describe('the harness constructs the verifier after the provider it is handed', () => {
  it('finds both constructions, so the check is about a program and not about a comment', () => {
    // **A grep that matches the discussion of a line is not a check on the line** - the lesson
    // `a-switch-that-is-off-does-not-spend.test.ts` records after it compared a record branch against prose. Both of
    // these strings are code: one is a `const` initialiser and the other is a constructor call whose first argument is
    // the identifier in question.
    expect(PROVIDER_AT).toBeGreaterThan(-1);
    expect(VERIFIER_AT).toBeGreaterThan(-1);
  });

  it('declares the provider first, which is the whole of the fix', () => {
    // **The ordering is the semantics under `const`.** A function declaration could be hoisted and a `var` could be
    // `undefined`; a `const` can be neither, so the position of the initialiser is what decides whether the switch-on
    // path throws. This is the assertion that would have failed before the repair.
    expect(PROVIDER_AT).toBeLessThan(VERIFIER_AT);
  });

  it('builds one provider and hands that one to the verifier, because a second is a second bill', () => {
    // **The sentence beside the declaration is an invariant, so it is checked.** "A second provider would be a second
    // bill that the ceiling did not see" - and the way that happens is a pass that constructs its own model client to
    // avoid touching the review's. One construction, and the verifier's first argument is that identifier.
    const constructions = SOURCE.match(/new DeepSeekProvider\(/g) ?? [];
    expect(constructions).toHaveLength(1);
    expect(VERIFIER_AT).toBeGreaterThan(-1);
    expect(SOURCE.slice(VERIFIER_AT, VERIFIER_AT + 60)).toContain(
      'new CORRECTION.SymbolCrosscheck(provider,',
    );
  });

  it('keeps the verifier import behind the switch, so a run that does not buy it does not load it', () => {
    // **The property §167.4 priced.** The pass is off by default and its module is loaded only when it is asked for, so
    // a review that does not correct anything pays neither for the import path nor for the calls. A repair that hoisted
    // the import to the top of the file to solve the ordering would have turned the switch into a runtime flag over
    // code that had already been loaded - which is not the same purchase.
    const importAt = SOURCE.indexOf(
      "await import('../../packages/intelligence/dist/review/symbol-crosscheck.js')",
    );
    expect(importAt).toBeGreaterThan(-1);
    const region = SOURCE.slice(importAt - 200, importAt);
    expect(region).toContain('const CORRECTION = CROSSCHECK');
  });
});
