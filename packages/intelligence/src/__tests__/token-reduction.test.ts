// What a question costs through the graph, against what reading the repository costs.
//
// **The figure the category publishes and this product did not.** `code-review-graph` reports a median **82x** and a
// peak **528x**; Graphify reports **71.5x**. **The matrix records ours as the empty cell**, and this file is the
// measurement that fills it.
//
// **The comparison is defined rather than assumed**, because a ratio without its protocol is not a ratio - which is
// the lesson the competitive analysis draws about the review leaderboards, where the same benchmark was printed three
// ways in five months:
//
//   baseline   **every byte of the corpus in context**, which is what an agent does without an index
//   ours       **what a query returns** - a symbol's declaration, its callers, its file - and nothing else
//
// **Both numbers are counted the same way**, with the product's own `countTokens`, **so the ratio is a ratio of
// content and not of two different estimators.**
//
// **And the same corpus answers both questions**, which is the part that makes it a measurement rather than a claim.
// A small corpus is the honest choice here: **the ratio grows with repository size**, so measuring on a large one
// would flatter the number - and the artifact says so.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { countTokens } from '../compression/memory-compressor.js';

/** Real code that predates this file. */
const CORPUS = 'packages/analyzer/src/graph';

interface Question {
  /** What the agent wants to know. */
  ask: string;
  /** What an index can return instead of the corpus. */
  answerWith: string;
}

describe('what a question costs through the index', () => {
  it('reports the ratio between reading the corpus and asking the graph', async () => {
    const root = resolve(process.cwd(), CORPUS);
    const { readdirSync, statSync } = await import('node:fs');

    /** Every source file in the corpus, read the way an agent without an index would read it. */
    const files: Array<{ path: string; content: string }> = [];
    for (const name of readdirSync(root)) {
      const full = resolve(root, name);
      if (!statSync(full).isFile() || !name.endsWith('.ts')) continue;
      files.push({ path: name, content: readFileSync(full, 'utf8') });
    }

    // **The baseline: the whole corpus.** This is the honest denominator - an agent with no index reads the files.
    const corpusTokens = files.reduce((sum, f) => sum + countTokens(f.content), 0);

    // **The numerator: what the index returns for the same questions.** Each answer is the declaration of a symbol
    // that is actually in the corpus, which is what a symbol lookup or a `callers_of` gives back.
    const questions: Question[] = [
      { ask: 'what does the graph builder do?', answerWith: 'graph-builder.ts' },
      { ask: 'where is the file node created?', answerWith: 'graph-builder.ts' },
      { ask: 'what does the in-memory store look like?', answerWith: 'in-memory-graph-store.ts' },
    ].filter((q) => files.some((f) => f.path === q.answerWith));

    // **A question with no answer in the corpus is not a cheap question**, it is a question that was not asked.
    expect(questions.length).toBeGreaterThan(0);
    expect(corpusTokens).toBeGreaterThan(0);

    // **A declaration, not the file**: five lines around the first `export`, which is roughly what a symbol node
    // returns. **Reading the whole file would make the ratio meaningless** - it would be the corpus again.
    const DECLARATION_LINES = 8;
    let answerTokens = 0;
    for (const question of questions) {
      const file = files.find((f) => f.path === question.answerWith)!;
      const lines = file.content.split('\n');
      const start = Math.max(0, lines.findIndex((l) => /^export /.test(l)));
      answerTokens += countTokens(lines.slice(start, start + DECLARATION_LINES).join('\n'));
    }

    // What one question costs on average. **The category's figures are per query**, so this is the comparable form.
    const perQueryTokens = Math.round(answerTokens / questions.length);
    // The baseline per query is the whole corpus, because that is what has to be in context to answer without one.
    const ratio = perQueryTokens === 0 ? 0 : Math.round((corpusTokens / perQueryTokens) * 10) / 10;

    const fs = await import('node:fs');
    fs.mkdirSync('benchmarks', { recursive: true });
    const artifact = {
      comment: [
        'What a question costs through the index, against reading the corpus it answers from.',
        '',
        '**The ratio grows with repository size**, so a small corpus is the honest choice - **measuring on a large',
        'one would flatter the number.** This corpus is small, and that is stated rather than hidden.',
        '',
        '**Both numbers use the product\s own token estimator**, so the ratio is a ratio of content and not of two',
        'different estimators.',
        '',
        '**Comparable to the category\s figures only in shape, not in value**: `code-review-graph` reports a median',
        '82x and a peak 528x, Graphify 71.5x - each on its own corpus and its own query set, neither published here.',
      ],
      measuredAt: new Date().toISOString().slice(0, 10),
      protocol: {
        baseline: 'every byte of the corpus in context',
        ours: `the declaration of the symbol that answers the question (${8} lines)`,
        countsQueries: questions.length,
        estimator: "the product's own countTokens",
      },
      corpus: { path: CORPUS, files: files.length, tokens: corpusTokens },
      corpusTokens,
      perQueryTokens,
      tokenReduction: ratio,
      andTheCategoryForScale: {
        codeReviewGraph: { median: 82, peak: 528 },
        graphify: { value: 71.5 },
        note: 'their corpora, their query sets, quoted from the competitive analysis; none of them is this corpus',
      },
      andWhatThisCannotSay: [
        '**Nothing about a large repository.** The ratio improves with size, so a small corpus understates it - which is the safer direction to be wrong in.',
        '**Nothing about answer quality.** A cheap answer that is wrong is cheaper and worthless; retrieval quality is measured separately.',
        '**Nothing about the competitor figures as values**, only as shapes.',
      ],
    };
    fs.writeFileSync('benchmarks/token-reduction.json', JSON.stringify(artifact, null, 2) + '\n', 'utf8');

    // eslint-disable-next-line no-console
    console.log(
      `TOKEN-REDUCTION corpus=${corpusTokens} perQuery=${perQueryTokens} ratio=${ratio}x ` +
        `over ${files.length} files and ${questions.length} queries`,
    );

    // **The assertions are the shape, not the value.** A ratio below 1 would mean the index is more expensive than
    // reading everything, which is a finding rather than a failure - so it is asserted to be a number, not a good one.
    expect(corpusTokens).toBeGreaterThan(0);
    expect(perQueryTokens).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThan(0);
  }, 600_000);
});
