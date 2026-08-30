// @code-analyzer/intelligence — PR Review Bridge Branch Coverage
// Exercises the pure decision/formatting helpers of PRReviewBridge (risk level,
// merge recommendation, recommendations, summary, and changed-symbol extraction)
// across every branch. These are private, deterministic methods exercised
// directly through the public pipeline in the existing suite, but only their
// "all-clear" paths were reached.

import { describe, it, expect } from 'vitest';
import { PRReviewBridge } from '../../cross-repo/pr-review-bridge.js';
import type { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import type { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';
import type { CodeReviewEngine } from '../../review/review-engine.js';
import type { ContractValidationResult } from '../../cross-repo/contract-validator.js';
import type { BlastRadiusResult, DependencyChain } from '../../cross-repo/impact-graph.js';
import type { GitDiff } from '@code-analyzer/shared';

function makeBridge(): PRReviewBridge {
  return new PRReviewBridge({} as CrossRepoIndexer, {} as RepoGroupManager, {} as CodeReviewEngine);
}

function cv(overrides: Partial<ContractValidationResult> = {}): ContractValidationResult {
  return {
    sourceRepo: 'myorg/service-a',
    targetRepos: [],
    changes: [],
    breakingCount: 0,
    compatible: true,
    recommendations: [],
    ...overrides,
  };
}

function br(overrides: Partial<BlastRadiusResult> = {}): BlastRadiusResult {
  return {
    sourceRepo: 'myorg/service-a',
    directImpact: [],
    transitiveImpact: [],
    totalAffected: 0,
    criticalPaths: [],
    severityRankings: new Map(),
    ...overrides,
  };
}

function diff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    filePath: 'src/api.ts',
    changeType: 'modified',
    oldHash: '',
    newHash: '',
    ranges: [],
    ...overrides,
  };
}

describe('PRReviewBridge — determineRiskLevel', () => {
  const risk = (c: ContractValidationResult, b: BlastRadiusResult) =>
    (makeBridge() as any).determineRiskLevel(c, b);

  it('classifies an incompatible contract as critical', () => {
    expect(risk(cv({ compatible: false }), br())).toBe('critical');
  });

  it('classifies >=3 breaking changes as critical', () => {
    expect(risk(cv({ breakingCount: 3 }), br())).toBe('critical');
  });

  it('classifies >=5 affected repos as critical', () => {
    expect(risk(cv(), br({ totalAffected: 5 }))).toBe('critical');
  });

  it('classifies a single breaking change as high', () => {
    expect(risk(cv({ breakingCount: 1 }), br())).toBe('high');
  });

  it('classifies >=3 affected repos as high', () => {
    expect(risk(cv(), br({ totalAffected: 3 }))).toBe('high');
  });

  it('classifies one affected repo as medium', () => {
    expect(risk(cv(), br({ totalAffected: 1 }))).toBe('medium');
  });

  it('classifies no impact as low', () => {
    expect(risk(cv(), br())).toBe('low');
  });
});

describe('PRReviewBridge — determineMergeRecommendation', () => {
  const rec = (riskLevel: string, c: ContractValidationResult, b: BlastRadiusResult) =>
    (makeBridge() as any).determineMergeRecommendation(riskLevel, c, b);

  it('blocks on critical risk', () => {
    expect(rec('critical', cv(), br())).toBe('block');
  });

  it('requests changes on high risk', () => {
    expect(rec('high', cv(), br())).toBe('request-changes');
  });

  it('approves with caution on an incompatible contract', () => {
    expect(rec('low', cv({ compatible: false }), br())).toBe('approve-with-caution');
  });

  it('approves with caution when more than one repo is affected', () => {
    expect(rec('low', cv(), br({ totalAffected: 2 }))).toBe('approve-with-caution');
  });

  it('approves when compatible and at most one repo affected', () => {
    expect(rec('low', cv(), br())).toBe('approve');
  });
});

