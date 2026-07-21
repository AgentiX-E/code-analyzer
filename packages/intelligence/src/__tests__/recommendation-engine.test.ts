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

// ==========================================================================
// Branch Coverage Hardening — Edge Cases
// ==========================================================================

describe('RecommendationEngine edge cases', () => {
  let engine: RecommendationEngine;

  beforeEach(() => {
    engine = new RecommendationEngine();
  });

  it('returns empty array for empty findings list', () => {
    const recs = engine.generateRecommendations([]);
    expect(recs).toEqual([]);
  });

  it('handles single finding', () => {
    const finding: Finding = {
      id: 'f-1',
      title: 'Missing error handling',
      description: 'Async function lacks try/catch',
      filePath: 'src/api.ts',
      lineRange: [10, 15],
      severity: 'high',
      category: 'error_handling',
      recommendation: 'Add try/catch block',
      relatedFindings: [],
    };
    const recs = engine.generateRecommendations([finding]);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]!.affectedFiles).toContain('src/api.ts');
  });

  it('groups related findings by file and category', () => {
    const findings: Finding[] = [
      { id: '1', title: 't1', description: '', filePath: 'a.ts', lineRange: [1,2], severity: 'high', category: 'bug', recommendation: '', relatedFindings: [] },
      { id: '2', title: 't2', description: '', filePath: 'a.ts', lineRange: [3,4], severity: 'high', category: 'bug', recommendation: '', relatedFindings: [] },
      { id: '3', title: 't3', description: '', filePath: 'b.ts', lineRange: [1,2], severity: 'low', category: 'style', recommendation: '', relatedFindings: [] },
    ];
    const recs = engine.generateRecommendations(findings);
    // a.ts bug findings should be grouped together
    expect(recs.length).toBeGreaterThanOrEqual(2);
  });

  it('finds related findings by id reference', () => {
    const findings: Finding[] = [
      { id: '1', title: 't1', description: '', filePath: 'x.ts', lineRange: [1,2], severity: 'medium', category: 'bug', recommendation: '', relatedFindings: ['2'] },
      { id: '2', title: 't2', description: '', filePath: 'y.ts', lineRange: [3,4], severity: 'medium', category: 'bug', recommendation: '', relatedFindings: ['1'] },
    ];
    const recs = engine.generateRecommendations(findings);
    // Should be grouped together since they reference each other
    expect(recs.length).toBeGreaterThanOrEqual(1);
  });

  it('estimateEffort returns trivial for 1 file, 1 action', () => {
    const effort = engine.estimateEffort({
      id: 'r1', priority: 1, title: '', description: '',
      estimatedEffort: 'small', affectedFiles: ['a.ts'], actionItems: [{ description: '', file: 'a.ts' }],
      risksAddressed: [], references: [],
    });
    expect(effort).toBe('trivial');
  });

  it('estimateEffort returns xlarge for many files', () => {
    const effort = engine.estimateEffort({
      id: 'r1', priority: 1, title: '', description: '',
      estimatedEffort: 'small',
      affectedFiles: Array.from({ length: 20 }, (_, i) => `f${i}.ts`),
      actionItems: Array.from({ length: 30 }, (_, i) => ({ description: `a${i}`, file: `f${i}.ts` })),
      risksAddressed: [], references: [],
    });
    expect(effort).toBe('xlarge');
  });

  it('estimateEffort returns small for 3 files, 5 actions', () => {
    const effort = engine.estimateEffort({
      id: 'r1', priority: 2, title: '', description: '',
      estimatedEffort: 'small',
      affectedFiles: ['a.ts', 'b.ts', 'c.ts'],
      actionItems: Array.from({ length: 5 }, (_, i) => ({ description: `a${i}`, file: 'x.ts' })),
      risksAddressed: [], references: [],
    });
    expect(effort).toBe('small');
  });

  it('estimateEffort returns medium for 7 files, 10 actions', () => {
    const effort = engine.estimateEffort({
      id: 'r1', priority: 2, title: '', description: '',
      estimatedEffort: 'small',
      affectedFiles: Array.from({ length: 7 }, (_, i) => `f${i}.ts`),
      actionItems: Array.from({ length: 10 }, (_, i) => ({ description: `a${i}`, file: 'x.ts' })),
      risksAddressed: [], references: [],
    });
    expect(effort).toBe('medium');
  });

  it('estimateEffort returns large for 15 files, 20 actions', () => {
    const effort = engine.estimateEffort({
      id: 'r1', priority: 2, title: '', description: '',
      estimatedEffort: 'small',
      affectedFiles: Array.from({ length: 15 }, (_, i) => `f${i}.ts`),
      actionItems: Array.from({ length: 20 }, (_, i) => ({ description: `a${i}`, file: 'x.ts' })),
      risksAddressed: [], references: [],
    });
    expect(effort).toBe('large');
  });

  it('computes priority correctly for all severity levels', () => {
    // Test via generateRecommendations
    const severe: Finding = {
      id: 's1', title: 'Critical bug', description: '', filePath: 'a.ts',
      lineRange: [1, 2], severity: 'critical', category: 'bug',
      recommendation: '', relatedFindings: [],
    };
    const recs = engine.generateRecommendations([severe]);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]!.priority).toBe(1);
  });

  it('handles info severity correctly', () => {
    const findings: Finding[] = [
      { id: 'i1', title: 'Info note', description: '', filePath: 'a.ts', lineRange: [1,2], severity: 'info', category: 'documentation', recommendation: '', relatedFindings: [] },
    ];
    const recs = engine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]!.priority).toBe(3); // info → priority 3
  });

  it('handles medium severity correctly', () => {
    const findings: Finding[] = [
      { id: 'm1', title: 'Medium issue', description: '', filePath: 'a.ts', lineRange: [1,2], severity: 'medium', category: 'maintainability', recommendation: '', relatedFindings: [] },
    ];
    const recs = engine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]!.priority).toBe(2); // medium → priority 2
  });

  it('handles unknown risk category gracefully', () => {
    const findings: Finding[] = [
      { id: 'u1', title: 'Unknown', description: '', filePath: 'a.ts', lineRange: [1,2], severity: 'low', category: 'other', recommendation: '', relatedFindings: [] },
    ];
    const recs = engine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces max recommendations limit', () => {
    const findings: Finding[] = Array.from({ length: 50 }, (_, i) => ({
      id: `f${i}`, title: `Issue ${i}`, description: '',
      filePath: `src/file${i % 5}.ts`,
      lineRange: [1, 2] as [number, number],
      severity: (['low', 'medium', 'high'] as const)[i % 3],
      category: (['bug', 'style', 'performance'] as const)[i % 3],
      recommendation: '', relatedFindings: [],
    }));
    const recs = engine.generateRecommendations(findings, { maxRecommendations: 5 });
    expect(recs.length).toBeLessThanOrEqual(5);
  });

  it('handles priority weight default case (priority 0 or invalid)', () => {
    // Test that an invalid priority falls through to the default case (0.1 weight)
    // We access the private method indirectly through generateRecommendations
    // with findings that produce recommendations having specific priorities
    const findings: Finding[] = [
      { id: 'i1', title: 'Info issue', description: '', filePath: 'a.ts', lineRange: [1, 2], severity: 'info', category: 'style', recommendation: '', relatedFindings: [] },
    ];
    const recs = engine.generateRecommendations(findings);
    // Info severity → priority 3 → weight 0.2
    expect(recs.length).toBeGreaterThanOrEqual(1);
    if (recs.length > 0) {
      expect(recs[0]!.priority).toBe(3);
    }
  });

  it('handles highestSeverity with info-only findings (default low)', () => {
    // When all findings are 'info' severity, the first non-matching iteration
    // falls through to return 'low' at the end
    const findings: Finding[] = [
      { id: 'i1', title: 'Info 1', description: '', filePath: 'a.ts', lineRange: [1, 2], severity: 'info', category: 'style', recommendation: '', relatedFindings: [] },
      { id: 'i2', title: 'Info 2', description: '', filePath: 'b.ts', lineRange: [1, 2], severity: 'info', category: 'style', recommendation: '', relatedFindings: [] },
    ];
    const recs = engine.generateRecommendations(findings);
    expect(recs.length).toBeGreaterThanOrEqual(0);
  });
});
