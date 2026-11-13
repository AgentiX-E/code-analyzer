// @code-analyzer — the multi-repository question set, asked the way a person would ask it.
//
// **The verbatim corpus measures routing, and says so.** Each question there is the first sentence of a symbol's own doc
// comment, and the doc comment is in the index - so a system that finds the answer has found the text, not understood
// the question. §33.2 of the evaluation contract named the consequence: the `name-free` subset moved the figure by 0.1
// points, which is the finding that **the identifier was never what made those questions easy**.
//
// This file is the other condition. A model is shown the same doc comment and asked for **the question a developer would
// actually type**, under three rules that make the rewrite a different question rather than a paraphrase of the same
// words: never use the symbol's name, never copy a phrase longer than five words, ask about behaviour. The answer key is
// unchanged - it still comes from the checkout - so **the only difference between the two figures is how the question
// was worded**, on the same symbols, in the same index, in the same run.
//
// **The generation is paid once and the measurement is free.** Generated questions are frozen into
// `benchmarks/multirepo-qa-paraphrase-corpus.json` with the model, the prompt version and a SHA-256 of the list, so every
// later run replays the same questions at zero cost and a reader can diff two corpora rather than two runs.
//
// Usage:
//   npx tsx scripts/multirepo-paraphrase.ts --mode generate   # needs DEEPSEEK_API_KEY; rewrites the corpus file
//   npx tsx scripts/multirepo-paraphrase.ts                   # replays it and publishes the artifact

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  CUT,
  buildWorkspace,
  deriveQuestions,
  embedWorkspace,
  rankOf,
  readCorpus,
  repoName,
  sampleQuestions,
  score,
  type Question,
} from './lib/multirepo-harness.js';
import { FederatedSearchEngine } from '../packages/intelligence/src/cross-repo/federated-search.js';
import {
  DeepSeekProvider,
  LLMRateLimitError,
} from '../packages/intelligence/src/review/llm/provider.js';
import {
  compareArms,
  decodeRanks,
  encodeRanks,
} from '../packages/intelligence/src/search/paired-stats.js';
import { rateLimitDelayMs } from '../packages/intelligence/src/search/rerank.js';
import { mapWithConcurrency } from '../packages/shared/src/index.js';

const DEPTH = CUT;

/**
 * **The prompt's version, recorded in the corpus.**
 *
 * A rewrite prompt is a measurement instrument: changing one sentence changes the questions, and a corpus that did not
 * say which prompt produced it would make two corpora look like two samples rather than two instruments.
 */
const PROMPT_VERSION = 'multirepo-paraphrase-v1';

/**
 * **How many rewrites are in flight.**
 *
 * Four hundred and sixty-nine completions one at a time is twenty-five minutes of a job that exists to produce a file
 * once; the questions are independent, so the queue is the only thing the serial version bought. **Four rather than
 * eight** because generation happens once and a 429 costs a retry that costs more than the wall-clock it saved.
 */
const REWRITE_CONCURRENCY = 4;

/** The waiting the provider's own retry policy does not do, which is the same gap `rerankCandidates` closes. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * **The instruction, and the three rules that make this a different question.**
 *
 * The symbol name is shown because the rule forbidding it cannot be followed without knowing it - and the name is the
 * single largest crutch the verbatim condition gave the retriever. **Five words is the copy limit**, chosen against the
 * six-word overlap that a phrase-level plagiarism check would flag: anything longer and the "rewritten" question would
 * still contain the indexed string.
 */
function paraphrasePrompt(question: Question): string {
  return [
    'You turn API documentation into the question a developer would actually type into a code search box.',
    '',
    `Symbol: ${question.symbol}`,
    `Documentation: ${question.text}`,
    '',
    'Rules:',
    "- One question, at most 160 characters, ending with '?'.",
    `- Never use the name "${question.symbol}", in any spelling: camelCase, snake_case, with spaces, or abbreviated.`,
    '- Do not copy a phrase longer than five words from the documentation.',
    '- Ask about behaviour or purpose, not about syntax or naming.',
    '- Write it the way someone who has not read the code would ask it.',
    '',
    'Answer with the question only. No quotation marks, no explanation.',
  ].join('\n');
}

/** `camelCase`, `snake_case` and `kebab-case` collapsed to one string, so a spelling variant cannot hide the name. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The words of a text, lowercased, for the copied-phrase check. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/**
 * Why a rewrite is not usable, as a list of reasons. **Empty means it is.**
 *
 * A generated question that fails these is not a paraphrase, it is the verbatim question with a question mark - and
 * including one would shrink the measured difference toward zero, which is the direction that looks like a null result.
 */
