// @code-analyzer/mcp — PR Review Tools

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl, type ToolContext } from './tool-context.js';
import type { ToolResult } from './registry.js';
import type { GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getContext(store?: unknown): ToolContext | null {
  if (ToolContextImpl.isToolContext(store)) return store;
  return null;
}

function getStore(storeOrContext: unknown): InMemoryGraphStore | null {
  if (storeOrContext instanceof InMemoryGraphStore) return storeOrContext;
  if (ToolContextImpl.isToolContext(storeOrContext)) return storeOrContext.store;
  return null;
}

// ---------------------------------------------------------------------------
// review_pr
// ---------------------------------------------------------------------------

interface ReviewPRParams {
  projectId: string;
  prNumber?: number;
  baseRef?: string;
  headRef?: string;
  includeAiReview?: boolean;
  diff?: string;
}

export const reviewPRSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    prNumber: { type: 'number', description: 'Pull request number' },
    baseRef: { type: 'string', description: 'Base branch reference' },
    headRef: { type: 'string', description: 'Head branch reference' },
    includeAiReview: { type: 'boolean', description: 'Include AI-powered review suggestions' },
    diff: { type: 'string', description: 'PR diff content (optional, for direct review)' },
  },
  required: ['projectId'],
};

export async function reviewPR(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as ReviewPRParams;
  const projectId = params.projectId;
  const prNumber = params.prNumber;
  const baseRef = params.baseRef ?? 'main';
  const headRef = params.headRef ?? 'HEAD';
  const includeAiReview = Boolean(params.includeAiReview);
  const diff = params.diff;

  try {
    const ctx = getContext(store);
    const graphStore = getStore(store);

    let findings: unknown[] = [];
    let totalFindings = 0;
    let criticalFindings = 0;
    let highFindings = 0;
    let mediumFindings = 0;
    let lowFindings = 0;
    let overallScore = 100;
    let riskLevel: string = 'low';
    let symbolsAffected = 0;
    let routesAffected = 0;
    let testsImpacted = 0;
    let linesChanged = 0;
    let filesChanged = 0;

    if (ctx) {
      // Run impact analysis if we have a diff
      if (diff) {
        const diffs = parsePrDiff(projectId, diff);
        filesChanged = diffs.length;

        for (const d of diffs) {
          linesChanged += d.ranges.reduce((sum, r) => sum + Math.abs(r.newEnd - r.newStart + r.oldEnd - r.oldStart), 0);
        }

        const impactAnalyzer = ctx.getImpactAnalyzer();

        // Find changed symbols from diffs
        for (const d of diffs) {
          for (const range of d.ranges) {
            const startLine = d.changeType === 'added' ? range.newStart : range.oldStart;
            const endLine = d.changeType === 'added' ? range.newEnd : range.oldEnd;

            const nodes = ctx.store.getAllNodes().filter(
              n => n.projectId === projectId &&
                n.filePath === d.filePath &&
                n.startLine !== null && n.endLine !== null &&
                n.startLine <= endLine && n.endLine >= startLine,
            );

            symbolsAffected += nodes.length;

            for (const node of nodes) {
              const bfs = ctx.store.bfs(node.id, 3, ['CALLS', 'IMPLEMENTS', 'EXTENDS']);
              const impactedCount = bfs.visitedCount;

              if (impactedCount > 10) {
                criticalFindings++;
              } else if (impactedCount > 5) {
                highFindings++;
              } else if (impactedCount > 1) {
                mediumFindings++;
              } else {
                lowFindings++;
              }
            }
          }
        }

        // Find affected routes
        const routeNodes = ctx.store.getAllNodes().filter(
          n => n.projectId === projectId && n.label === 'Route',
        );
        routesAffected = routeNodes.length;

        // Find affected tests
        const testNodes = ctx.store.getAllNodes().filter(
          n => n.projectId === projectId && n.label === 'Test',
        );
        testsImpacted = testNodes.length;
      } else {
        // No diff — analyze general PR risk from graph
        const stats = ctx.getGraphStats(projectId);

        // Find high-risk components
        const allNodes = ctx.store.getAllNodes().filter(n => n.projectId === projectId);
        for (const node of allNodes) {
          if (node.complexity && node.complexity > 20) {
            findings.push({
              type: 'risk',
              title: `High complexity: ${node.name}`,
              description: `Symbol "${node.qualifiedName}" has complexity ${node.complexity}. Changes here are high-risk.`,
              filePath: node.filePath,
              severity: 'high',
            });
            highFindings++;
          }

          const degree = ctx.store.getDegree(node.id);
          if (degree > 10 && node.isExported) {
            findings.push({
              type: 'risk',
              title: `High impact target: ${node.name}`,
              description: `Exported symbol "${node.qualifiedName}" has ${degree} connections. Changes here affect many dependents.`,
              filePath: node.filePath,
              severity: node.complexity && node.complexity > 15 ? 'critical' : 'high',
            });
            if (node.complexity && node.complexity > 15) criticalFindings++;
            else highFindings++;
          }
        }
      }

      totalFindings = criticalFindings + highFindings + mediumFindings + lowFindings;

      // Determine overall score and risk level
      if (criticalFindings > 0) {
        overallScore = Math.max(0, 100 - criticalFindings * 20 - highFindings * 10 - mediumFindings * 5);
        riskLevel = 'critical';
      } else if (highFindings > 0) {
        overallScore = Math.max(0, 100 - highFindings * 10 - mediumFindings * 5 - lowFindings * 2);
        riskLevel = 'high';
      } else if (mediumFindings > 2) {
        overallScore = Math.max(0, 100 - mediumFindings * 5 - lowFindings * 2);
        riskLevel = 'medium';
      } else {
        overallScore = Math.max(0, 100 - lowFindings);
        riskLevel = 'low';
      }

      const mergeRecommendation =
        criticalFindings > 0 ? 'reject' :
        highFindings > 2 ? 'caution' :
        'approve';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            prNumber: prNumber ?? 'N/A',
            baseRef,
            headRef,
            summary: {
              overallScore,
              riskLevel,
              totalFindings,
              criticalFindings,
              highFindings,
              mediumFindings,
              lowFindings,
              mergeRecommendation,
            },
            findings,
            recommendations: generateRecommendations(criticalFindings, highFindings, mediumFindings),
            metrics: {
              linesChanged,
              filesChanged,
              symbolsAffected,
              routesAffected,
              testsImpacted,
            },
            reviewMethod: 'Graph-backed heuristics analysis',
            aiReview: includeAiReview ? 'LLM backend not available' : undefined,
          }, null, 2),
        }],
      };
    }

    // Fallback: no context
    if (graphStore) {
      const integrity = graphStore.validateIntegrity(projectId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            prNumber: prNumber ?? 'N/A',
            baseRef,
            headRef,
            summary: {
              overallScore: 100,
              riskLevel: 'unknown',
              totalFindings: 0,
              criticalFindings: 0,
              highFindings: 0,
              mediumFindings: 0,
              lowFindings: 0,
              mergeRecommendation: 'review-manually',
            },
            findings: [],
            recommendations: [],
            metrics: {
              linesChanged: 0,
              filesChanged: 0,
              symbolsAffected: 0,
              routesAffected: 0,
              testsImpacted: 0,
            },
            graphIntegrity: integrity,
            reviewMethod: 'Basic integrity check',
            aiReview: includeAiReview ? 'LLM backend not available' : undefined,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          prNumber: prNumber ?? 'N/A',
          baseRef,
          headRef,
          summary: {
            overallScore: 100,
            riskLevel: 'unknown',
            totalFindings: 0,
            criticalFindings: 0,
            highFindings: 0,
            mediumFindings: 0,
            lowFindings: 0,
            mergeRecommendation: 'manual-review-needed',
          },
          findings: [],
          recommendations: [],
          metrics: {
            linesChanged: 0,
            filesChanged: 0,
            symbolsAffected: 0,
            routesAffected: 0,
            testsImpacted: 0,
          },
          note: 'No graph store available. Index a project first with analyze_repository.',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `PR review error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// check_standards
// ---------------------------------------------------------------------------

interface CheckStandardsParams {
  projectId: string;
  standardIds?: string[];
  filePath?: string;
  autoFix?: boolean;
}

export const checkStandardsSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    standardIds: { type: 'array', items: { type: 'string' }, description: 'Specific standard IDs to check' },
    filePath: { type: 'string', description: 'Specific file to check' },
    autoFix: { type: 'boolean', description: 'Apply auto-fixes when available' },
  },
  required: ['projectId'],
};

export async function checkStandards(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as CheckStandardsParams;
  const projectId = params.projectId;
  const standardIds = params.standardIds;
  const filePath = params.filePath;
  const autoFix = Boolean(params.autoFix);

  try {
    const ctx = getContext(store);

    if (ctx) {
      const results: unknown[] = [];
      const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, passed: 0 };

      if (filePath) {
        // Check specific file
        const fileNodes = ctx.getFileSymbols(projectId, filePath);
        for (const node of fileNodes) {
          // Naming conventions check
          if (node.label === 'Class' && node.name[0] !== node.name[0]?.toUpperCase()) {
            results.push({
              standard: 'naming-conventions',
              title: 'Class name should use PascalCase',
              description: `Class "${node.name}" does not follow PascalCase naming convention.`,
              filePath,
              startLine: node.startLine,
              severity: 'low',
              passed: false,
            });
            summary.low++;
          }

          // Export check
          if (node.label === 'Function' && !node.isExported && !node.name?.startsWith('_')) {
            results.push({
              standard: 'export-conventions',
              title: 'Consider exporting public function',
              description: `Function "${node.name}" is not exported. If it should be part of the public API, add the export keyword.`,
              filePath,
              startLine: node.startLine,
              severity: 'info',
              passed: true,
            });
            summary.info++;
          }

          // Complexity check
          if (node.complexity && node.complexity > 10) {
            results.push({
              standard: 'complexity-threshold',
              title: `Function "${node.name}" exceeds complexity threshold`,
              description: `Cyclomatic complexity ${node.complexity} exceeds threshold of 10.`,
              filePath,
              startLine: node.startLine,
              severity: node.complexity > 20 ? 'high' : 'medium',
              passed: false,
            });
            if (node.complexity > 20) summary.high++;
            else summary.medium++;
          }
        }
      } else {
        // Check all files in project
        const stats = ctx.getGraphStats(projectId);
        const highComplexityCount = stats.labelDistribution
          .filter(l => l.label === 'Function' || l.label === 'Method')
          .reduce((sum, l) => sum + l.count, 0);

        if (highComplexityCount > 100) {
          results.push({
            standard: 'project-size',
            title: 'Large project detected',
            description: `Project has ${stats.nodeCount} nodes. Consider modularization if the codebase continues to grow.`,
            severity: 'info',
            passed: true,
          });
          summary.info++;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            projectId,
            standardsChecked: standardIds ?? ['all'],
            filePath: filePath ?? 'all files',
            autoFix,
            results,
            complianceScore: Math.max(0, 100 - summary.critical * 20 - summary.high * 10 - summary.medium * 5 - summary.low),
            summary,
            reviewMethod: 'Graph-backed standards check',
            note: autoFix ? 'Auto-fix requires configured fix rules' : undefined,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          projectId,
          standardsChecked: standardIds ?? ['all'],
          filePath: filePath ?? 'all files',
          autoFix,
          results: [],
          complianceScore: 100,
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, passed: 0 },
          note: 'Standards check requires indexed project data',
        }, null, 2),
      }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Standards check error: ${message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePrDiff(projectId: string, rawDiff: string): GitDiff[] {
  const diffs: GitDiff[] = [];
  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    let filePath = '';
    let oldPath: string | undefined;
    let changeType: GitDiff['changeType'] = 'modified';

    for (const line of lines) {
      if (line.startsWith('--- ')) {
        oldPath = line.replace('--- a/', '').trim();
      }
      if (line.startsWith('+++ ')) {
        filePath = line.replace('+++ b/', '').trim();
      }
      if (line.startsWith('new file mode')) changeType = 'added';
      if (line.startsWith('deleted file mode')) changeType = 'deleted';
      if (line.startsWith('rename from')) changeType = 'renamed';
    }

    if (filePath) {
      const ranges: GitDiff['ranges'] = [];
      for (const line of lines) {
        const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          const oldStart = parseInt(match[1]!, 10);
          const oldCount = parseInt(match[2] ?? '1', 10);
          const newStart = parseInt(match[3]!, 10);
          const newCount = parseInt(match[4] ?? '1', 10);
          ranges.push({
            oldStart,
            oldEnd: oldStart + oldCount,
            newStart,
            newEnd: newStart + newCount,
            changeType: (oldCount > 0 && newCount > 0) ? 'modified' : oldCount > 0 ? 'deleted' : 'added',
          });
        }
      }

      diffs.push({
        id: `diff_${diffs.length}`,
        repositoryId: projectId,
        filePath,
        oldPath,
        changeType,
        ranges: ranges.length > 0 ? ranges : [{ oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 1, changeType: 'modified' }],
        createdAt: new Date().toISOString(),
      });
    }
  }

  return diffs;
}

function generateRecommendations(critical: number, high: number, medium: number): string[] {
  const recs: string[] = [];

  if (critical > 0) {
    recs.push(`Address ${critical} critical findings before merging`);
    recs.push('Consider adding more tests for high-risk areas');
  }

  if (high > 0) {
    recs.push(`Review ${high} high-severity findings carefully`);
    recs.push('Add integration tests to verify no regressions');
  }

  if (medium > 0) {
    recs.push(`Address ${medium} medium-severity findings at your discretion`);
  }

  if (critical === 0 && high === 0 && medium === 0) {
    recs.push('No significant issues found — safe to merge');
  }

  return recs;
}
