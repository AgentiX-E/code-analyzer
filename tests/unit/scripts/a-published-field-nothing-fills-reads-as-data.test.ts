// A published field that nothing fills reads as data, and the artifact cannot tell the difference
//
// **The defect this exists for.** The 2026-11-22 artifact published `existingCode: ""` on all 591 rows, beside a comment
// claiming the field was the code the finding is about and the only way a paid run's grounding gate could be replayed.
// The harness was reading `entry.finding.existingCode`; `LLMFinding` declares `snippet`, and every lane leaves it unset.
// So a missing field and an empty field became one fact, and the artifact said "this reviewer quoted no code" when the
// truth was "this harness asked the wrong object for five iterations".
//
// **The repair is not the value, it is the provenance.** `existingCodeFrom` names what filled the field, so `none` is a
// fact about the reviewer and `snippet` is a fact about the harness, and a reader no longer has to guess which it has.

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_VERSION,
  QUOTATION_FIELD,
  evidenceSummary,
  quotationOf,
} from '../../../.github/scripts/lib/published-evidence.mjs';

describe('the quotation a row publishes', () => {
  it('takes it from the field `LLMFinding` declares', () => {
    const evidence = quotationOf({ snippet: 'const a = source.item;', title: 'a claim' });
    expect(evidence.existingCode).toBe('const a = source.item;');
    expect(evidence.existingCodeFrom).toBe(QUOTATION_FIELD);
  });

  it('says `none` when the finding carries no quotation, rather than leaving a bare empty string', () => {
    // This is the state of every row at this commit, and **the two cases are not the same fact**: one is a reviewer that
    // quoted nothing, the other is a harness reading a field that does not exist.
    const evidence = quotationOf({ title: 'a claim with no quotation' });
    expect(evidence.existingCode).toBe('');
    expect(evidence.existingCodeFrom).toBe('none');
  });

  it('refuses the field name that caused the defect, because `existingCode` belongs to the comment and not to the finding', () => {
    // A finding shaped like a `ReviewComment` has `existingCode` and no `snippet`. Reading the comment's field here is
    // exactly the mistake, so the reader must report nothing - and say so - rather than silently publishing a value from
    // an object it was not given.
    const evidence = quotationOf({ existingCode: 'the code the comment carried' });
    expect(evidence.existingCode).toBe('');
    expect(evidence.existingCodeFrom).toBe('none');
  });

  it('caps the quotation at the length the artifact publishes', () => {
    const evidence = quotationOf({ snippet: 'x'.repeat(5000) });
    expect(evidence.existingCode).toHaveLength(2000);
    expect(evidence.existingCodeFrom).toBe(QUOTATION_FIELD);
  });

  it('treats a non-string quotation as absent instead of coercing it into a misleading value', () => {
    expect(quotationOf({ snippet: 42 }).existingCodeFrom).toBe('none');
    expect(quotationOf(null).existingCodeFrom).toBe('none');
  });
});

describe('the evidence summary published beside the rows', () => {
  it('counts the rows that carry evidence and the rows that do not', () => {
    const summary = evidenceSummary([
      { existingCode: 'a', existingCodeFrom: 'snippet' },
      { existingCode: '', existingCodeFrom: 'none' },
      { existingCode: '', existingCodeFrom: 'none' },
    ]);
    expect(summary.rows).toBe(3);
    expect(summary.quoted).toBe(1);
    expect(summary.none).toBe(2);
  });

  it('names the field and the version, so a figure can be tied to the shape that produced it', () => {
    const summary = evidenceSummary([]);
    expect(summary.version).toBe(EVIDENCE_VERSION);
    expect(summary.field).toBe(QUOTATION_FIELD);
    expect(summary.rows).toBe(0);
  });

  it('carries the distinction a gate replay needs, in words, because an empty quotation is not a reviewer shown no code', () => {
    const note = evidenceSummary([]).note;
    expect(note).toContain('no quotation');
    expect(note).toContain('wrong field');
  });
});
