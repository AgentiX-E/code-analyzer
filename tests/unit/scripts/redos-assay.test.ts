// The instrument that sorts seventy-six ReDoS findings, checked before its verdicts are believed
//
// **Why an instrument has tests.** The previous iteration sorted thirty-five of these findings by hand, in a scratch
// file, and wrote the answer into an audit page: twenty-two real, thirteen not. **Nothing about that sort could be
// re-run**, so a reader had to take the paragraph on trust - and the paragraph's own numbers had already been produced
// by two different thresholds in two different hours. This file is the part that makes the sort a measurement: the
// locator, the pump, the verdict and the replay, each pinned by a case, plus **a positive and a negative control** so
// that an instrument which called everything linear would fail here rather than in the corpus.
//
// **The controls are the point of the file.** A harness that never fires is indistinguishable from a repository with no
// defect, and the way to tell them apart is to hand it a pattern that is certainly quadratic and one that is certainly
// not, and require the two answers to differ.

import { describe, expect, it } from 'vitest';

import {
  adversarialString,
  assay,
  locateLiteral,
  measureOnce,
  pumpFromMessage,
  regexConsumers,
  regexLiteralsIn,
  verdictOf,
} from '../../../scripts/redos-assay.mjs';

describe('the literal scanner', () => {
  it('finds the literals, with the lines they start and end on', () => {
    const source = ['const a = /first/g;', 'const b = /second[\\/]x/i;'].join('\n');
    const found = regexLiteralsIn(source);

    expect(found.map((literal) => [literal.pattern, literal.flags, literal.startLine])).toEqual([
      ['first', 'g', 1],
      ['second[\\/]x', 'i', 2],
    ]);
  });

  it('does not mistake a division for a literal', () => {
    // **The one local decision the scanner makes**, and the one it can get wrong: `a / b / c` is arithmetic and
    // `/ab/` after `=` is a literal. The rule is what the previous significant character is.
    const source = ['const half = total / 2 / 3;', 'const re = /ab/g;'].join('\n');
    expect(regexLiteralsIn(source).map((literal) => literal.pattern)).toEqual(['ab']);
  });

  it('ignores literals written inside comments and strings', () => {
    const source = [
      '// const a = /commented/g;',
      '/* const b = /blocked/g; */',
      "const s = 'a /slash/ in a string';",
      'const c = /real/g;',
    ].join('\n');
    expect(regexLiteralsIn(source).map((literal) => literal.pattern)).toEqual(['real']);
  });

  it('reads a class containing an unescaped slash, because the class is not the end', () => {
    expect(regexLiteralsIn('const p = /[/]/g;').map((literal) => literal.pattern)).toEqual(['[/]']);
  });

  it('binds a literal to the name it is assigned to, across a line break', () => {
    // **The shape a formatter produces for a long pattern**, and the reason the lookback is two hundred characters
    // rather than one line: `const methodPattern =` ends the line and the literal opens the next.
    const source = ['const methodPattern =', '  /^(\\w+)/;'].join('\n');
    const [literal] = regexLiteralsIn(source);
    expect(literal?.assignedTo).toBe('methodPattern');
  });
});

describe('the claim the alert carries', () => {
  it('reads the pump out of the sentence CodeQL writes', () => {
    expect(
      pumpFromMessage(
        "This regular expression may run slow on strings with many repetitions of ' '.",
      ),
    ).toEqual({ prefix: '', pump: ' ' });
    expect(
      pumpFromMessage(
        "This regular expression may run slow on strings starting with 'let 0=(' and with many repetitions of 'let 0=('.",
      ),
    ).toEqual({ prefix: 'let 0=(', pump: 'let 0=(' });
    expect(
      pumpFromMessage(
        "This expression may cause exponential backtracking on strings starting with '#' and containing many repetitions of '#include<!'.",
      ),
    ).toEqual({ prefix: '#', pump: '#include<!' });
  });

  it('refuses a sentence it cannot read rather than inventing an input', () => {
    // **An invented pump measures the author's imagination and reports it as the rule's claim.**
    expect(pumpFromMessage('')).toBeNull();
    expect(pumpFromMessage('This regular expression may run slow, somehow.')).toBeNull();
  });

  it('builds a string of the size asked for, from the prefix and the pump', () => {
    const claim = { prefix: 'pre', pump: 'ab' };
    const built = adversarialString(claim, 4_096);
    expect(built.startsWith('pre')).toBe(true);
    expect(built.length).toBeGreaterThanOrEqual(4_096);
    expect(built.length).toBeLessThan(4_096 + claim.pump.length);
    expect(() => adversarialString({ prefix: '', pump: '' }, 100)).toThrow(/not an input/);
  });
});