function rejectionReasons(paraphrase: string, question: Question): string[] {
  const reasons: string[] = [];
  const text = paraphrase.trim();

  if (text.length < 15) reasons.push('too short to be a question');
  if (text.length > 240) reasons.push('too long to be a question');
  if (!text.endsWith('?')) reasons.push('is not a question');

  // **The name in any spelling.** `computeKineticEnergy`, `compute_kinetic_energy` and `compute kinetic energy` all
  // normalise to the same string, so the check cannot be walked past by a model that renames the separator.
  if (normalise(text).includes(normalise(question.symbol))) reasons.push('spells the symbol name');

  // **A copied phrase.** Six consecutive words in common with the documentation is a quote, and a quoted question is
  // still a lookup - the exact thing this condition exists to remove.
  const source = words(question.text);
  const rewrite = words(text);
  const sixGrams = new Set<string>();
  for (let at = 0; at + 6 <= source.length; at++) {
    sixGrams.add(source.slice(at, at + 6).join(' '));
  }
  for (let at = 0; at + 6 <= rewrite.length; at++) {
    if (sixGrams.has(rewrite.slice(at, at + 6).join(' '))) {
      reasons.push('copies six words from the documentation');
      break;
    }
  }

  // **An answer that is about the question rather than the code**, which models produce when they decline.
  if (/^(i |i'm |sorry|cannot|can't|unable|as an ai)/i.test(text)) reasons.push('is a refusal');

  return reasons;
}

/** One corpus row: the question the symbol's documentation gives, and the model's rewrite of it. */
interface CorpusRow {
  key: string;
  repo: string;
  symbol: string;
  filePath: string;
  verbatim: string;
  paraphrase: string;
  /** **Why this row was rejected**, and absent when it was accepted. */
  rejected?: string[];
}

interface ParaphraseCorpus {
  comment: string[];
  generatedAt: string;
  model: string;
  prompt: string;
  cut: number;
  repositories: Array<{ id: string; sha: string; language: string; role: string }>;
  /** **A hash of the rewrites in order**, so a hand-edited corpus is detectable rather than silently a different one. */
  digest: string;
  rows: CorpusRow[];
}

function digestOf(rows: ReadonlyArray<{ key: string; paraphrase: string }>): string {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(`${row.key}\t${row.paraphrase}\n`);
  return `sha256:${hash.digest('hex')}`;
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

/** One completion, waiting out a rate limit. **A 429 is a queue that is too full, not an answer.** */
async function completeWithBackoff(
  provider: DeepSeekProvider,
  prompt: string,
): Promise<Awaited<ReturnType<DeepSeekProvider['complete']>>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.complete(prompt, {
        temperature: 0,
        maxTokens: 120,
        // **One tag per stage**, so a bill can be split between generating questions and answering them.
        tag: 'benchmark:paraphrase',
        timeout: 60_000,
      });
    } catch (error) {
      if (error instanceof LLMRateLimitError && attempt < 3) {
        await sleep(rateLimitDelayMs(error, attempt));
        continue;
      }
      throw error;
    }
  }
}

