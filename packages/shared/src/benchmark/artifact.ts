// Recording a benchmark figure is a decision, and this module is the only place that makes it.
//
// **Why a gate on the write.** A test that measures something and then writes `benchmarks/*.json` records a figure
// on whatever machine ran it. That is what we want on a runner and what we do not want on a laptop: three artifacts
// in this repository were rewritten by ordinary local runs - a docstring artifact that lost its vector column, an
// indexing artifact whose schema changed under the gate that reads it, and a search artifact whose corpus count moved
// by nineteen nodes because a source file grew. **None of those runs was wrong; each of them answered a question
// nobody asked**, and the committed figure it replaced was the one the documentation quotes.
//
// **So the write is opt-in and named.** `BENCHMARK_WRITE=1` is a statement that this run intends to publish numbers.
// Without it the measurement still happens - the assertion still runs, the printed line still appears - and the
// committed artifact is left alone, with a `because` that says why.

// **And a figure may not be replaced by a weaker measurement of the same question.** `space.semantic` says whether the
// semantic half ran, and it is not a detail of the artifact: a run with `true` and a run with `false` are two different
// measurements, the second being the fallback. **A laptop without `ZHIPU_API_KEY` therefore may not overwrite a
// runner's figure even with `BENCHMARK_WRITE=1`** - which is exactly how the docstring artifact in this repository lost
// its vector column and published a lexical figure under a semantic name for two commits.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';

/** The environment variable that turns recording on. Strictly `1`: a typo must read as off, not as half-on. */
export const ARTIFACT_WRITE_ENV = 'BENCHMARK_WRITE';

/** Where figures live. A write anywhere else is a path mistake, and a path mistake here is a lost artifact. */
const ARTIFACT_ROOT = 'benchmarks/';

/** What happened to an artifact, so the caller can print it rather than assume it. */
export interface ArtifactRecord {
  /** Path as given, relative to the working directory. */
  readonly path: string;
  /** Whether bytes reached the disk. */
  readonly written: boolean;
  /** One sentence: written, or the reason it was not. */
  readonly because: string;
}

/**
 * Whether this run is allowed to publish figures.
 *
 * @param env the environment to read, so a test can supply its own rather than mutate the process.
 */
export function artifactRecordingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[ARTIFACT_WRITE_ENV] === '1';
}

/**
 * Whether a figure's semantic half ran, when the artifact says so.
 *
 * @param value an artifact body, which may be any shape: a non-object, a missing `space`, or a `semantic` that is not a
 *   boolean all read as "this artifact makes no claim about a measurement space".
 */
function semanticHalfRan(value: unknown): boolean | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const space = (value as { space?: unknown }).space;
  if (typeof space !== 'object' || space === null) return undefined;
  const semantic = (space as { semantic?: unknown }).semantic;
  return typeof semantic === 'boolean' ? semantic : undefined;
}

/** The space of the figure already on disk. **Read leniently**: an unreadable file makes no claim and blocks nothing. */
function publishedSemanticHalf(absolute: string): boolean | undefined {
  if (!existsSync(absolute)) return undefined;
  try {
    return semanticHalfRan(JSON.parse(readFileSync(absolute, 'utf8')));
  } catch {
    return undefined;
  }
}

/**
 * Write a figure to `benchmarks/`, or explain why it was not written.
 *
 * @param relativePath path under `benchmarks/`, e.g. `benchmarks/owasp-benchmark.json`.
 * @param value the artifact body; serialised with two-space indent and a trailing newline, which is what
 *   `prettier --check` reads.
 * @param env the environment to read, so a test can supply its own rather than mutate the process.
 * @throws when `relativePath` is not under `benchmarks/` - silently writing a figure somewhere no gate reads is
 *   worse than failing here.
 */
export function recordArtifact(
  relativePath: string,
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): ArtifactRecord {
  // **The guard normalises before it looks**, because `benchmarks/../docs/x.json` starts with the prefix and lands
  // nowhere near it - a prefix check on an unnormalised path is a check on a string rather than on a destination.
  const normalised = posix.normalize(relativePath.replaceAll('\\', '/'));
  if (!normalised.startsWith(ARTIFACT_ROOT)) {
    throw new Error(
      `artifacts live under ${ARTIFACT_ROOT} and ${relativePath} does not: a figure written elsewhere is a figure no gate reads`,
    );
  }
  if (!artifactRecordingEnabled(env)) {
    return {
      path: normalised,
      written: false,
      because: `recording is off: set ${ARTIFACT_WRITE_ENV}=1 to publish this run's figure`,
    };
  }
  const absolute = resolve(process.cwd(), normalised);
  // **Only an explicit `false` blocks a write.** An artifact that records no space at all is a different artifact, and
  // a refused write has to be explainable in one sentence to the person who set the variable.
  if (publishedSemanticHalf(absolute) === true && semanticHalfRan(value) === false) {
    return {
      path: normalised,
      written: false,
      because: `${normalised} records a figure measured with the semantic half running and this run could not run it: that is a different measurement, not a newer one (delete the file to publish a fallback figure)`,
    };
  }
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return { path: normalised, written: true, because: `written with ${ARTIFACT_WRITE_ENV}=1` };
}
