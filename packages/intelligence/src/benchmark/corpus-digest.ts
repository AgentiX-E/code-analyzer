// A corpus digest — which version of a directory a figure was measured on.
//
// **The defect that motivated this file.** `benchmarks/docstring-search.json` records `corpus.nodes: 5735` and
// `measuredAt: "2026-11-03"`, while the same corpus measures **3 257** nodes today on the same 52 files, in CI and
// locally alike. Two runs a week apart, on the same path, disagreeing by 43% about how much was measured — and
// nothing compared them, because a path is not a version. A figure that names a directory has named a moving thing.
//
// The digest is computed rather than written down, because a hand-written revision number is a claim and a hash is
// an observation: the same reason `datasetRevision` was removed from a contract that no report satisfied.
//
// The algorithm is deliberately small enough to reimplement identically in `scripts/corpus-provenance-gate.js`,
// which is JavaScript and cannot import this module: sorted by relative path, for each file feed
// `<path>\n<sha256 of its bytes>\n` into one sha256. A test asserts the two implementations agree.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Sorted-by-path hash of every file under `root`, recursively. */
export function corpusDigest(root: string): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = join(dir, name);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  };
  walk(root);

  const digest = createHash('sha256');
  for (const absolute of files) {
    digest.update(`${relative(root, absolute).split(sep).join('/')}\n`);
    digest.update(createHash('sha256').update(readFileSync(absolute)).digest('hex'));
    digest.update('\n');
  }
  return digest.digest('hex');
}
