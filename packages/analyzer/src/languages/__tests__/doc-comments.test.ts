// @code-analyzer/analyzer — the doc-comment scanner, its contract, and its cost
//
// **Why this file exists rather than two more cases in the parsers' suites.** The pattern it replaces lived in two
// parsers - PHP and TypeScript - and a scanner that is only exercised through them is a scanner whose contract is
// inferred from two callers that happen to agree. `scripts/redos-assay.mjs` measured the pattern at forty kilobytes of
// `/**` with no closing delimiter at **502 ms and quadrupling when the input doubled**, which is the definition of the
// defect class this repository has a rule about: the analyser reads files a pull request supplies, and a generated file
// can supply a line three hundred times longer.

import { describe, expect, it } from 'vitest';

import { readDocComments } from '../doc-comments.js';

/** **How long forty kilobytes may take.** The scan is tens of microseconds; the pattern it replaces was half a second. */
const CEILING_MS = 200;

describe('the doc-comment scanner', () => {
  it('reads a block, its delimiters and its offsets', () => {
    const source = ['const a = 1;', '/**', ' * A note.', ' */', 'const b = 2;'].join('\n');
    const comments = readDocComments(source);

    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe('/**\n * A note.\n */');
    expect(source.slice(comments[0]?.start ?? 0, comments[0]?.end ?? 0)).toBe(comments[0]?.text);
    expect(source.slice(0, comments[0]?.start).split('\n')).toHaveLength(2);
  });

  it('reads several, in the order they appear, without swallowing the code between them', () => {
    const source = '/** one */\nconst a = 1;\n/** two */\nconst b = 2;\n/** three */';
    expect(readDocComments(source).map((c) => c.text)).toEqual([
      '/** one */',
      '/** two */',
      '/** three */',
    ]);
  });

  it('treats an empty body as a block, because the delimiters are what make it one', () => {
    expect(readDocComments('/**/').map((c) => c.text)).toEqual(['/**/']);
    expect(readDocComments('/***/').map((c) => c.text)).toEqual(['/***/']);
  });

  it('ignores the comments that are not doc comments', () => {
    // `/*` and `//` are not the opening delimiter, and a `*/` with nothing open is not a close.
    expect(readDocComments('/* plain */\n// line\nconst a = 1;')).toEqual([]);
    expect(readDocComments('*/ orphan')).toEqual([]);
  });

  it('stops at an opener it can never close rather than swallowing the rest of the file', () => {
    // **The half-written comment at the end of a file in progress is the case that matters**, and the pattern this
    // replaces could not match it either - it simply failed. Same answer, one pass.
    expect(readDocComments('const a = 1;\n/** never closed')).toEqual([]);
    expect(readDocComments('/** one */\n/** never closed').map((c) => c.text)).toEqual([
      '/** one */',
    ]);
  });

  it('keeps a `*/` inside the body out of the search, since the first close is the close', () => {
    expect(readDocComments('/** a */ x */').map((c) => c.text)).toEqual(['/** a */']);
  });

  it('costs the length of the input on a source that is nothing but openers', () => {
    // **The input is CodeQL's own**, taken from the message the alert carried: an opener followed by many repetitions
    // of `/**a`. Forty kilobytes of it, which is what the pattern this replaces walked to the end of from every one of
    // its four thousand openers. **The assertion is a stopwatch**, because a shape read off the source is a claim about
    // the source and this is a claim about the call.
    const hostile = `/**${'/**a'.repeat(7_000)}`;

    const started = performance.now();
    const comments = readDocComments(hostile);
    const elapsed = performance.now() - started;

    // Every opener that has a closer is a block, and the scanner reads them all without asking twice.
    expect(comments.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(CEILING_MS);

    // And doubling the input must not quadruple the cost, which a ceiling alone cannot say.
    const half = performance.now();
    readDocComments(`/**${'/**a'.repeat(3_500)}`);
    const halfElapsed = performance.now() - half;
    expect(elapsed).toBeLessThan(Math.max(4 * halfElapsed, 5));
  });

  it('still reads the doc comments a real file has, at the length a real one has', () => {
    const body = Array.from({ length: 200 }, (_, i) => ` * line ${String(i)}`).join('\n');
    const comments = readDocComments(`/**\n${body}\n */\nexport function f(): void {}`);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text.endsWith('*/')).toBe(true);
    expect(comments[0]?.text).toContain('line 199');
  });
});
