/**
 * **A head-to-head in which only one artifact names the question is not shown to be a head-to-head.**
 *
 * The competitor's baseline records the judge prompt as a version (`aacr-judge-v1`) because a figure is reusable only
 * while the question stays the same. Our own artifact recorded the model and the endpoint and **not the prompt**, so the
 * claim "both sides were scored by the same judge" rested on a shared model name - which is the weakest form of the
 * claim, and the one a prompt rewrite would leave standing after it stopped being true.
 *
 * Two assertions, and the second is the one that bites: the field must be written from the imported constant rather than
 * typed, and **the constant must still match the version frozen inside the baseline** - because bumping the prompt
 * without re-recording the competitor makes every later comparison a comparison of two questions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BASELINE_VERSION, JUDGE_PROMPT_VERSION } from '../../../.github/scripts/lib/competitor-baseline.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const BASELINE = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks', 'aacr', 'competitor-baseline.json'), 'utf8'),
) as { version: number; corpus: { judge: { model: string; prompt: string } } };

describe('the head-to-head names the question both sides answered', () => {
  it('writes the judge prompt into our artifact from the constant and not from a literal', () => {
    expect(BENCH).toMatch(/JUDGE_PROMPT_VERSION,/u);
    expect(BENCH).toMatch(/judge: \{ model: MODEL, endpoint: BASE, prompt: JUDGE_PROMPT_VERSION \}/u);
    // A typed version is a second source of truth for the same fact, and the second one is the one that goes stale.
    expect(BENCH).not.toMatch(/prompt: 'aacr-judge-v1'/u);
  });

  it('still agrees with the version frozen inside the recorded baseline', () => {
    expect(BASELINE.version).toBe(BASELINE_VERSION);
    expect(BASELINE.corpus.judge.prompt).toBe(JUDGE_PROMPT_VERSION);
  });
});
