// @code-analyzer/intelligence — reading the second reader's answer
//
// **The cases are chosen by what a wrong reading costs.** A verdict read as `upheld` when it said `refuted` files a
// comment the reviewer itself rejected; a verdict read as `refuted` when the response was prose deletes a true positive
// and reports it as precision. **So every test below is about a distinction that changes a filed comment**, and the
// three that look pedantic - the fence, the string line number, the missing repair title - are the three ways a real
// provider's answer arrives.

import { describe, it, expect } from 'vitest';

import {
  applyVerdict,
  readAdjudication,
  resolveAnchor,
  ADJUDICATION_VERDICTS,
} from '../../review/adjudication/verdict.js';

import type { LLMFinding } from '../../review/llm/prompts.js';

function candidate(overrides: Partial<LLMFinding> = {}): LLMFinding {
  return {
    startLine: 10,
    endLine: 12,
    severity: 'medium',
    category: 'bug',
    title: 'the claim',
    description: 'the description',
    suggestion: 'the fix',
    ...overrides,
  };
}

const ADDED = new Set([11, 12, 13]);

describe('readAdjudication', () => {
  it('reads an upheld verdict and its line', () => {
    const read = readAdjudication('{"verdict":"upheld","line":12,"reason":"the guard is missing"}');
    expect(read).toEqual({
      kind: 'verdict',
      verdict: { verdict: 'upheld', line: 12, reason: 'the guard is missing', repair: null },
    });
  });

  it('reads a verdict wrapped in a code fence', () => {
    // Providers that were told "JSON only" fence it anyway, and a parser that refuses the fence converts a provider
    // habit into a deletion.
    const read = readAdjudication(
      '```json\n{"verdict":"refuted","reason":"it restates the diff"}\n```',
    );
    expect(read.kind).toBe('verdict');
    expect(read.kind === 'verdict' && read.verdict.verdict).toBe('refuted');
  });

  it('reads an answer that is fenced but never closed', () => {
    // A model that opened a fence and stopped. The body is still JSON, and refusing it would delete a finding over a
    // punctuation mark.
    const read = readAdjudication('```json\n{"verdict":"upheld","reason":"holds"}');
    expect(read.kind === 'verdict' && read.verdict.verdict).toBe('upheld');
  });

  it('does not treat a bare fence as an answer', () => {
    // `unfence` with no newline: there is no body, and the text is handed on unchanged for the parser to refuse.
    expect(readAdjudication('```').kind).toBe('unreadable');
  });

  it('refuses a verdict that arrived as an object or as a non-finite number', () => {
    // **`String({})` is `"[object Object]"`**, which would fail the vocabulary check for a reason nobody chose. Reading
    // only strings and finite numbers makes the refusal deliberate.
    expect(readAdjudication('{"verdict":{"name":"upheld"}}').kind).toBe('unreadable');
    expect(readAdjudication('{"verdict":5,"reason":"x"}').kind).toBe('unreadable');
  });

  it('accepts a refutation with no reason', () => {
    // Refusing this would file the comment, and a filed invention is the failure this repository cannot afford.
    const read = readAdjudication('{"verdict":"refuted"}');
    expect(read.kind).toBe('verdict');
    expect(read.kind === 'verdict' && read.verdict.reason).toBe('');
  });

  it('reads a line that arrived as a string', () => {
    const read = readAdjudication('{"verdict":"upheld","line":"12","reason":"ok"}');
    expect(read.kind === 'verdict' && read.verdict.line).toBe(12);
  });

  it('refuses a zero or negative line rather than anchoring on it', () => {
    // `Number(null)` is 0 and 0 is finite; a range written as line zero would be measured against every golden.
    // **`NaN` is not in this list on purpose**: it is not valid JSON, so the response is `unreadable` for a different
    // reason, and a test that mixed the two would pass while the number reader was broken.
    for (const line of ['0', '-4', 'null', '""', '"x"']) {
      const read = readAdjudication(`{"verdict":"upheld","line":${line},"reason":"ok"}`);
      expect(read.kind === 'verdict' && read.verdict.line).toBeNull();
    }
  });

  it('reads a repair with its four fields', () => {
    const read = readAdjudication(
      JSON.stringify({
        verdict: 'repaired',
        line: 12,
        reason: 'the defect here is the missing bounds check',
        title: 'index past the end of the buffer',
        description: 'Size comes from the header and is never compared with the buffer length.',
        severity: 'high',
        category: 'bug',
        suggestion: 'compare size with buffer.length before the copy',
      }),
    );
    expect(read.kind).toBe('verdict');
    if (read.kind !== 'verdict') return;
    expect(read.verdict.repair).toEqual({
      title: 'index past the end of the buffer',
      description: 'Size comes from the header and is never compared with the buffer length.',
      severity: 'high',
      category: 'bug',
      suggestion: 'compare size with buffer.length before the copy',
    });
  });

  it('refuses a repair that carries no sentence', () => {
    // A repair with no title is a refutation wearing a promotion: it would replace a comment that said something with
    // one that says nothing, which is the one outcome strictly worse than dropping it.
    expect(readAdjudication('{"verdict":"repaired","line":11,"reason":"x"}').kind).toBe(
      'unreadable',
    );
    expect(
      readAdjudication('{"verdict":"repaired","line":11,"title":"t","description":"  "}').kind,
    ).toBe('unreadable');
  });

  it('reports an unknown verdict as unreadable rather than as a refutation', () => {
    const read = readAdjudication('{"verdict":"maybe","reason":"unsure"}');
    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' && read.why).toContain('maybe');
  });

  it('reports a missing response as unreadable rather than throwing', () => {
    // The signature says `string`; JavaScript disagrees, and a provider adapter that returns nothing must produce a
    // refusal rather than a crash inside a review.
    expect(readAdjudication(undefined as unknown as string).kind).toBe('unreadable');
  });

  it('reports prose, JSON arrays and empty input as unreadable', () => {
    for (const raw of ['I think this is fine.', '[]', '', 'null', '{"verdict":']) {
      expect(readAdjudication(raw).kind).toBe('unreadable');
    }
  });

  it('declares its three verdicts as a value a schema can be checked against', () => {
    expect([...ADJUDICATION_VERDICTS]).toEqual(['upheld', 'refuted', 'repaired']);
  });
});

