#!/usr/bin/env node
/**
 * Corpus-provenance gate.
 *
 * `benchmarks/docstring-search.json` recorded `corpus.nodes: 5735` for `benchmarks/retrieval-corpus`, which measures
 * **3 257** nodes on the same 52 files — the same figure a runner produced an hour ago. Two numbers, one path, no
 * way to tell which was measured on what, because **a directory is not a version**. Every comparison this project
 * has published against a competitor rests on artifacts whose corpus was named but never identified.
 *
 * So a `corpus` block now states which of three things it is:
 *
 *   `pinned`      a frozen directory, with the digest computed from its contents. The digest must match, or the
 *                 figure was measured on files that no longer exist under that path.
 *   `live`        this repository as it is — `packages/` on the day the speed was measured. It moves on purpose and
 *                 a digest would be a lie.
 *   `superseded`  a corpus that changed under a figure which cannot be re-derived today. It must say why, and the
 *                 reason is printed on every run so the number is never quoted as if it were current.
 *
 * An artifact that names a corpus and no state fails, because the omission is exactly what let 5 735 and 3 257 sit
 * in the same repository without anyone asking which was true.
 *
 * Usage:
 *   node scripts/corpus-provenance-gate.js [--repo .] [--json]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

/** The same algorithm as `packages/intelligence/src/benchmark/corpus-digest.ts`; a test asserts they agree. */
function corpusDigest(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const absolute = path.join(dir, name);
      if (fs.statSync(absolute).isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  };
  walk(root);
  const digest = createHash('sha256');
  for (const absolute of files) {
    digest.update(`${path.relative(root, absolute).split(path.sep).join('/')}\n`);
    digest.update(createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'));
    digest.update('\n');
  }
  return digest.digest('hex');
}

function parseArgs(argv) {
  const args = { repo: '.', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

function analyse(repo) {
  const dir = path.join(repo, 'benchmarks');
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort()
    : [];

  const failures = [];
  const notes = [];
  const states = { pinned: [], live: [], superseded: [] };
  const corpora = {};
  const digestCache = new Map();

  for (const name of files) {
    let artifact;
    try {
      artifact = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
    } catch {
      continue;
    }
    const corpus = artifact && typeof artifact === 'object' ? artifact.corpus : undefined;
    if (!corpus || typeof corpus.path !== 'string') continue;

    const absolute = path.join(repo, corpus.path);
    if (!fs.existsSync(absolute)) {
      failures.push(
        `${name}: names a corpus at ${corpus.path}, which does not exist — nothing can be re-checked`,
      );
      continue;
    }
    // **A digest is only meaningful for a frozen corpus**, and only a directory can be walked. Computing one for a
    // `live` corpus would hash this repository every run to answer a question nobody asked.
    if (corpus.snapshot === 'pinned' && !digestCache.has(corpus.path)) {
      digestCache.set(corpus.path, corpusDigest(absolute));
      corpora[corpus.path] = { digest: digestCache.get(corpus.path) };
    }

    if (corpus.snapshot === 'pinned') {
      if (typeof corpus.digest !== 'string' || corpus.digest === '') {
        failures.push(
          `${name}: corpus.snapshot is "pinned" with no digest — a pinned figure has to name the version it ` +
            'measured, or the path names a moving thing.',
        );
      } else if (corpus.digest !== digestCache.get(corpus.path)) {
        failures.push(
          `${name}: measured on ${corpus.path} at ${corpus.digest}, which is now ${digestCache.get(corpus.path)} — ` +
            'the figure predates the files it names and is not comparable with anything measured since.',
        );
      } else {
        states.pinned.push(name);
      }
    } else if (corpus.snapshot === 'live') {
      states.live.push(name);
    } else if (corpus.snapshot === 'superseded') {
      if (typeof corpus.supersededReason !== 'string' || corpus.supersededReason.trim() === '') {
        failures.push(
          `${name}: corpus.snapshot is "superseded" with no supersededReason — that is a silence.`,
        );
      } else {
        states.superseded.push(name);
        notes.push(`${name}: ${corpus.supersededReason.trim()}`);
      }
    } else {
      failures.push(
        `${name}: names ${corpus.path} and no snapshot state — say "pinned", "live" or "superseded", because the ` +
          'omission is what let two node counts for one directory coexist.',
      );
    }
  }

  return { states, corpora, notes, failures, scanned: files.length };
}

function main() {
  const args = parseArgs(process.argv);
  const result = analyse(args.repo);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.failures.length === 0 ? 0 : 1);
  }

  console.log(
    `${result.states.pinned.length} pinned · ${result.states.live.length} live · ` +
      `${result.states.superseded.length} superseded · ${result.scanned} artifacts scanned`,
  );
  for (const note of result.notes) console.log(`  superseded: ${note}`);
  if (result.failures.length > 0) {
    console.error(
      `\n❌ Corpus provenance failed:\n${result.failures.map((f) => `  • ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  console.log('✅ every figure that names a corpus also names which version of it.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

module.exports = { analyse, corpusDigest };
