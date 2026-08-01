import type { AnalysisReport } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// ReportFormatter interface
// ---------------------------------------------------------------------------

export interface ReportFormatter {
  format(report: AnalysisReport): string;
  readonly mimeType: string;
  readonly extension: string;
}

// ---------------------------------------------------------------------------
// Markdown Formatter
// ---------------------------------------------------------------------------

export class MarkdownFormatter implements ReportFormatter {
  readonly mimeType = 'text/markdown';
  readonly extension = 'md';

  format(report: AnalysisReport): string {
    const lines: string[] = [];

    // Title & metadata
    lines.push(`# ${report.title}`);
    lines.push('');
    lines.push(`**ID:** \`${report.id}\`  `);
    lines.push(`**Type:** ${report.type}  `);
    lines.push(`**Created:** ${report.createdAt}  `);
    lines.push(`**Repository:** ${report.metadata.repository}  `);
    if (report.scope.type === 'pr' && report.scope.prNumber) {
      lines.push(`**PR:** #${report.scope.prNumber} (${report.scope.baseRef} → ${report.scope.headRef})  `);
    }
    lines.push('');

    // --- Summary ---
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Overall Score | ${this.formatScore(report.summary.overallScore)} |`);
    lines.push(`| Risk Level | **${report.summary.riskLevel.toUpperCase()}** |`);
    lines.push(`| Total Findings | ${report.summary.totalFindings} |`);
    lines.push(`| Critical | ${report.summary.criticalFindings} |`);
    lines.push(`| High | ${report.summary.highFindings} |`);
    lines.push(`| Medium | ${report.summary.mediumFindings} |`);
    lines.push(`| Low | ${report.summary.lowFindings} |`);
    lines.push(`| Merge Recommendation | **${report.summary.mergeRecommendation}** |`);
    lines.push('');

    if (report.summary.keyTakeaways.length > 0) {
      lines.push('### Key Takeaways');
      lines.push('');
      for (const takeaway of report.summary.keyTakeaways) {
        lines.push(`- ${takeaway}`);
      }
      lines.push('');
    }

    lines.push(`> ${report.summary.mergeRationale}`);
    lines.push('');

    // --- Metrics ---
    if (report.metrics.linesChanged > 0 || report.metrics.filesChanged > 0) {
      lines.push('## Metrics');
      lines.push('');
      lines.push('| Metric | Value |');
      lines.push('|--------|-------|');
      lines.push(`| Lines Changed | ${report.metrics.linesChanged} |`);
      lines.push(`| Files Changed | ${report.metrics.filesChanged} |`);
      lines.push(`| Symbols Affected | ${report.metrics.symbolsAffected} |`);
      lines.push(`| Routes Affected | ${report.metrics.routesAffected} |`);
      lines.push(`| Tests Impacted | ${report.metrics.testsImpacted} |`);
      lines.push(`| Complexity Delta | ${report.metrics.complexityDelta} |`);
      lines.push(`| Compliance Score | ${this.formatScore(report.metrics.complianceScore)} |`);
      lines.push(`| Token Usage | ${report.metrics.tokenUsage} |`);
      lines.push('');
    }

    // --- Findings ---
    if (report.findings.length > 0) {
      lines.push('## Findings');
      lines.push('');
      lines.push(`*${report.findings.length} total finding(s)*`);
      lines.push('');

      const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
      for (const sev of severityOrder) {
        const bySeverity = report.findings.filter((f) => f.severity === sev);
        if (bySeverity.length === 0) continue;

        const icon = this.severityIcon(sev);
        lines.push(`### ${icon} ${sev.charAt(0).toUpperCase() + sev.slice(1)} Severity (${bySeverity.length})`);
        lines.push('');

        for (const finding of bySeverity) {
          finding.id.replace(report.id + '-', '');
          lines.push(`<details>`);
          lines.push(`<summary><strong>${this.escapeHtml(finding.title)}</strong></summary>`);
          lines.push('');
          lines.push(`- **File:** \`${finding.filePath}\``);
          if (finding.lineRange) {
            lines.push(`- **Lines:** L${finding.lineRange[0]}-L${finding.lineRange[1]}`);
          }
          lines.push(`- **Category:** ${finding.category}`);
          if (finding.description) {
            lines.push(`- **Description:** ${finding.description}`);
          }
          if (finding.standardRef) {
            lines.push(`- **Standard:** ${finding.standardRef}`);
          }
          if (finding.evidence) {
            lines.push('');
            lines.push('```');
            lines.push(finding.evidence.trim());
            lines.push('```');
          }
          lines.push('');
          lines.push(`</details>`);
          lines.push('');
        }
      }
    }

    // --- Recommendations ---
    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      lines.push(`*${report.recommendations.length} recommendation(s)*`);
      lines.push('');

      for (const rec of report.recommendations) {
        lines.push(`### ${rec.title}`);
        lines.push('');
        lines.push(`- **Priority:** ${rec.priority}  `);
        lines.push(`- **Effort:** ${rec.estimatedEffort}  `);
        lines.push(`- **Files affected:** ${rec.affectedFiles.length}  `);
        lines.push('');
        if (rec.description) {
          lines.push(rec.description);
          lines.push('');
        }

        if (rec.actionItems.length > 0) {
          lines.push('#### Action Items');
          lines.push('');
          for (const item of rec.actionItems) {
            lines.push(`- [ ] ${item.description}`);
            if (item.file) {
              lines.push(`  - File: \`${item.file}\``);
            }
          }
          lines.push('');
        }
      }
    }

    // --- Footer ---
    lines.push('---');
    lines.push('');
    lines.push(`*Generated by Code Analyzer v${report.metadata.generatorVersion} on ${report.createdAt}*`);
    lines.push('');

    return lines.join('\n');
  }

  private formatScore(score: number): string {
    const emoji = score >= 90 ? '🟢' : score >= 70 ? '🟡' : score >= 50 ? '🟠' : '🔴';
    return `${emoji} ${score}`;
  }

  private severityIcon(severity: string): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      case 'info':
        return '🔵';
      default:
        return '⚪';
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// ---------------------------------------------------------------------------
// JSON Formatter
// ---------------------------------------------------------------------------

