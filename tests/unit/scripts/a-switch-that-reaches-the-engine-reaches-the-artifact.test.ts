/**
 * **A switch that reaches the engine and not the artifact is a comparison between two arms that look identical.**
 *
 * §58.1 paid for this lesson already: the merge arm was dispatched, ran, and published under the name an agent-only run
 * uses, so a paired comparison matching on configuration would have compared an arm with itself. The repair then was
 * three lines of wiring. **The repair now is a test, written before the second device that needs the same five
 * connections**, because five is the number that makes forgetting one likely:
 *
 * 1. an environment variable the script reads;
 * 2. the option passed to the engine, which is what makes the flag a device rather than a log line;
 * 3. the key in `configuration`, which is what lets the comparison see what varied;
 * 4. the `matrix` row, which is what makes one dispatch produce both arms;
 * 5. the artifact name and the compute job's download, which is what makes the second arm reachable at all.
 *
 * **Static assertions, on the sources.** Each of the five is a string in a file, and a test that ran the workflow would
 * cost a hundred pull requests to discover a missing key. This one costs nothing and fails on the push that introduces
 * the omission - `an-artifact-that-is-never-uploaded-is-never-downloaded.test.ts` covers (5) from the name side and the
 * matrix side; this file covers the three the artifact carries and the registration that reads them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MECHANISMS, REGISTRATIONS } from '../../../.github/scripts/aacr-ablation-compare.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

describe('the second-concern switch is wired end to end', () => {
  it('is read from the environment the workflow sets', () => {
    expect(BENCH).toContain("process.env['AACR_SECOND_CONCERN']");
    expect(WORKFLOW).toContain('AACR_SECOND_CONCERN: ${{ matrix.second_concern }}');
  });

  it('reaches the engine as an option, which is what makes it a device', () => {
    // **A flag the script reads and does not pass is a flag the artifact records and the reviewer never consults** -
    // the failure mode §45 named for a different device, and the one an env-var reading looks least like.
    expect(BENCH).toMatch(/secondConcern: SECOND_CONCERN,/);
    // **The whole constructor, not a window of it.** This read `slice(0, 600)` until §79 added a fifth option and pushed
    // the key past the window - which is the third time a character count has failed to keep up with an insertion, and
    // the same repair the test below already made. A window measures the file's length; the constructor measures the
    // wiring, which is what the switch is supposed to reach.
    const start = BENCH.indexOf('new LLMReviewEngine(');
    const options = BENCH.slice(start, BENCH.indexOf('\n  });', start));
    expect(options).toContain('secondConcern: SECOND_CONCERN');
  });

  it('is recorded in the artifact, because that is what the comparison sees', () => {
    const configuration = BENCH.slice(BENCH.indexOf('configuration: {'));
    expect(
      configuration.slice(0, 6000),
      'the artifact does not carry the key the comparison prices',
    ).toContain('secondConcern: SECOND_CONCERN');
  });

  it('is published as a merge that did not happen, not only as a total that fell', () => {
    expect(BENCH).toContain('acc.keptAsSecondConcern');
  });
});

describe('the registration is the one the switch is measured against', () => {
  it('exists, and asks for recall rather than for precision', () => {
    const registration = (REGISTRATIONS as unknown as Record<string, Record<string, unknown>>)[
      'secondConcern'
    ];
    expect(
      registration,
      'the switch has no registration, so its run is a diagnostic',
    ).toBeDefined();
    // **The mechanism is the mirror of every other entry**, and that is the point: this device adds comments and cannot
    // raise precision, so a registration that asked it to would be asking a filter to behave like a merge.
    expect(registration!['mechanismRule']).toBe('recall-rises');
    expect(Object.keys(MECHANISMS)).toContain('recall-rises');
    expect(registration!['arm']).toBe('file');
    expect(Number(registration!['registeredGain'])).toBeGreaterThan(0);
  });

  it('names the slice the dispatch will read, so the run can be a confirmation rather than a surprise', () => {
    const registration = (REGISTRATIONS as unknown as Record<string, Record<string, unknown>>)[
      'secondConcern'
    ];
    expect(registration!['confirmation']).toEqual([{ skip: 50, max: 100 }]);
  });
});

describe('the lane-set switch is wired end to end', () => {
  // **The fifth connection this file exists for, and the first one whose switch changes a *question* rather than a
  // filter.** A lane set that reaches the artifact and not the engine is a run that publishes one reviewer's name over
  // another's figure; one that reaches the engine and not the artifact is two arms a comparison cannot tell apart.
  it('is read from the environment the workflow sets', () => {
    expect(BENCH).toContain("process.env['AACR_LANE_SET']");
    expect(WORKFLOW).toContain('AACR_LANE_SET: ${{ matrix.lane_set }}');
  });

  it('refuses an unrecognised value rather than falling through to the default', () => {
    // **A typo answered by a default is a run that pays for one reviewer and publishes another's name**, which is the
    // rule `AACR_PROFILE` already follows and the reason this one does too.
    //
    // **The message names the sets from a list rather than from the refusal itself**, because this assertion used to pin
    // the literal `"shipped" or "behaviour"` and went red the moment a third set existed - **which is the assertion
    // working**, and the reason it now checks the generator rather than the sentence. The list is compared against the
    // module's own keys in `a-lane-set-the-bench-refuses-is-a-set-that-exists.test.ts`.
    expect(BENCH).toMatch(/AACR_LANE_SET must be one of \$\{LANE_SET_NAMES\.join/);
  });

  it('reaches the engine as the lane list, which is what makes it a reviewer rather than a log line', () => {
    // **The whole constructor, not a window of it.** This read `slice(0, 900)` until §78 added a fourth option to the
    // engine and the lane list fell outside the window - a test that fails because the block grew is measuring its own
    // constant rather than the wiring. It now stops at the closing `});`.
    const start = BENCH.indexOf('new LLMReviewEngine(');
    expect(start).toBeGreaterThan(-1);
    const options = BENCH.slice(start, BENCH.indexOf('\n  });', start));
    expect(options).toContain('lanes: [...LANE_SETS[LANE_SET]]');
    // **And the list comes from the module that owns it**, so the five the artifact names and the five the engine calls
    // are one list rather than two copies that agree today.
    expect(BENCH).toContain(
      "await import('../../packages/intelligence/dist/review/llm/prompts.js')",
    );
  });

  it('is recorded in the artifact with the lanes themselves, not only with the name', () => {
    const configuration = BENCH.slice(BENCH.indexOf('configuration: {'));
    expect(configuration.slice(0, 7000)).toContain(
      'laneSet: { name: LANE_SET, lanes: [...LANE_SETS[LANE_SET]] }',
    );
  });

  it('publishes as an arm the workflow uploads and the comparison downloads', () => {
    expect(WORKFLOW).toContain('aacr-bench-advisory-off-off-off-off-off-off-off-behaviour');
  });
});

describe('the registration is the one the lane-set switch is measured against', () => {
  it('asks for recall rather than for precision, and for a bar the corpus can sign', () => {
    const registration = (REGISTRATIONS as unknown as Record<string, Record<string, unknown>>)[
      'laneSet'
    ];
    expect(
      registration,
      'the switch has no registration, so its run is a diagnostic',
    ).toBeDefined();
    expect(registration!['mechanismRule']).toBe('recall-rises');
    expect(registration!['arm']).toBe('file');
    // **0.026 and not 0.021**: 146 rows can sign 0.0255 (§69.2), and a bar under its own resolution is a sentence that
    // cannot be true whatever the device does - the defect §68 had.
    expect(registration!['registeredGain']).toBe(0.026);
  });

  it('names the slice that holds the 146 rows the bar was written for', () => {
    const registration = (REGISTRATIONS as unknown as Record<string, Record<string, unknown>>)[
      'laneSet'
    ];
    // **One dispatch over rows 50-195, which is the union of the two slices R-32 and R-33 read.** A corpus assembled
    // from two runs carries their difference as well as the device's - two dispatches of *one* configuration have
    // reported 0.1691 and 0.2405 (§20.4) - so the same 146 rows are bought once. **The bar is unchanged**, because the
    // row count is unchanged and it is rows that decide what can be signed.
    expect(registration!['confirmation']).toEqual([{ skip: 50, max: 146 }]);
  });
});
