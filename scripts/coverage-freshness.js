#!/usr/bin/env node
/**
 * Coverage reports are evidence, and evidence has a date.
 *
 * **What this guards against, measured.** On 2026-11-07 the per-file gate reported every file above 95% on a
 * commit that the runner then failed: `packages/intelligence/src/community/louvain.ts` at 92.59% branches. The
 * report the local gate read had been written thirty minutes *before* that file was rewritten — so the gate was
 * describing a version of the code that no longer existed, and it said "green". A gate cannot tell whether a
 * number is right, but it can tell whether the number is current, and this is that check.
 *
 * The rule is one line of arithmetic: the newest source file named in the report must not be newer than the
 * report itself. Nothing else is compared — no hashes, no git revision — because the summary already carries the
 * absolute paths of the files it measured, and each of those paths still has its modification time.
 *
 * **A path that no longer exists is not staleness.** A deleted file leaves an entry behind in an old summary,
 * and that entry is evidence of a missing file rather than of an old measurement; `baselines:anchors` owns the
 * question of whether a recorded path still exists, and failing here would report one problem as another. Such
 * entries are skipped, which is also what makes the module usable on a summary from another checkout.
 */

'use strict';

const { statSync } = require('node:fs');
const { resolve } = require('node:path');

/**
 * The newest source file a summary names, and whether the summary predates it.
 *
 * @param {string} summaryPath — the coverage-summary.json being read
 * @param {Record<string, unknown>} data — its parsed contents
 * @returns {{ reportMtime: number, newestPath: string, newestMtime: number, lagMs: number } | null}
 *   `null` when the report is at least as new as every source it names.
 */
function staleAgainst(summaryPath, data) {
  let reportMtime;
  try {
    reportMtime = statSync(summaryPath).mtimeMs;
  } catch {
    return null; // the caller has already reported a missing file; nothing to add here
  }

  let newestPath = '';
  let newestMtime = 0;
  for (const filePath of Object.keys(data)) {
    if (filePath === 'total') continue;
    let sourceMtime;
    try {
      sourceMtime = statSync(resolve(filePath)).mtimeMs;
    } catch {
      continue;
    }
    if (sourceMtime > newestMtime) {
      newestMtime = sourceMtime;
      newestPath = filePath;
    }
  }

  if (newestMtime <= reportMtime) return null;
  return { reportMtime, newestPath, newestMtime, lagMs: newestMtime - reportMtime };
}

/** `31m` / `2h 05m` / `4s` — long enough to be legible, short enough for one line. */
function humanLag(lagMs) {
  const seconds = Math.round(lagMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * Fail the calling gate when the report it was handed predates the code it describes.
 *
 * @param {string} summaryPath — the coverage-summary.json being read
 * @param {Record<string, unknown>} data — its parsed contents
 */
function assertCoverageFresh(summaryPath, data) {
  const stale = staleAgainst(summaryPath, data);
  if (!stale) return;

  console.error(
    `\nError: the coverage report at ${summaryPath} is ${humanLag(stale.lagMs)} older than a source file it ` +
      `describes:\n  ${stale.newestPath}\n` +
      'The numbers below would be about a version of that file that is no longer on disk, so they are not ' +
      'evidence about this tree. Regenerate the report from the sources you mean to measure:\n' +
      '  npm run test:coverage\n',
  );
  console.log(
    `::error title=Stale coverage report::${stale.newestPath} is newer than the report by ` +
      `${humanLag(stale.lagMs)} — regenerate it with \`npm run test:coverage\` before reading any number from it.`,
  );
  process.exit(1);
}

module.exports = { staleAgainst, humanLag, assertCoverageFresh };
