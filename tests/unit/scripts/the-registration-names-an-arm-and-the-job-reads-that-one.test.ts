// **The registration names an arm, and until this iteration the job read a different one.**
//
// R-18's sentence (`docs/EVAL-CONTRACT.md` §20.3) requires the **pull-request** arm to rise by 0.02 and the **file** arm
// not to fall. The comparison job read `artifact.f1` - the file arm - for every registration, because that is the arm
// §8 and §19 were measured on and the field it had always read. On R-18's own two artifacts the file arm gained 0.024 and
// cleared the bar while the pull-request arm the sentence names **lost 0.0065**, so the job published
// `magnitudeMet: true` and the word `inconclusive` about the arm nobody registered.
//
// **The failure is not arithmetic and no fixture of the old shape could have found it**: the two files disagreed about
// which number the claim was attached to, and a comparison job has no way to notice that unless the registration says.
// So a registration now names its arm, its other clause becomes a gate, both arms are published, and an artifact that
// does not carry the named arm is refused rather than measured on the nearest one.
//
// **This file spawns the job rather than importing its arithmetic**, for the reason the neighbouring file gives: a
// guard that only exists inside a unit test is a guard the job does not have.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '.github',
  'scripts',
  'aacr-ablation-compare.mjs',
);

/** The slice §20's registration names, because a run over other rows cannot confirm it whatever its gain. */
const SLICE = { skip: 14, requested: 36 };

const PULLS = ['https://github.com/example/repo/pull/1', 'https://github.com/example/repo/pull/2'];

interface ArmOptions {
  readonly codeContext: boolean;
  /** The file arm: one call per file per lane, at most three findings per file. */
  readonly truePositives: number;
  readonly falsePositives: number;
  /** The pull-request arm: one call per lane for the whole pull request, one budget of sixteen. */
  readonly pullRequestTruePositives?: number;
  readonly pullRequestFalsePositives?: number;
  readonly found: readonly number[];
}

/**
 * One arm, as the bench writes it: the file arm at the top level and the pull-request arm in the block beside it.
 *
 * **`pullRequestTruePositives` is optional on purpose** - omitting it produces an artifact from before the block existed,
 * which is the artifact a registration that names that arm must refuse.
 */
function arm(options: ArmOptions): Record<string, unknown> {
  const goldens = 10;
  const figures = (truePositives: number, falsePositives: number) => {
    const falseNegatives = goldens - truePositives;
    return {
      truePositives,
      falsePositives,
      falseNegatives,
      precision: truePositives / (truePositives + falsePositives),
      recall: truePositives / goldens,
      f1: (2 * truePositives) / (2 * truePositives + falsePositives + falseNegatives),
    };
  };
  const file = figures(options.truePositives, options.falsePositives);
  return {
    corpus: 'fixture corpus',
    prsInDataset: PULLS.length,
    datasetRows: 20,
    prsReviewed: PULLS.length,
    corpusRead: { requested: PULLS.length, unread: 0, whole: true },
    corpusSlice: SLICE,
    configuration: {
      judgeModel: 'fixture-model',
      languageChecklist: false,
      emissionProfile: 'defect',
      codeContext: options.codeContext,
    },
    ...file,
    fullEmission: { k: options.truePositives + options.falsePositives },
    ...(typeof options.pullRequestTruePositives === 'number'
      ? {
          pullRequestArm: {
            ...figures(options.pullRequestTruePositives, options.pullRequestFalsePositives ?? 0),
            findings: options.pullRequestTruePositives + (options.pullRequestFalsePositives ?? 0),
          },
        }
      : {}),
    coverage: {
      byPullRequest: PULLS.map((pr, at) => ({
        pr,
        goldens: goldens / PULLS.length,
        covered: options.found.filter((golden) => golden % PULLS.length === at),
      })),
    },
  };
}

