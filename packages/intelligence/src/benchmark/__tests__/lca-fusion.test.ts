// **The two ways a row records a fused ranking, and the asymmetry between them is the whole test.** A measured
// instance ran both arms and its row says `fused: true`; a refused one ran only the file-level arm because the
// declaration arm *is* the analysis that was refused, so it says `fused: false` and names one arm. A column over both
// kinds is only quotable if the split is stated, and this module is where the split is decided.

import { describe, expect, it } from 'vitest';

import { declinedFusion, FUSION_ARMS, fusedResult } from '../lca-fusion.js';

describe('fusedResult', () => {
  it('**names both arms and the constant**, so the figure can be reproduced', () => {
    const result = fusedResult({ map: 0.4, rank: 2, ranked: ['a.py', 'b.py'] });
    expect(result.fused).toBe(true);
    expect(result.arms).toEqual([...FUSION_ARMS]);
    expect(result.k).toBe(60);
    expect(result.map).toBe(0.4);
    expect(result.rank).toBe(2);
  });

  it('**keeps the first ten paths and no more**, which is a preview and not the ranking', () => {
    const ranked = Array.from({ length: 25 }, (_, index) => `f${String(index)}.py`);
    expect(fusedResult({ map: 0.1, rank: null, ranked }).ranked).toHaveLength(10);
  });

  it('**passes an ablation’s constant through** rather than relabelling it as sixty', () => {
    expect(fusedResult({ map: 0.1, rank: null, ranked: [], k: 10 }).k).toBe(10);
  });
});

describe('declinedFusion', () => {
  it('**says one arm and says it is not fused**, which is the fact a mean over both kinds must carry', () => {
    const result = declinedFusion({ map: 0.2, rank: 7, ranked: ['x.py'] });
    expect(result.fused).toBe(false);
    expect(result.arms).toEqual(['file-level']);
    // **The figure is the fallback's own, restated rather than recomputed**: a second computation would be a second
    // ruler, and the artifact's job is to say which arm produced which number.
    expect(result.map).toBe(0.2);
    expect(result.rank).toBe(7);
  });

  it('**publishes the constant even though nothing was fused**, so the column has one `k` throughout', () => {
    expect(declinedFusion({ map: 0.2, rank: null, ranked: [] }).k).toBe(60);
    expect(declinedFusion({ map: 0.2, rank: null, ranked: [], k: 15 }).k).toBe(15);
  });
});