export class JsonFormatter implements ReportFormatter {
  readonly mimeType = 'application/json';
  readonly extension = 'json';

  format(report: AnalysisReport): string {
    return JSON.stringify(report, null, 2);
  }
}

// ---------------------------------------------------------------------------
// HTML Formatter
// ---------------------------------------------------------------------------

export class HtmlFormatter implements ReportFormatter {
  readonly mimeType = 'text/html';
  readonly extension = 'html';

  format(report: AnalysisReport): string {
    const lines: string[] = [];

    lines.push('<!DOCTYPE html>');
    lines.push('<html lang="en">');
    lines.push('<head>');
    lines.push('<meta charset="UTF-8">');
    lines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    lines.push(`<title>${this.escapeHtml(report.title)}</title>`);
    lines.push('<style>');
    lines.push(this.css());
    lines.push('</style>');
    lines.push('</head>');
    lines.push('<body>');
    lines.push('<div class="container">');

    // Header
    lines.push(`<h1>${this.escapeHtml(report.title)}</h1>`);
    lines.push('<div class="meta">');
    lines.push(`<span>ID: <code>${report.id}</code></span>`);
    lines.push(`<span>Type: ${report.type}</span>`);
    lines.push(`<span>Created: ${report.createdAt}</span>`);
    lines.push(`<span>Repository: ${report.metadata.repository}</span>`);
    lines.push('</div>');

    // Summary
    lines.push('<h2>Summary</h2>');
    lines.push('<table>');
    lines.push('<tr><th>Metric</th><th>Value</th></tr>');
    lines.push(`<tr><td>Overall Score</td><td>${report.summary.overallScore}</td></tr>`);
    lines.push(`<tr><td>Risk Level</td><td class="risk-${report.summary.riskLevel}">${report.summary.riskLevel.toUpperCase()}</td></tr>`);
    lines.push(`<tr><td>Total Findings</td><td>${report.summary.totalFindings}</td></tr>`);
    lines.push(`<tr><td>Critical</td><td>${report.summary.criticalFindings}</td></tr>`);
    lines.push(`<tr><td>High</td><td>${report.summary.highFindings}</td></tr>`);
    lines.push(`<tr><td>Medium</td><td>${report.summary.mediumFindings}</td></tr>`);
    lines.push(`<tr><td>Low</td><td>${report.summary.lowFindings}</td></tr>`);
    lines.push(`<tr><td>Merge Recommendation</td><td><strong>${report.summary.mergeRecommendation}</strong></td></tr>`);
    lines.push('</table>');

    if (report.summary.keyTakeaways.length > 0) {
      lines.push('<h3>Key Takeaways</h3>');
      lines.push('<ul>');
      for (const t of report.summary.keyTakeaways) {
        lines.push(`<li>${this.escapeHtml(t)}</li>`);
      }
      lines.push('</ul>');
    }

    lines.push(`<blockquote>${this.escapeHtml(report.summary.mergeRationale)}</blockquote>`);

    // Findings
    if (report.findings.length > 0) {
      lines.push('<h2>Findings</h2>');
      lines.push(`<p><em>${report.findings.length} total finding(s)</em></p>`);

      for (const finding of report.findings) {
        const sevClass = `severity-${finding.severity}`;
        lines.push('<div class="finding">');
        lines.push(`<div class="finding-header ${sevClass}">`);
        lines.push(`<strong>${finding.severity.toUpperCase()}</strong> — ${this.escapeHtml(finding.title)}`);
        lines.push('</div>');
        lines.push('<div class="finding-body">');
        lines.push(`<p><strong>File:</strong> <code>${finding.filePath}</code></p>`);
        if (finding.lineRange) {
          lines.push(`<p><strong>Lines:</strong> L${finding.lineRange[0]}-L${finding.lineRange[1]}</p>`);
        }
        lines.push(`<p><strong>Category:</strong> ${finding.category}</p>`);
        if (finding.description) {
          lines.push(`<p>${this.escapeHtml(finding.description)}</p>`);
        }
        if (finding.evidence) {
          lines.push('<pre><code>');
          lines.push(this.escapeHtml(finding.evidence.trim()));
          lines.push('</code></pre>');
        }
        lines.push('</div>');
        lines.push('</div>');
      }
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('<h2>Recommendations</h2>');
      lines.push(`<p><em>${report.recommendations.length} recommendation(s)</em></p>`);

      for (const rec of report.recommendations) {
        lines.push('<div class="recommendation">');
        lines.push(`<h3>${this.escapeHtml(rec.title)}</h3>`);
        lines.push(`<p><strong>Priority:</strong> ${rec.priority} | <strong>Effort:</strong> ${rec.estimatedEffort} | <strong>Files:</strong> ${rec.affectedFiles.length}</p>`);
        if (rec.description) {
          lines.push(`<p>${this.escapeHtml(rec.description)}</p>`);
        }
        if (rec.actionItems.length > 0) {
          lines.push('<ul>');
          for (const item of rec.actionItems) {
            lines.push(`<li>${this.escapeHtml(item.description)}</li>`);
          }
          lines.push('</ul>');
        }
        lines.push('</div>');
      }
    }

    // Footer
    lines.push('<hr>');
    lines.push(`<p class="footer">Generated by Code Analyzer v${report.metadata.generatorVersion}</p>`);
    lines.push('</div>');
    lines.push('</body>');
    lines.push('</html>');

    return lines.join('\n');
  }

