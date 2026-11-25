import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **A comparison against a competitor that was not bought, and the three readings it took down with it.**
 *
 * Run `45629019118` bought no competitor arm (`competitor: off`) and reviewed fifty pull requests successfully. The
 * paired-scoring step ran anyway, because its condition asked whether `benchmarks/aacr/competitor-baseline.json` exists
 * - **and that path is a tracked file**, so the condition was true in every checkout and said nothing about this run. It
 * threw `the two artifacts share no pull request`, and because three later steps carried no status function, GitHub read
 * them as `success() && …` and skipped them: the selection ceiling, the score-term ablation, and the Martian profile.
 * **The job went red on a question nobody asked, and the readings the dispatch was bought for were never taken.**
 *
 * That is §155's defect in a second place - *a verdict that destroys its evidence leaves nothing to be judged* - so the
 * two halves of the repair are asserted here: **the comparison runs only when there is something to compare**, and
 * **a reading that asks the artifact about itself is never gated on another step's verdict.**
 */
const WORKFLOW = readFileSync(
  resolve(__dirname, '../../../.github/workflows/aacr-bench.yml'),
  'utf8',
);

interface Step {
  readonly name: string;
  readonly condition: string | null;
}

/** The workflow's steps, by name, with the `if:` line each one carries - absent meaning implicit `success() && …`. */
function steps(): Step[] {
  const found: Step[] = [];
  let current: { name: string; condition: string | null } | null = null;
  for (const line of WORKFLOW.split('\n')) {
    const name = /^\s{6}- name: (.+)$/.exec(line);
    if (name) {
      if (current) found.push(current);
      current = { name: (name[1] ?? '').trim(), condition: null };
      continue;
    }
    const condition = /^\s{8}if: (.+)$/.exec(line);
    if (condition && current && current.condition === null) {
      current.condition = (condition[1] ?? '').trim();
      continue;
    }
    // A new list item that is not a name starts a different kind of step; its conditions are not this step's.
    if (/^\s{6}- /.test(line) && current) {
      found.push(current);
      current = null;
    }
  }
  if (current) found.push(current);
  return found;
}

function stepNamed(prefix: string): Step {
  const match = steps().filter((step) => step.name.startsWith(prefix));
  expect(match, `no step starting "${prefix}"`).toHaveLength(1);
  const [found] = match;
  if (!found) throw new Error(`no step starting "${prefix}"`);
  return found;
}

describe('a comparison that needs a competitor runs only when one was bought', () => {
  it('does not pair our rows with a baseline when the arm was switched off', () => {
    const comparison = stepNamed(
      'Score this run against the competitor on the rows both of them hold',
    );
    expect(comparison.condition).not.toBeNull();
    // The file check alone was the defect: the path is tracked, so it is present in every run including the ones that
    // bought nothing. **The arm's own switch is the only statement about this run.**
    expect(comparison.condition).toContain("inputs.competitor != 'off'");
    expect(comparison.condition).toContain('hashFiles(');
  });
});

describe('a reading about our own artifact is never gated on the comparison', () => {
  const ourOwnReadings = [
    'Say how much of the answer key a better selector could still reach',
    'score_terms',
    'martian_profile',
    'Price the cut this board',
    'Upload the figure',
  ];

  it.each(ourOwnReadings)('%s runs whenever our arm produced an artifact', (name) => {
    const step = stepNamed(name);
    expect(step.condition, `${name} has no if, so a red neighbour can skip it`).not.toBeNull();
    // **`always()` and the replay proof**: the artifact is evidence, and a step that reads it does not need any other
    // step's opinion to be allowed to.
    expect(step.condition).toContain('always()');
    expect(step.condition).toContain('steps.replay.outcome');
  });
});
