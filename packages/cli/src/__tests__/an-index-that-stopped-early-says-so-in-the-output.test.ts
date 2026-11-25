// @code-analyzer/cli — an index that stopped early says so in the output a person reads
//
// The scan phase now carries the three counts that describe what it did not read. **A count in a JSON field nobody
// prints is a fact the product does not have**, so this case reads the text format a developer actually sees: when the
// walk stopped at the ceiling, the report says the index is a prefix of the tree; when it read everything, the report
// says nothing extra, because a warning that is always on is not a warning.

import { describe, expect, it } from 'vitest';

import { formatAnalyzeResult } from '../commands/analyze.js';

import type { AnalyzeOutput } from '../commands/analyze.js';

function report(scanOutput: Record<string, unknown>): AnalyzeOutput {
  return {
    success: true,
    projectId: 'coverage-fixture',
    repoPath: '/home/user/project',
    graph: { nodeCount: 10, edgeCount: 12, fileCount: 3, phaseCount: 2 },
    phases: [
      { id: 'scan', status: 'success', duration: 4, output: scanOutput },
      { id: 'parse', status: 'success', duration: 9 },
    ],
    duration: 40,
    errors: [],
  };
}

describe('the analysis report says how much of the repository it indexed', () => {
  it('says an index that hit the ceiling is a prefix of the tree', () => {
    const text = formatAnalyzeResult(
      report({
        filesDiscovered: 5000,
        walk: { stoppedAtLimit: true, skippedOverSize: 0, skippedUnreadable: 0 },
      }),
      'text',
    );
    expect(text).toContain('Index Coverage');
    expect(text).toContain('prefix of the tree');
    expect(text).toContain('5000');
  });

  it('names the two refusals with their counts, so a size cap is not read as an empty repository', () => {
    const text = formatAnalyzeResult(
      report({
        filesDiscovered: 12,
        walk: { stoppedAtLimit: false, skippedOverSize: 34, skippedUnreadable: 2 },
      }),
      'text',
    );
    expect(text).toContain('too large: 34');
    expect(text).toContain('unreadable: 2');
    // **The walk finished**, so the report does not make the one claim that would be false.
    expect(text).not.toContain('prefix of the tree');
  });

  it('says nothing when the index is the repository', () => {
    const text = formatAnalyzeResult(
      report({
        filesDiscovered: 12,
        walk: { stoppedAtLimit: false, skippedOverSize: 0, skippedUnreadable: 0 },
      }),
      'text',
    );
    expect(text).not.toContain('Index Coverage');
  });

  it('does not invent a coverage block for an artifact written before the walk reported', () => {
    const text = formatAnalyzeResult(report({ filesDiscovered: 12 }), 'text');
    expect(text).not.toContain('Index Coverage');
  });
});
