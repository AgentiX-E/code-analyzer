/**
 * **A call shape that reaches the engine and not the artifact is a figure whose price nobody can explain.**
 *
 * §106.7's ledger splits one fifty-pull-request run into five almost equal lane bills - 1.46 M, 1.36 M, 1.36 M, 1.34 M
 * and 1.34 M prompt tokens - and five equal bills over one corpus is five copies of the diff. `laneMode: 'fused'` asks
 * all five questions in one call, and the arithmetic that says it is worth asking is **21.9 % of the five prompts on one
 * 8 000-character diff**. That number is only a claim about *this product* if the run that produced a figure used the
 * shape its artifact says it used, which is what this file holds.
 *
 * **Three connections, and the two that are deliberately absent.**
 *
 * 1. an environment variable the workflow sets (`AACR_LANE_MODE`);
 * 2. the option passed to the engine, which is what makes the flag a device rather than a log line;
 * 3. the key in `configuration`, which is what lets a reader - and the comparison script - see what varied.
 *
 * **No `matrix` row and no artifact-name suffix**, and the reasons are the two this repository has already paid for.
 * A matrix row is what makes one dispatch produce both arms; a fused arm costs about a fifth of a separate one, so a
 * pair here would be affordable - **but its token side is arithmetic rather than a measurement**, and the run exists to
 * price the accuracy side, which a same-day `separate` artifact already answers. And the name cannot carry an input:
 * `an-artifact-that-is-never-uploaded-is-never-downloaded` forbids it, because a name built from a dispatch input cannot
 * distinguish two arms of one matrix. **One dispatch runs one shape**, so two names would be two names for one artifact.
 *
 * **The refusal is the fourth connection and the one a typo meets first.** `AACR_LANE_MODE=fuze` must throw before a
 * call, not fall through to `separate` - a run that pays for one reviewer and publishes it under another's name is the
 * defect §58.1 recorded, one device later.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configurationBlock } from './configuration-block.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

describe('the call shape is wired from the dispatch to the artifact', () => {
  it('is read from the environment the workflow sets', () => {
    expect(BENCH).toContain("process.env['AACR_LANE_MODE']");
    expect(WORKFLOW).toContain("AACR_LANE_MODE: ${{ inputs.lane_mode || 'separate' }}");
  });

  it('reaches the engine as an option, which is what makes it a device', () => {
    expect(BENCH).toMatch(/laneMode: LANE_MODE,/);
    const start = BENCH.indexOf('new LLMReviewEngine(');
    const options = BENCH.slice(start, BENCH.indexOf('\n  });', start));
    expect(options).toContain('laneMode: LANE_MODE');
  });

  it('is recorded in the artifact, because a figure carries the shape that produced it', () => {
    expect(
      configurationBlock(BENCH),
      'the artifact does not carry the shape its calls were made in',
    ).toContain('laneMode: LANE_MODE');
  });

  it('refuses an unrecognised value before a single call, rather than defaulting to the measured side', () => {
    expect(BENCH).toContain('AACR_LANE_MODE must be one of');
    // **The parser is called at module scope**, so `--dry-run` - which CI runs on every push - meets the typo too.
    expect(BENCH).toMatch(/const LANE_MODE = parseLaneMode\(process\.env\['AACR_LANE_MODE'\]\)/);
  });

  it('is a dispatch input with the measured side as its default', () => {
    const input = WORKFLOW.slice(WORKFLOW.indexOf('      lane_mode:'));
    expect(input.slice(0, 1200)).toContain("options: ['separate', 'fused']");
    expect(input.slice(0, 1200)).toContain("default: 'separate'");
  });
});