/** Generate one rewrite, retrying once on a rejected or unusable answer. **A retry is cheaper than a hole.** */
async function rewrite(
  provider: DeepSeekProvider,
  question: Question,
): Promise<{ text: string; reasons: string[]; attempts: number; usd: number }> {
  let reasons: string[] = ['not attempted'];
  let text = '';
  let usd = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const completion = await completeWithBackoff(provider, paraphrasePrompt(question));
    usd += completion.costUsd ?? 0;
    text = completion.content.trim().replace(/^["'`]+|["'`]+$/g, '');
    reasons = rejectionReasons(text, question);
    if (reasons.length === 0) return { text, reasons, attempts: attempt, usd };
  }
  return { text, reasons, attempts: 2, usd };
}

async function main(): Promise<void> {
  const mode = arg('mode', 'replay');
  const out = arg('out', 'benchmarks/multirepo-qa-paraphrase.json');
  const corpusPath = arg('corpus', 'benchmarks/multirepo-qa-paraphrase-corpus.json');
  const cache = arg('cache', '.cache/multirepo-qa');

  const corpus = readCorpus();
  const { store, manager, index, indexMs } = await buildWorkspace(corpus, cache);
  const questions = sampleQuestions(deriveQuestions(store));

  let rows: CorpusRow[];
  let generation: { usd: number; attempts: number; model: string } | undefined;

  if (mode === 'generate') {
    const provider = new DeepSeekProvider({ timeout: 60_000 });
    // **Bounded concurrency, and the results come back in question order** - the corpus is a file a reader diffs, so
    // its rows have to be in the sample's order and not in the order the network answered.
    const results = await mapWithConcurrency(questions, REWRITE_CONCURRENCY, (question) =>
      rewrite(provider, question),
    );
    const usd = results.reduce((sum, result) => sum + result.usd, 0);
    const attempts = results.reduce((sum, result) => sum + result.attempts, 0);
    rows = questions.map((question, index) => {
      const result = results[index]!;
      return {
        key: question.key,
        repo: question.repo,
        symbol: question.symbol,
        filePath: question.filePath,
        verbatim: question.text,
        paraphrase: result.text,
        ...(result.reasons.length > 0 ? { rejected: result.reasons } : {}),
      };
    });
    generation = { usd: Math.round(usd * 1_000_000) / 1_000_000, attempts, model: provider.model };

    const written: ParaphraseCorpus = {
      comment: [
        'The multi-repository question set, rewritten as the question a developer would ask.',
        '',
        'Each `paraphrase` was produced from the same doc comment as `verbatim`, under the rules in',
        '`scripts/multirepo-paraphrase.ts`: no symbol name in any spelling, no copied phrase of six words, a question.',
        'A row with `rejected` failed those rules twice and is excluded from the measurement rather than counted as a',
        'miss. The answer key is unchanged - the symbol the documentation belongs to - so the two conditions differ in',
        'wording and in nothing else.',
      ],
      generatedAt: new Date().toISOString(),
      model: provider.model,
      prompt: PROMPT_VERSION,
      cut: CUT,
      repositories: corpus.repositories.map(({ id, sha, language, role }) => ({
        id,
        sha,
        language,
        role,
      })),
      digest: digestOf(rows),
      rows,
    };
    mkdirSync(dirname(corpusPath), { recursive: true });
    writeFileSync(corpusPath, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
    console.log(
      `PARAPHRASE generated=${rows.length} usd=${generation.usd} model=${provider.model}`,
    );
  } else {
    rows = (JSON.parse(readFileSync(corpusPath, 'utf8')) as ParaphraseCorpus).rows;
    const digest = digestOf(rows);
    const recorded = (JSON.parse(readFileSync(corpusPath, 'utf8')) as ParaphraseCorpus).digest;
    // **A corpus whose rows no longer hash to its own digest was edited**, and an edited question set is a different
    // measurement rather than a corrected one.
    if (digest !== recorded) throw new Error(`corpus digest ${digest} does not match ${recorded}`);
  }

  // **Only the rows that passed**, and only the ones the run's question set contains: a corpus generated against a
  // different sample (a commit moved, a filter changed) must not be quietly intersected into a smaller measurement.
  const accepted = rows.filter((row) => row.rejected === undefined);
  const byKey = new Map(questions.map((question) => [question.key, question]));
  const missing = accepted.filter((row) => !byKey.has(row.key));
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} corpus rows are not in this run's question set, so the two conditions would be different samples`,
    );
  }

  const engine = new FederatedSearchEngine(store, manager);

  // **The vector channel, built once and registered on its own engine**, so the lexical columns keep the engine they
  // were measured on. `--embed` is refused rather than degraded when no model answers: a hash-vector run reporting a
  // semantic figure is the defect `embedding-backend.yml` exists to prevent, and it is cheaper to refuse here.
  const semantic = process.argv.includes('--embed')
    ? await embedWorkspace(
        { store, manager, index, indexMs },
        {
          model: process.env['ZHIPU_EMBEDDING_MODEL'] ?? null,
        },
      )
    : null;
  if (process.argv.includes('--embed')) {
    if (semantic === null) {
      throw new Error(
        "--embed was asked for and no query embedder could be built in the index's space: a cosine across two spaces is not a semantic figure",
      );
    }
    if (semantic.index === 'deterministic') {
      throw new Error(
        '--embed was asked for and the index fell back to hash vectors: set ZHIPU_API_KEY on a runner rather than publishing a semantic figure that used no model',
      );
    }
  }
  const semanticEngine = semantic === null ? null : new FederatedSearchEngine(store, manager);
  if (semantic !== null && semanticEngine !== null) {
    semanticEngine.registerEmbeddings(semantic.lookup, semantic.embed);
  }

  const verbatimFederated: Array<number | null> = [];
  const verbatimScoped: Array<number | null> = [];
  const paraphraseFederated: Array<number | null> = [];
  const paraphraseScoped: Array<number | null> = [];
  const semanticParaphrase: Array<number | null> = [];
  const semanticParaphraseScoped: Array<number | null> = [];
  const semanticVerbatim: Array<number | null> = [];

  for (const row of accepted) {
    const question = byKey.get(row.key)!;
    const asked = { ...question, text: row.paraphrase };

    const open = await engine.search(row.paraphrase, { maxResults: DEPTH });
    paraphraseFederated.push(rankOf(open.results, asked));

    const narrowed = await engine.search(row.paraphrase, {
      maxResults: DEPTH,
      repoFilter: [repoName(row.repo)],
    });
    paraphraseScoped.push(rankOf(narrowed.results, asked));

    // **The same two questions in the same run**, because a verbatim figure from another run would carry the index and
    // the engine's own drift into a difference that is supposed to be about wording alone.
    const openVerbatim = await engine.search(row.verbatim, { maxResults: DEPTH });
    verbatimFederated.push(rankOf(openVerbatim.results, question));

    const narrowedVerbatim = await engine.search(row.verbatim, {
      maxResults: DEPTH,
      repoFilter: [repoName(row.repo)],
    });
    verbatimScoped.push(rankOf(narrowedVerbatim.results, question));

    // **The vector channel over the same questions, on the same index, in the same pass.** The verbatim column is kept
    // because a channel that helps a rewritten question and costs a quoted one has not been shown to help: §37.5
    // recorded exactly that trade for the lexical change and it had to be stated rather than averaged away.
    if (semanticEngine !== null) {
      const fused = await semanticEngine.search(row.paraphrase, { maxResults: DEPTH });
      semanticParaphrase.push(rankOf(fused.results, asked));

      const fusedScoped = await semanticEngine.search(row.paraphrase, {
        maxResults: DEPTH,
        repoFilter: [repoName(row.repo)],
      });
      semanticParaphraseScoped.push(rankOf(fusedScoped.results, asked));

      const fusedVerbatim = await semanticEngine.search(row.verbatim, { maxResults: DEPTH });
      semanticVerbatim.push(rankOf(fusedVerbatim.results, question));
    }
  }

  const artifact = {
    comment: [
      'The same symbols, asked twice: once as the doc comment reads and once as a model rewrote it.',
      '',
      'Both conditions are measured in one run over one index, so the difference between them is the wording of the',
      'question and not the corpus, the embedding backend or the engine. Every aggregate can be recomputed from',
      '`perQuestion`, and a test does recompute them.',
    ],
    measuredAt: new Date().toISOString(),
    cut: CUT,
    depth: DEPTH,
    model: generation?.model ?? 'replayed',
    prompt: PROMPT_VERSION,
    index: { ...index, durationMs: indexMs },
    // **`null` is the lexical run and a named space is the vector run**, so a reader can tell two artifacts apart
    // without a document and a downstream gate can refuse a semantic claim that has no space.
    space:
      semantic === null
        ? null
        : {
            index: semantic.index,
            query: semantic.query,
            model: semantic.model,
            reason: semantic.reason,
            vectors: semantic.vectors,
            embedMs: semantic.embedMs,
          },
    corpus: corpus.repositories.map(({ id, sha, language, role }) => ({ id, sha, language, role })),
    questions: {
      sampled: questions.length,
      generated: rows.length,
      accepted: accepted.length,
      rejected: rows.length - accepted.length,
      namesItsAnswer: accepted.filter((row) => {
        const question = byKey.get(row.key)!;
        return row.paraphrase.toLowerCase().includes(question.symbol.toLowerCase());
      }).length,
    },
    ...(generation ? { generation } : {}),
    conditions: {
      verbatimFederated: score(verbatimFederated),
      verbatimScoped: score(verbatimScoped),
      paraphraseFederated: score(paraphraseFederated),
      paraphraseScoped: score(paraphraseScoped),
      ...(semanticEngine === null
        ? {}
        : {
            semanticParaphrase: score(semanticParaphrase),
            semanticParaphraseScoped: score(semanticParaphraseScoped),
            semanticVerbatim: score(semanticVerbatim),
          }),
    },
    paired: {
      // **The two questions this file exists to answer.** The first is what wording costs; the other two are what the
      // three neighbouring repositories cost, asked once under each wording - because a scope that helps by three
      // questions when the question quotes the documentation may help by far more when it does not, and the difference
      // between those two numbers is the price of a first stage that only works on quoted text.
      'paraphrase-vs-verbatim-federated': compareArms(paraphraseFederated, verbatimFederated),
      'paraphrase-vs-verbatim-scoped': compareArms(paraphraseScoped, verbatimScoped),
      'paraphrase-scoped-vs-federated': compareArms(paraphraseScoped, paraphraseFederated),
      'verbatim-scoped-vs-federated': compareArms(verbatimScoped, verbatimFederated),
      // **Whether the vector channel changes either condition, paired on the same rows.** The verbatim pair is the
      // regression guard: a semantic half that lifts the rewritten questions and drops the quoted ones has moved the
      // defect rather than fixed it.
      ...(semanticEngine === null
        ? {}
        : {
            'semantic-vs-lexical-paraphrase': compareArms(semanticParaphrase, paraphraseFederated),
            'semantic-vs-lexical-verbatim': compareArms(semanticVerbatim, verbatimFederated),
            'semantic-scoped-vs-federated-paraphrase': compareArms(
              semanticParaphraseScoped,
              semanticParaphrase,
            ),
          }),
    },
    perQuestion: {
      keys: accepted.map((row) => row.key),
      verbatim: encodeRanks(verbatimFederated),
      verbatimScoped: encodeRanks(verbatimScoped),
      paraphrase: encodeRanks(paraphraseFederated),
      paraphraseScoped: encodeRanks(paraphraseScoped),
      ...(semanticEngine === null
        ? {}
        : {
            semanticParaphrase: encodeRanks(semanticParaphrase),
            semanticParaphraseScoped: encodeRanks(semanticParaphraseScoped),
            semanticVerbatim: encodeRanks(semanticVerbatim),
          }),
    },
    rejected: rows
      .filter((row) => row.rejected !== undefined)
      .map((row) => ({
        key: row.key,
        reasons: row.rejected,
      })),
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const rate = (condition: { found: number; n: number }): string =>
    `${((100 * condition.found) / Math.max(1, condition.n)).toFixed(1)}%`;
  console.log(
    `PARAPHRASE scored=${accepted.length} rejected=${rows.length - accepted.length} nodes=${index.totalNodes}`,
  );
  console.log(
    `PARAPHRASE verbatim   federated found@10=${rate(artifact.conditions.verbatimFederated)} mrr=${artifact.conditions.verbatimFederated.mrr} scoped=${artifact.conditions.verbatimScoped.mrr}`,
  );
  console.log(
    `PARAPHRASE paraphrase federated found@10=${rate(artifact.conditions.paraphraseFederated)} mrr=${artifact.conditions.paraphraseFederated.mrr} scoped=${artifact.conditions.paraphraseScoped.mrr}`,
  );
  for (const [name, pair] of Object.entries(artifact.paired)) {
    console.log(
      `PARAPHRASE-PAIRED pair=${name} deltaMrr=${pair.deltaMrr.toFixed(4)} ci [${pair.mrrInterval[0].toFixed(4)},${pair.mrrInterval[1].toFixed(4)}] ` +
        `onlyParaphrase=${pair.onlyA} onlyVerbatim=${pair.onlyB} p=${pair.pValue.toFixed(4)}`,
    );
  }
  if (semantic !== null) {
    console.log(
      `PARAPHRASE space index=${semantic.index} query=${semantic.query} model=${semantic.model ?? 'none'} vectors=${semantic.vectors} embedMs=${semantic.embedMs}`,
    );
    console.log(
      `PARAPHRASE semantic paraphrase found@10=${rate(artifact.conditions.semanticParaphrase!)} mrr=${artifact.conditions.semanticParaphrase!.mrr} verbatim found@10=${rate(artifact.conditions.semanticVerbatim!)} mrr=${artifact.conditions.semanticVerbatim!.mrr}`,
    );
  }

  // **The columns and the aggregates are printed together**, and the gate test recomputes one from the other.
  const decoded = decodeRanks(artifact.perQuestion.paraphrase, accepted.length);
  if (decoded.length !== accepted.length) throw new Error('paraphrase column did not decode');
  store.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
