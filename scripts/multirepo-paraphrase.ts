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
  scoreBy,
  trimToQuota,
  type Question,
} from './lib/multirepo-harness.js';
import { FederatedSearchEngine } from '../packages/intelligence/src/cross-repo/federated-search.js';
import {
  DeepSeekProvider,
  LLMRateLimitError,
} from '../packages/intelligence/src/review/llm/provider.js';
import {
  FUSION_RULE_NAMES,
  type FusionRuleName,
} from '../packages/intelligence/src/search/fusion-rules.js';
import {
  channelEvidence,
  evidenceRatioWeight,
} from '../packages/intelligence/src/search/fusion-weight.js';
import {
  compareArms,
  decodeRanks,
  encodeRanks,
} from '../packages/intelligence/src/search/paired-stats.js';
import { rateLimitDelayMs } from '../packages/intelligence/src/search/rerank.js';
import { mapWithConcurrency } from '../packages/shared/src/index.js';

const DEPTH = CUT;

/**
 * **A column of weights or shares, written as the three decimals they are.**
 *
 * Not `encodeRanks`: that encoder is a rank's encoder and `decodeRanks` rejects anything that is not a 1-based integer,
 * so a weight written through it would be a published column its own reader refuses to read. Three decimals is the
 * resolution every share in this file is computed at, and it is what a reader needs to recompute a weight from the two
 * shares it came out of.
 */
function shareOf(values: readonly number[]): string {
  return values.map((value) => String(Math.round(value * 1_000) / 1_000)).join(',');
}

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

/**
 * **The denominator the sample is drawn for, stated once.**
 *
 * Four hundred because that is a denominator an effect of three questions can be stated against, and because every
 * question is a paid rewrite rather than a free lookup. It is passed to `sampleQuestions` and to `trimToQuota`, so the
 * two cannot disagree about what the quota is.
 */
const SAMPLE_TARGET = 400;

