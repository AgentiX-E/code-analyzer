// @code-analyzer/code-analyzer — one configuration field, two devices, and the sentence that belongs to each
//
// **The defect this file was written after.** Run `44853661785` dispatched two arms that differ in one field, `laneSet`:
// `shipped`'s five lanes and `lean`'s four. The comparison job read the field, found a registration keyed on it - §69.5's
// R-35, which swapped a lane for a *different question* - and wrote that sentence into the artifact together with its bar
// (0.026), its arm, its mechanism and its slice (`skip 50 max 146`). The verdict it then published about a fifty-row run
// was **"not a confirmation: the registration names skip 50 max 146, and this run read skip 0 max 50"**, which is a true
// statement about R-35 and a false one about R-52.
//
// **A field is not a device.** Two devices can vary the same key in different directions - `behaviour` substitutes a lane,
// `lean` removes one - and **the arm's own name is the only thing in the artifact that tells them apart**. So an entry may
// declare the arms it is about, an entry that declares them answers nothing else, and a pair no entry names writes
// `registration: null` with a pointer to the section that holds the reading instead of a verdict about somebody else's
// experiment.
//
// **What this file checks, through the job's own entry point rather than a copy of its logic**: the lookup, the artifact
// it produces for a `lean` pair, the artifact it produces for a `behaviour` pair, and that no two entries on one field
// claim the same arm.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  REGISTRATIONS,
  UNREAD_REGISTRATIONS,
  registrationFor,
} from '../../../.github/scripts/aacr-ablation-compare.mjs';

const script = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'aacr-ablation-compare.mjs',
);

const FIVE_LANES = ['security', 'architecture', 'performance', 'maintainability', 'testing'];
const FOUR_LANES = ['security', 'architecture', 'performance', 'maintainability'];

/** One arm as the bench writes it, differing from the other in `laneSet` and nothing else. */
function arm(options: {
  readonly name: string;
  readonly lanes: readonly string[];
  readonly truePositives: number;
  readonly falsePositives: number;
}): Record<string, unknown> {
  const goldens = 20;
  const falseNegatives = goldens - options.truePositives;
  const pullRequests = Array.from(
    { length: 10 },
    (_, at) => `https://github.com/example/repo/pull/${at}`,
  );
  return {
    corpus: 'fixture corpus',
    prsInDataset: pullRequests.length,
    datasetRows: 200,
    prsReviewed: pullRequests.length,
    corpusRead: { requested: pullRequests.length, unread: 0, whole: true },
    configuration: {
      judgeModel: 'fixture-model',
      laneSet: { name: options.name, lanes: options.lanes },
    },
    truePositives: options.truePositives,
    falsePositives: options.falsePositives,
    falseNegatives,
    precision: options.truePositives / (options.truePositives + options.falsePositives),
    recall: options.truePositives / goldens,
    f1:
      (2 * options.truePositives) /
      (2 * options.truePositives + options.falsePositives + falseNegatives),
    fullEmission: { k: options.truePositives + options.falsePositives },
    coverage: {
      byPullRequest: pullRequests.map((pr, at) => ({
        pr,
        goldens: 2,
        covered: at < options.truePositives ? [at * 2] : [],
      })),
    },
  };
}

/**
 * **The three fields this file reads, declared rather than indexed.** The artifact is a document the job writes, so it
 * arrives as `unknown` - and `Record<string, unknown>` would make every read a bracket access the type-check ratchet
 * refuses (`noPropertyAccessFromIndexSignature`), which is the ratchet saying that a shape nobody declared is a shape
 * nobody checks.
 */
interface ComparedArtifact {
  readonly registration?: { readonly section?: string } | null;
  readonly registrationReadIn?: string | null;
  readonly verdict?: { readonly outcome?: string };
}

