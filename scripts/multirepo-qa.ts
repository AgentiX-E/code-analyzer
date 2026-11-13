// @code-analyzer — cross-repository question answering, measured on four released repositories in four languages.
//
// **Story 10 was written down as "not measured beyond four questions", and the four questions were a skipped test.**
// The skip said the federated search "returns 0 results for a symbol that is demonstrably in it"; the cause was a
// `repoFilter` compared to `owner/name` with a repository name, so scoped questions answered nothing at all. The fix is
// in `search-scope.ts`. This script is the number that the skip was standing in for.
//
// **The questions are not written by this project.** Each one is the first sentence of a symbol's own doc comment,
// taken from the checkout; the expected answer is that symbol. The construction is the one RepoQA uses for
// repository-level code understanding, and it has the property that matters here: the answer key comes from the code,
// so the product cannot contribute to its own expected answers.
//
// Three conditions, because the interesting quantity is the *difference* between them:
//
//   `federated`  the question, all four repositories open, no scope - the product's answer to "where is this?"
//   `scoped`     the same question, told which repository holds it - what a caller who already knows the repo gets
//   `ambiguous`  the subset whose symbol name exists in two or more repositories, answered federated: the answer is
//                only correct if it lands on the repository that holds *this* doc comment
//
// **`scoped` minus `federated` is the price of the other three repositories being present**, and it is the number no
// published benchmark reports, because no published benchmark asks one question of four repositories at once.
//
// Usage:
//   npx tsx scripts/multirepo-qa.ts [--out benchmarks/multirepo-qa.json] [--cache .cache/multirepo-qa]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  CUT,
  buildWorkspace,
  deriveQuestions,
  rankOf,
  readCorpus,
  repoName,
  sampleQuestions,
  score,
} from './lib/multirepo-harness.js';
import { FederatedSearchEngine } from '../packages/intelligence/src/cross-repo/federated-search.js';
import {
  compareArms,
  decodeRanks,
  encodeRanks,
  foundWithin,
} from '../packages/intelligence/src/search/paired-stats.js';


/** **Ten results per question**, which is the cut every figure below is reported at. */
const DEPTH = CUT;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

