// The one place a fixed fixture path is allowed to live, and why it is not `os.tmpdir()`.
//
// **Some of these fixtures cannot use `mkdtempSync`, and the reason is the product rather than tidiness.** The search
// tool indexes the *absolute* path of every declaration, so a directory with a random suffix puts a different token
// into the index on every run - `repo-vD2alE` and `repo-HwvvQO` are two different documents - and the ranking of a
// fixture then moves between two analyses of the same source. The first version of `issue-to-ranked-files.test.ts` used
// `mkdtempSync` and its ranking changed, which read like a product defect and was a fixture one. So the name has to be
// fixed.
//
// **A fixed name in the shared temporary directory is a different problem from a fixed name here.** `os.tmpdir()` is
// world-writable with a predictable layout, so a fixed name there can be created by someone else first - as a symlink,
// among other things - and the test then writes through whatever it points at. The checkout this file lives in is owned
// by the user running the test, so the same fixed name is not shared with anybody, and `.cache/` is already ignored by
// git. **Fixed where it must be fixed, private where it must be private.**
//
// The alternative - keeping the fixed name under `os.tmpdir()` and describing why that is safe - was rejected because
// this repository's rule is that an alert is closed by code or by a test, not by a paragraph.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `<checkout>/.cache/test-scratch/`, resolved from this file rather than from the working directory. */
export const SCRATCH_ROOT = fileURLToPath(new URL('../../.cache/test-scratch/', import.meta.url));

/**
 * An empty directory at a **stable absolute path**, created if it is not there.
 *
 * @param name The fixed name. Two tests may not share one, because the path is what the assertion is about.
 */
export function fixedScratch(name: string): string {
  const path = join(SCRATCH_ROOT, name);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  return path;
}
