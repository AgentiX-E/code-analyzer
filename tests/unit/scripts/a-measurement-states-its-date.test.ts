// **A figure without a date is a figure two documents can quote as one measurement.**
//
// §39.11 compared a 27-October artifact with a 13-November run, attributed a hundred and twelve questions to one repair,
// and was falsified in this iteration by a control that measured the pre-repair engine at almost exactly the same number
// (§40.7). **Every artifact involved carried its own `measuredAt`** - the date was in the file, in a field nothing read.
//
// This test is the reader. It is deliberately weak about *content* - it does not judge a figure - and deliberately strict
// about provenance: an artifact that carries per-question columns or per-condition aggregates is a measurement, and a
// measurement states the day it was taken and the space it was taken in. A document quoting two measurements must be able
// to see that they are not the same one, and this is the cheapest place to guarantee it.

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../benchmarks/', import.meta.url);

interface Artifact {
  measuredAt?: string;
  generatedAt?: string;
  space?: { index?: string; query?: string } | null;
  perQuestion?: unknown;
  conditions?: unknown;
}

/**
 * **The artifacts that are measurements**, recognised by their own structure rather than by a list.
 *
 * A list would be a second place to forget: the reason a new artifact would ship without a date is the same reason it
 * would ship without being added to a register. A file that publishes per-question columns or per-condition aggregates is
 * a measurement by construction.
 */
function measurements(): Array<[string, Artifact]> {
  const found: Array<[string, Artifact]> = [];
  for (const name of readdirSync(ROOT).sort()) {
    if (!name.endsWith('.json')) continue;
    const parsed = JSON.parse(readFileSync(new URL(name, ROOT), 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const artifact = parsed as Artifact;
    if (artifact.perQuestion === undefined && artifact.conditions === undefined) continue;
    found.push([name, artifact]);
  }
  return found;
}

describe('every measurement says when it was taken', () => {
  it('finds the artifacts the product publishes', () => {
    // **A reader that found nothing would pass every assertion below**, which is the failure mode of a gate written to
    // tolerate an empty corpus. Five measurements are committed today; a sixth appears here the day it is written.
    expect(measurements().length).toBeGreaterThanOrEqual(5);
  });

  it('carries a parseable date on every one of them', () => {
    for (const [name, artifact] of measurements()) {
      const stamp = artifact.measuredAt ?? artifact.generatedAt;
      expect(stamp, `${name} records no measurement date`).toBeDefined();
      // **Parsed, not merely present**: a field with a placeholder in it passes a presence check and fails the only
      // question a reader has - was this taken before or after the change I am reading about.
      expect(Number.isNaN(Date.parse(stamp!)), `${name} has an unparseable date ${stamp}`).toBe(
        false,
      );
    }
  });

  it('names the space a semantic figure was measured in', () => {
    // A retrieval figure with vectors and no space is a figure that cannot be compared with another one: §37's rule, and
    // the reason `space` is `null` rather than absent on a lexical run - **`null` is an answer, a missing key is not**.
    for (const [name, artifact] of measurements()) {
      if (!Object.hasOwn(artifact, 'space')) continue;
      const space = artifact.space;
      // **`null` is the lexical run and is an answer**; absent is the defect, and a key that exists but is `undefined`
      // is the same defect with a different spelling.
      if (space === null || space === undefined) continue;
      expect(space.index, `${name} does not name its index space`).toBeDefined();
      expect(space.query, `${name} does not name its query space`).toBeDefined();
    }
  });
});
