// **A competitor's report is prose, so the parser is a device and the device gets a test.**
//
// The Martian competitor arm (`run-martian-competitor.mjs`) and the AACR arm (`aacr-bench.mjs`) read one format through
// one module, `scripts/lib/ocr-arm.mjs`. **Both figures depend on it recovering what the tool said**, and the failure it
// can hide is asymmetric: a parser that loses findings looks exactly like a tool that found fewer, which is why the
// tool's own declared count is returned beside the parse.
//
// **The sample below is written from the report the tool actually printed** (kept whole in
// `benchmarks/runnable-competitors-outputs/`): a header carrying the count, a separator made of three U+2500 box-drawing
// characters, a bracketed tag whose separator is U+00B7, and sometimes a suggested diff. **The first draft of the
// Martian arm's own self-check wrote `---` and `.` and recovered nothing** - a fixture that agrees with a guess would
// have licensed a parser that cannot read the tool.

import { describe, expect, it } from 'vitest';

import { parseProseReport, reviewRange, shortRepo } from '../../../scripts/lib/ocr-arm.mjs';

const rule = '\u2500\u2500\u2500';
const sample = [
  'Review complete: 2 finding(s) across 35 selected item(s).',
  '',
  `${rule} src/Mod/TechDraw/App/DrawViewPart.cpp:1299-1300 ${rule}`,
  '[bug \u00b7 medium] `angle` is declared uninitialized and only assigned inside the two branches.',
  '-     double angle;',
  '+     double angle = 0.0;',
  '',
  `${rule} src/a.ts:4-4 ${rule}`,
  '[security \u00b7 high] The token is logged in full.',
].join('\n');

describe('the competitor report, read as the shape it is', () => {
  it('recovers the tool’s own declared count and both findings', () => {
    const parsed = parseProseReport(sample);
    expect(parsed.declaredCount).toBe(2);
    expect(parsed.findings).toHaveLength(2);
  });

  it('keeps the file and the line range a finding is anchored to', () => {
    const [first] = parseProseReport(sample).findings;
    expect(first?.path).toBe('src/Mod/TechDraw/App/DrawViewPart.cpp');
    expect(first?.startLine).toBe(1299);
    expect(first?.endLine).toBe(1300);
  });

  it('reads the category and severity out of the bracketed tag', () => {
    const [first, second] = parseProseReport(sample).findings;
    expect([first?.category, first?.severity]).toEqual(['bug', 'medium']);
    expect([second?.category, second?.severity]).toEqual(['security', 'high']);
  });

  it('gathers prose across lines rather than truncating at the first one', () => {
    const [first] = parseProseReport(sample).findings;
    expect(first?.body).toContain('double angle;');
    expect(first?.body).toContain('double angle = 0.0;');
  });

  it('separates the tag line from the body it introduces', () => {
    const [first] = parseProseReport(sample).findings;
    // The tag is metadata and the sentence is the finding; a body that began with `[bug · medium]` would be judged as
    // text the tool did not write as prose.
    expect(first?.body.startsWith('[bug')).toBe(false);
    expect(first?.body.startsWith('`angle` is declared')).toBe(true);
  });

  it('reports a declared count of null when the header is absent, rather than a zero', () => {
    // **Zero and "no header" are different claims**: one says the tool found nothing, the other says this parser cannot
    // check the tool's count. The caller records whichever it got.
    const parsed = parseProseReport(`${rule} a.ts:1-1 ${rule}\n[bug \u00b7 low] x`);
    expect(parsed.declaredCount).toBeNull();
    expect(parsed.findings).toHaveLength(1);
  });

  it('returns nothing for a stream that carries no separator at all', () => {
    // A refusal or a summary with no findings is not a finding; a parser that invented one would put a false positive
    // into a comparison.
    expect(
      parseProseReport('Review complete: 0 finding(s) across 3 selected item(s).').findings,
    ).toEqual([]);
  });

  it('reads the repository out of a pull request URL without a regular expression', () => {
    expect(shortRepo('https://github.com/calcom/cal.com/pull/8087')).toBe('calcom/cal.com');
    expect(shortRepo('https://example.com/nope')).toBeNull();
    expect(shortRepo(null)).toBeNull();
  });
});

describe('a range review refuses before it clones', () => {
  it('refuses a range with no commits, and says which half is missing', () => {
    // **The Martian corpus names neither commit** - its rows carry `githubPrUrl`, a title and the goldens - so this is
    // exactly the refusal a Martian run met until the arm learned to resolve the pair from the pull request resource.
    // It is a sentence rather than a throw because the caller's job is to record it and continue to the next row.
    const outcome = reviewRange({
      url: 'https://github.com/calcom/cal.com/pull/8087',
      source: '',
      target: '',
      endpoint: '',
      key: '',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('the range needs two commits');
  });

  it('refuses a URL that names no repository, without running git', () => {
    // A refusal has to be cheaper than an attempt: this one returns before `mkdtemp`, so a corpus row with a bad URL
    // costs nothing and cannot leave a directory behind.
    const outcome = reviewRange({
      url: 'https://example.com/not-a-pull-request',
      source: 'a'.repeat(40),
      target: 'b'.repeat(40),
      endpoint: '',
      key: '',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('the pull request URL did not name a repository');
  });
});
