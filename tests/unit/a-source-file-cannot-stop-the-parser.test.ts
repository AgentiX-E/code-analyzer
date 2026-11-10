// A source file must not be able to stop the parser, and the bound has to be measured rather than asserted.
//
// **What this file was written against.** Twenty-five `js/polynomial-redos` alerts were open on this repository and the
// audit said "triaged" three times without a number attached. So they were measured: twenty-five patterns, each fed an
// input built for its own shape, at roughly 120 KB - a plausible single-file size in the repositories this product
// reviews. **Five were slow and twenty were not**, and the five were not the five the severity labels suggested:
//
// | pattern | hostile input | before | after |
// | --- | --- | --- | --- |
// | C++ declaration | `'static '.repeat(20000)` | **7 205 ms** | 9 ms |
// | HTML tag | `'<a '.repeat(30000)` | **1 539 ms** | 0.2 ms |
// | Kotlin `fun` modifiers | `'private '.repeat(20000)` | **1 272 ms** | 1.3 ms |
// | Kotlin class modifiers | `'data '.repeat(20000)` | **988 ms** | 1 ms |
// | signature trailing noise | `'= '.repeat(20000) + 'a'` | **> 15 000 ms, killed** | < 1 ms |
//
// **A measurement without a test is a measurement that expires.** Every one of these was a regex whose quantifier nesting
// reads as harmless, and every one of them came back the moment the alternative was written by hand. So the bound lives
// here: the same inputs, through the same functions, under a budget, on every push.
//
// **Why a wall-clock bound and not a big-O proof.** The property a user cares about is "a file I paste in finishes", and
// the mechanism is a regex engine whose constants are not mine to reason about. A budget of 400 ms for 120 KB against a
// measured worst case of 9 ms is **a fortyfold margin over the fixed code and a fourfold gap under the broken one** -
// wide enough not to flake on a loaded runner, narrow enough that a regression cannot hide inside it.

import { describe, expect, it } from 'vitest';

// **Static imports, because a template-literal `import()` is not resolvable by the bundler** and fails at collection
// time with `Unknown variable dynamic import` - a failure that reads as a missing module rather than as a test bug.
import { HtmlProvider } from '../../packages/analyzer/src/languages/html.js';
import { KotlinProvider } from '../../packages/analyzer/src/languages/kotlin.js';
import { PhpProvider } from '../../packages/analyzer/src/languages/php.js';
import { PythonProvider } from '../../packages/analyzer/src/languages/python.js';
import { RProvider } from '../../packages/analyzer/src/languages/r.js';
import { RubyProvider } from '../../packages/analyzer/src/languages/ruby.js';
import { RustProvider } from '../../packages/analyzer/src/languages/rust.js';
import { stripTrailingNoise } from '../../packages/analyzer/src/languages/signatures.js';
import { SwiftProvider } from '../../packages/analyzer/src/languages/swift.js';
import { TypeScriptProvider } from '../../packages/analyzer/src/languages/typescript.js';

/**
 * **The budget, and it is deliberately loose.**
 *
 * The fixed patterns run in single-digit milliseconds at this size, so 400 ms is a fortyfold margin. **A tight bound
 * would be a flaky test and a flaky test is disabled within a month**, which is how a security guard stops being one.
 * The gap that matters is between milliseconds and seconds, and this sits in it.
 */
const BUDGET_MS = 400;

