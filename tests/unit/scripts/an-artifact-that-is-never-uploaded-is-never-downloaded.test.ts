// An artifact a job downloads by a name nothing uploads fails the job at the download, not at the comparison
//
// **The defect this exists for.** When the benchmark matrix was renamed from `checklist: [with, without]` to
// `profile: [defect, advisory]`, three strings had to move with it: the emission profile the code reads, the upload name,
// and the download name. Two moved. The third became `aacr-bench-defectout` - the old `without` with `defect` substituted
// into the front of it - and nothing noticed, because a download of a name that does not exist is a step that fails in
// the job that runs *after* the money is spent.
//
// **What it cost.** The fifty-pull-request run and the hundred-pull-request confirmation both completed their two arms,
// both uploaded both artifacts, and both ended as `failure` at the step whose output is the only reason the run was
// dispatched. The measurements existed and the verdict did not, twice, at about five dollars a dispatch.
//
// **Why the check is here and not in the workflow.** GitHub cannot validate an artifact name against another job's
// matrix: the name is a string in YAML, and the matrix that produces it is a list in a different job. That is a fact
// about the names, so it is checked by reading the names.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
  'utf8',
);

/** The `profile` values the bench job runs, read from the matrix rather than restated here. */
function profiles(): string[] {
  const matrix = /matrix:\s*\n\s*profile:\s*\[([^\]]+)\]/.exec(WORKFLOW);
  expect(matrix, 'the workflow no longer declares a profile matrix').not.toBeNull();
  return matrix![1]!
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * **Every `name:` that follows an `upload-` or `download-artifact` action**, with the matrix expression expanded.
 *
 * Read as text because that is what GitHub does with it: the name is a YAML string, and the only way for it to be wrong
 * is for the string to disagree with the list - which is the disagreement this checks.
 */
function artifactNames(action: 'upload' | 'download'): string[] {
  const names: string[] = [];
  const lines = WORKFLOW.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.includes(`actions/${action}-artifact@`)) continue;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      // The value may contain spaces inside `${{ }}`, so it is not `\S+`.
      const m = /^\s*name:\s*(.+?)\s*$/.exec(lines[j]!);
      if (m) {
        names.push(m[1]!);
        break;
      }
      // A second action starts before a name was found, so this one has none.
      if (lines[j]!.includes('uses:')) break;
    }
  }
  return names;
}

describe('the artifact names of the benchmark workflow', () => {
  it('downloads only names that some job uploads', () => {
    const expanded = new Set<string>();
    for (const name of artifactNames('upload')) {
      const matrixName = /^(.*)\$\{\{\s*matrix\.profile\s*\}\}(.*)$/.exec(name);
      if (matrixName) {
        for (const profile of profiles())
          expanded.add(`${matrixName[1]}${profile}${matrixName[2]}`);
      } else expanded.add(name);
    }

    const downloads = artifactNames('download');
    expect(downloads.length).toBeGreaterThanOrEqual(2);
    for (const name of downloads) {
      expect(expanded, `${name} is downloaded but no job uploads it`).toContain(name);
    }
  });

  it('downloads both arms of the pair, and not the same one twice', () => {
    const downloads = artifactNames('download');
    expect(new Set(downloads).size).toBe(downloads.length);
    // **Two arms or no comparison.** The two names have to be the two the matrix produces, in some order.
    expect(downloads.map((n) => n.replace('aacr-bench-', '')).sort()).toEqual(
      [...profiles()].sort(),
    );
  });

  it('runs one arm per profile the code knows about', () => {
    // The matrix is what makes the pair; a profile added to the code and not to the matrix is a hypothesis that is never
    // tested, and one added to the matrix and not to the code fails at the parse rather than at the comparison.
    expect(profiles()).toEqual(['defect', 'advisory']);
  });
});
