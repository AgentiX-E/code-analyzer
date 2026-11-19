// @code-analyzer/intelligence — the budget the benchmark runs at is the budget the product ships at
//
// **A number that describes a configuration nobody ships is a number about the past.** `DEFAULT_PULL_REQUEST_BUDGET`
// lives in the engine, and the benchmark's arm sets its own `PR_BUDGET` in a `.mjs` script that cannot import a TypeScript
// constant without a build step in front of it. **Two numbers that must agree and cannot see each other drift apart** -
// slowly, silently, and in the direction of whichever one was edited last, which is the failure mode this repository has
// already paid for once in `gate:wiring`.
//
// **The test reads both files and compares the defaults**, which is the only assertion that can hold without a build:
// the constant is 12 in the engine, the script's fallback is 12, and `PR_BUDGET` may still override either at run time
// because an override is a decision a runner makes on purpose.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PULL_REQUEST_BUDGET } from '../llm-review-engine.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('the pull-request budget', () => {
  it('is the number the benchmark arm runs at', () => {
    const script = read('.github/scripts/aacr-bench.mjs');
    const declared = /const PR_BUDGET = Number\(process\.env\['PR_BUDGET'\] \?\? '(\d+)'\);/u.exec(
      script,
    );

    expect(
      declared,
      'the benchmark script no longer declares PR_BUDGET in the shape this test reads',
    ).not.toBeNull();
    expect(Number(declared![1])).toBe(DEFAULT_PULL_REQUEST_BUDGET);
  });

  it('is twelve, and the artifact that measured it is on disk', () => {
    // **The number is a measurement, so the file it was measured from has to be present.** A future edit that changes the
    // constant without re-running the replay would otherwise leave no trace of where 12 came from.
    expect(DEFAULT_PULL_REQUEST_BUDGET).toBe(12);
    expect(read('benchmarks/r41b-witness.json')).toContain('"score@12"');
  });

  it('is a budget the replayed curve peaks at', () => {
    // The claim the constant rests on: at 12 the replayed F1 is at least as good as at 8 and at 16. **Asserted rather
    // than described**, because a curve that inverts makes the comment above the constant false.
    const replay = JSON.parse(read('benchmarks/r41b-witness.json')) as {
      budgetCurves: Record<string, { f1: number }>;
    };
    const at = (n: number) => replay.budgetCurves[`score@${String(n)}`]!.f1;

    expect(at(12)).toBeGreaterThanOrEqual(at(8));
    expect(at(12)).toBeGreaterThan(at(16));
  });
});