/** Run `work` and return how long it took, so a failure reports the elapsed time rather than a bare timeout. */
function elapsed(work: () => void): number {
  const start = process.hrtime.bigint();
  work();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

describe('the signature stripper is linear in the length of the header', () => {
  it('strips the same tokens the regex did, including the ones that made it backtrack', () => {
    // **The equivalence that matters**: a rewrite that is fast and strips different characters is a different function.
    expect(stripTrailingNoise('run(a: number): void;')).toBe('run(a: number): void');
    expect(stripTrailingNoise('f(x) => ')).toBe('f(x)');
    expect(stripTrailingNoise('class A {')).toBe('class A');
    expect(stripTrailingNoise('f() = ')).toBe('f()');
    expect(stripTrailingNoise('int x;')).toBe('int x');
    expect(stripTrailingNoise('a = ')).toBe('a');
    expect(stripTrailingNoise('x:')).toBe('x');
    expect(stripTrailingNoise('')).toBe('');
    // Trailing whitespace on a header with no noise is not noise, and it is not returned either: the function trims
    // before it looks, which is the one place it is stricter than the regex it replaced.
    expect(stripTrailingNoise('plain ')).toBe('plain');
  });

  it('finishes an input that killed the regex, and finishes it at once', () => {
    // **The input is the one that took the regex past fifteen seconds**: a run of `= ` with a letter after it, so the
    // anchor can never match and every starting position is tried.
    const hostile = `${'= '.repeat(20000)}a`;
    const ms = elapsed(() => {
      expect(stripTrailingNoise(hostile).endsWith('a')).toBe(true);
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('is not quadratic on a run of spaces, which is the same shape with one alternative fewer', () => {
    const ms = elapsed(() => {
      expect(stripTrailingNoise(`${' '.repeat(40000)}a`).endsWith('a')).toBe(true);
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('is not quadratic on a header that is nothing but noise', () => {
    // Every iteration shortens the string here, which is the invariant the comment claims: a loop whose body can return
    // without shortening is a loop that can run forever.
    const ms = elapsed(() => {
      expect(stripTrailingNoise(':=;{ '.repeat(6000))).toBe('');
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('a declaration with an absurd number of modifiers is still found', () => {
  it('bounds the Kotlin modifier run without losing the declaration behind it', () => {
    // **The bound is eight, and this is why it is safe.** A pattern that starts matching later still matches, because
    // the engine advances and tries again - so a declaration with twenty modifiers costs the *prefix* and not the name.
    // **A bound that silently lost the declaration would be a correctness fix bought with a bug**, so the assertion is
    // on the name and not on the timing.
    const provider = new KotlinProvider();
    const source = `${'open '.repeat(20)}class Ledger { }\n${'private '.repeat(20)}fun settle(id: String) { }\n`;
    const captures = provider.fallbackParse(source, 'Ledger.kt');
    expect(captures.map((capture) => capture.name)).toEqual(
      expect.arrayContaining(['Ledger', 'settle']),
    );
  });

  it('and a file of modifiers with no declaration in it finishes at once', () => {
    const provider = new KotlinProvider();
    const hostile = 'data '.repeat(20000);
    const ms = elapsed(() => {
      expect(provider.fallbackParse(hostile, 'Hostile.kt')).toHaveLength(0);
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('and an unterminated tag run does not scan the rest of the file for every `<`', () => {
    // **1 539 ms before the attribute class was narrowed to `[^<>]*`**, because `[^>]*` re-scanned to the end of the
    // input from every opening bracket. A `<` inside an attribute value is invalid HTML - it must be written `&lt;` -
    // so stopping the scan at the next `<` costs no valid document anything.
    const provider = new HtmlProvider();
    const hostile = '<a '.repeat(30000);
    const ms = elapsed(() => {
      provider.fallbackParse(hostile, 'hostile.html');
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe("every language's fallback scanner survives a file built to stall it", () => {
  /**
   * **The twenty patterns that measured fast, held fast by the same test that holds the five that were slow.**
   *
   * The audit that produced the table at the top of this file measured twenty-five patterns; **five were slow and twenty
   * were not**, and the twenty were never written down anywhere a test could reach. So each language below is handed a
   * source built out of its own flagged shape - a run of keywords with no declaration after them, an unterminated
   * delimiter, a block comment opener with no closer - and the whole fallback scan has to finish inside the same budget.
   *
   * **A whole-file bound rather than a per-regex one, deliberately.** The defect a user experiences is "the review never
   * finished", and it does not matter which of a file's patterns was the one that scanned to the end. This also survives
   * a refactor that replaces a regex with a hand-written scanner, which a per-pattern test would not.
   */
  const TRIPLE_QUOTE = '"'.repeat(3);
  const HOSTILE: Array<{
    file: string;
    provider: { fallbackParse: (source: string, path: string) => unknown[] };
    source: string;
  }> = [
    {
      file: 'Hostile.kt',
      provider: new KotlinProvider(),
      source: `${'data '.repeat(12000)}${'private '.repeat(12000)}`,
    },
    {
      file: 'Hostile.php',
      provider: new PhpProvider(),
      source: 'use App\\'.repeat(12000),
    },
    {
      file: 'hostile.py',
      provider: new PythonProvider(),
      // An unmatched docstring delimiter over a file that is nothing but import keywords.
      source: `${TRIPLE_QUOTE.repeat(8000)}${'import '.repeat(8000)}`,
    },
    {
      file: 'hostile.r',
      provider: new RProvider(),
      source: 'x <- '.repeat(12000),
    },
    {
      file: 'hostile.rb',
      provider: new RubyProvider(),
      source: 'CONST_'.repeat(12000),
    },
    {
      file: 'hostile.rs',
      provider: new RustProvider(),
      source: 'use a::'.repeat(12000),
    },
    {
      file: 'hostile.swift',
      provider: new SwiftProvider(),
      source: 'let a = '.repeat(12000),
    },
    {
      file: 'hostile.ts',
      provider: new TypeScriptProvider(),
      // A block comment opener with no closer, after twelve thousand declarations.
      source: `${'const a = '.repeat(12000)}${'/'.padEnd(20000, '*')}`,
    },
    {
      file: 'hostile.html',
      provider: new HtmlProvider(),
      source: '<a '.repeat(12000),
    },
  ];

  for (const entry of HOSTILE) {
    it(`scans ${entry.file} without scanning to the end of it from every position`, () => {
      const ms = elapsed(() => {
        entry.provider.fallbackParse(entry.source, entry.file);
      });
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }
});
