// **The two ways a row records a fused ranking, and the asymmetry between them is the whole test.** A measured
// instance ran all three arms and its row says `fused: true`; a refused one ran the two file-level arms because the
// declaration arm *is* the analysis that was refused, so it says `fused: false` and names those two. A column over both
// kinds is only quotable if the split is stated, and this module is where the split is decided.
//
// **And the ladder's last rung is an equality, not a preference.** `body-alone` zeroes the other two weights, so the
// fused list it produces has to be the body arm's own list - the property that proves the weights reach the arithmetic
// rather than sitting in a record beside it.

import { describe, expect, it } from 'vitest';

import { RRF_K } from '../../search/fusion.js';
import {
  FUSION_ARMS,
  FUSION_K_LADDER,
  FUSION_WEIGHTING,
  FUSION_WEIGHT_LADDER,
  armWeights,
  fuseFileRankings,
  fusionFor,
} from '../lca-fusion.js';

describe('the weight ladder', () => {
  it('**ships a rung that is on the ladder**, so the shipped weighting is one of the published alternatives', () => {
    expect(FUSION_WEIGHT_LADDER).toContain(FUSION_WEIGHTING);
  });

  it('**has a rung that names each arm alone**, because a rung that reproduces one column is the mechanism test', () => {
    const bodyAlone = FUSION_WEIGHT_LADDER.find((rung) => rung.name === 'body-alone');
    expect(bodyAlone).toBeDefined();
    expect(armWeights(bodyAlone!)).toEqual({
      declarations: 0,
      'file-level': 0,
      'file-body': 1,
    });
  });

  it('**reproduces the named arm’s list exactly**, which is what makes the rung a control rather than a candidate', () => {
    const arms = {
      declarations: ['d.py', 'shared.py'],
      fileLevel: ['l.py', 'shared.py'],
      fileBody: ['b.py', 'shared.py'],
    };
    const bodyAlone = FUSION_WEIGHT_LADDER.find((rung) => rung.name === 'body-alone')!;
    expect(fuseFileRankings({ arms, weighting: bodyAlone })).toEqual(arms.fileBody);
  });

  it('**skips an arm it was not given** rather than fusing an empty list', () => {
    // A refused row has no declaration arm. The fusion reads the two it has and the result is the same as one computed
    // from those two alone, which is the property that keeps "did not run" and "matched nothing" apart.
    const withMissing = fuseFileRankings({
      arms: { fileLevel: ['a.py'], fileBody: ['b.py'] },
    });
    expect(withMissing).toEqual(
      fuseFileRankings({
        arms: { declarations: undefined, fileLevel: ['a.py'], fileBody: ['b.py'] },
      }),
    );
    expect(new Set(withMissing)).toEqual(new Set(['a.py', 'b.py']));
  });

  it('**puts a path both arms agree on above a path one arm put first**, which is what a fusion is for', () => {
    const fused = fuseFileRankings({
      arms: { fileLevel: ['wrong.py', 'right.py'], fileBody: ['also-wrong.py', 'right.py'] },
    });
    expect(fused[0]).toBe('right.py');
  });
});

describe('fuseFileRankings', () => {
  it('**truncates to a stated limit without reordering**, which is what a caller with a fixed page size asks for', () => {
    const arms = { fileBody: ['a.py', 'b.py', 'c.py', 'd.py'] };
    const full = fuseFileRankings({ arms });
    expect(fuseFileRankings({ arms, limit: 2 })).toEqual(full.slice(0, 2));
  });
});

