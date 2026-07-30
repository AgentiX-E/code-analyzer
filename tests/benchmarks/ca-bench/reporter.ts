// @code-analyzer — CA-Bench Reporter
// Standalone report generation utilities for benchmark results.
/* v8 ignore file -- @preserve */

import type { CaBenchReport, BenchmarkResult, BenchmarkMeasurement } from './runner.js';

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

/** Generate a comprehensive JSON report with metadata. */
export function generateJsonReport(report: CaBenchReport): string {
  return JSON.stringify(
    {
      schema: 'ca-bench-v1',
      ...report,
    },
    null,
    2,
  );
}

/** Generate a Markdown summary report. */
export function generateMarkdownReport(report: CaBenchReport): string {
  const lines: string[] = [
    `# CA-Bench Report`,
    '',
    `> Generated: ${report.generatedAt}`,
    '',
    '## Overview',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Suites Run | ${report.summary.totalSuites} |`,
    `| Passed | ${report.summary.passedSuites} |`,
    `| Failed | ${report.summary.failedSuites} |`,
    `| Measurements | ${report.summary.totalMeasurements} |`,
    `| Pass Rate | ${report.summary.totalMeasurements > 0 ? ((report.summary.passedMeasurements / report.summary.totalMeasurements) * 100).toFixed(1) : '0.0'}% |`,
    '',
  ];

  for (const suite of report.suites) {
    lines.push(
      `## ${suite.passed ? '✅' : '❌'} ${suite.suiteName}`,
      '',
      `*${suite.description}* | Duration: ${suite.durationMs}ms`,
      '',
      '| Measurement | Value | Unit | Threshold | Pass |',
      '|-------------|-------|------|-----------|------|',
    );

    for (const m of suite.measurements) {
      lines.push(
        `| ${m.name} | ${typeof m.value === 'number' ? m.value.toFixed(2) : m.value} | ${m.unit} | ${m.threshold.target} | ${m.passed ? '✅' : '❌'} |`,
      );
    }

    if (suite.details.length > 0) {
      lines.push('', '**Notes**:');
      for (const d of suite.details) lines.push(`- ${d}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/** Generate an HTML dashboard with summary and per-suite results. */
export function generateHtmlReport(report: CaBenchReport): string {
  const passRate =
    report.summary.totalMeasurements > 0
      ? ((report.summary.passedMeasurements / report.summary.totalMeasurements) * 100).toFixed(1)
      : '0.0';

  const suiteSections = report.suites
    .map(
      (suite) => `
    <div class="suite ${suite.passed ? 'passed' : 'failed'}">
      <h3>${suite.passed ? '✅' : '❌'} ${suite.suiteName}</h3>
      <p class="desc">${suite.description} <span class="duration">(${suite.durationMs}ms)</span></p>
      <table>
        <thead><tr><th>Measurement</th><th>Value</th><th>Unit</th><th>Threshold</th><th>Status</th></tr></thead>
        <tbody>
          ${suite.measurements
            .map(
              (m) => `
          <tr class="${m.passed ? 'pass-row' : 'fail-row'}">
            <td>${m.name}</td>
            <td>${typeof m.value === 'number' ? m.value.toFixed(3) : m.value}</td>
            <td>${m.unit}</td>
            <td>${m.threshold.target}</td>
            <td>${m.passed ? '✅' : '❌'}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${suite.details.length > 0 ? `<ul class="details">${suite.details.map((d) => `<li>${d}</li>`).join('')}</ul>` : ''}
    </div>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CA-Bench Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 24px; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { color: #1a237e; margin-bottom: 8px; }
    .generated { color: #666; font-size: 0.9em; margin-bottom: 24px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .summary-card { background: white; border-radius: 8px; padding: 16px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary-card .value { font-size: 1.8em; font-weight: bold; color: #1a237e; }
    .summary-card .label { font-size: 0.8em; color: #888; margin-top: 4px; }
    .suite { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .suite.passed { border-left: 4px solid #2e7d32; }
    .suite.failed { border-left: 4px solid #c62828; }
    .suite h3 { margin-bottom: 4px; }
    .desc { color: #666; font-size: 0.9em; margin-bottom: 12px; }
    .duration { color: #999; font-size: 0.85em; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: left; font-size: 0.9em; }
    th { background: #e8eaf6; font-weight: 600; }
    .pass-row { background: #e8f5e9; }
    .fail-row { background: #ffebee; }
    .details { margin-top: 12px; padding-left: 20px; color: #555; font-size: 0.85em; }
    .footer { margin-top: 32px; text-align: center; color: #999; font-size: 0.8em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>CA-Bench Report</h1>
    <p class="generated">Generated: ${report.generatedAt}</p>
    <div class="summary">
      <div class="summary-card"><div class="value">${report.summary.totalSuites}</div><div class="label">Suites</div></div>
      <div class="summary-card"><div class="value">${report.summary.passedSuites}</div><div class="label">Passed</div></div>
      <div class="summary-card"><div class="value">${report.summary.failedSuites}</div><div class="label">Failed</div></div>
      <div class="summary-card"><div class="value">${passRate}%</div><div class="label">Pass Rate</div></div>
    </div>
    ${suiteSections}
    <div class="footer">CA-Bench v1.0 — Code Analyzer Benchmark Suite</div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/** Create a BenchmarkMeasurement with threshold validation. */
export function measurement(
  name: string,
  value: number,
  unit: string,
  threshold: { min?: number; max?: number; target: number },
): BenchmarkMeasurement {
  let passed = true;
  if (threshold.min !== undefined && value < threshold.min) passed = false;
  if (threshold.max !== undefined && value > threshold.max) passed = false;
  return { name, value, unit, threshold, passed };
}

/** Create a BenchmarkResult from measurements. */
export function makeResult(
  suiteName: string,
  description: string,
  measurements: BenchmarkMeasurement[],
  details: string[] = [],
): BenchmarkResult {
  return {
    suiteName,
    description,
    durationMs: 0,
    measurements,
    passed: measurements.every((m) => m.passed),
    details,
    timestamp: new Date().toISOString(),
  };
}
