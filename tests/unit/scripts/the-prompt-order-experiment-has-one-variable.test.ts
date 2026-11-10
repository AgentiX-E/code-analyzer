// **An experiment whose arms are two spellings of the same setting is not an experiment.**
//
// The prompt order is now a measured variable: `boilerplate-first` raised prefix reuse from 61 % to 91.7 % and cut the
// reviewer's bill from 1.41 USD to 0.29 USD, and the first run that measured quality as well read **F1 0.1691 where the
// previous ordering read 0.2405**. Whether that is a regression or run-to-run variance is a question only a second run
// answers, and the second run is only worth anything if it differs in exactly one thing.
//
// **The dispatch's `choice` list and the engine's union are the same three strings written in two files.** A typo in
// either would run the fallthrough order while the artifact recorded a name nobody implemented - **an experiment that
// measures the wrong arm and says so in its own metadata**, which is worse than no experiment.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROMPT_ORDERS } from '../../../packages/intelligence/src/review/llm/prompts.js';

const workflow = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
  'utf8',
);

/** The options of the `prompt_order` dispatch input, read out of the YAML without a YAML parser in the test. */
function promptOrderOptions(): string[] {
  const block = /prompt_order:[\s\S]*?options: \[([^\]]+)\]/.exec(workflow);
  if (!block) throw new Error('the aacr-bench workflow declares no prompt_order options');
  return block[1]!.split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, ''));
}

describe('the dispatch input and the engine offer the same three orders', () => {
  it('lists exactly the orders the engine implements, in the same set', () => {
    expect(promptOrderOptions().sort()).toEqual([...PROMPT_ORDERS].sort());
  });

  it('defaults to the order the artifact will record when nobody chooses', () => {
    // **The default is part of the experiment too**: a dispatch that picks nothing must produce the arm whose name the
    // artifact carries, or the two runs differ in the default as well as in the choice.
    const declared = /prompt_order:[\s\S]*?default: ([a-z-]+)/.exec(workflow);
    expect(declared?.[1]).toBe('boilerplate-first');
    expect(PROMPT_ORDERS).toContain('boilerplate-first');
  });

  it('passes the choice through to the process the script reads', () => {
    expect(workflow).toContain(
      "AACR_PROMPT_ORDER: ${{ inputs.prompt_order || 'boilerplate-first' }}",
    );
  });
});
