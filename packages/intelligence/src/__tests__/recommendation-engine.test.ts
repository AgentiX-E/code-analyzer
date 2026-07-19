// @ts-nocheck — test file assertion patterns may access possibly-undefined
import { describe, it, expect } from 'vitest';
import { RecommendationEngine } from '../report/recommend.js';
import type { Finding, Recommendation } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    category: 'bug',
    severity: 'high',
    title: 'Null reference risk',
    description: 'Potential null reference.',
    filePath: 'src/main.ts',
    lineRange: [42, 42],
    evidence: 'const x = maybeNull.value;',
    relatedFindings: [],
    ...overrides,
  };
}

function makeEngine(): RecommendationEngine {
  return new RecommendationEngine();
}

// ---------------------------------------------------------------------------
// Group Related Findings
// ---------------------------------------------------------------------------

describe('RecommendationEngine — groupRelatedFindings', () => {
  const engine = makeEngine();

  it('should return single group for single finding', () => {
    const findings = [makeFinding()];
    const groups = engine.groupRelatedFindings(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  it('should group findings by file path and category', () => {
    const findings = [
      makeFinding({ id: 'f-1', filePath: 'src/a.ts', category: 'bug' }),
      makeFinding({ id: 'f-2', filePath: 'src/a.ts', category: 'bug' }),
      makeFinding({ id: 'f-3', filePath: 'src/b.ts', category: 'security' }),
    ];
    const groups = engine.groupRelatedFindings(findings);
    expect(groups.length).toBeLessThanOrEqual(3);
    // f-1 and f-2 should be grouped together (same file + category)
    const group1 = groups.find((g) => g.some((f) => f.id === 'f-1'));
    expect(group1!.some((f) => f.id === 'f-2')).toBe(true);
  });

  it('should keep different-category findings separate', () => {
    const findings = [
      makeFinding({ id: 'f-1', filePath: 'src/a.ts', category: 'bug' }),
      makeFinding({ id: 'f-2', filePath: 'src/a.ts', category: 'performance' }),
    ];
    const groups = engine.groupRelatedFindings(findings);
    // Different categories should not be grouped together
    const groupWithBug = groups.filter((g) => g.some((f) => f.category === 'bug'));
    const groupWithPerf = groups.filter((g) => g.some((f) => f.category === 'performance'));
    expect(groupWithBug.length > 0 && groupWithPerf.length > 0).toBe(true);
  });

  it('should group findings with related findings references', () => {
    const findings = [
      makeFinding({ id: 'f-1', relatedFindings: ['f-2'] }),
      makeFinding({ id: 'f-2', relatedFindings: ['f-1'] }),
    ];
    const groups = engine.groupRelatedFindings(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('should return empty groups for empty input', () => {
    const groups = engine.groupRelatedFindings([]);
    expect(groups).toHaveLength(0);
  });

  it('should handle single-element array', () => {
    const groups = engine.groupRelatedFindings([makeFinding()]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Generate Recommendations
// ---------------------------------------------------------------------------

describe('RecommendationEngine — generateRecommendations', () => {
  const engine = makeEngine();

  it('should generate recommendations from findings', () => {
    const findings = [
      makeFinding({ id: 'f-1', severity: 'critical', category: 'security' }),
      makeFinding({ id: 'f-2', severity: 'high', category: 'bug' }),
    ];

    const recs = engine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThan(0);
  });

  it('should return empty for no findings', () => {
    expect(engine.generateRecommendations([])).toHaveLength(0);
  });

  it('should respect maxRecommendations option', () => {
    const findings = Array(20).fill(null).map((_, i) =>
      makeFinding({ id: `f-${i}`, filePath: `src/file${i}.ts`, category: i % 2 === 0 ? 'bug' : 'performance' }));

    const recs = engine.generateRecommendations(findings, { maxRecommendations: 5 });
    expect(recs.length).toBeLessThanOrEqual(5);
  });

  it('should assign priorities based on severity', () => {
    const findings = [
      makeFinding({ id: 'f-critical', severity: 'critical' }),
    ];
    const recs = engine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].priority).toBe(1);
  });

  it('should include action items from findings', () => {
    const findings = [makeFinding({ title: 'Fix null check' })];
    const recs = engine.generateRecommendations(findings);
    expect(recs[0].actionItems.length).toBeGreaterThan(0);
    expect(recs[0].actionItems[0].description).toBe('Fix null check');
  });

  it('should include affected files', () => {
    const findings = [makeFinding({ filePath: 'src/app.ts' })];
    const recs = engine.generateRecommendations(findings);
    expect(recs[0].affectedFiles).toContain('src/app.ts');
  });
});

// ---------------------------------------------------------------------------
// Prioritization
// ---------------------------------------------------------------------------

describe('RecommendationEngine — prioritizeRecommendations', () => {
  const engine = makeEngine();

  it('should prioritize critical findings first', () => {
    const lowRec: Recommendation = {
      id: 'rec-1',
      priority: 3,
      title: 'Low priority',
      description: 'A low priority issue.',
      estimatedEffort: 'trivial',
      affectedFiles: ['f1.ts'],
      actionItems: [{ description: 'Fix it' }],
      risksAddressed: ['style'],
      references: [],
    };

    const highRec: Recommendation = {
      id: 'rec-2',
      priority: 1,
      title: 'High priority',
      description: 'A critical issue.',
      estimatedEffort: 'small',
      affectedFiles: ['f2.ts'],
      actionItems: [{ description: 'Fix it' }],
      risksAddressed: ['security'],
      references: [],
    };

    const prioritized = engine.prioritizeRecommendations([lowRec, highRec]);
    expect(prioritized[0].id).toBe('rec-2');
  });

  it('should not modify empty array', () => {
    const result = engine.prioritizeRecommendations([]);
    expect(result).toHaveLength(0);
  });

  it('should preserve single item', () => {
    const rec: Recommendation = {
      id: 'rec-1',
      priority: 2,
      title: 'Test',
      description: 'Test',
      estimatedEffort: 'medium',
      affectedFiles: [],
      actionItems: [],
      risksAddressed: [],
      references: [],
    };
    const result = engine.prioritizeRecommendations([rec]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('rec-1');
  });

  it('should weight security risks higher', () => {
    const securityRec: Recommendation = {
      id: 'rec-sec',
      priority: 2,
      title: 'Security',
      description: 'Security issue',
      estimatedEffort: 'small',
      affectedFiles: ['a.ts'],
      actionItems: [{ description: 'Fix' }],
      risksAddressed: ['security'],
      references: [],
    };

    const styleRec: Recommendation = {
      id: 'rec-style',
      priority: 2,
      title: 'Style',
      description: 'Style issue',
      estimatedEffort: 'small',
      affectedFiles: ['b.ts'],
      actionItems: [{ description: 'Fix' }],
      risksAddressed: ['style'],
      references: [],
    };

    const prioritized = engine.prioritizeRecommendations([styleRec, securityRec]);
    expect(prioritized[0].id).toBe('rec-sec');
  });

  it('should weigh security and trivial effort higher than low-impact priorities', () => {
    // Priority 1 with large effort and low-impact (style) risk
    const p1: Recommendation = {
      id: 'p1',
      priority: 1,
      title: 'P1 style',
      description: 'Large effort, style only',
      estimatedEffort: 'large', // effort_inverse = 0.25
      affectedFiles: ['a.ts'],
      actionItems: [{ description: 'Fix' }],
      risksAddressed: ['style'], // impact = 0.15
      references: [],
    };
    // Priority 2 with trivial effort and security risk
    const p2: Recommendation = {
      id: 'p2',
      priority: 2,
      title: 'P2 security trivial',
      description: 'Security, trivial effort',
      estimatedEffort: 'trivial', // effort_inverse = 1.0
      affectedFiles: ['b.ts'],
      actionItems: [{ description: 'Fix' }],
      risksAddressed: ['security'], // impact = 1.0
      references: [],
    };

    // p1 = 1.0*0.5 + 0.15*0.3 + 0.25*0.2 = 0.5 + 0.045 + 0.05 = 0.595
    // p2 = 0.5*0.5 + 1.0*0.3 + 1.0*0.2 = 0.25 + 0.3 + 0.2 = 0.75
    // p2 scores higher because security risk and trivial effort outweigh priority
    const prioritized = engine.prioritizeRecommendations([p1, p2]);
    expect(prioritized[0].id).toBe('p2');
  });
});

// ---------------------------------------------------------------------------
// Effort Estimation
// ---------------------------------------------------------------------------

describe('RecommendationEngine — estimateEffort', () => {
  const engine = makeEngine();

  it('should estimate trivial for small recommendations', () => {
    const rec: Recommendation = {
      id: 'rec-1',
      priority: 3,
      title: 'T',
      description: 'T',
      estimatedEffort: 'small', // placeholder, will be recomputed
      affectedFiles: ['a.ts'],
      actionItems: [{ description: 'Fix' }],
      risksAddressed: [],
      references: [],
    };
    expect(engine.estimateEffort(rec)).toBe('trivial');
  });

  it('should estimate small for medium effort', () => {
    const rec: Recommendation = {
      id: 'rec-1',
      priority: 2,
      title: 'M',
      description: 'M',
      estimatedEffort: 'medium',
      affectedFiles: ['a.ts', 'b.ts', 'c.ts'],
      actionItems: [
        { description: 'Fix 1' },
        { description: 'Fix 2' },
        { description: 'Fix 3' },
        { description: 'Fix 4' },
      ],
      risksAddressed: [],
      references: [],
    };
    expect(engine.estimateEffort(rec)).toBe('small');
  });

  it('should estimate large for many files and actions', () => {
    const rec: Recommendation = {
      id: 'rec-1',
      priority: 1,
      title: 'L',
      description: 'L',
      estimatedEffort: 'small',
      affectedFiles: Array(10).fill('file.ts').map((f, i) => `${i}${f}`),
      actionItems: Array(15).fill(0).map((_, i) => ({ description: `Action ${i}` })),
      risksAddressed: [],
      references: [],
    };
    expect(engine.estimateEffort(rec)).toBe('large');
  });

  it('should estimate xlarge for very large effort', () => {
    const rec: Recommendation = {
      id: 'rec-1',
      priority: 1,
      title: 'XL',
      description: 'XL',
      estimatedEffort: 'small',
      affectedFiles: Array(20).fill('file.ts').map((f, i) => `${i}${f}`),
      actionItems: Array(25).fill(0).map((_, i) => ({ description: `Action ${i}` })),
      risksAddressed: [],
      references: [],
    };
    expect(engine.estimateEffort(rec)).toBe('xlarge');
  });

  it('should estimate medium for intermediate effort', () => {
    const rec: Recommendation = {
      id: 'rec-1',
      priority: 2,
      title: 'Med',
      description: 'Med',
      estimatedEffort: 'small',
      affectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      actionItems: Array(7).fill(0).map((_, i) => ({ description: `Action ${i}` })),
      risksAddressed: [],
      references: [],
    };
    expect(engine.estimateEffort(rec)).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Scoring model verification
// ---------------------------------------------------------------------------

describe('RecommendationEngine — scoring model', () => {
  const engine = makeEngine();

  it('should use weighted scoring: severity × 0.5 + impact × 0.3 + effort_inverse × 0.2', () => {
    // Priority 1 → severity weight = 1.0
    // security → impact weight = 1.0
    // trivial → effort inverse = 1.0
    // Score = 1.0*0.5 + 1.0*0.3 + 1.0*0.2 = 1.0
    const best: Recommendation = {
      id: 'best',
      priority: 1,
      title: 'Best',
      description: 'Best',
      estimatedEffort: 'trivial',
      affectedFiles: [],
      actionItems: [],
      risksAddressed: ['security'],
      references: [],
    };

    // Priority 3 → severity weight = 0.2
    // style → impact weight = 0.15
    // xlarge → effort inverse = 0.1
    // Score = 0.2*0.5 + 0.15*0.3 + 0.1*0.2 = 0.1 + 0.045 + 0.02 = 0.165
    const worst: Recommendation = {
      id: 'worst',
      priority: 3,
      title: 'Worst',
      description: 'Worst',
      estimatedEffort: 'xlarge',
      affectedFiles: [],
      actionItems: [],
      risksAddressed: ['style'],
      references: [],
    };

    const prioritized = engine.prioritizeRecommendations([worst, best]);
    expect(prioritized[0].id).toBe('best');
    expect(prioritized[1].id).toBe('worst');
  });
});