async function main(): Promise<void> {
  const out = arg('out', 'benchmarks/multirepo-qa.json');
  const cache = arg('cache', '.cache/multirepo-qa');
  const corpus = readCorpus();

  // **The four checkouts and the index over them**, which the paraphrase script shares: two corpora compared on the
  // same symbols have to be the same symbols, and the only way to be sure is to run the same code.
  const { store, manager, index, indexMs } = await buildWorkspace(corpus, cache);

  const derived = deriveQuestions(store);
  const sample = sampleQuestions(derived);

  const engine = new FederatedSearchEngine(store, manager);

  const federated: Array<number | null> = [];
  const scoped: Array<number | null> = [];
  for (const question of sample) {
    const open = await engine.search(question.text, { maxResults: DEPTH });
    federated.push(rankOf(open.results, question));

    const narrowed = await engine.search(question.text, {
      maxResults: DEPTH,
      repoFilter: [repoName(question.repo)],
    });
    scoped.push(rankOf(narrowed.results, question));
  }

  // **The subset that only a cross-repository search can get wrong**: the name exists in more than one repository, so
  // the answer is the repository whose doc comment was asked about, and a search that ignores the distinction scores
  // the wrong function as a hit.
  const ambiguousIndexes = sample
    .map((question, index) => (question.sameNameElsewhere > 1 ? index : -1))
    .filter((index) => index >= 0);
  const ambiguousFederated = ambiguousIndexes.map((index) => federated[index]!);

  // **The subset whose question does not spell its own answer's name.** A question that contains the identifier is a
  // lookup and it should be found; a question that describes the symbol without naming it is the one a user asks.
  const nameFreeIndexes = sample
    .map((question, index) => (question.namesItsAnswer ? -1 : index))
    .filter((index) => index >= 0);
  const nameFreeFederated = nameFreeIndexes.map((index) => federated[index]!);
  const nameFreeScoped = nameFreeIndexes.map((index) => scoped[index]!);

  const pairedScoped = compareArms(scoped, federated);

  const byRepo: Record<string, { federated: number; scoped: number; n: number }> = {};
  sample.forEach((question, index) => {
    const row = (byRepo[question.repo] ??= { federated: 0, scoped: 0, n: 0 });
    row.n += 1;
    if (foundWithin(federated[index], CUT)) row.federated += 1;
    if (foundWithin(scoped[index], CUT)) row.scoped += 1;
  });

  const artifact = {
    comment: [
      'Cross-repository question answering on four released repositories in four languages.',
      '',
      "Every question is the first sentence of a symbol's own doc comment and every expected answer is that symbol, so",
      'the answer key comes from the code and not from this project. `scoped` minus `federated` is what the presence of',
      'three other repositories costs.',
      '',
      '`perQuestion` holds the rank of the intended answer for each question, 1-based, `-` for not returned. Every',
      'aggregate above can be recomputed from those columns, and a test does recompute them.',
    ],
    measuredAt: new Date().toISOString(),
    cut: CUT,
    depth: DEPTH,
    corpus: corpus.repositories.map(({ id, sha, language, role }) => ({ id, sha, language, role })),
    index: { ...index, durationMs: indexMs },
    questions: {
      derived: derived.length,
      scored: sample.length,
      ambiguous: ambiguousIndexes.length,
      namesItsAnswer: sample.filter((question) => question.namesItsAnswer).length,
    },
    conditions: {
      federated: score(federated),
      scoped: score(scoped),
      nameFree: score(nameFreeFederated),
      nameFreeScoped: score(nameFreeScoped),
      ambiguousFederated: score(ambiguousFederated),
    },
    paired: {
      'scoped-vs-federated': pairedScoped,
      'scoped-vs-federated-name-free': compareArms(nameFreeScoped, nameFreeFederated),
    },
    byRepo,
    perQuestion: {
      keys: sample.map((question) => question.key),
      federated: encodeRanks(federated),
      scoped: encodeRanks(scoped),
      ambiguous: ambiguousIndexes.map((index) => sample[index]!.key),
    },
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const pct = (value: number): string => (value * 100).toFixed(1);
  console.log(
    `MULTIREPO repositories=${corpus.repositories.length} nodes=${index.totalNodes} questions=${sample.length}`,
  );
  console.log(
    `MULTIREPO federated found@10=${pct(artifact.conditions.federated.found / sample.length)}% mrr=${artifact.conditions.federated.mrr}`,
  );
  console.log(
    `MULTIREPO scoped    found@10=${pct(artifact.conditions.scoped.found / sample.length)}% mrr=${artifact.conditions.scoped.mrr}`,
  );
  console.log(
    `MULTIREPO namefree  n=${nameFreeIndexes.length} found@10=${pct(nameFreeFederated.filter((rank) => foundWithin(rank, CUT)).length / Math.max(1, nameFreeIndexes.length))}% mrr=${score(nameFreeFederated).mrr}`,
  );
  console.log(
    `MULTIREPO ambiguous n=${ambiguousIndexes.length} found@10=${pct(ambiguousFederated.filter((rank) => foundWithin(rank, CUT)).length / Math.max(1, ambiguousIndexes.length))}%`,
  );
  console.log(
    `MULTIREPO paired onlyScoped=${pairedScoped.onlyA} onlyFederated=${pairedScoped.onlyB} p=${pairedScoped.pValue.toFixed(6)} deltaMrr=${pairedScoped.deltaMrr.toFixed(4)}`,
  );

  // **The columns and the aggregates are printed together** so that a reader of the log has both, and the gate test
  // recomputes one from the other.
  const decoded = decodeRanks(artifact.perQuestion.federated, sample.length);
  if (decoded.length !== sample.length)
    throw new Error('federated column did not decode to the question count');
  store.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
