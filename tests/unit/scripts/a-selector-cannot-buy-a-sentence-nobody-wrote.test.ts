/**
 * **A selector cannot buy a sentence nobody wrote.**
 *
 * Iteration 146 asked the emission five questions and every one came back no: the waste is not redundant (305 shipped
 * comments land in 304 referent clusters, and not one pair of comments is a lexical near-duplicate), the pull request a
 * comment sits in separates buyers from non-buyers at AUC 0.7755 and turns into **−0.0042 F1** when a threshold is fitted
 * out of sample, whether a claim names something the diff touched separates at 0.5132, and every alternative key to the
 * budget's ordering - objects named, agreement - loses to the key the product already ships.
 *
 * What is left is not a selector. It is the question this module answers, and the cases below are the ways the answer can
 * be made to say something it does not.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CEILING_VERSION,
  ceilingLine,
  codeObjectsIn,
  selectionCeiling,
} from '../../../scripts/lib/selection-ceiling.mjs';

const row = (pr: string, goldens: number, covered: number[] = []) => ({ pr, goldens, covered });
/** One answer-key entry. `key` collects them, because a corpus is a list and a single entry is the common mistake. */
const entry = (pullRequest: string, comments: string[]) => ({ pullRequest, comments });
const key = (...entries: { pullRequest: string; comments: string[] }[]) => entries;

describe('what counts as a subject', () => {
  it('reads backticked spans, camel case, snake case and runs of capitals, and nothing else', () => {
    const named = codeObjectsIn(
      'The `parseConfig` call in load_settings returns early, and HTTP_TIMEOUT is ignored: this error is silent.',
    );
    expect([...named].sort()).toEqual(['http_timeout', 'load_settings', 'parseconfig']);
  });

  it('does not read ordinary prose, so two sentences about one topic are not two sentences about one object', () => {
    // **The measure has to refuse this**, or "error" in one sentence and "error" in another would raise the ceiling for
    // a reviewer that said nothing about the same code.
    expect(codeObjectsIn('the error path is not handled').size).toBe(0);
  });

  it('reads a one-character backticked identifier, because a claim quoting `i` is talking about a variable', () => {
    expect([...codeObjectsIn('the loop counter `i` is not advanced')]).toEqual(['i']);
  });
});