  private css(): string {
    return `
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
  max-width: 960px;
  margin: 0 auto;
  padding: 20px;
  background: #f9f9f9;
}
.container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
h1 { color: #1a1a2e; border-bottom: 2px solid #4a90d9; padding-bottom: 10px; }
h2 { color: #2c3e50; margin-top: 30px; }
h3 { color: #34495e; }
.meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.9em; color: #666; margin-bottom: 20px; }
table { border-collapse: collapse; width: 100%; margin: 15px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f5f5f5; }
.risk-critical { color: #e74c3c; font-weight: bold; }
.risk-high { color: #e67e22; font-weight: bold; }
.risk-medium { color: #f1c40f; font-weight: bold; }
.risk-low { color: #27ae60; }
blockquote { border-left: 4px solid #4a90d9; padding: 10px 15px; margin: 15px 0; background: #f0f4f8; }
.finding { border: 1px solid #e0e0e0; border-radius: 4px; margin: 10px 0; }
.finding-header { padding: 8px 12px; font-size: 0.95em; }
.finding-body { padding: 8px 12px; }
.severity-critical { background: #fde8e8; border-left: 4px solid #e74c3c; }
.severity-high { background: #fef3e2; border-left: 4px solid #e67e22; }
.severity-medium { background: #fef9e7; border-left: 4px solid #f1c40f; }
.severity-low { background: #eaf7ea; border-left: 4px solid #27ae60; }
.severity-info { background: #e8f4fd; border-left: 4px solid #2980b9; }
.recommendation { border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; margin: 15px 0; }
pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
pre code { padding: 0; background: none; }
hr { border: none; border-top: 1px solid #e0e0e0; margin: 30px 0; }
.footer { color: #999; font-size: 0.85em; text-align: center; }
`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
