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
    const options = BENCH.slice(BENCH.indexOf('new LLMReviewEngine('));
    expect(options.slice(0, 600)).toContain('secondConcern: SECOND_CONCERN');
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
    const registration = (REGISTRATIONS as Record<string, Record<string, unknown>>)['secondConcern'];
    expect(registration, 'the switch has no registration, so its run is a diagnostic').toBeDefined();
    // **The mechanism is the mirror of every other entry**, and that is the point: this device adds comments and cannot
    // raise precision, so a registration that asked it to would be asking a filter to behave like a merge.
    expect(registration!['mechanismRule']).toBe('recall-rises');
    expect(Object.keys(MECHANISMS)).toContain('recall-rises');
    expect(registration!['arm']).toBe('file');
    expect(Number(registration!['registeredGain'])).toBeGreaterThan(0);
  });

  it('names the slice the dispatch will read, so the run can be a confirmation rather than a surprise', () => {
    const registration = (REGISTRATIONS as Record<string, Record<string, unknown>>)['secondConcern'];
    expect(registration!['confirmation']).toEqual([{ skip: 50, max: 100 }]);
  });
});
