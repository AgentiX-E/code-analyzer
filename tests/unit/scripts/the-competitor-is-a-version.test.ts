// code-analyzer — the competitor a percentage is measured against is a version, not a package name
//
// **An unpinned `npm install -g` makes "the competitor" a moving target.** The AACR job publishes a head-to-head F1
// against `open-code-review`; with the install line carrying no version, that number is reproducible only on the day it
// was measured, and nothing in the artifact says which competitor it was against. It is the same defect the corpus
// provenance gate was built for - *a directory is not a version* - one level up: **a package name is not a version
// either.**
//
// The version below is not a guess. `open-code-review v1.13.8 (4236c871)` is what the install step printed in run
// 43184902326, which is the run every published AACR figure in this repository was measured on, so pinning it to
// 1.13.8 freezes the comparison at the version the comparison was made with. A bump is then a visible edit to this
// file, a re-run, and a new pairing - rather than a silent drift in what "the competitor" means.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/** The version the published figures were measured against, as the run's own install step printed it. */
const MEASURED_VERSION = '1.13.8';

const WORKFLOWS = ['.github/workflows/aacr-bench.yml', '.github/workflows/runnable-competitors.yml'];

describe('the competitor install is pinned to the version the figures were measured on', () => {
  it.each(WORKFLOWS)('%s names the version', (path) => {
    const workflow = readFileSync(path, 'utf8');

    expect(workflow).toContain(`npm install -g @alibaba-group/open-code-review@${MEASURED_VERSION}`);
    // **A bare install line is the defect**, and it is one keystroke away from the pinned one.
    expect(workflow).not.toMatch(/npm install -g @alibaba-group\/open-code-review\s*$/m);
  });

  it('asks the installed competitor what version it is, so a bump cannot be silent', () => {
    // The pin is only half of it: printing the version is what makes the artifact's competitor traceable when the pin
    // is wrong, stale, or bypassed by a cached install.
    for (const path of WORKFLOWS) {
      expect(readFileSync(path, 'utf8')).toContain('ocr --version');
    }
  });

  it('pins the harness tool the same way', () => {
    const workflow = readFileSync('.github/workflows/martian-harness.yml', 'utf8');

    expect(workflow).toMatch(/pip install uv==\d+\.\d+\.\d+/);
    expect(workflow).not.toMatch(/pip install uv\s*$/m);
  });
});
