// @code-analyzer/mcp — Confidence Scoring Module

import { EDGE_CALLS, EDGE_EXTENDS, EDGE_IMPLEMENTS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfidenceFinding {
  qualifiedName?: string | null;
  filePath?: string | null;
  signature?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  rank?: number | null;
  name?: string | null;
  projectId?: string | null;
  label?: string | null;
  vectorScore?: number | null;
}

export interface ConfidenceContext {
  targetSymbol?: string | null;
  targetFile?: string | null;
  targetSignature?: string | null;
  lineNumber?: number | null;
  edgeType?: string | null;
  hasDirectEdge?: boolean | null;
  isExported?: boolean | null;
  projectId?: string | null;
  expectedLabel?: string | null;
}

export interface ConfidenceScore {
  score: number;
  label: 'high' | 'medium' | 'low';
  factors: string[];
}

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a confidence score for a graph finding based on match evidence.
 *
 * Scoring tiers:
 *   - Direct matches:     0.9 – 1.0
 *   - Heuristic matches:  0.7 – 0.89
 *   - Inferred matches:   0.5 – 0.69
 */
export function computeConfidence(
  finding: ConfidenceFinding,
  context: ConfidenceContext,
): ConfidenceScore {
  const factors: string[] = [];

  // --- Direct match signals (highest confidence) ---
  let directMatches = 0;
  let heuristicMatches = 0;
  let inferredMatches = 0;

  // Qualified name exact match
  if (typeof finding.qualifiedName === 'string' && typeof context.targetSymbol === 'string') {
    if (finding.qualifiedName === context.targetSymbol) {
      directMatches++;
      factors.push('exact qualified name match');
    }
  }

  // File path match
  if (typeof finding.filePath === 'string' && typeof context.targetFile === 'string') {
    if (finding.filePath === context.targetFile) {
      directMatches++;
      factors.push('exact file path match');
    } else if (
      typeof finding.filePath === 'string' &&
      typeof context.targetFile === 'string' &&
      finding.filePath.includes(context.targetFile)
    ) {
      heuristicMatches++;
      factors.push('partial file path match');
    }
  }

  // Signature match
  if (typeof finding.signature === 'string' && typeof context.targetSignature === 'string') {
    if (finding.signature === context.targetSignature) {
      directMatches++;
      factors.push('exact signature match');
    } else if (finding.signature.includes(context.targetSignature)) {
      heuristicMatches++;
      factors.push('partial signature match');
    }
  }

  // Edge-based direct caller/callee
  if (context.edgeType === EDGE_CALLS && context.hasDirectEdge === true) {
    directMatches++;
    factors.push('direct edge exists in graph');
  }

  // Line range overlap check
  if (
    typeof finding.startLine === 'number' &&
    typeof finding.endLine === 'number' &&
    typeof context.lineNumber === 'number'
  ) {
    if (finding.startLine <= context.lineNumber && finding.endLine >= context.lineNumber) {
      directMatches++;
      factors.push('line range contains target');
    } else if (Math.abs(finding.startLine - context.lineNumber) <= 5) {
      heuristicMatches++;
      factors.push('proximity-based line match');
    }
  }

  // --- Heuristic signals ---
  if (context.edgeType === EDGE_IMPLEMENTS && context.hasDirectEdge === true) {
    heuristicMatches++;
    factors.push('implements relationship');
  }

  if (context.edgeType === EDGE_EXTENDS && context.hasDirectEdge === true) {
    heuristicMatches++;
    factors.push('extends relationship');
  }

  /* v8 ignore start -- @preserve */
  if (context.isExported === true) {
    heuristicMatches++;
    factors.push('exported symbol (likely public API)');
  }
  /* v8 ignore stop -- @preserve */

  // FTS rank-based heuristic
  if (typeof finding.rank === 'number' && finding.rank > 8) {
    heuristicMatches++;
    factors.push('high FTS rank');
  }

  // Name similarity (substring)
  if (typeof finding.name === 'string' && typeof context.targetSymbol === 'string') {
    const fn = finding.name.toLowerCase();
    const tn = context.targetSymbol.toLowerCase();
    if (fn !== tn && (fn.includes(tn) || tn.includes(fn))) {
      heuristicMatches++;
      factors.push('name substring similarity');
    }
  }

  // --- Inferred matches ---
  // Same project but no direct edge
  if (
    typeof finding.projectId === 'string' &&
    typeof context.projectId === 'string' &&
    finding.projectId === context.projectId
  ) {
    if (!context.hasDirectEdge) {
      inferredMatches++;
      factors.push('same project (no direct edge)');
    }
  }

  // Same file but different symbol
  if (
    typeof finding.filePath === 'string' &&
    typeof context.targetFile === 'string' &&
    finding.filePath === context.targetFile &&
    context.hasDirectEdge === false
  ) {
    inferredMatches++;
    factors.push('same file (no direct edge)');
  }

  // Same label type (e.g., both are Functions)
  if (typeof finding.label === 'string' && typeof context.expectedLabel === 'string') {
    if (finding.label === context.expectedLabel) {
      inferredMatches++;
      factors.push('same label type');
    }
  }

  // Semantic vector similarity
  if (typeof finding.vectorScore === 'number' && finding.vectorScore > 0.7) {
    inferredMatches++;
    factors.push('high vector similarity');
  }

  // --- Compute final score ---
  const totalSignals = directMatches + heuristicMatches + inferredMatches;

  if (totalSignals === 0) {
    return { score: 0.0, label: 'low', factors: ['no matching signals found'] };
  }

  // Scoring: direct signals contribute most, then heuristic, then inferred
  // Base from strongest signal
  let score: number;
  if (directMatches > 0) {
    // Scale within direct range: 0.9 - 1.0 based on number of matches
    score = 0.9 + Math.min(directMatches, 5) * 0.02;
  } else if (heuristicMatches > 0) {
    // Scale within heuristic range: 0.7 - 0.89
    score = 0.7 + Math.min(heuristicMatches, 10) * 0.019;
  } else {
    // Scale within inferred range: 0.5 - 0.69
    score = 0.5 + Math.min(inferredMatches, 10) * 0.019;
  }

  // Boost for multiple signal types (having both direct and heuristic increases confidence)
  if (directMatches > 0 && heuristicMatches > 0) {
    score += 0.03;
  }
  if (heuristicMatches > 0 && inferredMatches > 0) {
    /* v8 ignore next -- @preserve */
    score += 0.02;
  }

  // Clamp to [0, 1]
  score = Math.max(0.0, Math.min(1.0, score));

  const label = getConfidenceLabel(score);

  return { score: Math.round(score * 1000) / 1000, label, factors };
}

/**
 * Convert a numeric confidence score into a label.
 *   >= 0.9  → high
 *   >= 0.7  → medium
 *   <  0.7  → low
 */
export function getConfidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.9) return 'high';
  if (score >= 0.7) return 'medium';
  return 'low';
}