describe('resolveAnchor', () => {
  it('anchors on a line the diff added', () => {
    expect(resolveAnchor(12, { startLine: 10, endLine: 12 }, ADDED)).toEqual({
      startLine: 12,
      endLine: 12,
    });
  });

  it('keeps the overlap when the verdict line is not an added line', () => {
    // A comment about a construct that starts on context lines and continues into added ones is about the added ones.
    expect(resolveAnchor(9, { startLine: 10, endLine: 12 }, ADDED)).toEqual({
      startLine: 11,
      endLine: 12,
    });
  });

  it('refuses a comment with no added line at all', () => {
    expect(resolveAnchor(null, { startLine: 1, endLine: 4 }, ADDED)).toBeNull();
  });

  it('refuses everything when the patch added nothing', () => {
    expect(resolveAnchor(11, { startLine: 11, endLine: 11 }, new Set())).toBeNull();
  });

  it('applies no constraint when the added lines are unknown', () => {
    // **The case a code window produces**, and the reason `null` is not an empty set: a review handed a file body has
    // no patch to read, and refusing every comment in it would be a coordinate defect reported as precision.
    expect(resolveAnchor(12, { startLine: 10, endLine: 12 }, null)).toEqual({
      startLine: 12,
      endLine: 12,
    });
    expect(resolveAnchor(null, { startLine: 10, endLine: 12 }, null)).toEqual({
      startLine: 10,
      endLine: 12,
    });
  });

  it('refuses a range with no positive line when the constraint is unknown', () => {
    expect(resolveAnchor(null, { startLine: 0, endLine: 0 }, null)).toBeNull();
  });

  it('reads the original range whichever way round it was written', () => {
    expect(resolveAnchor(null, { startLine: 12, endLine: 10 }, ADDED)).toEqual({
      startLine: 11,
      endLine: 12,
    });
  });
});

