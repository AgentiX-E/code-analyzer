// A judge shown a file can say what a judge shown a pair could not
//
// **The protocol the corpus measures is not the one this repository was computing.** `Alibaba-Aone/aacr-bench` publishes
// `file-level-semantic-v1`: one judge call per generated comment, every reference comment of that file in a numbered
// list, and a verdict of the form *which of these does this comment cover* - one-to-many by construction. The harness in
// `aacr-bench.mjs` asks the opposite question, one pair at a time, and the artifact of 2026-11-10 recorded the
// consequence without being able to name it: of 254 reference comments whose file the reviewer did comment on,
// **141 sat on the same line as a finding we had already emitted** and the pairwise judge still called them different
// defects.
//
// **Two things could explain that, and they need different fixes.** Either those 141 are defects we did describe and the
// pairwise question is too narrow to see it, or they are different defects and no wording of the question helps. **Only
// a run answers it, and only if the question is asked the corpus's way** - which is what this file builds and what these
// tests pin: the prompt, the parser, and the rule that one comment may cover several reference comments.
//
// **What is asserted here is expressiveness, not accuracy.** A test can show that the file-level shape can carry a
// verdict the pairwise shape cannot, because that is arithmetic over two fixtures. **It cannot show that the judge will
// recover the 141**, because that is a measurement. The declaration in `docs/EVAL-CONTRACT.md` says which one this is:
// the smoke run buys the reading, and this file makes sure the smoke run is asking the right question when it does.

import { describe, expect, it } from 'vitest';

import {
  FILE_SEMANTIC_JUDGE_PROTOCOL,
  buildFileSemanticJudgeMessages,
  parseFileSemanticCovers,
  planFileSemanticJudgements,
  toGlobalMatches,
} from '../../../.github/scripts/lib/file-semantic-judge.mjs';
import {
  FILE_SEMANTIC_PROTOCOL,
  scoreFileSemantic,
} from '../../../.github/scripts/lib/file-semantic.mjs';

const FINDINGS = [
  { text: 'The session token is compared with `==`, which is not a constant-time comparison.' },
  { text: 'This log line writes the token to stdout.' },
];

const GOLDENS = [
  { path: 'src/auth.ts', line: 42, text: 'Use a constant-time comparison for the session token.' },
  { path: 'src/auth.ts', line: 88, text: 'Missing null check on the principal.' },
];

describe('the protocol this judge implements', () => {
  it('names the same protocol the arithmetic it feeds names', () => {
    // **One string in two modules is a string that can drift**, and a figure labelled with the arithmetic but judged
    // under another protocol is the defect §136 recorded: a measurement quoted for a corpus that does not measure it.
    expect(FILE_SEMANTIC_JUDGE_PROTOCOL).toBe(FILE_SEMANTIC_PROTOCOL);
  });
});

describe('the prompt', () => {
  const messages = buildFileSemanticJudgeMessages({
    path: 'src/auth.ts',
    findings: FINDINGS,
    goldens: GOLDENS,
  });

  it('carries every reference comment of the file, numbered from one', () => {
    // **All of them, in one list**, because that is the whole difference: a judge that sees one reference comment
    // cannot answer "which of these", and a judge that sees the list can.
    expect(messages.system).toContain('1. [line 42]');
    expect(messages.system).toContain('2. [line 88]');
    expect(messages.system).toContain('Use a constant-time comparison for the session token.');
    expect(messages.system).toContain('Missing null check on the principal.');
  });

  it('carries the line and the side, which the protocol shows as context rather than as a filter', () => {
    // **Context, not a filter**, the distinction `lib/file-semantic.mjs` states: the corpus shows the diff side and the
    // line number and does not use them to narrow the list, so a comment on line 42 may cover a reference on line 88.
    expect(messages.system).toContain('line 42');
    expect(messages.system).toContain('line 88');
    expect(messages.system).toContain('context, not a constraint');
  });

  it('names the file once, so two files cannot be confused inside one call', () => {
    expect(messages.system.match(/src\/auth\.ts/gu)).toHaveLength(1);
  });

  it('puts the file name inside the cached prefix rather than after the list', () => {
    // **The system message is the block a prefix cache can share**, and every call in a run shares the rubric - so the
    // rubric leads and the file name joins it. A file name in the user message would have been cached only up to the
    // rubric, which is under one cache block.
    expect(messages.system).toContain('src/auth.ts');
  });

  it('asks for one integer list per finding, in the shape the parser reads', () => {
    expect(messages.user).toMatch(/covers/);
    expect(messages.user).toContain('2');
  });
});

