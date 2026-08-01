// @code-analyzer — CA-Bench Runner
// Orchestrates all benchmark suites, collects results, and generates reports.
/* v8 ignore file -- @preserve */

export interface BenchmarkSuite {
  readonly name: string;
  readonly description: string;
  run(): Promise<BenchmarkResult>;
}

export interface BenchmarkMeasurement {
  name: string;
  value: number;
  unit: string;
  threshold: { min?: number; max?: number; target: number };
  passed: boolean;
}

export interface BenchmarkResult {
  suiteName: string;
  description: string;
  durationMs: number;
  measurements: BenchmarkMeasurement[];
  passed: boolean;
  details: string[];
  timestamp: string;
}

export interface CaBenchReport {
  title: string;
  generatedAt: string;
  summary: {
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    totalMeasurements: number;
    passedMeasurements: number;
    failedMeasurements: number;
  };
  suites: BenchmarkResult[];
}

// ---------------------------------------------------------------------------
// BenchmarkRunner
// ---------------------------------------------------------------------------

export class CaBenchRunner {
  private suites: Map<string, BenchmarkSuite> = new Map();

  /** Register a benchmark suite. */
  register(suite: BenchmarkSuite): void {
    if (this.suites.has(suite.name)) {
      throw new Error(`Benchmark suite "${suite.name}" is already registered`);
    }
    this.suites.set(suite.name, suite);
  }

  /** Run a single suite by name. */
  async runSuite(name: string): Promise<BenchmarkResult> {
    const suite = this.suites.get(name);
    if (!suite) {
      throw new Error(`Benchmark suite "${name}" not found. Available: ${[...this.suites.keys()].join(', ')}`);
    }

    const start = Date.now();
    const result = await suite.run();
    result.durationMs = Date.now() - start;
    result.timestamp = new Date().toISOString();

    return result;
  }

  /** Run all registered suites. */
  async runAll(): Promise<CaBenchReport> {
    const suiteResults: BenchmarkResult[] = [];
    const suiteNames = [...this.suites.keys()];

    for (const name of suiteNames) {
      try {
        const result = await this.runSuite(name);
        suiteResults.push(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        suiteResults.push({
          suiteName: name,
          description: this.suites.get(name)?.description ?? '',
          durationMs: 0,
          measurements: [],
          passed: false,
          details: [`Suite execution failed: ${message}`],
          timestamp: new Date().toISOString(),
        });
      }
    }

    return this.buildReport(suiteResults);
  }

  /** Build a CaBenchReport from suite results. */
  private buildReport(results: BenchmarkResult[]): CaBenchReport {
    let totalMeasurements = 0;
    let passedMeasurements = 0;
    let failedMeasurements = 0;

    for (const suite of results) {
      totalMeasurements += suite.measurements.length;
      passedMeasurements += suite.measurements.filter((m) => m.passed).length;
      failedMeasurements += suite.measurements.filter((m) => !m.passed).length;
    }

    return {
      title: 'CA-Bench — Code Analyzer Benchmark Report',
      generatedAt: new Date().toISOString(),
      summary: {
        totalSuites: results.length,
        passedSuites: results.filter((r) => r.passed).length,
        failedSuites: results.filter((r) => !r.passed).length,
        totalMeasurements,
        passedMeasurements,
        failedMeasurements,
      },
      suites: results,
    };
  }

  /** Generate a JSON report string. */
  generateJsonReport(report: CaBenchReport): string {
    return JSON.stringify(
      {
        schema: 'ca-bench-v1',
        ...report,
      },
      null,
      2,
    );
  }

  /** Generate a Markdown report string. */
  generateMarkdownReport(report: CaBenchReport): string {
    const lines: string[] = [
      `# ${report.title}`,
      '',
      `**Generated**: ${report.generatedAt}`,
      '',
      '## Summary',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total Suites | ${report.summary.totalSuites} |`,
      `| Passed Suites | ${report.summary.passedSuites} |`,
      `| Failed Suites | ${report.summary.failedSuites} |`,
      `| Total Measurements | ${report.summary.totalMeasurements} |`,
      `| Passed Measurements | ${report.summary.passedMeasurements} |`,
      `| Failed Measurements | ${report.summary.failedMeasurements} |`,
      '',
      '## Suite Results',
      '',
    ];

    for (const suite of report.suites) {
      const icon = suite.passed ? '✅' : '❌';
      lines.push(
        `### ${icon} ${suite.suiteName}`,
        '',
        `**Duration**: ${suite.durationMs}ms`,
        '',
        '| Measurement | Value | Unit | Threshold | Status |',
        '|-------------|-------|------|-----------|--------|',
      );

      for (const m of suite.measurements) {
        const threshold = m.threshold.target;
        const statusIcon = m.passed ? '✅' : '❌';
        lines.push(
          `| ${m.name} | ${m.value} | ${m.unit} | ${threshold} | ${statusIcon} |`,
        );
      }

      if (suite.details.length > 0) {
        lines.push('', '**Details**:', '');
        for (const detail of suite.details) {
          lines.push(`- ${detail}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /** Generate an HTML report string. */
  generateHtmlReport(report: CaBenchReport): string {
    const suiteCards = report.suites.map((suite) => {
      const icon = suite.passed ? '&#9989;' : '&#10060;';
      const statusColor = suite.passed ? '#2e7d32' : '#c62828';
      const rows = suite.measurements.map((m) => {
        const statusIcon = m.passed ? '&#9989;' : '&#10060;';
        const rowColor = m.passed ? '#e8f5e9' : '#ffebee';
        return `<tr style="background:${rowColor}"><td>${m.name}</td><td>${m.value}</td><td>${m.unit}</td><td>${m.threshold.target}</td><td>${statusIcon}</td></tr>`;
      }).join('');

      return `
      <div class="suite-card" style="border-left: 4px solid ${statusColor}; margin: 16px 0; padding: 12px; background: #fafafa;">
        <h3>${icon} ${suite.suiteName} <span style="font-size:0.8em;color:#666">(${suite.durationMs}ms)</span></h3>
        <p>${suite.description}</p>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr><th>Measurement</th><th>Value</th><th>Unit</th><th>Threshold</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${report.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 0 auto; padding: 24px; color: #333; }
    h1 { color: #1a237e; border-bottom: 2px solid #1a237e; padding-bottom: 8px; }
    h2 { color: #283593; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #e3f2fd; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
    .summary-card { background: #e8eaf6; padding: 16px; border-radius: 8px; text-align: center; }
    .summary-card .value { font-size: 2em; font-weight: bold; color: #1a237e; }
    .summary-card .label { font-size: 0.85em; color: #666; }
    .footer { margin-top: 32px; font-size: 0.85em; color: #999; text-align: center; }
  </style>
</head>
<body>
  <h1>${report.title}</h1>
  <p><strong>Generated</strong>: ${report.generatedAt}</p>
  <div class="summary-grid">
    <div class="summary-card"><div class="value">${report.summary.totalSuites}</div><div class="label">Total Suites</div></div>
    <div class="summary-card"><div class="value">${report.summary.passedSuites}/${report.summary.totalSuites}</div><div class="label">Passed Suites</div></div>
    <div class="summary-card"><div class="value">${report.summary.passedMeasurements}/${report.summary.totalMeasurements}</div><div class="label">Passed Measurements</div></div>
  </div>
  <h2>Suite Results</h2>
  ${suiteCards}
  <div class="footer">CA-Bench v1.0 — Code Analyzer Benchmark Suite</div>
</body>
</html>`;
  }

  /** Get the list of registered suite names. */
  get suiteNames(): string[] {
    return [...this.suites.keys()];
  }
}
