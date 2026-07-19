import type {
  Finding,
  Recommendation,
  ReviewCategory,
  Severity,
} from '@code-analyzer/shared';

export interface RecommendationOptions {
  maxRecommendations?: number;
}

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

/** Impact weight mapping based on category */
const IMPACT_WEIGHT: Record<string, number> = {
  security: 1.0,
  bug: 0.9,
  architecture: 0.85,
  performance: 0.7,
  error_handling: 0.65,
  maintainability: 0.5,
  test: 0.3,
  style: 0.15,
  documentation: 0.1,
  other: 0.2,
};

/** Inverse effort multiplier based on estimated effort */
const EFFORT_INVERSE: Record<string, number> = {
  trivial: 1.0,
  small: 0.8,
  medium: 0.5,
  large: 0.25,
  xlarge: 0.1,
};

// ---------------------------------------------------------------------------
// RecommendationEngine
// ---------------------------------------------------------------------------

export class RecommendationEngine {
  private idCounter = 0;

  /**
   * Generate recommendations from findings.
   * Groups related findings, scores them, and returns prioritized list.
   */
  generateRecommendations(
    findings: Finding[],
    options?: RecommendationOptions,
  ): Recommendation[] {
    if (findings.length === 0) return [];

    // Group related findings
    const groups = this.groupRelatedFindings(findings);

    // Build recommendations from groups
    const recommendations = groups.map((group) => this.buildRecommendation(group));

    // Prioritize and score
    const prioritized = this.prioritizeRecommendations(recommendations);

    // Apply max limit
    const maxRecs = options?.maxRecommendations ?? 20;
    return prioritized.slice(0, maxRecs);
  }

  /**
   * Estimate implementation effort for a recommendation.
   * Considers number of affected files, findings, and complexity.
   */
  estimateEffort(recommendation: Recommendation): 'trivial' | 'small' | 'medium' | 'large' | 'xlarge' {
    const fileCount = recommendation.affectedFiles.length;
    const actionCount = recommendation.actionItems.length;

    if (actionCount <= 2 && fileCount <= 1) return 'trivial';
    if (actionCount <= 5 && fileCount <= 3) return 'small';
    if (actionCount <= 10 && fileCount <= 7) return 'medium';
    if (actionCount <= 20 && fileCount <= 15) return 'large';
    return 'xlarge';
  }

  /**
   * Prioritize recommendations using weighted scoring model:
   *   score = severity_weight × 0.5 + impact_weight × 0.3 + effort_inverse × 0.2
   */
  prioritizeRecommendations(recommendations: Recommendation[]): Recommendation[] {
    return [...recommendations]
      .map((rec) => ({
        rec,
        score: this.computeScore(rec),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.rec);
  }

  /**
   * Group related findings by shared file paths, categories, or severity.
   * Uses a simple clustering approach: findings sharing a file path
   * with the same category are grouped together.
   */
  groupRelatedFindings(findings: Finding[]): Finding[][] {
    if (findings.length === 0) return [];
    if (findings.length === 1) return [[findings[0]!]];

    const used = new Set<number>();
    const groups: Finding[][] = [];
    const arr = findings; // Local alias for type narrowing

    for (let i = 0; i < arr.length; i++) {
      if (used.has(i)) continue;

      const current = arr[i]!;
      const group: Finding[] = [current];
      used.add(i);

      for (let j = i + 1; j < arr.length; j++) {
        if (used.has(j)) continue;

        if (this.areRelated(current, arr[j]!)) {
          group.push(arr[j]!);
          used.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  // ---- Private helpers ----

  private areRelated(a: Finding, b: Finding): boolean {
    // Same file path and category
    if (a.filePath === b.filePath && a.category === b.category) return true;

    // Same severity and category within the same file
    if (a.severity === b.severity && a.category === b.category && a.filePath === b.filePath)
      return true;

    // Has related findings reference
    if (a.relatedFindings.includes(b.id) || b.relatedFindings.includes(a.id)) return true;

    return false;
  }

  private buildRecommendation(group: Finding[]): Recommendation {
    this.idCounter++;

    const effort = this.estimateEffort({
      id: '',
      priority: 1,
      title: '',
      description: '',
      estimatedEffort: 'small',
      affectedFiles: [...new Set(group.map((f) => f.filePath))],
      actionItems: [],
      risksAddressed: [],
      references: [],
    });

    const severity = this.highestSeverity(group);
    const category = this.mostCommonField(group, 'category') as ReviewCategory;

    return {
      id: `rec-${this.idCounter}`,
      priority: this.severityToPriority(severity),
      title: `Address ${group.length} ${severity} ${category} issue(s)`,
      description: `Found ${group.length} related finding(s) in "${category}" category (${severity} severity) across ${new Set(group.map((f) => f.filePath)).size} file(s).`,
      estimatedEffort: effort,
      affectedFiles: [...new Set(group.map((f) => f.filePath))],
      actionItems: group.map((f) => ({
        description: f.title,
        file: f.filePath,
        lineRange: f.lineRange ?? undefined,
      })),
      risksAddressed: [category],
      references: [],
    };
  }

  private computeScore(recommendation: Recommendation): number {
    const severityW = this.computeSeverityWeight(recommendation);
    const impactW = this.computeImpactWeight(recommendation);
    const effortInv = this.computeEffortInverse(recommendation);

    return severityW * 0.5 + impactW * 0.3 + effortInv * 0.2;
  }

  private computeSeverityWeight(rec: Recommendation): number {
    // Higher priority → higher severity weight
    switch (rec.priority) {
      case 1:
        return 1.0;
      case 2:
        return 0.5;
      case 3:
        return 0.2;
      default:
        return 0.1;
    }
  }

  private computeImpactWeight(rec: Recommendation): number {
    let totalImpact = 0;
    let count = 0;

    for (const risk of rec.risksAddressed) {
      const weight = IMPACT_WEIGHT[risk] ?? 0.2;
      totalImpact += weight;
      count++;
    }

    return count > 0 ? totalImpact / count : 0.3;
  }

  private computeEffortInverse(rec: Recommendation): number {
    return EFFORT_INVERSE[rec.estimatedEffort] ?? 0.5;
  }

  private highestSeverity(findings: Finding[]): Severity {
    const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
    for (const sev of severityOrder) {
      if (findings.some((f) => f.severity === sev)) return sev;
    }
    return 'low';
  }

  private severityToPriority(severity: Severity): 1 | 2 | 3 {
    switch (severity) {
      case 'critical':
      case 'high':
        return 1;
      case 'medium':
        return 2;
      case 'low':
      case 'info':
      default:
        return 3;
    }
  }

  private mostCommonField<T extends keyof Finding>(findings: Finding[], field: T): Finding[T] {
    const counts = new Map<Finding[T], number>();
    for (const f of findings) {
      const val = f[field];
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? (findings[0]?.[field] as Finding[T]);
  }
}
