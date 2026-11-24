// **A comment that says "line 42" makes the reader go and find line 42.** The engine knew the range and never carried
// the text: `weighFinding` read `finding.snippet`, and the pipeline wrote a snippet only on the posting side, so the
// finding arrived at the scorer with the field empty - measured at **48 of 591 findings quoting the change they were
// about**. These cases pin the resolver that fills it, and they pin the refusals as hard as the answers: **a resolver
// that quotes a context line as evidence would let a review claim to be about a change it never touched.**

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_EXTRACTOR,
  addedTextAt,
  attachEvidence,
  collectDiffFacts,
  evidenceFor,
} from '@code-analyzer/intelligence';

import type { DiffFacts, LLMFinding } from '@code-analyzer/intelligence';

/** One file, one hunk: two lines added at new lines 2 and 3, one line of context either side. */
const HUNK = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,4 @@',
  ' const before = 1;',
  '+const first = 2;',
  '+const second = 3;',
  ' const after = 4;',
].join('\n');

/** Two hunks in one file, so "in file order" cannot be confused with "contiguous". */
const TWO_HUNKS = [
  'diff --git a/src/b.ts b/src/b.ts',
  'index 3333333..4444444 100644',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -1,1 +1,2 @@',
  ' const head = 0;',
  '+const one = 1;',
  '@@ -40,1 +41,2 @@',
  ' const tail = 9;',
  '+const two = 2;',
].join('\n');

const ORIGIN = { commit: 'deadbeef', extractor: EVIDENCE_EXTRACTOR };

function finding(overrides: Partial<LLMFinding> = {}): LLMFinding {
  return {
    startLine: 2,
    endLine: 2,
    severity: 'high',
    category: 'bug',
    title: 'A value is read before it is assigned',
    description: 'The reader sees `first` used on the next line.',
    suggestion: null,
    ...overrides,
  };
}

describe('the text of the change, inside the range the finding names', () => {
  const facts = collectDiffFacts(HUNK);

  it('returns the added lines the range covers', () => {
    expect(addedTextAt(facts, 'src/a.ts', 2, 2)).toBe('const first = 2;');
  });

  it('joins every added line in the range rather than only the first', () => {
    expect(addedTextAt(facts, 'src/a.ts', 2, 3)).toBe('const first = 2;\nconst second = 3;');
  });

  it('normalises an inverted range, which is the same range', () => {
    expect(addedTextAt(facts, 'src/a.ts', 3, 2)).toBe(addedTextAt(facts, 'src/a.ts', 2, 3));
  });

  it('returns only the lines the change added, never the context around them', () => {
    // Lines 1 and 4 exist in the file and are shown by the diff; neither is the change.
    expect(addedTextAt(facts, 'src/a.ts', 1, 1)).toBeNull();
    expect(addedTextAt(facts, 'src/a.ts', 4, 4)).toBeNull();
    expect(addedTextAt(facts, 'src/a.ts', 1, 4)).toBe('const first = 2;\nconst second = 3;');
  });

  it('answers null for a range the change does not reach', () => {
    expect(addedTextAt(facts, 'src/a.ts', 100, 200)).toBeNull();
  });

  it('answers null for a path the diff does not name', () => {
    expect(addedTextAt(facts, 'src/nope.ts', 1, 10)).toBeNull();
  });

  it('keeps the file order of two hunks rather than emitting whichever the map iterates first', () => {
    expect(addedTextAt(collectDiffFacts(TWO_HUNKS), 'src/b.ts', 1, 100)).toBe(
      'const one = 1;\nconst two = 2;',
    );
  });

  it.each([
    ['a fractional start', 1.5, 2],
    ['a fractional end', 1, 2.5],
    ['line zero', 0, 2],
    ['a negative line', -1, 2],
    ['NaN', Number.NaN, 2],
    ['Infinity', Number.POSITIVE_INFINITY, 2],
  ])('refuses %s rather than repairing it into a line', (_label, start, end) => {
    // **A repaired line number would make two components disagree about how many findings were malformed**: the ingest
    // path counts these as `invalidLine`, and a resolver that invented line 1 for them would hide the count.
    expect(addedTextAt(facts, 'src/a.ts', start, end)).toBeNull();
  });

  it('answers null when the path is known and nothing was added to it', () => {
    const onlyContext: DiffFacts = {
      added: new Map(),
      shown: new Map([['src/a.ts', 'const before = 1;']]),
    };
    expect(addedTextAt(onlyContext, 'src/a.ts', 1, 1)).toBeNull();
  });

  it('answers null when the path is present with an empty added set', () => {
    const empty: DiffFacts = { added: new Map([['src/a.ts', new Map()]]), shown: new Map() };
    expect(addedTextAt(empty, 'src/a.ts', 1, 5)).toBeNull();
  });
});

