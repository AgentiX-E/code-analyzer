#!/usr/bin/env node
/**
 * **How much of the answer key the diff can reach, as a picture.**
 *
 * `scripts/corpus-reach.mjs` partitions a slice's goldens by whether the diff the arm was shown has a coordinate for them
 * at all. **The record is the answer and this page draws it**, because "41 of 452 goldens sit on paths the diff does not
 * contain, and neither arm credited one of them" is a sentence a reader has to reconstruct from a JSON file, and two bars
 * are the same statement in one glance.
 *
 * Usage:
 *     node scripts/corpus-reach-page.mjs [--record benchmarks/corpus-reach.json]
 *                                        [--out docs/corpus-reach.html]
 *
 * **Nothing here computes a figure.** Every number is read from the record, and the checks below are about the record's
 * internal consistency rather than about its arithmetic: a version this page does not know, and a bucket table whose rows
 * do not add back up to the slice it decomposes - **a bar drawn from rows that disagree with their own total is a picture
 * of a different run**, and a page is where a figure gets quoted without its sentence.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

/** The sentence a bucket's bar carries, in the corpus's own vocabulary rather than in column names. */
function describe(bucket) {
  if (bucket.bucket === 'inHunk') return 'inside a hunk of the diff';
  if (bucket.bucket === 'outsideHunks') return 'on a path the diff has, outside every hunk';
  if (bucket.bucket === 'absentPath') return 'on a path the diff does not contain';
  return 'on a pull request whose diff could not be read';
}

/**
 * **The page, from a record that is already on disk.**
 *
 * Exported because `corpus-reach.mjs` writes the page from the record it just built and because the test reads the same
 * function - **a page that can only be produced by a run is a page nobody can test**.
 */