describe('the verdict', () => {
  it('calls a pattern that did not return quadratic', () => {
    expect(verdictOf({ ms: null, growth: null, killed: true })).toBe('quadratic');
  });

  it('calls a pattern that crossed the wall clock quadratic even at linear growth', () => {
    expect(verdictOf({ ms: 900, growth: 10, killed: false })).toBe('quadratic');
  });

  it('calls a pattern quadratic on growth alone, which is the one a ceiling misses', () => {
    // **`structure-lens` measured 94 ms at forty kilobytes and ×95 over the smaller size**: a quadratic pattern with a
    // small constant, and a wall-clock-only rule called it fast until the corpus grew by a factor of fifteen.
    expect(verdictOf({ ms: 94, growth: 95, killed: false })).toBe('quadratic');
  });

  it('calls a fast, flat pattern linear, and a missing number unmeasured', () => {
    expect(verdictOf({ ms: 4, growth: 9, killed: false })).toBe('linear');
    expect(verdictOf({ ms: null, growth: null, killed: false })).toBe('unmeasured');
  });
});

describe('locating the literal an alert is about', () => {
  const source = [
    'function read(line) {', // 1
    '  const at = line.indexOf("from");', // 2
    '  const pattern =', // 3
    '    /^import\\s+(\\w+)/;', // 4
    '  return pattern.exec(line);', // 5
    '}', // 6
  ].join('\n');

  it('finds the literal on the line, and names the variable when it is elsewhere', () => {
    expect(locateLiteral({ line: 4 }, regexLiteralsIn(source), source).locatedBy).toBe('line');
    const byName = locateLiteral({ line: 5 }, regexLiteralsIn(source), source);
    expect(byName.locatedBy).toBe('name');
    expect(byName.literal?.pattern).toBe('^import\\s+(\\w+)');
  });

  it('falls back to the nearest literal above, and says that it did', () => {
    // A line that invokes nothing, so no name can be resolved and the only answer left is the literal above it.
    const plain = ['const re = /a/;', '', '', 'let z = 0;'].join('\n');
    const located = locateLiteral({ line: 4 }, regexLiteralsIn(plain), plain);
    expect(located.locatedBy).toBe('adjacent');
    expect(located.literal?.pattern).toBe('a');
  });

  it('finds the literal an alert points at from above the line, because a call wraps', () => {
    const wrapped = ['const m = trimmed.match(', '  /f(\\w*)/,', ');'].join('\n');
    const located = locateLiteral({ line: 1 }, regexLiteralsIn(wrapped), wrapped);
    expect(located.locatedBy).toBe('below');
    expect(located.literal?.pattern).toBe('f(\\w*)');
  });

  it('returns nothing rather than a neighbour when there is no literal at all', () => {
    const code = ['const a = 1;', 'const b = 2;'].join('\n');
    const located = locateLiteral({ line: 2 }, regexLiteralsIn(code), code);
    expect(located).toEqual({ literal: null, locatedBy: null });
  });

  it('reads the five shapes a line passes a pattern through, and only the pattern', () => {
    expect(regexConsumers('pattern.exec(line)')).toEqual(['pattern']);
    // **`line` is not a candidate here**, even though it sits where `pattern` sits in the case above.
    expect(regexConsumers('line.match(re)')).toEqual(['re']);
    expect(regexConsumers('a.replace(re, "")')).toEqual(['re']);
    expect(regexConsumers('const x = 1;')).toEqual([]);
  });
});

