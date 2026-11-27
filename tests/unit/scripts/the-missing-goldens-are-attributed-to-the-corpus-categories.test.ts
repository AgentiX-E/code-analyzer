// **A decomposition is only worth reading if it adds back up.**
//
// §173 reads a `-0.11` F1 against the competitor on the wide AACR arm, and a single delta says nothing about which of the
// four things an arm can be weak at - emission, ranking, matching, judgement - is the one to buy next. The corpus
// publishes a category on every reference comment, so the same verdicts can be split by it; what makes the split a
// reading rather than a second opinion is arithmetic that reconciles with the numbers it decomposes.
//
// These cases hold the four properties the instrument cannot be allowed to lose:
//
//   1. **Our arm is the shipped cut, rebuilt first.** `rankedFindings` holds `622` candidates on the wide arm and the
//      published figure is over the `311` the cut kept; a table over the candidates is a table about another run.
//   2. **One golden, one credit, per arm, by the corpus's matching** - not a sum over `matchedGoldens`, which reports 40 %
//      more credit than the matching does on this corpus.
//   3. **Every bucket adds back up** to the figure it decomposes, or nothing is printed.
//   4. **The slice is the run's, not the corpus file's** - the answer key holds 196 pull requests and a run asks about 50,
//      so a denominator built from the file is a denominator nobody was scored on.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/aacr-category-gap.mjs';

/**
 * Two pull requests, five goldens, three categories.
 *
 * `A` holds `bug, bug, style`: two of the three findings claim golden `0`, which is **the redundancy the matching exists
 * to price** - a sum over `matchedGoldens` would credit three pairs among the two the budget keeps where the matching
 * credits two. `B` holds `bug, perf`, and `C` holds `bug` and was scored by us with nothing to say about it - a hole on our
 * side, never asked of theirs.
 */
const CORPUS = [
  {
    githubPrUrl: 'https://example.test/a/pull/1',
    comments: [{ category: 'bug' }, { category: 'bug' }, { category: 'style' }],
  },
  {
    githubPrUrl: 'https://example.test/b/pull/2',
    comments: [{ category: 'bug' }, { category: 'perf' }],
  },
  { githubPrUrl: 'https://example.test/c/pull/3', comments: [{ category: 'bug' }] },
];

const finding = (pr, matchedGoldens) => ({
  pr,
  path: 'src/lib.rs',
  startLine: 1,
  endLine: 2,
  severity: 'high',
  category: 'bug',
  lane: 'bug',
  score: 0.9,
  actionable: true,
  features: {},
  matchedGoldens,
});

/** Three comments kept by the shipped cut, one dropped by the budget. */
const RANKED = [
  finding('https://example.test/a/pull/1', [0]),
  finding('https://example.test/a/pull/1', [0, 1]),
  finding('https://example.test/b/pull/2', [1]),
  finding('https://example.test/a/pull/1', [2]),
];

function artifact(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    coverage: {
      byPullRequest: [
        { pr: 'https://example.test/a/pull/1' },
        { pr: 'https://example.test/b/pull/2' },
        { pr: 'https://example.test/c/pull/3' },
      ],
    },
    rankedFindings: RANKED,
    // **The budget is per pull request**, so `A` keeps two of its three and `B` keeps its only one: three comments.
    emissionRules: { shipped: { steps: [{ kind: 'budget', k: 2 }], point: { k: 3 } } },
    truePositives: 3,
    falseNegatives: 3,
    secondReviewer: {
      // **Three credits on their side, one per category**: `bug` on `A`, `style` on `A`, `perf` on `B`.
      findingsAtItsOwnOperatingPoint: [
        finding('https://example.test/a/pull/1', [0]),
        finding('https://example.test/a/pull/1', [2]),
        finding('https://example.test/b/pull/2', [1]),
      ],
      truePositives: 3,
    },
    ...overrides,
  });
}

interface Run {
  code: number;
  out: string;
  board: {
    corpus: { pullRequests: number; goldens: number };
    credited: { ours: number; theirs: number };
    rows: {
      category: string;
      goldens: number;
      ours: number;
      theirs: number;
      oursRecall: number;
      theirsRecall: number;
      gap: number;
    }[];
  } | null;
}