/** Run the job over two artifacts in a directory of their own and read both its status and what it wrote. */
function compare(
  withArtifact: Record<string, unknown>,
  withoutArtifact: Record<string, unknown>,
): {
  readonly status: number;
  readonly artifact: Record<string, unknown> | null;
  readonly stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'aacr-arm-'));
  const onPath = join(dir, 'with.json');
  const offPath = join(dir, 'without.json');
  writeFileSync(onPath, JSON.stringify(withArtifact));
  writeFileSync(offPath, JSON.stringify(withoutArtifact));
  let status = 0;
  let stderr = '';
  try {
    execFileSync(process.execPath, [script, onPath, offPath], { cwd: dir, stdio: 'pipe' });
  } catch (error) {
    const failure = error as { status?: number; stderr?: Buffer };
    status = failure.status ?? -1;
    stderr = failure.stderr?.toString() ?? '';
  }
  let artifact: Record<string, unknown> | null = null;
  try {
    artifact = JSON.parse(
      readFileSync(join(dir, 'benchmarks', 'aacr-ablation-paired.json'), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    artifact = null;
  }
  return { status, artifact, stderr };
}

describe('the arm a registration is a claim about', () => {
  /**
   * **R-18's own two numbers, in miniature**: the file arm gains 0.2 and the pull-request arm loses 0.0667.
   *
   * This is the pair the old job certified. A threshold of 0.02 compared against the top-level F1 passed; compared
   * against the arm the sentence names it fails. **Both facts are asserted below**, because a fix that only reported the
   * right arm without keeping the other one visible would merely move the half-truth.
   */
  const fileArmOnly = arm({
    codeContext: true,
    truePositives: 6,
    falsePositives: 14,
    pullRequestTruePositives: 2,
    pullRequestFalsePositives: 18,
    found: [0, 1, 2, 3, 4],
  });
  const baseline = arm({
    codeContext: false,
    truePositives: 3,
    falsePositives: 17,
    pullRequestTruePositives: 3,
    pullRequestFalsePositives: 17,
    found: [0, 1],
  });

  it('reads the threshold against the arm the registration names, not the arm it used to read', () => {
    const { artifact } = compare(fileArmOnly, baseline);
    expect(artifact).not.toBeNull();
    const body = artifact as Record<string, unknown>;

    expect(body['registeredArm']).toBe('pullRequest');
    const delta = body['delta'] as Record<string, number>;
    expect(delta['f1']).toBeCloseTo(-0.0667, 4);

    const verdict = body['verdict'] as Record<string, unknown>;
    expect(verdict['registeredArm']).toBe('pullRequest');
    expect(verdict['magnitudeMet']).toBe(false);
    expect(verdict['confirms']).toBe(false);
    expect(String(verdict['outcome'])).toMatch(/^falsified/);
    expect(String(verdict['outcome'])).toContain('pull-request arm');
  });

  it('still publishes the arm the claim does not name, because it moved too', () => {
    const { artifact } = compare(fileArmOnly, baseline);
    const byArm = (artifact as Record<string, unknown>)['byArm'] as Record<
      string,
      { delta: Record<string, number> } | null
    >;
    expect(byArm['file']?.delta['f1']).toBeCloseTo(0.2, 4);
    expect(byArm['pullRequest']?.delta['f1']).toBeCloseTo(-0.0667, 4);
  });

  it('fails the registration when the arm it forbids lowering falls, even as the named one rises', () => {
    const risingButNarrowing = arm({
      codeContext: true,
      truePositives: 2,
      falsePositives: 18,
      pullRequestTruePositives: 5,
      pullRequestFalsePositives: 15,
      found: [0, 3],
    });
    const { artifact } = compare(risingButNarrowing, baseline);
    const verdict = (artifact as Record<string, unknown>)['verdict'] as Record<string, unknown>;
    expect(verdict['magnitudeMet']).toBe(true);
    expect(verdict['mechanismMet']).toBe(true);
    const guard = verdict['guard'] as { arm: string; gain: number; met: boolean };
    expect(guard.arm).toBe('file');
    expect(guard.met).toBe(false);
    expect(verdict['confirms']).toBe(false);
    expect(String(verdict['outcome'])).toContain('must not lower');
  });

  it('refuses an artifact that does not carry the arm the registration names', () => {
    const withoutBlock = arm({
      codeContext: true,
      truePositives: 6,
      falsePositives: 14,
      found: [0, 1, 2],
    });
    const { status, artifact, stderr } = compare(withoutBlock, baseline);
    expect(status).not.toBe(0);
    expect(stderr).toContain('pull-request arm');
    // **And it writes no comparison**, because an artifact left behind would be read by the next job as a result.
    expect(artifact).toBeNull();
  });
});
