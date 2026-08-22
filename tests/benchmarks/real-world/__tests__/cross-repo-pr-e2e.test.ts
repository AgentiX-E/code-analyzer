// @code-analyzer — Cross-Repo PR Review E2E Tests
// Validates the cross-repo PR review benchmark produces correct results.

import { describe, it, expect, beforeAll } from 'vitest';
import { runCrossRepoPRE2E, type CrossRepoPRE2EResult } from '../cross-repo-pr-e2e.bench.js';

let result: CrossRepoPRE2EResult;

beforeAll(async () => {
  result = await runCrossRepoPRE2E();
}, 60_000);

describe('Cross-Repo PR Review E2E', () => {
  // --- Indexing ---
  it('should index all three repos', () => {
    expect(result.reposIndexed).toBe(3);
  });

  it('should complete within 60 seconds', () => {
    expect(result.durationMs).toBeLessThan(60_000);
  });

  // --- Changed Symbol Detection ---
  it('should identify changed symbols', () => {
    expect(result.changedSymbols.length).toBeGreaterThan(0);
  });

  it('should detect user-related symbols in the changes', () => {
    const hasUserSymbol = result.changedSymbols.some((s) => s.toLowerCase().includes('user'));
    expect(hasUserSymbol).toBe(true);
  });

  // --- Contract Validation ---
  it('should produce contract validation results', () => {
    expect(result.contractValidation).not.toBeNull();
  });

  it('should detect at least one breaking change', () => {
    expect(result.breakingChangesDetected).toBeGreaterThan(0);
  });

  it('should mark the contract as incompatible', () => {
    expect(result.contractValidation?.compatible).toBe(false);
  });

  it('should identify affected repos in contract validation', () => {
    const targets = result.contractValidation?.targetRepos ?? [];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain('api-gateway');
  });

  // --- Blast Radius ---
  it('should calculate blast radius', () => {
    expect(result.blastRadius).not.toBeNull();
  });

  it('should identify api-gateway as directly impacted', () => {
    expect(result.blastRadius?.directImpact).toContain('api-gateway');
  });

  it('should include affected repos in the final list', () => {
    expect(result.affectedRepos.length).toBeGreaterThan(0);
    expect(result.affectedRepos).toContain('api-gateway');
  });

  // --- Recommendations ---
  it('should produce actionable recommendations', () => {
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  // --- Overall Result ---
  it('should pass the benchmark (breaking change detected)', () => {
    expect(result.passed).toBe(true);
  });
});