describe('the replay, on a pattern that is certainly quadratic and one that is certainly not', () => {
  /**
   * **Two adjacent optional whitespace runs around an optional group**, which is the shape three of this repository's
   * findings turned out to be: `\)\s*(?::\s*\w+)?\s*\{`. On a run of spaces the engine tries every split of the run
   * between the two, so the cost is the square of its length.
   */
  const DOUBLE_RUN = '^\\s*(?::\\s*\\w+)?\\s*\\{';

  it('catches a pattern whose two whitespace runs can be split in any proportion', () => {
    // **The positive control.** If this came back linear, every verdict the assay prints would be suspect.
    const literal = { pattern: DOUBLE_RUN, flags: '' };
    const small = measureOnce(literal, ' '.repeat(2_048));
    const large = measureOnce(literal, ' '.repeat(20_480));

    expect(small.error).toBeNull();
    expect(large.error).toBeNull();
    const growth = (large.ms ?? 0) / Math.max(small.ms ?? 0.001, 0.001);
    expect(
      verdictOf({ ms: large.ms, growth, killed: large.killed }),
      `${String(large.ms)} ms at ten times the size, ×${growth.toFixed(1)}`,
    ).toBe('quadratic');
  });

  it('does not accuse a linear pattern of the same input', () => {
    // **The negative control, on the same shape of input**: if the harness called this quadratic too, its verdict would
    // be a property of the input rather than of the pattern.
    const literal = { pattern: '^import ([a-z]+)$', flags: '' };
    const input = `import ${'a'.repeat(40_000)}`;
    const measured = measureOnce(literal, input);
    expect(measured.killed).toBe(false);
    expect(measured.ms).toBeLessThan(50);
  });
});

describe('the assay over a list of findings', () => {
  const sources = new Map([
    [
      'a.ts',
      [
        'const slow = /^\\s*(?::\\s*\\w+)?\\s*\\{/;',
        'slow.test(line);',
        'const fine = /^ok$/;',
        'fine.test(line);',
      ].join('\n'),
    ],
  ]);

  const read = (file: string): string => {
    const source = sources.get(file);
    if (source === undefined) throw new Error(`no fixture for ${file}`);
    return source;
  };

  it('measures each finding and keeps the ones it cannot place in the table', () => {
    const rows = assay(
      [
        { rule: 'js/redos', file: 'a.ts', line: 2, message: "many repetitions of ' '." },
        { rule: 'js/redos', file: 'a.ts', line: 40, message: "many repetitions of ' '." },
      ],
      read,
      { sizes: [2_048, 20_480], killMs: 2_000 },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.outcome).toBe('quadratic');
    // **`unlocated` is a value, not a gap**: a finding that vanished between the API and the summary is the arithmetic
    // defect `docs/SECURITY.md` §1.6 was written about.
    expect(rows[1]?.outcome).toBe('unlocated');
    expect(rows[1]?.pattern).toBeNull();
  });

  it('says it did not measure a finding whose sentence it cannot read', () => {
    const rows = assay(
      [{ rule: 'js/redos', file: 'a.ts', line: 4, message: 'slow, somehow' }],
      read,
      {
        sizes: [64, 256],
      },
    );
    expect(rows[0]?.outcome).toBe('no-claim');
    expect(rows[0]?.ms).toBeNull();
  });

  it('measures a pattern once however many findings name it', () => {
    // The same literal is reported at its definition and at each of its uses; replaying it per finding would multiply
    // the corpus by the number of call sites.
    const rows = assay(
      [
        { rule: 'js/redos', file: 'a.ts', line: 1, message: "many repetitions of ' '." },
        { rule: 'js/redos', file: 'a.ts', line: 2, message: "many repetitions of ' '." },
      ],
      read,
      { sizes: [2_048, 20_480], killMs: 2_000 },
    );
    expect(rows.map((row) => row.outcome)).toEqual(['quadratic', 'quadratic']);
    expect(rows[0]?.pattern).toBe(rows[1]?.pattern);
  });
});
