import type { AnalysisReport, Finding } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Trend types
// ---------------------------------------------------------------------------

export interface TrendData {
  values: number[];
  timestamps: string[];
  direction: 'improving' | 'degrading' | 'stable';
  changeRate: number;
}

export interface ReportComparison {
  addedFindings: Finding[];
  removedFindings: Finding[];
  metricDeltas: Record<string, number>;
  overallChange: 'improved' | 'degraded' | 'unchanged';
}

// ---------------------------------------------------------------------------
// TrendAnalyzer
// ---------------------------------------------------------------------------

export class TrendAnalyzer {
  /**
   * Track a metric across multiple reports over time.
   *
   * The `metricPath` is a dot-separated path into the report object,
   * e.g.:
   *   - `summary.overallScore`
   *   - `summary.totalFindings`
   *   - `metrics.complianceScore`
   *   - `metrics.complexityDelta`
   *   - `summary.criticalFindings`
   */
  trackMetric(reports: AnalysisReport[], metricPath: string): TrendData {
    if (reports.length === 0) {
      return { values: [], timestamps: [], direction: 'stable', changeRate: 0 };
    }

    // Sort by creation time (oldest first)
    const sorted = [...reports].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const values: number[] = [];
    const timestamps: string[] = [];

    for (const report of sorted) {
      const value = this.getValueAtPath(report, metricPath);
      if (value !== null) {
        values.push(value);
        timestamps.push(report.createdAt);
      }
    }

    const { direction, changeRate } = this.computeDirection(values, metricPath);

    return { values, timestamps, direction, changeRate };
  }

  /**
   * Compare two reports and produce a delta comparison.
   * `reportA` is the baseline (older), `reportB` is the new version.
   */
  compareReports(reportA: AnalysisReport, reportB: AnalysisReport): ReportComparison {
    // Ensure chronological order
    const timeA = new Date(reportA.createdAt).getTime();
    const timeB = new Date(reportB.createdAt).getTime();

    const [baseline, current] = timeA <= timeB ? [reportA, reportB] : [reportB, reportA];

    // Compare findings by ID
    const baselineIds = new Set(baseline.findings.map((f) => f.id));
    const currentIds = new Set(current.findings.map((f) => f.id));

    const addedFindings = current.findings.filter((f) => !baselineIds.has(f.id));
    const removedFindings = baseline.findings.filter((f) => !currentIds.has(f.id));

    // Compute metric deltas
    const metricDeltas = this.computeMetricDeltas(baseline, current);

    // Overall change determination
    const overallChange = this.determineOverallChange(addedFindings, removedFindings, metricDeltas);

    return {
      addedFindings,
      removedFindings,
      metricDeltas,
      overallChange,
    };
  }

  // ---- Private helpers ----

  private getValueAtPath(obj: unknown, path: string): number | null {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return null;
      if (typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[part];
    }

    if (typeof current === 'number') return current;
    return null;
  }

  private computeDirection(values: number[], metricPath: string): { direction: TrendData['direction']; changeRate: number } {
    if (values.length < 2) {
      return { direction: 'stable', changeRate: 0 };
    }

    const first = values[0]!;
    const last = values[values.length - 1]!;

    if (first === 0) {
      return { direction: last > 0 ? 'improving' : 'stable', changeRate: 0 };
    }

    const changeRate = ((last - first) / first) * 100;

    // Determine direction (with 2% tolerance for "stable")
    if (Math.abs(changeRate) < 2) {
      return { direction: 'stable', changeRate: Math.round(changeRate * 100) / 100 };
    }

    // Metrics where lower values are better (decreasing = improving)
    const LOWER_IS_BETTER = new Set([
      'metrics.linesChanged',
      'metrics.filesChanged',
      'metrics.symbolsAffected',
      'metrics.routesAffected',
      'metrics.testsImpacted',
      'metrics.complexityDelta',
      'metrics.reviewDuration',
      'metrics.tokenUsage',
      'summary.totalFindings',
      'summary.criticalFindings',
      'summary.highFindings',
      'summary.mediumFindings',
      'summary.lowFindings',
    ]);

    const lowerBetter = LOWER_IS_BETTER.has(metricPath);
    const improving = lowerBetter ? changeRate < 0 : changeRate > 0;

    return {
      direction: improving ? 'improving' : 'degrading',
      changeRate: Math.round(changeRate * 100) / 100,
    };
  }

  private computeMetricDeltas(baseline: AnalysisReport, current: AnalysisReport): Record<string, number> {
    const paths = [
      'summary.overallScore',
      'summary.totalFindings',
      'summary.criticalFindings',
      'summary.highFindings',
      'summary.mediumFindings',
      'summary.lowFindings',
      'metrics.linesChanged',
      'metrics.filesChanged',
      'metrics.symbolsAffected',
      'metrics.routesAffected',
      'metrics.testsImpacted',
      'metrics.complexityDelta',
      'metrics.coverageDelta',
      'metrics.complianceScore',
      'metrics.tokenUsage',
    ];

    const deltas: Record<string, number> = {};

    for (const path of paths) {
      const baseVal = this.getValueAtPath(baseline, path);
      const currVal = this.getValueAtPath(current, path);

      if (baseVal !== null && currVal !== null) {
        deltas[path] = currVal - baseVal;
      }
    }

    return deltas;
  }

  private determineOverallChange(
    addedFindings: Finding[],
    removedFindings: Finding[],
    metricDeltas: Record<string, number>,
  ): 'improved' | 'degraded' | 'unchanged' {
    let score = 0;

    // Removed findings → improvement, added findings → degradation
    score += removedFindings.length * 1;
    score -= addedFindings.length * 1;

    // Weight critical findings more heavily
    const criticalAdded = addedFindings.filter((f) => f.severity === 'critical').length;
    const criticalRemoved = removedFindings.filter((f) => f.severity === 'critical').length;
    score += criticalRemoved * 3;
    score -= criticalAdded * 3;

    // Weight high findings
    const highAdded = addedFindings.filter((f) => f.severity === 'high').length;
    const highRemoved = removedFindings.filter((f) => f.severity === 'high').length;
    score += highRemoved * 2;
    score -= highAdded * 2;

    // Overall score improvement
    if (metricDeltas['summary.overallScore'] && metricDeltas['summary.overallScore'] > 1) score += 2;
    else if (metricDeltas['summary.overallScore'] && metricDeltas['summary.overallScore'] < -1) score -= 2;

    // Compliance score
    if (metricDeltas['metrics.complianceScore'] && metricDeltas['metrics.complianceScore'] > 1) score += 2;
    else if (metricDeltas['metrics.complianceScore'] && metricDeltas['metrics.complianceScore'] < -1) score -= 2;

    if (score > 0) return 'improved';
    if (score < 0) return 'degraded';
    return 'unchanged';
  }
}