export function renderCorpusReach(record) {
  if (record?.version !== 'corpus-reach-v1') {
    throw new Error(`${String(record?.version)} is not corpus-reach-v1`);
  }
  const buckets = Array.isArray(record.buckets) ? record.buckets : [];
  if (buckets.length === 0)
    throw new Error('the record holds no buckets, so there is nothing to draw');
  const summed = buckets.reduce((count, bucket) => count + bucket.goldens, 0);
  if (summed !== record.corpus.goldens) {
    throw new Error(
      `the buckets hold ${String(summed)} goldens against ${String(record.corpus.goldens)} in the slice`,
    );
  }
  const credited = buckets.reduce((count, bucket) => count + bucket.ours, 0);
  if (credited !== record.credited.ours) {
    throw new Error(
      `the buckets credit ${String(credited)} against ${String(record.credited.ours)} in the record`,
    );
  }

  const total = record.corpus.goldens;
  const percent = (value) => `${(value * 100).toFixed(1)}%`;
  const bucketRows = buckets
    .map((bucket) => {
      const width = (bucket.goldens / total) * 100;
      const oursWidth = bucket.goldens === 0 ? 0 : (bucket.ours / bucket.goldens) * width;
      // **Two bars rather than one**, because the question this page draws is a comparison: the dark fill is what our arm
      // credited there and the pale one what theirs did, both as a share of the same bucket - so a bar that looks short is
      // a bucket neither arm reaches rather than a bucket only one of them was drawn for.
      const theirsWidth =
        bucket.theirs === null || bucket.goldens === 0
          ? 0
          : (bucket.theirs / bucket.goldens) * width;
      return `      <tr>
        <th scope="row">${bucket.bucket}<span class="why">${describe(bucket)}</span></th>
        <td class="number">${bucket.goldens}</td>
        <td class="number">${bucket.addedInSpan}</td>
        <td class="bars"><div class="track" style="width:${width.toFixed(2)}%"><div class="hit" style="width:${theirsWidth.toFixed(2)}%"></div><div class="ours" style="width:${oursWidth.toFixed(2)}%"></div></div></td>
        <td class="number">${bucket.ours}</td>
        <td class="number">${bucket.theirs === null ? 'n/a' : bucket.theirs}</td>
      </tr>`;
    })
    .join('\n');

  const addressable = record.addressable;
  const rate = record.rate;
  const theirsAddressable =
    rate.theirsOnAddressable === null ? 'n/a' : percent(rate.theirsOnAddressable);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>How much of the answer key the diff can reach</title>
<style>
  :root { color-scheme: light dark; --ink: #16181d; --dim: #5a6272; --line: #d8dce5; --hit: #2f6f4f; --panel: #f6f7fa; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e8ebf2; --dim: #9aa3b5; --line: #333a48; --hit: #5fbf8c; --panel: #1b1f27; } }
  body { margin: 0 auto; max-width: 62rem; padding: 2.5rem 1.5rem 4rem; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--ink); }
  h1 { font-size: 1.45rem; line-height: 1.25; margin: 0 0 .4rem; letter-spacing: -.01em; }
  p.lead { color: var(--dim); margin: 0 0 2rem; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 1.6rem; }
  th, td { text-align: left; padding: .55rem .5rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
  thead th { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); font-weight: 600; }
  th[scope="row"] { font-weight: 600; }
  .why { display: block; font-weight: 400; color: var(--dim); font-size: .82rem; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  .bars { width: 38%; }
  .track { height: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
  .hit { height: 100%; background: var(--hit); opacity: .35; }
  .ours { position: relative; top: -12px; height: 12px; background: var(--hit); }
  .figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem; margin: 0 0 1.8rem; }
  .figure { border: 1px solid var(--line); border-radius: 6px; padding: .9rem 1rem; background: var(--panel); }
  .figure dt { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 0 0 .25rem; }
  .figure dd { margin: 0; font-size: 1.5rem; font-variant-numeric: tabular-nums; }
  .figure dd small { display: block; font-size: .8rem; color: var(--dim); font-variant-numeric: normal; margin-top: .2rem; }
  footer { color: var(--dim); font-size: .85rem; border-top: 1px solid var(--line); padding-top: 1rem; }
  code { font-size: .88em; }
</style>
</head>
<body>
<h1>How much of the answer key the diff can reach</h1>
<p class="lead">${record.source} · ${total} goldens on ${record.corpus.pullRequests} pull requests · ${record.basis}</p>

<dl class="figures">
  <div class="figure"><dt>addressable goldens</dt><dd>${addressable.goldens}<small>${percent(addressable.share)} of the slice</small></dd></div>
  <div class="figure"><dt>ours, on the addressable</dt><dd>${percent(rate.oursOnAddressable)}<small>${record.credited.ours} credited · ${percent(rate.oursOnSlice)} of the slice</small></dd></div>
  <div class="figure"><dt>theirs, on the addressable</dt><dd>${theirsAddressable}<small>${record.credited.theirs === null ? 'no baseline read' : `${record.credited.theirs} credited · ${percent(rate.theirsOnSlice)} of the slice`}</small></dd></div>
</dl>

<table>
  <thead><tr><th scope="col">where the golden stands</th><th scope="col" class="number">goldens</th><th scope="col" class="number">+added line</th><th scope="col">credited by us</th><th scope="col" class="number">ours</th><th scope="col" class="number">theirs</th></tr></thead>
  <tbody>
${bucketRows}
  </tbody>
</table>

<footer>
  <code>+added line</code> is the stricter question our emission rule asks - a comment must cover a line the change wrote.
  A golden inside a hunk with no added line is reachable by a reviewer and not postable by our gate, which is a product
  decision and the reason the two columns are not the same column.
</footer>
</body>
</html>
`;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const RECORD = argument('--record', join(REPO, 'benchmarks', 'corpus-reach.json'));
  const OUT = argument('--out', join(REPO, 'docs', 'corpus-reach.html'));
  const record = JSON.parse(readFileSync(RECORD, 'utf8'));
  writeFileSync(OUT, renderCorpusReach(record));
  process.stdout.write(`wrote ${OUT}\n`);
}
