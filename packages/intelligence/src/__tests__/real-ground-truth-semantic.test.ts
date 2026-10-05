// The semantic path measured on the same hundred real issues - the experiment the last measurement argued for.
//
// **Why the semantic path and not more rules.** Three precisely written, precisely tested bug rules produced nine
// findings on a hundred real issues and moved the overlap F1 by nothing (0.2173 to 0.2173). Their nine did not land
// on the lines the humans changed, because those authors were fixing `undefined` and `null` comparisons - and "this
// comparison was wrong" is a property of a line *relative to a requirement*, which a rule that reads only the grammar
// cannot decide. **A model can be asked the question the humans were answering.**
//
// **What this harness is, and what it is not.** It runs the repository's own `LLMReviewEngine` over the same windows
// the heuristic harness uses, and scores the result with the same criterion from `real-ground-truth-scoring.ts`.
// `createDiff` is the same function, so "how a window becomes a diff" has one implementation.
//
// **It does not run without a key, and it says so loudly rather than reporting a zero.** A skipped measurement that
// prints nothing is indistinguishable from a measurement that failed, and this whole stretch has been about that
// difference. With `DEEPSEEK_API_KEY` set it reviews every window; without it, it reports the skip and its cost.
//
//   DEEPSEEK_API_KEY=... npx vitest run --config vitest.config.ts \
//     packages/intelligence/src/__tests__/real-ground-truth-semantic.test.ts
//
// **The number is not expected to be 0.68.** Nobody has measured this path on real code, and the honest reason to run
// it is to find out - the same reason the heuristic measurement was run rather than assumed.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDiff } from '../benchmark/benchmark-runner.js';
import { measure, type Range } from '../benchmark/real-ground-truth-scoring.js';
import { LLMReviewEngine } from '../review/llm/llm-review-engine.js';
import { DeepSeekProvider } from '../review/llm/provider.js';

const DATASET = resolve(process.cwd(), 'benchmarks/real-ground-truth/issues.json');

interface RealIssue {
  id: string;
  files: Array<{ filePath: string; beforeContent: string }>;
  groundTruth: Range[];
}

const HAS_KEY = Boolean(process.env['DEEPSEEK_API_KEY']);

describe('the semantic path against real ground truth', () => {
  it('reports the skip when there is no key, instead of a zero that looks like a result', () => {
    if (!existsSync(DATASET)) {
      // eslint-disable-next-line no-console
      console.log('REAL-SEMANTIC skipped: no dataset extracted yet');
      return;
    }
    const data = JSON.parse(readFileSync(DATASET, 'utf8')) as { count: number };
    // **The skip prints in both branches**, which is the point of the harness. The first version of this line only
    // logged when it *could* run, so a machine without a key saw nothing at all - indistinguishable from a
    // measurement that crashed, which is the confusion this whole stretch has been about.
    // eslint-disable-next-line no-console
    console.log(
      HAS_KEY
        ? `REAL-SEMANTIC running over ${data.count} issues (this one calls a model and is slow)`
        : `REAL-SEMANTIC skipped: no DEEPSEEK_API_KEY, ${data.count} issues not reviewed`,
    );
    expect(data.count).toBeGreaterThan(0);
  });

  it('reviews each window and scores with the same criterion as the heuristic path', async () => {
    if (!existsSync(DATASET) || !HAS_KEY) {
      // **The skip is the assertion.** A harness that silently passes when it cannot run is a harness that reports
      // success for work it did not do.
      expect(HAS_KEY).toBe(false);
      return;
    }

    const data = JSON.parse(readFileSync(DATASET, 'utf8')) as { count: number; issues: RealIssue[] };
    const engine = new LLMReviewEngine(new DeepSeekProvider());

    const findings: Range[] = [];
    const groundTruth: Range[] = [];
    let reviewed = 0;
    let failed = 0;

    for (const issue of data.issues) {
      for (const file of issue.files) {
        // The same construction the heuristic harness uses: the window IS the changed region, so it is `added`.
        const diff = createDiff(file.filePath, 'added', file.beforeContent);
        try {
          for (const lane of await engine.reviewDiff(diff, file.beforeContent)) {
            if (!lane.success) {
              failed += 1;
              continue;
            }
            for (const f of lane.findings) {
              findings.push({
                // **The path is on the review result, not on the finding.** `LLMFinding` carries the lines, the
                // category and the severity; which file they are about is a property of the lane that produced it.
                filePath: lane.filePath || file.filePath,
                startLine: f.startLine,
                endLine: f.endLine,
                category: String(f.category),
              });
            }
          }
          reviewed += 1;
        } catch {
          failed += 1;
        }
      }
      groundTruth.push(...issue.groundTruth);
    }

    const m = measure(findings, groundTruth, false);
    // eslint-disable-next-line no-console
    console.log(
      `REAL-SEMANTIC ${m.f1} (p ${m.precision} r ${m.recall}) on ${data.count} real issues, ` +
        `${findings.length} findings, ${reviewed} windows reviewed, ${failed} lane failures`,
    );

    // **The shapes that must hold whatever the number is.** A run that reviewed nothing, or a metric outside its
    // range, is a broken measurement rather than a bad result - and the point of running this is to trust the answer.
    expect(reviewed).toBeGreaterThan(0);
    expect(findings.length).toBeGreaterThan(0);
    for (const v of [m.precision, m.recall, m.f1]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }, 1_800_000);
});
