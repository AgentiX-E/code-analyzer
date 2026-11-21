// **A figure whose segments do not add up to its own corpus is a figure that absorbed an arithmetic error silently.**
//
// §121.5 found a hand-edited chart pointing at a run that had not produced it; this is the same class of defect one
// figure later, and the check is the same kind: the renderer must refuse a bar whose last segment has quietly taken on
// the difference between what the stages say and what the corpus holds.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkStages } from '../../../scripts/recall-ceiling-figure.mjs';

import type { RecallCeilingData } from '../../../scripts/recall-ceiling-figure.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
// **Typed by the generator's own declaration, not by a second shape written here.** The narrow literal type this file
// used to declare was assignable to nothing the renderer accepts - the type-error ratchet counted two `TS2345`s on it -
// and a fixture that describes the data differently from the renderer is the drift the figure exists to prevent, one
// layer up.
const DATA = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks', 'recall-ceiling.json'), 'utf8'),
) as RecallCeilingData;
const SVG = readFileSync(join(ROOT, 'docs', 'aacr-recall-ceiling.svg'), 'utf8');

describe('the figure about what was not produced', () => {
  it('adds up to its own corpus, and refuses to draw when it does not', () => {
    expect(checkStages(DATA)).toBe(DATA.provenance.goldens);
    // **One golden short**, which is the shape an error takes when a stage's note is edited and its count is not.
    // **Spread rather than rebuilt**, so the only thing wrong with the fixture is the count - a fixture missing a field
    // would fail the *type* check for a reason unrelated to what the assertion is about.
    const broken: RecallCeilingData = {
      ...DATA,
      stages: DATA.stages.map((stage, at) =>
        at === 0 ? { ...stage, goldens: stage.goldens - 1 } : stage,
      ),
    };
    expect(() => checkStages(broken)).toThrow(/sum to 329/u);
  });

  it('names the run that produced it rather than a run that did not', () => {
    // **§121.5's defect**: the title and the source line were written into the script, so a figure regenerated from a
    // new artifact still carried the old run id. The id has to come out of the data.
    expect(SVG).toContain(DATA.provenance.runId);
    expect(SVG).toContain(`${String(DATA.provenance.goldens)} goldens`);
  });

  it('prints every stage and the share of the corpus it holds', () => {
    for (const stage of DATA.stages) {
      expect(SVG).toContain(String(stage.goldens));
      const share = ((stage.goldens / DATA.provenance.goldens) * 100).toFixed(1);
      expect(SVG).toContain(`(${share} %)`);
    }
  });

  it('puts the unreachable share in the colour a refuted claim gets, and says which segment it is', () => {
    // The last stage is the one no device in this repository can move, and the figure says so in `#cf222e` rather than
    // in the greys the other three use.
    expect(SVG).toContain('#cf222e');
    expect(SVG).toContain('no ranking, budget or judge change can move');
  });
});