describe('the ceiling', () => {
  const findings = [
    { pr: 'p1', path: 'src/a.ts', text: 'the `parseConfig` call ignores `strictMode`' },
    { pr: 'p1', path: 'src/b.ts', text: 'this `retryCount` is never reset' },
  ];

  it('counts a covered reference comment as reachable without asking the lexical question', () => {
    // The reference comment names nothing our sentences name, and it was covered anyway - so it is reachable, and a
    // measure that ran out of vocabulary on it would understate the selector in order to make a point.
    const ceiling = selectionCeiling({
      findings,
      rows: [row('p1', 1, [0])],
      corpus: key(entry('p1', ['Consider verifying whether the behaviour is intended'])),
    });
    expect(ceiling.covered).toBe(1);
    expect(ceiling.unreachable).toBe(0);
    expect(ceiling.ceiling).toBe(1);
  });

  it('calls a reference comment that names no code object unmeasurable, not unreachable', () => {
    const ceiling = selectionCeiling({
      findings,
      rows: [row('p1', 1)],
      corpus: key(entry('p1', ['Consider verifying whether the behaviour is intended'])),
    });
    expect(ceiling.unmeasurable).toBe(1);
    expect(ceiling.unreachable).toBe(0);
    // **And it is outside the ceiling's numerator**, because nothing was shown to reach it either.
    expect(ceiling.ceiling).toBe(0);
  });

  it('calls a reference comment unreachable when no sentence names any of its objects', () => {
    const ceiling = selectionCeiling({
      findings,
      rows: [row('p1', 1)],
      corpus: key(entry('p1', ['Typo in `minimumCouts`: it should be `minimumCounts`'])),
    });
    expect(ceiling.unreachable).toBe(1);
    expect(ceiling.examples[0]?.note).toContain('minimumCouts');
  });

  it('calls the same comment reachable when a sentence of ours names one of its objects', () => {
    const ceiling = selectionCeiling({
      findings,
      rows: [row('p1', 1)],
      corpus: key(entry('p1', ['`retryCount` should be reset when the socket closes'])),
    });
    expect(ceiling.reachableWithoutCoverage).toBe(1);
    expect(ceiling.unreachable).toBe(0);
  });

  it('keeps a pull request that emitted nothing in the denominator, so abstaining cannot raise the ceiling', () => {
    // **The trap this iteration fell into twice.** A pull request whose comments a cut removed still has its answer key.
    // Taking the denominator from the emission would make the ceiling rise every time a rule said nothing - which is the
    // defect §141 found in the row set, one level down from §140.5's subtraction, and the reason the two readings below
    // are not the same number.
    const answerKey = key(
      entry('p1', ['`parseConfig` ignores `strictMode`', '`retryCount` never resets']),
      entry('p2', [
        '`socketTimeout` is not restored',
        '`flush` swallows the error',
        '`reader` is never closed',
      ]),
    );
    const withTheSilentRow = selectionCeiling({
      findings,
      rows: [row('p1', 2), row('p2', 3)],
      corpus: answerKey,
    });
    expect(withTheSilentRow.referenceComments).toBe(5);
    expect(withTheSilentRow.ceiling).toBeCloseTo(2 / 5, 10);

    // The same emission and the same answer key, with the silent pull request dropped from the row set. **Two fifths
    // against one is the size of the mistake a denominator taken from the emission would make.**
    const withoutTheSilentRow = selectionCeiling({
      findings,
      rows: [row('p1', 2)],
      corpus: key(answerKey[0]!),
    });
    expect(withoutTheSilentRow.referenceComments).toBe(2);
    expect(withoutTheSilentRow.ceiling).toBe(1);
  });

  it('refuses a row set whose answer key is a different size than the artifact says', () => {
    expect(() =>
      selectionCeiling({
        findings,
        rows: [row('p1', 5)],
        corpus: key(entry('p1', ['one note'])),
      }),
    ).toThrow(/two answer keys/u);
  });

  it('refuses an empty row set, because zero over zero is not a ceiling', () => {
    expect(() => selectionCeiling({ findings, rows: [], corpus: [] })).toThrow(
      /no reference comment/u,
    );
  });

  it('names its arithmetic, so a figure can be compared against the one that produced it', () => {
    const ceiling = selectionCeiling({
      findings,
      rows: [row('p1', 1)],
      corpus: key(entry('p1', ['`parseConfig` is called twice'])),
    });
    expect(ceiling.version).toBe(CEILING_VERSION);
  });
});

describe('the line a table prints', () => {
  it('carries the denominator, so it cannot be read as a precision', () => {
    const line = ceilingLine({
      version: CEILING_VERSION,
      referenceComments: 452,
      covered: 101,
      reachableWithoutCoverage: 189,
      unmeasurable: 67,
      unreachable: 95,
      ceiling: 290 / 452,
      unreachableShare: 95 / 452,
      examples: [],
    });
    expect(line).toContain('290 of 452');
    expect(line).toContain('64.2%');
    expect(line).toContain('95 name objects no sentence of ours names');
    expect(line).toContain('67 name no object at all');
  });
});

describe('the instrument is wired where the artifact is made', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
    'utf8',
  );

  it('runs the ceiling on every dispatch, against the corpus that dispatch read', () => {
    expect(workflow).toContain('scripts/aacr-selection-ceiling.mjs');
    expect(workflow).toContain('benchmarks/aacr-selection-ceiling.json');
    // **Both boards, because the corpus file is an argument and the workflow is where the choice is made.**
    expect(workflow).toContain('benchmarks/martian/positive_samples.json');
    expect(workflow).toContain('/tmp/aacr-bench/dataset/v1/positive_samples.json');
  });

  it('uploads the figure beside the artifact, or it is a number nobody can download', () => {
    const upload = workflow.slice(workflow.indexOf('name: Upload the figure'));
    expect(upload).toContain('benchmarks/aacr-selection-ceiling.json');
  });
});