function run(files: { artifact?: string; corpus?: string } = {}): Run {
  const directory = mkdtempSync(join(tmpdir(), 'category-gap-'));
  const artifactPath = join(directory, 'artifact.json');
  writeFileSync(artifactPath, files.artifact ?? artifact());
  const corpusPath = join(directory, 'corpus.json');
  writeFileSync(corpusPath, files.corpus ?? JSON.stringify(CORPUS));
  const jsonPath = join(directory, 'out.json');
  try {
    const out = execFileSync(
      'node',
      [SCRIPT, '--artifact', artifactPath, '--corpus', corpusPath, '--json', jsonPath],
      { encoding: 'utf8' },
    );
    return { code: 0, out, board: JSON.parse(readFileSync(jsonPath, 'utf8')) };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`, board: null };
  }
}

describe('the missing goldens are attributed to the corpus’s own categories', () => {
  it('divides by the run’s slice, and counts a pull request it never asked about in neither arm', () => {
    // **`C` is scored by us and not by them**, so its golden is our false negative and their hole: the denominator is the
    // slice's six for both arms, which is the rule §173.1 restored and the reason our `R` is `0.5000` and not `0.6000`.
    const { code, out, board } = run();
    expect(code).toBe(0);
    expect(board?.corpus).toEqual({ pullRequests: 3, goldens: 6 });
    expect(out).toContain('6 goldens');
  });

  it('credits one golden once, so a second finding on the same note does not buy a second true positive', () => {
    // Two findings claim golden `0` of `A`; the matching pays for one. `A`'s second finding also holds golden `1`, so the
    // pair `(A, 1)` is paid by the finding that would otherwise have been redundant - three credits, not four.
    const { board } = run();
    expect(board?.credited.ours).toBe(3);
    expect(board?.credited.theirs).toBe(3);
  });

  it('prices our arm at the cut the run shipped, not at its candidates', () => {
    // The fourth finding is dropped by the per-pull-request budget of two, so `style` is credited by nobody on our side.
    const { board } = run();
    const style = board?.rows.find((row) => row.category === 'style');
    // **A category our cut credits nothing in and theirs does is a detection gap, not a ranking one** - and it is the
    // shape §173 found four of on the AACR corpus.
    expect(style).toEqual({
      category: 'style',
      goldens: 1,
      ours: 0,
      theirs: 1,
      oursRecall: 0,
      theirsRecall: 1,
      gap: 1,
    });
  });

  it('says which categories the two arms differ in, and by how much', () => {
    const { board } = run();
    // **Four `bug` goldens**: `A`'s two, `B`'s one and `C`'s one, which nobody paid. Ours pays `A`'s two, theirs pays
    // `A`'s first - so the sign of the gap reads the way the arm is weak, and `perf` and `style` are priced beside it.
    const bugs = board?.rows.find((row) => row.category === 'bug');
    expect(bugs).toMatchObject({ goldens: 4, ours: 2, theirs: 1, gap: -1 });
    const perf = board?.rows.find((row) => row.category === 'perf');
    expect(perf).toMatchObject({ goldens: 1, ours: 1, theirs: 1, gap: 0 });
  });

  it('refuses to print buckets that do not add back up to the figure they decompose', () => {
    // A `falseNegatives` of four claims seven goldens on a slice that holds six - the §124 defect, where every row looks
    // plausible and the total belongs to a different corpus. The instrument refuses rather than publishing it.
    const { code, out } = run({ artifact: artifact({ falseNegatives: 4 }) });
    expect(code).toBe(2);
    expect(out).toContain('do not add back up');
    expect(out).toContain('goldens 6 against 7');
  });

  it('refuses an emission the shipped cut cannot rebuild', () => {
    // A budget of three per pull request keeps all four comments on this fixture; the artifact publishes three. A table
    // over that emission is a table about a different run, which is the defect the guard exists to catch, not reprint.
    const { code, out } = run({
      artifact: artifact({
        emissionRules: { shipped: { steps: [{ kind: 'budget', k: 3 }], point: { k: 3 } } },
      }),
    });
    expect(code).toBe(2);
    expect(out).toContain('different emission');
  });

  it('refuses a corpus that cannot name the category of a golden it is asked about', () => {
    const { code, out } = run({ corpus: JSON.stringify(CORPUS.slice(0, 2)) });
    expect(code).toBe(2);
    expect(out).toContain('absent from the corpus');
  });

  it('refuses an artifact that bought no competitor arm, rather than decomposing one arm and calling it a gap', () => {
    const { code, out } = run({
      artifact: artifact({ secondReviewer: { findingsAtItsOwnOperatingPoint: [] } }),
    });
    expect(code).toBe(2);
    expect(out).toContain('no competitor emission');
  });
});