async function main(): Promise<void> {
  const mode = arg('mode', 'replay');
  const out = arg('out', 'benchmarks/multirepo-qa-paraphrase.json');
  const corpusPath = arg('corpus', 'benchmarks/multirepo-qa-paraphrase-corpus.json');
  const cache = arg('cache', '.cache/multirepo-qa');

  const corpus = readCorpus();
  const { store, manager, index, indexMs } = await buildWorkspace(corpus, cache);
  const questions = sampleQuestions(deriveQuestions(store), SAMPLE_TARGET);

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

  /**
   * **The rows that count, which is the accepted set trimmed to the quota it was sampled for.**
   *
   * §41.3's R1 promised every repository 60–70 scored rows, the first six-repository run produced 59 from `flask`
   * because eight of its sixty-seven rewrites were rejected twice, and the gate refused the artifact. **The refusal was
   * correct and the band was not the fix**: the quota is a promise about scored rows, so it belongs to the accepted set.
   * With a target of 400 over six repositories the trim is inert at 370 accepted - it can only remove rows, and it does
   * not remove rows to hit a number - and it becomes the piece that keeps a future `generate` run with headroom from
   * letting one repository carry more than its share.
   */
  const scored = trimToQuota(accepted, (row) => row.repo, SAMPLE_TARGET);

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

  /**
   * The weights to sweep, when a run is measuring the fusion rather than using it.
   *
   * **`deriveVectorWeight` reads the question and returns 4 for a paraphrase** - the share of the question's terms the
   * lexical best answer carries is low, so the vector list is allowed to dominate - and on this corpus that fused column
   * is 22 points worse than the lexical one (§38.1). **A weight that can move a figure by 22 points is a variable, not a
   * setting**, so the sweep that the single-repository corpora already run is available here as an input: four weights,
   * one dispatch, the same vectors, the same questions.
   *
   * **Empty by default**, because a run that does not ask for a sweep should not pay for one in wall clock.
   */
  const weights = arg('weights', '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);

  const verbatimFederated: Array<number | null> = [];
  const verbatimScoped: Array<number | null> = [];
  const paraphraseFederated: Array<number | null> = [];
  const paraphraseScoped: Array<number | null> = [];
  const semanticParaphrase: Array<number | null> = [];
  const semanticParaphraseScoped: Array<number | null> = [];
  const semanticVerbatim: Array<number | null> = [];
  /** One column per swept weight, in the order the weights were given. */
  const swept = new Map<number, Array<number | null>>();

  /**
   * **The two-sided candidate's columns, and the two numbers it is made of.**
   *
   * `deriveVectorWeight` reads the lexical list alone and §38.1 measured what that costs on this corpus: the derived
   * weight is four for a rewritten question, and four is the worst of the four weights the sweep scored. The rule was
   * fitted where the vector channel is the stronger one (CoSQA) and applied where it is the weaker one, and **a rule
   * that reads one side of a compromise cannot notice that**.
   *
   * `evidenceRatioWeight` asks the comparative question - which list carries more of the question - and these columns
   * are what decide whether the comparison is worth adopting (§39). Both conditions are measured, because a rule that
   * lifts the rewritten questions and costs the quoted ones has moved the defect rather than fixed it.
   */
  /**
   * **Which fusion mechanisms to measure, on the two lists this run already paid for.**
   *
   * §39 measured five weights of one rule and retired the two rules it tried for deriving them; the mechanisms - normalised
   * score summation, support gating, query-performance prediction - were never on this corpus. **Every column here costs
   * one fusion over fifty entries and no model call**, because the lists come from `channels()` once per question and are
   * fused by `fuse()`, which is the second half of the product's own `search()` (§40).
   */
  const rules = arg('rules', '')
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is FusionRuleName =>
      (FUSION_RULE_NAMES as readonly string[]).includes(value),
    );
  const ruleParaphrase = new Map<FusionRuleName, Array<number | null>>(
    rules.map((rule) => [rule, [] as Array<number | null>]),
  );
  const ruleVerbatim = new Map<FusionRuleName, Array<number | null>>(
    rules.map((rule) => [rule, [] as Array<number | null>]),
  );

  const candidateParaphrase: Array<number | null> = [];
  const candidateVerbatim: Array<number | null> = [];
  const candidateWeights: number[] = [];
  const lexicalEvidence: number[] = [];
  const vectorEvidence: number[] = [];

  for (const row of scored) {
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

      // **The sweep, on the same rows and the same vectors.** Only the weight differs, so the columns are comparable
      // question by question and the paired test says which of them found what the others did not.
      for (const weight of weights) {
        const column = swept.get(weight) ?? [];
        const at = await semanticEngine.search(row.paraphrase, {
          maxResults: DEPTH,
          vectorWeight: weight,
        });
        column.push(rankOf(at.results, asked));
        swept.set(weight, column);
      }

      // **The two lists the engine fused, read before it fused them**, so the candidate weight is a statement about the
      // retrieval the answer came from and not about a second one. `channels()` builds the same filters `search()`
      // does: five hundred lines of harness would otherwise be able to disagree with the product about what a channel
      // is, and the disagreement would look like a rule that does not work.
      const channels = await semanticEngine.channels(row.paraphrase, { maxResults: DEPTH });
      const lexicalShare = channelEvidence(row.paraphrase, channels.lexical);
      const vectorShare = channelEvidence(row.paraphrase, channels.vector);
      lexicalEvidence.push(lexicalShare);
      vectorEvidence.push(vectorShare);

      const candidateWeight = evidenceRatioWeight(
        channels.lexical,
        channels.vector,
        row.paraphrase,
      );
      candidateWeights.push(candidateWeight);

      const candidate = await semanticEngine.search(row.paraphrase, {
        maxResults: DEPTH,
        vectorWeight: candidateWeight,
      });
      candidateParaphrase.push(rankOf(candidate.results, asked));

      // **The regression guard, on the same rule.** A candidate that only lifts the rewritten questions is a candidate
      // that has moved the vector channel's vote, not one that has improved it.
      const candidateOnQuoted = await semanticEngine.search(row.verbatim, {
        maxResults: DEPTH,
        vectorWeight: candidateWeight,
      });
      candidateVerbatim.push(rankOf(candidateOnQuoted.results, question));

      if (rules.length > 0) {
        // **The quoted condition is fetched once and fused many times**, because the retrieval is the paid half and the
        // fusion is arithmetic. A loop that called `search()` per rule would embed the same question five times and
        // would make a free experiment cost a paid one.
        const quoted = await semanticEngine.channels(row.verbatim, { maxResults: DEPTH });
        for (const rule of rules) {
          ruleParaphrase.get(rule)!.push(
            rankOf(
              semanticEngine.fuse(row.paraphrase, channels, {
                maxResults: DEPTH,
                fusionRule: rule,
              }).results,
              asked,
            ),
          );
          ruleVerbatim
            .get(rule)!
            .push(
              rankOf(
                semanticEngine.fuse(row.verbatim, quoted, { maxResults: DEPTH, fusionRule: rule })
                  .results,
                question,
              ),
            );
        }
      }
    }
  }

  /**
   * **The whole figure and the parts of it.** Until this block existed the artifact published one aggregate per
   * condition and one column per question, so a reader could see the sum and the rows and nothing in between: the
   * corpus file said "six repositories" and no number here could contradict it - and on the previous corpus the
   * contradiction was real, with one repository contributing 67 per cent of every figure.
   *
   * The arithmetic is `score()`, applied to a subset, because a per-repository MRR computed by a second formula would be
   * a second definition of MRR and the two would drift.
   */
  const acceptedQuestions = scored.map((row) => byKey.get(row.key)!);
  const languageOf = new Map(corpus.repositories.map((repo) => [repo.id, repo.language]));
  const byRepository = {
    paraphraseFederated: scoreBy(
      acceptedQuestions,
      paraphraseFederated,
      (question) => question.repo,
    ),
    paraphraseScoped: scoreBy(acceptedQuestions, paraphraseScoped, (question) => question.repo),
    verbatimFederated: scoreBy(acceptedQuestions, verbatimFederated, (question) => question.repo),
    ...(semanticEngine === null
      ? {}
      : {
          semanticParaphrase: scoreBy(
            acceptedQuestions,
            semanticParaphrase,
            (question) => question.repo,
          ),
          semanticVerbatim: scoreBy(
            acceptedQuestions,
            semanticVerbatim,
            (question) => question.repo,
          ),
        }),
  };
  const byLanguage = {
    paraphraseFederated: scoreBy(
      acceptedQuestions,
      paraphraseFederated,
      (question) => languageOf.get(question.repo) ?? '',
    ),
    paraphraseScoped: scoreBy(
      acceptedQuestions,
      paraphraseScoped,
      (question) => languageOf.get(question.repo) ?? '',
    ),
    verbatimFederated: scoreBy(
      acceptedQuestions,
      verbatimFederated,
      (question) => languageOf.get(question.repo) ?? '',
    ),
    ...(semanticEngine === null
      ? {}
      : {
          semanticParaphrase: scoreBy(
            acceptedQuestions,
            semanticParaphrase,
            (question) => languageOf.get(question.repo) ?? '',
          ),
          semanticVerbatim: scoreBy(
            acceptedQuestions,
            semanticVerbatim,
            (question) => languageOf.get(question.repo) ?? '',
          ),
        }),
  };

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
      // **What the aggregates are over**, which is not the accepted count when a trim applies: an artifact whose
      // `n` and whose row count disagree is an artifact nobody can replay.
      scored: scored.length,
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
    // **The parts of every figure above**, per repository and per language: a corpus that names six repositories owes a
    // reader the six numbers, and the quota is only real if the artifact shows it holding.
    byRepository,
    byLanguage,
    // **The sweep, when one was asked for**, each column scored and paired against the lexical list it is a re-weighting
    // of. A column that beats 0.7930 is a weight the product could adopt; a column that does not is evidence that the
    // channel is not a channel this corpus can use, and both are results.
    ...(swept.size === 0
      ? {}
      : {
          semanticSweep: Object.fromEntries(
            [...swept.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([weight, column]) => [
                String(weight),
                { ...score(column), paired: compareArms(column, paraphraseFederated) },
              ]),
          ),
        }),
    // **The two-sided candidate beside the one-sided rule it would replace**, on both conditions, because a rule that
    // wins on rewritten questions and loses on quoted ones has moved the defect. **`null` when no vectors were
    // registered**: a candidate weight multiplies a list that does not exist, and a score for it would be a lexical
    // figure wearing a ratio's name.
    candidate:
      semanticEngine === null
        ? null
        : {
            paraphrase: {
              ...score(candidateParaphrase),
              paired: compareArms(candidateParaphrase, paraphraseFederated),
            },
            verbatim: {
              ...score(candidateVerbatim),
              paired: compareArms(candidateVerbatim, verbatimFederated),
            },
            weight: {
              min: Math.min(...candidateWeights),
              p50: [...candidateWeights].sort((a, b) => a - b)[
                Math.floor(candidateWeights.length / 2)
              ]!,
              max: Math.max(...candidateWeights),
              atFloor: candidateWeights.filter((weight) => weight <= 0.1).length,
              atCeiling: candidateWeights.filter((weight) => weight >= 4).length,
            },
            evidence: {
              lexicalP50: [...lexicalEvidence].sort((a, b) => a - b)[
                Math.floor(lexicalEvidence.length / 2)
              ]!,
              vectorP50: [...vectorEvidence].sort((a, b) => a - b)[
                Math.floor(vectorEvidence.length / 2)
              ]!,
              // **How often the two-sided rule gives the vector list more than half the vote.** The one-sided rule put
              // 467 of 500 CoSQA questions at the ceiling; a rule that puts every question at the ceiling here would be
              // the same rule with more arithmetic.
              vectorAhead: lexicalEvidence.filter((value, at) => vectorEvidence[at]! > value)
                .length,
            },
          },
    /**
     * **The tournament, on both conditions of the same run.**
     *
     * Each row is one mechanism, scored on the two lists this run already had, with the paired verdict against **the
     * lexical list alone** - because the figure a mechanism has to beat is not the shipped rule's, it is not fusing:
     * §39 measured the shipped rule at 0.6498 against the lexical list's 0.7930 on these questions.
     *
     * **`null` when no vectors were registered**, for the same reason every other semantic block is: a mechanism that
     * fuses one list is a constant multiplying every candidate, so a score for it would be a lexical figure wearing a
     * fusion's name.
     */
    tournament:
      semanticEngine === null || rules.length === 0
        ? null
        : Object.fromEntries(
            rules.map((rule) => [
              rule,
              {
                paraphrase: {
                  ...score(ruleParaphrase.get(rule)!),
                  paired: compareArms(ruleParaphrase.get(rule)!, paraphraseFederated),
                },
                verbatim: {
                  ...score(ruleVerbatim.get(rule)!),
                  paired: compareArms(ruleVerbatim.get(rule)!, verbatimFederated),
                },
              },
            ]),
          ),
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
            // **The two rules against each other, and the candidate against the list it has to beat.** A rule that beats
            // its predecessor while losing to no fusion at all should be turned off, and these two pairs are what tell
            // them apart.
            'candidate-vs-derived-paraphrase': compareArms(candidateParaphrase, semanticParaphrase),
            'candidate-vs-lexical-paraphrase': compareArms(
              candidateParaphrase,
              paraphraseFederated,
            ),
            'candidate-vs-derived-verbatim': compareArms(candidateVerbatim, semanticVerbatim),
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
            // **The candidate's column and the two numbers it is made of.** Without them the candidate block above is a
            // figure a reader has to trust; with them it is a figure a reader can recompute from the artifact alone,
            // which is the rule every other column in this file follows.
            candidate: encodeRanks(candidateParaphrase),
            candidateVerbatim: encodeRanks(candidateVerbatim),
            // **Decimals rather than `encodeRanks`**, because a weight is not a rank: `decodeRanks` refuses a
            // non-integer on purpose, and a column its own reader rejects is a column nobody can check.
            candidateWeight: shareOf(candidateWeights),
            lexicalEvidence: shareOf(lexicalEvidence),
            vectorEvidence: shareOf(vectorEvidence),
            // **One column per mechanism, under both conditions**, so the table above can be re-derived from the
            // artifact - which is what lets the next sweep of these same vectors be analysed without the key.
            ...(rules.length === 0
              ? {}
              : Object.fromEntries(
                  rules.flatMap((rule) => [
                    [`rule:${rule}`, encodeRanks(ruleParaphrase.get(rule)!)],
                    [`ruleVerbatim:${rule}`, encodeRanks(ruleVerbatim.get(rule)!)],
                  ]),
                )),
          }),
      // **One column per swept weight.** The sweep published four aggregates and no columns, so a reader could compare
      // the totals and could not ask which questions moved between them - and a weight that helps fourteen and hurts one
      // is a different finding from a weight that helps fifteen, which is what the paired count says and what only the
      // columns can check. It is also what lets the next sweep be analysed without re-embedding a corpus.
      ...(swept.size === 0
        ? {}
        : {
            sweep: Object.fromEntries(
              [...swept.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([weight, column]) => [String(weight), encodeRanks(column)]),
            ),
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
  if (semantic !== null) {
    const candidate = artifact.candidate!;
    console.log(
      `PARAPHRASE-CANDIDATE paraphrase found@10=${rate(candidate.paraphrase)} mrr=${candidate.paraphrase.mrr} ` +
        `verbatim found@10=${rate(candidate.verbatim)} mrr=${candidate.verbatim.mrr} ` +
        `vsDerived onlyCandidate=${candidate.paraphrase.paired.onlyA} onlyDerived=${candidate.paraphrase.paired.onlyB} p=${candidate.paraphrase.paired.pValue.toFixed(4)} ` +
        `vsLexical onlyCandidate=${candidate.paraphrase.paired.onlyA} p=${candidate.paraphrase.paired.pValue.toFixed(4)} ` +
        `weight min=${candidate.weight.min} p50=${candidate.weight.p50} max=${candidate.weight.max} ` +
        `atFloor=${candidate.weight.atFloor} atCeiling=${candidate.weight.atCeiling} ` +
        `lexicalEvidence=${candidate.evidence.lexicalP50} vectorEvidence=${candidate.evidence.vectorP50} vectorAhead=${candidate.evidence.vectorAhead}`,
    );
    for (const [name, pair] of Object.entries(artifact.paired).filter(([key]) =>
      key.startsWith('candidate-'),
    )) {
      console.log(
        `PARAPHRASE-CANDIDATE-PAIRED pair=${name} deltaMrr=${pair.deltaMrr.toFixed(4)} ` +
          `onlyA=${pair.onlyA} onlyB=${pair.onlyB} p=${pair.pValue.toFixed(4)}`,
      );
    }
  }

  if (artifact.tournament !== null) {
    // **One line per mechanism and one per condition**, on the same three columns the sweep prints, so the comparison a
    // reader makes between mechanisms is a comparison between rows rather than between documents.
    for (const [rule, rows] of Object.entries(artifact.tournament)) {
      console.log(
        `PARAPHRASE-RULE rule=${rule} paraphrase found@10=${rate(rows.paraphrase)} mrr=${rows.paraphrase.mrr} ` +
          `verbatim found@10=${rate(rows.verbatim)} mrr=${rows.verbatim.mrr} ` +
          `vsLexicalParaphrase onlyRule=${rows.paraphrase.paired.onlyA} onlyLexical=${rows.paraphrase.paired.onlyB} p=${rows.paraphrase.paired.pValue.toFixed(4)} ` +
          `vsLexicalVerbatim onlyRule=${rows.verbatim.paired.onlyA} onlyLexical=${rows.verbatim.paired.onlyB} p=${rows.verbatim.paired.pValue.toFixed(4)}`,
      );
    }
  }

  // **One line per weight**, because the sweep's whole point is a column a reader can compare with the lexical one it
  // is a re-weighting of - and the paired counts are what say whether a difference is a difference or a coin toss.
  for (const [weight, column] of Object.entries(artifact.semanticSweep ?? {})) {
    console.log(
      `PARAPHRASE-SWEEP weight=${weight} found@10=${((100 * column.found) / Math.max(1, column.n)).toFixed(1)}% mrr=${column.mrr} ` +
        `onlySweep=${column.paired.onlyA} onlyLexical=${column.paired.onlyB} p=${column.paired.pValue.toFixed(4)} deltaMrr=${column.paired.deltaMrr.toFixed(4)}`,
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
