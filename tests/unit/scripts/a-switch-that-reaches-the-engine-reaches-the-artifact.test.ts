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
import { knownLLMProviders } from '../../../packages/intelligence/src/review/llm/provider-factory.js';

import { configurationBlock } from './configuration-block.js';

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
    expect(
      configurationBlock(BENCH),
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
    expect(configurationBlock(BENCH)).toContain(
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

describe('the same-site cap is wired end to end', () => {
  it('is read from the environment the workflow sets, and validated rather than coerced', () => {
    expect(BENCH).toContain("process.env['AACR_SAME_SITE_CONCERNS']");
    expect(WORKFLOW).toContain('AACR_SAME_SITE_CONCERNS: ${{ inputs.same_site_concerns');
    // **`Number.isInteger`, because `parseInt('3 (three)')` is 3.** A cap that arrived as a string the engine silently
    // rounded would be an arm labelled one number and bought another, which is §122.2's defect one device later.
    const block = BENCH.slice(BENCH.indexOf("process.env['AACR_SAME_SITE_CONCERNS']"));
    expect(block.slice(0, 400)).toContain('Number.isInteger(parsed)');
  });

  it('reaches the engine as an option and the artifact as a key', () => {
    const start = BENCH.indexOf('new LLMReviewEngine(');
    const options = BENCH.slice(start, BENCH.indexOf('\n  });', start));
    expect(options).toContain('sameSiteConcerns: SAME_SITE_CONCERNS');
    expect(configurationBlock(BENCH)).toContain('sameSiteConcerns: SAME_SITE_CONCERNS');
  });

  it('is registered with a bar its own slice can sign, or says it cannot', () => {
    const registration = (REGISTRATIONS as unknown as Record<string, Record<string, unknown>>)[
      'sameSiteConcerns'
    ];
    expect(registration, 'the cap has no registration, so its run is a diagnostic').toBeDefined();
    expect(registration!['mechanismRule']).toBe('recall-rises');
    // **46 rows sign 0.0281** (§122.1), so a 0.01 bar is below its own resolution and the entry has to say so: a run
    // read as confirmed at half its instrument's resolution is the §68 defect.
    expect(registration!['registeredGain']).toBe(0.01);
    expect(registration!['registeredBelowResolution']).toBe(true);
    expect(registration!['confirmation']).toEqual([{ skip: 150, max: 46 }]);
  });
});

describe('the emission budget is an input, because the cap moved its maximum', () => {
  it('is read from the environment the workflow sets, and validated', () => {
    expect(BENCH).toContain("process.env['PR_BUDGET']");
    expect(WORKFLOW).toContain('PR_BUDGET: ${{ inputs.pull_request_budget');
    const block = BENCH.slice(BENCH.indexOf("process.env['PR_BUDGET']"));
    expect(block.slice(0, 400)).toContain('Number.isInteger(parsed)');
  });

  it('is the same number the artifact publishes as the budget it ran', () => {
    // **`pullRequestBudget: PR_BUDGET` in `configuration`**: a run whose artifact said 12 while the ranker cut at 20
    // would be the §58.1 shape - an artifact internally consistent and about a reviewer nobody dispatched.
    expect(configurationBlock(BENCH)).toContain('pullRequestBudget: PR_BUDGET');
  });
});

describe('the model family is a dispatch input, and the artifact says which one ran', () => {
  it('is read from the environment the workflow sets', () => {
    expect(BENCH).toContain("process.env['AACR_PROVIDER']");
    expect(WORKFLOW).toContain('AACR_PROVIDER: ${{ inputs.provider');
  });

  it('reaches the engine through the registry rather than a class name', () => {
    // **`new DeepSeekProvider(` in the job is the lock-in the registry exists to remove**, and it was what the engine,
    // the agent and the merge reviewer each did. The assertion is on the absence of that construction as much as on the
    // presence of the registry call: a fourth call site added later with a hard-coded class would pass a presence test.
    expect(BENCH).toContain(
      'createLLMProvider(PROVIDER, undefined, { ledger, ceilingUsd: MAX_USD })',
    );
    expect(BENCH).not.toContain('new DeepSeekProvider(');
    expect(BENCH).toContain('new LLMReviewEngine(providerFor(),');
  });

  it('is the key the artifact publishes, so two families cannot be compared as one', () => {
    // **Position rather than a window.** The other assertions in this file read the first six thousand characters of
    // `configuration`, and this key sits at the end of a block that has grown past that - so a window here would pass
    // today and start lying the next time a key was added above it. The comparison is order, which no insertion moves.
    const at = BENCH.indexOf('configuration: {');
    const providerAt = BENCH.indexOf('provider: PROVIDER,');
    expect(at).toBeGreaterThan(-1);
    expect(
      providerAt,
      'no configuration key publishes which family reviewed the corpus',
    ).toBeGreaterThan(at);
  });

  it('validates the name against a list the registry agrees with', () => {
    // **A literal list at module scope and a registry in `dist/`**: the list is what makes a typo a refusal before the
    // corpus is cloned, and this assertion is what keeps the two from becoming two different lists.
    const declared = /const PROVIDERS = \[([^\]]*)\];/u.exec(BENCH);
    expect(declared, 'the benchmark script no longer declares its provider list').not.toBeNull();
    const names = declared![1]!.split(',').map((part) => part.trim().replace(/^'|'$/gu, ''));
    expect(names).toEqual(knownLLMProviders());
  });

  it('passes the second family the key its provider reads, and not a variable it invents', () => {
    // **The workflow is the only place a secret becomes an environment variable**, and a provider whose variable is
    // absent throws at construction - so this is the difference between an arm that runs and an arm that fails for a
    // reason the artifact never records.
    expect(WORKFLOW).toContain('ZHIPU_API_KEY: ${{ secrets.ZHIPU_API_KEY }}');
  });
});

describe('the emission budget reaches one arm and the artifact says which', () => {
  it('passes the budget to the whole-pull-request arm and to nothing else', () => {
    // **R-67 is why this is asserted.** The run was dispatched at `pullRequestBudget: 20`, its artifact recorded 20, and
    // its headline was F1 0.2271 on 392 emissions - the number the engine produces when nothing is cut, because
    // `maxFindingsPerPullRequest` is read inside `reviewPullRequest` and the file arm never consults it. **A field that
    // reports a dispatch input as a measurement of the headline is the §58.1 shape**, and the file arm's budget is now
    // recorded as `null` rather than as the input's value.
    // **Counted as assignments, not as mentions**: the comment that records why this matters names the same option, and a
    // guard that counts prose would fail on its own explanation.
    const callSites = BENCH.split('maxFindingsPerPullRequest:').length - 1;
    expect(
      callSites,
      'the budget is passed at more than one call site, so one of them is the file arm',
    ).toBe(1);
    const block = BENCH.slice(BENCH.indexOf('maxFindingsPerPullRequest'));
    expect(block.slice(0, 200)).toContain('PR_BUDGET');
    expect(BENCH).toContain('reviewPullRequest(prSections, {');
  });

  it('publishes the file arm budget as null, not as the input it did not use', () => {
    const configuration = BENCH.slice(BENCH.indexOf('configuration: {'));
    expect(configuration).toContain('fileArmBudget: null');
    // **And the arm that does read it is published beside it**, so a reader can tell which figure the number belongs to.
    expect(configuration).toContain('pullRequestArmBudget: PR_BUDGET');
  });
});