/** Run the job over two artifacts in a directory of their own, and read the verdict it wrote. */
function compare(
  withArm: Record<string, unknown>,
  withoutArm: Record<string, unknown>,
): { readonly status: number; readonly artifact: ComparedArtifact } {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-lane-set-'));
  const onPath = join(dir, 'with.json');
  const offPath = join(dir, 'without.json');
  writeFileSync(onPath, JSON.stringify(withArm));
  writeFileSync(offPath, JSON.stringify(withoutArm));
  let status = 0;
  try {
    execFileSync(process.execPath, [script, onPath, offPath], { cwd: dir, stdio: 'pipe' });
  } catch (error) {
    status = (error as { status?: number }).status ?? -1;
  }
  const artifact = JSON.parse(
    readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
  ) as ComparedArtifact;
  return { status, artifact };
}

describe('a field that carries two devices', () => {
  it('answers the arm the entry names and refuses the arm it does not', () => {
    // **The removal is not the substitution**, and the difference between them is not a slice: it is that `lean` claims
    // a bill and `behaviour` claims a gain. §113.4's claim is not computable by this job at all, which is why the answer
    // to it is `null` rather than a smaller bar.
    expect(registrationFor('laneSet', [{ skip: 50, max: 146 }], 'behaviour')?.section).toBe(
      '§69.5 (R-35)',
    );
    expect(registrationFor('laneSet', [{ skip: 0, max: 50 }], 'lean')).toBeNull();
  });

  it('writes the pointer and not the neighbouring verdict for a lean pair', () => {
    const { status, artifact } = compare(
      arm({ name: 'lean', lanes: FOUR_LANES, truePositives: 7, falsePositives: 9 }),
      arm({ name: 'shipped', lanes: FIVE_LANES, truePositives: 6, falsePositives: 10 }),
    );
    // **A pair with no readable registration is still a comparison**, so the job stays green and publishes the numbers:
    // refusing it would have made the arm unmeasurable rather than correctly labelled.
    expect(status).toBe(0);
    expect(artifact.registration).toBeNull();
    expect(String(artifact.registrationReadIn)).toContain('§113.6');
    const outcome = String(artifact.verdict?.outcome);
    // **The two sentences that must not appear.** `not a confirmation: the registration names skip 50 max 146` is R-35's
    // slice quoted about a fifty-row run, and `unregistered` says nobody wrote an expectation - which is false for R-52.
    expect(outcome).not.toContain('skip 50 max 146');
    expect(outcome.startsWith('unregistered')).toBe(false);
    expect(outcome).toContain('cost band');
  });

  it('still answers a behaviour pair with §69.5', () => {
    const { status, artifact } = compare(
      arm({
        name: 'behaviour',
        lanes: [...FOUR_LANES, 'behaviour'],
        truePositives: 9,
        falsePositives: 7,
      }),
      arm({ name: 'shipped', lanes: FIVE_LANES, truePositives: 6, falsePositives: 10 }),
    );
    expect(status).toBe(0);
    expect(artifact.registration?.section).toBe('§69.5 (R-35)');
    expect(artifact.registrationReadIn).toBeNull();
    expect(String(artifact.verdict?.outcome)).not.toContain('cost band');
  });

  it('never lets two entries on one field claim the same arm', () => {
    // **The lookup is by name, so two entries claiming one arm is an ambiguity the file cannot resolve** - and the tie
    // would be broken by whichever key `Object.keys` happened to return first, which is not a rule.
    const claimed = new Map<string, string>();
    for (const [key, entry] of Object.entries(REGISTRATIONS) as [
      string,
      { field?: string; arms?: string[] },
    ][]) {
      const field = entry.field ?? key;
      if (entry.arms === undefined) continue;
      for (const armName of entry.arms) {
        const owner = `${field}:${armName}`;
        expect(claimed.get(owner), `${owner} is claimed by ${String(claimed.get(owner))}`).toBe(
          undefined,
        );
        claimed.set(owner, key);
      }
    }
    // **And every unread pair names an arm no entry claims**, because a pointer to a section beside a verdict is two
    // answers to one question.
    for (const key of Object.keys(UNREAD_REGISTRATIONS)) {
      expect(claimed.get(key), `${key} is both read and unread`).toBe(undefined);
      const field = key.split(':')[0] ?? '';
      expect(field in REGISTRATIONS, `${field} is not a registered field`).toBe(true);
    }
  });
});