describe('applyVerdict', () => {
  it('files an upheld finding unchanged except for its range', () => {
    const applied = applyVerdict(
      candidate(),
      { verdict: 'upheld', line: 12, reason: '', repair: null },
      ADDED,
    );
    expect(applied.kind).toBe('kept');
    if (applied.kind !== 'kept') return;
    expect(applied.finding.title).toBe('the claim');
    expect(applied.finding).toMatchObject({ startLine: 12, endLine: 12 });
    expect(applied.finding.repaired).toBeUndefined();
    expect(applied.anchored).toBe(true);
  });

  it('says when an upheld finding was re-anchored', () => {
    const applied = applyVerdict(
      candidate(),
      { verdict: 'upheld', line: 9, reason: '', repair: null },
      ADDED,
    );
    expect(applied.kind === 'kept' && applied.anchored).toBe(true);
    const same = applyVerdict(
      candidate({ startLine: 11, endLine: 12 }),
      { verdict: 'upheld', line: null, reason: '', repair: null },
      ADDED,
    );
    expect(same.kind === 'kept' && same.anchored).toBe(false);
  });

  it('drops a refuted finding with its reason', () => {
    const applied = applyVerdict(
      candidate(),
      { verdict: 'refuted', line: null, reason: 'the guard exists at line 9', repair: null },
      ADDED,
    );
    expect(applied).toEqual({
      kind: 'dropped',
      why: 'refuted',
      reason: 'the guard exists at line 9',
    });
  });

  it('drops a finding that cannot be anchored, and says which rule did it', () => {
    // **Neither the verdict's line nor the original range touches a line the diff added.** This is the outcome a
    // reviewer with a coordinate defect produces, and it is counted rather than absorbed into precision.
    const applied = applyVerdict(
      candidate({ startLine: 1, endLine: 2 }),
      { verdict: 'upheld', line: 1, reason: '', repair: null },
      ADDED,
    );
    expect(applied).toMatchObject({ kind: 'dropped', why: 'unanchored' });
  });

  it('re-anchors on the overlap when only the original range touches added lines', () => {
    const applied = applyVerdict(
      candidate({ startLine: 10, endLine: 12 }),
      { verdict: 'upheld', line: 3, reason: '', repair: null },
      ADDED,
    );
    expect(applied.kind === 'kept' && applied.finding).toMatchObject({
      startLine: 11,
      endLine: 12,
    });
  });

  it('treats a missing verdict as a refutation rather than filing an unchecked comment', () => {
    expect(applyVerdict(candidate(), null, ADDED)).toMatchObject({
      kind: 'dropped',
      why: 'refuted',
    });
  });

  it('files a repair with the new sentence and marks it', () => {
    const applied = applyVerdict(
      candidate({ lane: 'maintainability' }),
      {
        verdict: 'repaired',
        line: 12,
        reason: 'the defect here is the missing bounds check',
        repair: {
          title: 'index past the end of the buffer',
          description: 'Size is never compared with the buffer length.',
          severity: 'high',
          category: 'bug',
          suggestion: 'compare first',
        },
      },
      ADDED,
    );
    expect(applied.kind).toBe('kept');
    if (applied.kind !== 'kept') return;
    expect(applied.finding).toMatchObject({
      title: 'index past the end of the buffer',
      severity: 'high',
      category: 'bug',
      suggestion: 'compare first',
      repaired: true,
      // **The lane is kept**, because a repair is the same reviewer's finding with a better sentence and attributing it
      // to the second reader would double count one defect across two lanes.
      lane: 'maintainability',
    });
  });

  it('says so when a refutation carried no reason at all', () => {
    // The second `??` in the file: a refuted verdict with an empty sentence still has to name why it is on the record.
    const applied = applyVerdict(
      candidate(),
      { verdict: 'refuted', line: null, reason: '', repair: null },
      ADDED,
    );
    expect(applied).toEqual({
      kind: 'dropped',
      why: 'refuted',
      reason: 'refuted without a reason',
    });
  });

  it('keeps the original fields a repair did not answer', () => {
    const applied = applyVerdict(
      candidate({ severity: 'low', category: 'style' }),
      {
        verdict: 'repaired',
        line: 12,
        reason: '',
        repair: { title: 't', description: 'd', suggestion: null },
      },
      ADDED,
    );
    expect(applied.kind === 'kept' && applied.finding).toMatchObject({
      severity: 'low',
      category: 'style',
      suggestion: 'the fix',
    });
  });
});