describe('the parser', () => {
  it('reads one list of covered reference comments per finding', () => {
    expect(parseFileSemanticCovers('{"covers":[[1],[]]}', 2, 2)).toEqual([[1], []]);
  });

  it('reads a comment that covers several reference comments, which is the whole point', () => {
    // **One-to-many is not a tolerance, it is the metric.** The corpus counts one generated comment covering three
    // restated reference comments as one emission that recalled three.
    expect(parseFileSemanticCovers('{"covers":[[1,2]]}', 1, 2)).toEqual([[1, 2]]);
  });

  it('sorts and deduplicates, so an order the model chose cannot change the score', () => {
    expect(parseFileSemanticCovers('{"covers":[[2,1,2]]}', 1, 2)).toEqual([[1, 2]]);
  });

  it('refuses an answer that is not one list per finding', () => {
    // **A short list is a model that stopped reading**, and padding it with `[]` would record the unread comments as
    // having covered nothing - the failure this repository has paid for twice, in the batch arm and in the warm pass.
    expect(parseFileSemanticCovers('{"covers":[[1]]}', 2, 2)).toBeNull();
    expect(parseFileSemanticCovers('{"covers":[]}', 2, 2)).toBeNull();
  });

  it('refuses a reference comment that does not exist', () => {
    // **An out-of-range index is a verdict about nothing**, and accepting it would make a recall figure depend on a
    // number the judge invented. The whole answer is refused rather than the row, for the reason the batch arm refuses
    // the whole batch: a partially read answer is a partially invented one.
    expect(parseFileSemanticCovers('{"covers":[[3]]}', 1, 2)).toBeNull();
    expect(parseFileSemanticCovers('{"covers":[[0]]}', 1, 2)).toBeNull();
  });

  it('refuses a coordinate that is not an integer', () => {
    expect(parseFileSemanticCovers('{"covers":[["1"]]}', 1, 2)).toBeNull();
    expect(parseFileSemanticCovers('{"covers":[[1.5]]}', 1, 2)).toBeNull();
  });

  it('refuses text that is not JSON, and JSON that is not the shape', () => {
    expect(parseFileSemanticCovers('not json', 1, 2)).toBeNull();
    expect(parseFileSemanticCovers('{"matches":[[1]]}', 1, 2)).toBeNull();
    expect(parseFileSemanticCovers('{"covers":"1"}', 1, 2)).toBeNull();
    expect(parseFileSemanticCovers('{"covers":[[{}]]}', 1, 2)).toBeNull();
  });
});

describe('a verdict the pairwise shape cannot carry', () => {
  it('turns a covered reference comment into a match the arithmetic counts', () => {
    // **The arithmetic is not changed by this file.** `scoreFileSemantic` already knows how to count one comment covering
    // several reference comments; what was missing was a judge that could *say* it. The two fixtures below are the two
    // shapes, scored by the same function.
    const covers = parseFileSemanticCovers('{"covers":[[1],[]]}', 2, 2);
    expect(covers).not.toBeNull();

    const fileLevel = scoreFileSemantic({
      findings: FINDINGS.map((finding) => ({ path: 'src/auth.ts', text: finding.text })),
      goldens: GOLDENS,
      matches: toGlobalMatches({
        covers: covers!,
        findingIndices: [0, 1],
        goldenIndices: [0, 1],
      }),
    });

    // **The same finding set, scored as the pairwise arm scored it**: the judge said no to both pairs.
    const pairwise = scoreFileSemantic({
      findings: FINDINGS.map((finding) => ({ path: 'src/auth.ts', text: finding.text })),
      goldens: GOLDENS,
      matches: [[], []],
    });

    expect(fileLevel.coveredGoldens).toBe(1);
    expect(fileLevel.hitNewGt).toBe(1);
    expect(fileLevel.f1).toBeGreaterThan(pairwise.f1);
    expect(pairwise.f1).toBe(0);
  });

  it('keeps a covered reference comment out of the numerator when a later comment re-covers it', () => {
    // **The greedy walk is the corpus's precision rule**, and it is why a restated defect costs what a wrong comment
    // costs. A file-level judge that returns the same reference comment for two comments must not score two hits.
    const covers = parseFileSemanticCovers('{"covers":[[1],[1]]}', 2, 2);
    const score = scoreFileSemantic({
      findings: [
        { path: 'src/auth.ts', text: 'first' },
        { path: 'src/auth.ts', text: 'restated' },
      ],
      goldens: [GOLDENS[0]!],
      matches: toGlobalMatches({ covers: covers!, findingIndices: [0, 1], goldenIndices: [0] }),
    });
    expect(score.hitNewGt).toBe(1);
    expect(score.duplicateHits).toBe(1);
  });
});

describe('the price, which is the reason to ask the corpus\u2019s question', () => {
  it('groups by file rather than by pair, so a file is one call and not one call per reference comment', () => {
    const plan = planFileSemanticJudgements([
      {
        pr: 'owner/repo#1',
        findings: [
          { path: 'src/auth.ts', text: 'a' },
          { path: 'src/auth.ts', text: 'b' },
          { path: 'src/db.ts', text: 'c' },
        ],
        goldens: [
          { path: 'src/auth.ts', line: 1, text: 'g1' },
          { path: 'src/auth.ts', line: 2, text: 'g2' },
          { path: 'src/db.ts', line: 5, text: 'g3' },
        ],
      },
    ]);
    // **Three pairs would have been three calls and this is two**, because `src/auth.ts` is one list - and on the corpus
    // that ratio is the difference between 14 892 calls and the number of files the reviewer commented on.
    expect(plan).toHaveLength(2);
    expect(plan.map((job) => job.path)).toEqual(['src/auth.ts', 'src/db.ts']);
    expect(plan[0]!.findings).toHaveLength(2);
    expect(plan[0]!.goldens).toHaveLength(2);
  });

  it('asks nothing about a file with no reference comments, which no verdict could improve', () => {
    const plan = planFileSemanticJudgements([
      {
        pr: 'owner/repo#1',
        findings: [{ path: 'src/auth.ts', text: 'a' }],
        goldens: [{ path: 'src/db.ts', line: 5, text: 'g3' }],
      },
    ]);
    // **A call whose list is empty is a call that cannot change a figure**: precision counts every emission without
    // asking, so the file with no reference comment is already scored.
    expect(plan).toHaveLength(0);
  });

  it('normalises the path, so a diff prefix does not buy a second call', () => {
    const plan = planFileSemanticJudgements([
      {
        pr: 'owner/repo#1',
        findings: [{ path: 'a/src/auth.ts', text: 'a' }],
        goldens: [{ path: 'src/auth.ts', line: 1, text: 'g1' }],
      },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.path).toBe('src/auth.ts');
    expect(plan[0]!.goldenIndices).toEqual([0]);
    expect(plan[0]!.findingIndices).toEqual([0]);
  });
});
