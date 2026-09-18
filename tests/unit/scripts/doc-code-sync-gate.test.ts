// Doc-code sync gate.
//
// The gate failed on this repository before the README was corrected — four claims of "45 tools" against a code
// that has 48 — so it has been shown to be able to fail. These cases keep it able to, and pin the counts so a
// future change to the code that is not reflected in the documents is visible here.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  countConstArray,
  countPipelinePhases,
  countToolRegistrations,
} from '../../../scripts/doc-code-sync-gate.js';

const GATE = 'scripts/doc-code-sync-gate.js';

describe('doc-code-sync-gate', () => {
  it('counts register calls, not lines, when arguments span several', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-code-'));
    const file = join(dir, 'index.ts');
    writeFileSync(
      file,
      `registry.register(\n  'a',\n  'desc',\n);\nregistry.register('b', 'desc');\nregistry.register('c', 'desc');\n`,
      'utf-8',
    );

    const result = countToolRegistrations(file);

    // The first call spans four lines. Counting lines would give three as well here, which is why the test uses a
    // call whose name is on the next line: a line-based count is what produced three different totals (44, 45, 48)
    // before this gate computed it properly.
    expect(result.calls).toBe(3);
    expect(result.names).toEqual(['a', 'b', 'c']);
    expect(result.distinct).toBe(3);
  });

  it('reports the same count for a name repeated twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-code-'));
    const file = join(dir, 'index.ts');
    writeFileSync(file, `registry.register('a', 'd');\nregistry.register('a', 'd');\n`, 'utf-8');

    const result = countToolRegistrations(file);

    expect(result.calls).toBe(2);
    expect(result.distinct).toBe(1);
  });

  it('counts phase imports and const arrays', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-code-'));
    const phases = join(dir, 'pipeline.ts');
    const graph = join(dir, 'graph.ts');
    writeFileSync(
      phases,
      'import {\n  ScanPhase,\n  ParsePhase,\n  NotAPhase,\n} from x;\n',
      'utf-8',
    );
    writeFileSync(graph, `export const NODE_LABELS = ['a', 'b', 'c'] as const;\n`, 'utf-8');

    expect(countPipelinePhases(phases)).toBe(2);
    expect(countConstArray(graph, 'NODE_LABELS')).toBe(3);
    expect(countConstArray(graph, 'MISSING')).toBeNull();
  });

  it('agrees with the code that is actually committed', () => {
    // A regression guard: if the code gains a tool and the README is not updated, the gate's own JSON says so,
    // and so does this.
    const out = execFileSync(process.execPath, [GATE, '--json'], { encoding: 'utf-8' });
    const { summary, failures } = JSON.parse(out) as {
      summary: Record<string, number>;
      failures: string[];
    };

    expect(failures).toEqual([]);
    expect(summary.mcpToolCalls).toBe(48);
    expect(summary.pipelinePhases).toBe(19);
    expect(summary.nodeTypes).toBe(36);
    expect(summary.relationshipTypes).toBe(43);
  });
});
