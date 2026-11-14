// @code-analyzer/intelligence — the narration veto's own tests
//
// **Every case below is a sentence this repository actually filed.** They are transcribed from
// `benchmarks/aacr-bench.json`'s `rankedFindings`, not invented, because a rule written against invented examples is a
// rule written against the author's imagination - and the four rules this module *lost* were lost by reading exactly
// these rows against the corpus's answer key.

import { describe, it, expect } from 'vitest';

import { applyNarrationVeto, readNarration } from '../../review/adjudication/narration.js';

describe('readNarration', () => {
  describe('refuses a restatement of the diff', () => {
    it('refuses an API-change headline', () => {
      const read = readNarration({
        title: 'Public API breaking change: RefType enum converted to scoped enum',
        description: 'The enum was converted from unscoped to scoped.',
      });
      expect(read).toEqual({ narration: true, reason: 'restates-change', rule: 'api-change' });
    });

    it('refuses an API-change headline that opens with the path rather than the words', () => {
      const read = readNarration({
        title: 'Public API change: getStyle/setStyle/getPrefArrowStyle/getOverlapAdjust signatures',
        description: 'The return types were changed to the new enum.',
      });
      expect(read.narration).toBe(true);
    });

    it('refuses a signature change stated anywhere in the title', () => {
      const read = readNarration({
        title: 'prettyPrint signature changed from value to pointer',
        description: 'An internal API signature changed.',
      });
      expect(read.narration).toBe(true);
    });

    it('refuses an entity that was added', () => {
      const read = readNarration({
        title: 'Public API change: added default constructor to exported class',
        description: 'A new member was added to the exported class.',
      });
      expect(read.narration).toBe(true);
    });

    it('refuses an overload whose argument order moved', () => {
      const read = readNarration({
        title: 'getTopoShape overload argument order changed: sub passed as options',
        description: 'Two positional parameters swapped places.',
      });
      expect(read.narration).toBe(true);
    });
  });

  describe('keeps a claim that happens to use a change verb', () => {
    it('keeps "no longer invalidated", because that is a consequence', () => {
      // **The row that removed a rule.** "no longer" was a restatement pattern for one draft, and this comment - a real
      // true positive on this corpus - contains it. A rule that refuses it refuses a claim about the code.
      const read = readNarration({
        title: 'Auth nonce is no longer invalidated after validation, enabling replay',
        description: 'A nonce that is validated but not consumed can be replayed.',
      });
      expect(read.narration).toBe(false);
      expect(read.reason).toBeNull();
    });

    it('keeps a comment that restates a change and then says what it breaks', () => {
      const read = readNarration({
        title: 'Public API change: return type of prefBalloonArrow changed from int to ArrowType',
        description:
          'Callers still passing the int constant now silently fall into the default branch.',
      });
      expect(read.narration).toBe(false);
    });

    it('keeps a comment that names a null dereference without any change verb', () => {
      const read = readNarration({
        title: 'geometryRefs3d dereferenced before the 2D branch assigns it',
        description: 'When the selection is not a view reference the vector is empty.',
      });
      expect(read.narration).toBe(false);
    });
  });

  describe('leaves an empty or unusual finding alone', () => {
    it('keeps a finding with no title and no description', () => {
      // **Silence is not evidence.** A comment the lane filed without text is a parse defect, and this module's job is
      // the nine rows the table in the header names - not every row it cannot read.
      expect(readNarration({}).narration).toBe(false);
      expect(readNarration({ title: null, description: null }).narration).toBe(false);
    });

    it('keeps a very short title with no verb in it', () => {
      expect(readNarration({ title: 'Typo' }).narration).toBe(false);
    });
  });
});

describe('applyNarrationVeto', () => {
  it('partitions the list and counts each rule separately', () => {
    const findings = [
      {
        title: 'Public API change: return type changed from int to ArrowType',
        description: 'The type moved.',
      },
      {
        title: 'Auth nonce is no longer invalidated after validation, enabling replay',
        description: 'Replay.',
      },
      { title: 'Public API change: added default constructor', description: 'A member was added.' },
    ];
    const outcome = applyNarrationVeto(findings);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.refused).toHaveLength(2);
    // **`api-change` claims both, and that is the rules' own order rather than a bug**: a sentence that opens with
    // "Public API change:" is refused by the rule that names that headline, before the rule about the entity is asked.
    // The count that matters to a report is how many were refused, not which of two true readings of one sentence won.
    expect(outcome.report).toEqual({
      considered: 3,
      refusedByRule: { 'api-change': 2 },
      kept: 1,
    });
  });

  it('returns the refused findings themselves, not a count', () => {
    // A filter that returns only survivors cannot be audited: the artifact has to be able to say which sentences went.
    const refusedFinding = { title: 'Public API change: RefType converted', description: '' };
    const outcome = applyNarrationVeto([refusedFinding]);
    expect(outcome.refused[0]!.finding).toBe(refusedFinding);
    expect(outcome.refused[0]!.rule).toBe('api-change');
  });

  it('is a partition: kept plus refused is what it was given, for an empty list too', () => {
    const empty = applyNarrationVeto([]);
    expect(empty.kept).toEqual([]);
    expect(empty.report).toEqual({ considered: 0, refusedByRule: {}, kept: 0 });
  });
});