describe('fusionFor', () => {
  // **A coherent fixture**: `map` is `1/rank` for a one-file answer, so a row that publishes 0.5 and a rank of 2
  // is a row whose own numbers agree. A fixture that does not is a fixture that cannot catch a wiring defect.
  const fallback = { map: 0.5, rank: 2, candidates: ['x.py', 'y.py'] };
  const body = { map: 0.44, rank: 1, candidates: ['y.py', 'z.py'] };
  const expected = ['y.py'];

  it('transcribes a measured row, because the child already fused it', () => {
    const fused = fusionFor({
      skipped: null,
      map: 0.42,
      rank: 2,
      ranked: ['a.py', 'b.py'],
      fallback,
      body,
      expected,
      depth: 200,
    });
    expect(fused).toEqual({
      map: 0.42,
      rank: 2,
      fused: true,
      arms: [...FUSION_ARMS],
      k: RRF_K,
      weighting: FUSION_WEIGHTING.name,
      ranked: ['a.py', 'b.py'],
    });
  });

  it('**declines to the fusion of the two file-level arms** when the row is refused', () => {
    // **The defect this case was written for, and the repair two iterations later.** The parent chose this on "did the
    // child write a row", so a child whose analysis threw - a refusal through the measured branch - published
    // `fused: true` beside `skipped: "the analysis failed: ..."`. The flag has to follow the row's refusal sentence, not
    // the process's exit. And a refused row no longer declines to *one* arm: the body arm runs where the analyser
    // cannot, so the row carries their fusion.
    const analysisFailed = fusionFor({
      skipped: 'the analysis failed: heap out of memory',
      map: 0,
      rank: null,
      ranked: [],
      fallback,
      body,
      expected,
      depth: 200,
    });
    expect(analysisFailed?.fused).toBe(false);
    expect(analysisFailed?.arms).toEqual(['file-level', 'file-body']);
    // `y.py` is the answer and both arms ranked it, so the fusion puts it first: 1/(10+2) + 1/(10+1).
    expect(analysisFailed?.ranked[0]).toBe('y.py');
    expect(analysisFailed?.map).toBe(1);
    expect(analysisFailed?.rank).toBe(1);
  });

  it('**fuses one arm when only one ran**, and still says so', () => {
    // The body arm is computed in the parent, so a run that omits it - an older part, a local run - must still produce
    // a figure rather than a null. The single arm's order survives, at any `k` and weighting that keeps it.
    const single = fusionFor({
      skipped: 'above the stated cap',
      map: 0,
      rank: null,
      ranked: [],
      fallback,
      expected,
      depth: 200,
    });
    expect(single?.arms).toEqual(['file-level']);
    expect(single?.rank).toBe(2);
    expect(single?.map).toBe(0.5);
  });

  it('publishes no fused figure at all when neither file-level arm is there', () => {
    // A zero here would be a ranking that found nothing, which is a different claim from "no ranking exists".
    expect(
      fusionFor({
        skipped: 'above the stated cap',
        map: 0,
        rank: null,
        ranked: [],
        fallback: null,
        expected,
        depth: 200,
      }),
    ).toBeNull();
    // And a measured row never needs a file-level arm, so its absence changes nothing.
    expect(
      fusionFor({
        skipped: null,
        map: 0.5,
        rank: 1,
        ranked: ['a.py'],
        fallback: null,
        expected,
        depth: 200,
      })?.fused,
    ).toBe(true);
  });

  it('**applies the weighting it was given**, so an ablation can ask for a rung other than the shipped one', () => {
    // `body-alone` zeroes the two other arms; if the argument were recorded and not applied, this row would still be the
    // three-arm fusion and the ladder would be a table about itself.
    const bodyAlone = FUSION_WEIGHT_LADDER.find((rung) => rung.name === 'body-alone')!;
    const fused = fusionFor({
      skipped: 'above the stated cap',
      map: 0,
      rank: null,
      ranked: [],
      fallback,
      body,
      expected,
      depth: 200,
      weighting: bodyAlone,
    });
    expect(fused?.weighting).toBe('body-alone');
    // The body arm ranks `y.py` first, so the rung that keeps only the body arm puts it first - and earns exactly the
    // body arm's own average precision on this fixture.
    expect(fused?.ranked[0]).toBe('y.py');
    expect(fused?.map).toBe(1);
    expect(fused?.arms).toEqual(['file-level', 'file-body']);
  });

  it('**fuses the body arm alone when the parent built no path-and-imports ranking**', () => {
    // **The refused row where only one arm exists.** `fallback: null` is not "no arms": the body arm still ran, and a
    // fusion that treated a missing first arm as a missing row would publish an empty list on exactly the instances this
    // arm was built for. The arm list is what says which arms took part, so it is the assertion.
    const fused = fusionFor({
      skipped: 'above the stated cap',
      map: 0,
      rank: null,
      ranked: [],
      fallback: null,
      body,
      expected,
      depth: 200,
    });
    expect(fused?.arms).toEqual(['file-body']);
    // **And the figure is the arm's own**, because a fusion of one list is that list.
    expect(fused?.ranked[0]).toBe('y.py');
    expect(fused?.map).toBe(1);
  });

  it('carries the constant it was given into both readings', () => {
    // Off the shipped constant on purpose: a test that passes `RRF_K` would pass whether or not the argument is read.
    const offRung = FUSION_K_LADDER.find((k) => k !== RRF_K)!;
    expect(
      fusionFor({
        skipped: null,
        map: 0.5,
        rank: 1,
        ranked: [],
        fallback,
        expected,
        depth: 200,
        k: offRung,
      })?.k,
    ).toBe(offRung);
    expect(
      fusionFor({
        skipped: 'cap',
        map: 0,
        rank: null,
        ranked: [],
        fallback,
        expected,
        depth: 200,
        k: offRung,
      })?.k,
    ).toBe(offRung);
  });
});
