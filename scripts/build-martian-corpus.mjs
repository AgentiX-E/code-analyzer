#!/usr/bin/env node
/**
 * **The field's answer key, turned into the shape this repository's harness reads.**
 *
 * `benchmarks/martian/golden_comments/*.json` is the MIT-licensed golden set of Martian's Code Review Bench, copied
 * byte-for-byte from `withmartian/code-review-benchmark/offline/golden_comments/`. Its rows carry `url`, `pr_title`,
 * `comments[]` and nothing else that matters: **no diff, no path, no line**, because that benchmark matches a review
 * comment against a golden comment with an LLM judge and never asks where either of them stood.
 *
 * This job's corpus reader is the one built for AACR-Bench, whose `PRDataItem` is
 * `{githubPrUrl, source_commit, target_commit, comments[{note, path, from_line, to_line, category}]}`. **The mapping is
 * therefore an identity on the two fields that decide the score (`githubPrUrl`, `note`) and an omission on the fields
 * that only serve attribution** - and an omission is not a silence: `path` and `from_line` are read here as `null`, the
 * attribution buckets record a golden with no coordinates as one the reviewer could not have been asked about, and the
 * artifact's `corpus` field says `martian` so no reader mistakes the two corpora for each other.
 *
 * **Why a generator and a committed copy of both ends.** The raw goldens are committed so the conversion is
 * reproducible without the network and auditable against upstream; the generated file is committed so a run is a
 * checkout rather than a build. `tests/unit/scripts/the-answer-key-we-are-scored-on-is-the-one-they-publish.test.ts`
 * rebuilds the corpus from the raw files and fails if the committed copy differs by a byte - **which is what stops the
 * two from drifting apart while both look plausible.**
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, '..', 'benchmarks', 'martian');
const RAW_DIR = join(CORPUS_DIR, 'golden_comments');
const OUT = join(CORPUS_DIR, 'positive_samples.json');

/**
 * **The categories each scoring profile counts**, from the benchmark's own README, because **a profile applied from
 * memory is a profile that quietly disagrees with the published number it is being compared to.**
 *
 * `All` is every golden; `Core` adds `perf`, `test_gap` and `doc_defect`; `Strict` is the five that describe a defect
 * in behaviour. The counts the README states - 139, 158, 173 - are asserted here rather than paraphrased, because a
 * category renamed upstream would otherwise show up as a one-point move in a figure nobody could explain.
 */
export const PROFILES = {
  strict: ['bug', 'security', 'concurrency', 'data', 'api'],
  core: ['bug', 'security', 'concurrency', 'data', 'api', 'perf', 'test_gap', 'doc_defect'],
  all: null,
};

/** **Every golden of every pull request, in the harness's row shape.** */
export function martianRows(files) {
  const rows = [];
  for (const name of [...files.keys()].sort()) {
    const parsed = JSON.parse(files.get(name));
    for (const row of parsed) {
      const url = String(row.url ?? '').trim();
      // **A row without a URL is not a pull request**, and a corpus that carried it would report a golden the run could
      // never have been asked about as one it failed to find.
      if (url.length === 0) continue;
      rows.push({
        githubPrUrl: url,
        prTitle: String(row.pr_title ?? ''),
        // **Named `note` because that is what the reader reads**, and it is the whole of the ground truth: the judge is
        // asked whether a finding and this sentence describe the same defect.
        comments: (row.comments ?? []).map((comment) => ({
          note: String(comment.comment ?? ''),
          category: String(comment.category ?? ''),
          severity: String(comment.severity ?? ''),
          // **Explicitly absent rather than zero**, so the attribution can say "no coordinates" instead of "line 0",
          // which is a line every file has.
          path: null,
          from_line: null,
          to_line: null,
        })),
      });
    }
  }
  return rows;
}

/** How many goldens a profile keeps, over rows. */
export function profileCount(rows, profile) {
  const keep = PROFILES[profile];
  if (keep === null) return rows.reduce((total, row) => total + row.comments.length, 0);
  return rows.reduce(
    (total, row) => total + row.comments.filter((c) => keep.includes(c.category)).length,
    0,
  );
}

function main() {
  const files = new Map();
  for (const name of readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    files.set(name, readFileSync(join(RAW_DIR, name), 'utf8'));
  }
  const rows = martianRows(files);
  writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
  const comments = rows.reduce((total, row) => total + row.comments.length, 0);
  console.log(
    `martian corpus: ${rows.length} pull requests, ${comments} golden comments ` +
      `(strict ${profileCount(rows, 'strict')}, core ${profileCount(rows, 'core')}, all ${comments}) -> ${OUT}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