describe('the anchor a finding carries', () => {
  const facts = collectDiffFacts(HUNK);

  it('names the file, the normalised range, the revision and the resolver', () => {
    const evidence = evidenceFor(
      { finding: finding({ startLine: 3, endLine: 2 }), path: 'src/a.ts' },
      facts,
      ORIGIN,
    );
    expect(evidence).toEqual({
      file: 'src/a.ts',
      startLine: 2,
      endLine: 3,
      text: 'const first = 2;\nconst second = 3;',
      commit: 'deadbeef',
      extractor: EVIDENCE_EXTRACTOR,
    });
  });

  it('answers null instead of an anchor with no text', () => {
    expect(
      evidenceFor(
        { finding: finding({ startLine: 1, endLine: 1 }), path: 'src/a.ts' },
        facts,
        ORIGIN,
      ),
    ).toBeNull();
  });

  it('resolves the anchor from the change even when the model wrote its own quotation', () => {
    // The two questions are different: *which lines is this about* has the same answer whoever wrote the quotation.
    const evidence = evidenceFor(
      {
        finding: finding({ snippet: 'something the model wrote', snippetSource: 'model' }),
        path: 'src/a.ts',
      },
      facts,
      ORIGIN,
    );
    expect(evidence?.text).toBe('const first = 2;');
  });

  it('names the resolver by a path that exists, so an audit can open the rule', () => {
    expect(EVIDENCE_EXTRACTOR).toBe('review/evidence.addedTextAt');
  });
});

describe('attaching the anchor to the finding', () => {
  const facts = collectDiffFacts(HUNK);

  it('fills the snippet, marks it as the diff’s, and records the evidence', () => {
    const located = { finding: finding(), path: 'src/a.ts' };
    expect(attachEvidence(located, facts, ORIGIN)).toBe(true);
    expect(located.finding.snippet).toBe('const first = 2;');
    expect(located.finding.snippetSource).toBe('diff');
    expect(located.finding.evidence?.text).toBe('const first = 2;');
  });

  it('mutates the finding it was given rather than replacing it', () => {
    // **Identity is load-bearing at the call site**: the pull-request budget filters `result.findings` by object identity
    // and the rank order is a `Map<LLMFinding, number>`. A pure version would detach both and ship an empty review.
    const original = finding();
    const located = { finding: original, path: 'src/a.ts' };
    attachEvidence(located, facts, ORIGIN);
    expect(located.finding).toBe(original);
  });

  it('keeps a quotation the model wrote, and marks where it came from', () => {
    // Overwriting it would destroy the only text the scorer is allowed to read.
    const located = { finding: finding({ snippet: 'const first = 2;' }), path: 'src/a.ts' };
    expect(attachEvidence(located, facts, ORIGIN)).toBe(true);
    expect(located.finding.snippet).toBe('const first = 2;');
    expect(located.finding.snippetSource).toBe('model');
    expect(located.finding.evidence?.text).toBe('const first = 2;');
  });

  it('leaves an already-marked snippet marked as it was', () => {
    const located = { finding: finding({ snippet: 'x', snippetSource: 'diff' }), path: 'src/a.ts' };
    attachEvidence(located, facts, ORIGIN);
    expect(located.finding.snippet).toBe('x');
    expect(located.finding.snippetSource).toBe('diff');
  });

  it('reports false and writes nothing when the change has no lines there', () => {
    const located = { finding: finding({ startLine: 1, endLine: 1 }), path: 'src/a.ts' };
    expect(attachEvidence(located, facts, ORIGIN)).toBe(false);
    expect(located.finding.snippet).toBeUndefined();
    expect(located.finding.snippetSource).toBeUndefined();
    expect(located.finding.evidence).toBeUndefined();
  });

  it('still marks a pre-existing snippet when the change has no lines there', () => {
    // An unmarked snippet predates the distinction, and nothing but the model could have written it.
    const located = {
      finding: finding({ startLine: 1, endLine: 1, snippet: 'quoted' }),
      path: 'src/a.ts',
    };
    expect(attachEvidence(located, facts, ORIGIN)).toBe(false);
    expect(located.finding.snippetSource).toBe('model');
    expect(located.finding.evidence).toBeUndefined();
  });
});
