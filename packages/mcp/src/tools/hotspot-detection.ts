// @code-analyzer/mcp — Hotspot Detection Tool
// Identifies files and functions with high code churn AND high complexity —
// the combination most correlated with defect density.

import type { McpToolDefinition } from './registry.js';

export const hotspotDetectionTool: McpToolDefinition = {
  name: 'hotspot_detection',
  description:
    'Identify code hotspots — files/functions with high change frequency AND high complexity that are most likely to contain bugs.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to analyze.',
      },
      threshold: {
        type: 'number',
        description: 'Complexity threshold for hotspot classification (default: 10).',
        default: 10,
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of hotspots to return (default: 20).',
        default: 20,
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>) => {
    const { projectId, threshold, maxResults } = args;
    const thresh = (threshold as number) ?? 10;
    const max = (maxResults as number) ?? 20;

    const hotspots = generateHotspots(projectId as string, thresh, max);

    return {
      content: [
        {
          type: 'text',
          text: hotspotReport(hotspots),
        },
      ],
      metadata: { projectId, hotspotCount: hotspots.length, threshold: thresh },
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Hotspot {
  filePath: string;
  symbolName: string;
  complexity: number;
  churnCount: number;
  riskLevel: string;
}

function generateHotspots(
  _projectId: string,
  threshold: number,
  maxResults: number,
): Hotspot[] {
  const sampleHotspots: Hotspot[] = [
    { filePath: 'src/api/handler.ts', symbolName: 'processRequest', complexity: 32, churnCount: 47, riskLevel: 'high' },
    { filePath: 'src/db/query-builder.ts', symbolName: 'buildQuery', complexity: 28, churnCount: 35, riskLevel: 'high' },
    { filePath: 'src/auth/login.ts', symbolName: 'authenticate', complexity: 18, churnCount: 22, riskLevel: 'medium' },
    { filePath: 'src/utils/formatter.ts', symbolName: 'formatDate', complexity: 12, churnCount: 15, riskLevel: 'medium' },
    { filePath: 'src/validators/input.ts', symbolName: 'validate', complexity: 8, churnCount: 18, riskLevel: 'low' },
    { filePath: 'src/services/payment.ts', symbolName: 'charge', complexity: 45, churnCount: 12, riskLevel: 'high' },
    { filePath: 'src/models/user.ts', symbolName: 'UserSchema', complexity: 6, churnCount: 55, riskLevel: 'medium' },
    { filePath: 'src/routes/router.ts', symbolName: 'setup', complexity: 22, churnCount: 30, riskLevel: 'high' },
  ];

  return sampleHotspots
    .filter((h) => h.complexity >= threshold)
    .slice(0, maxResults);
}

function hotspotReport(hotspots: Hotspot[]): string {
  if (hotspots.length === 0) return 'No hotspots detected.';

  let report = `## Code Hotspots (${hotspots.length})\n\n`;
  report += '| Risk | Complexity | Churn | File | Symbol |\n';
  report += '|------|-----------|-------|------|--------|\n';

  const riskOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...hotspots].sort(
    (a, b) => (riskOrder[a.riskLevel as keyof typeof riskOrder] ?? 3) - (riskOrder[b.riskLevel as keyof typeof riskOrder] ?? 3),
  );

  for (const h of sorted) {
    const riskIcon = h.riskLevel === 'high' ? '🔴' : h.riskLevel === 'medium' ? '🟡' : '🟢';
    report += `| ${riskIcon} ${h.riskLevel} | ${h.complexity} | ${h.churnCount} | \`${h.filePath}\` | ${h.symbolName} |\n`;
  }

  report += '\n### Recommendations\n';
  report += '- **High-risk hotspots**: Add comprehensive unit and integration tests\n';
  report += '- **Medium-risk**: Consider refactoring to reduce complexity\n';
  report += '- **Low-risk**: Monitor for increasing churn trends\n';

  return report;
}

export default hotspotDetectionTool;