describe('PRReviewBridge — buildRecommendations', () => {
  const build = (c: ContractValidationResult, b: BlastRadiusResult, chains: DependencyChain[]) =>
    (makeBridge() as any).buildRecommendations(c, b, chains);

  it('includes contract recommendations', () => {
    const recs = build(cv({ recommendations: ['Update consumers.'] }), br(), []);
    expect(recs).toContain('Update consumers.');
  });

  it('includes blast-radius coordination advice when repos are affected', () => {
    const recs = build(cv(), br({ totalAffected: 1, directImpact: ['myorg/service-b'] }), []);
    expect(recs.some((r: string) => r.includes('1 repos are affected'))).toBe(true);
  });

  it('includes critical-path advice', () => {
    const recs = build(cv(), br({ criticalPaths: [['a', 'b']] }), []);
    expect(recs.some((r: string) => r.includes('Critical dependency paths'))).toBe(true);
  });

  it('includes critical dependency-chain advice', () => {
    const chains: DependencyChain[] = [
      { repos: ['a', 'b'], symbols: ['x'], depth: 2, criticality: 'critical' },
    ];
    const recs = build(cv(), br(), chains);
    expect(recs.some((r: string) => r.includes('critical dependency chains'))).toBe(true);
  });

  it('falls back to a safe-to-merge note when nothing specific applies', () => {
    const recs = build(cv(), br(), []);
    expect(recs).toEqual([
      'No breaking changes detected. Safe to merge with standard review process.',
    ]);
  });
});

describe('PRReviewBridge — buildSummary', () => {
  const summary = (c: ContractValidationResult, b: BlastRadiusResult) =>
    (makeBridge() as any).buildSummary('myorg/service-a', 0, c, b);

  it('reports breaking changes when present', () => {
    expect(summary(cv({ breakingCount: 2, targetRepos: ['b', 'c'] }), br())).toContain(
      'Found 2 breaking contract change(s)',
    );
  });

  it('reports no breaking changes', () => {
    expect(summary(cv(), br())).toContain('No breaking contract changes detected');
  });

  it('reports blast radius coverage', () => {
    const s = summary(cv(), br({ totalAffected: 2, directImpact: ['b'], transitiveImpact: ['c'] }));
    expect(s).toContain('Blast radius covers 2 repos');
  });

  it('marks a safe merge when compatible with no impact', () => {
    expect(summary(cv(), br())).toContain('safe to merge without cross-repo coordination');
  });
});

describe('PRReviewBridge — extractChangedSymbols', () => {
  const extract = (diffs: GitDiff[]) => (makeBridge() as any).extractChangedSymbols(diffs);

  it('extracts base name, capitalized variant, and directory', () => {
    const symbols = extract([diff({ filePath: 'src/api.ts' })]);
    expect(symbols).toContain('api');
    expect(symbols).toContain('Api');
    expect(symbols).toContain('src');
  });

  it('handles a file path with no directory segment', () => {
    const symbols = extract([diff({ filePath: 'api.ts' })]);
    expect(symbols).toContain('api');
    expect(symbols).toContain('Api');
    expect(symbols).not.toContain('');
  });

  it('does not add a duplicate variant when the base name is already capitalized', () => {
    const symbols = extract([diff({ filePath: 'src/API.ts' })]);
    expect(symbols).toContain('API');
    expect(symbols).toContain('src');
    // baseName === capitalized, so no extra PascalCase variant is appended.
    expect(symbols.filter((s: string) => s.toLowerCase() === 'api')).toHaveLength(1);
  });

  it('skips an empty file path entirely', () => {
    expect(extract([diff({ filePath: '' })])).toEqual([]);
  });

  it('deduplicates symbols across diffs', () => {
    const symbols = extract([diff({ filePath: 'src/api.ts' }), diff({ filePath: 'src/api.ts' })]);
    expect(symbols.filter((s: string) => s === 'api')).toHaveLength(1);
  });
});
