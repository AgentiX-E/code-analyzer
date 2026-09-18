// Doc-code sync gate.
//
// The gate failed on this repository before the README was corrected — four claims of "45 tools" against a code
// that has 48 — so it has been shown to be able to fail. These cases run it against synthetic repositories, which
// is why the gate takes a `--root`: a test that can only exercise the real repository can only test one state of
// it.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = 'scripts/doc-code-sync-gate.js';

function buildRepo(options: { tools: number; readmeTools: number }): string {
  const root = mkdtempSync(join(tmpdir(), 'doc-code-'));
  mkdirSync(join(root, 'packages/mcp/src/tools'), { recursive: true });
  mkdirSync(join(root, 'packages/analyzer/src/pipeline'), { recursive: true });
  mkdirSync(join(root, 'packages/shared/src/types'), { recursive: true });

  const calls = Array.from(
    { length: options.tools },
    (_, i) => `registry.register(\n  'tool_${i}',\n  'd',\n);`,
  ).join('\n');
  writeFileSync(join(root, 'packages/mcp/src/tools/index.ts'), calls + '\n', 'utf-8');
  writeFileSync(
    join(root, 'packages/analyzer/src/pipeline/index.ts'),
    'import {\n  ScanPhase,\n} from x;\n',
    'utf-8',
  );
  writeFileSync(
    join(root, 'packages/shared/src/types/graph.ts'),
    `export const NODE_LABELS = ['a'] as const;\nexport const RELATIONSHIP_TYPES = ['b'] as const;\n`,
    'utf-8',
  );
  writeFileSync(
    join(root, 'README.md'),
    `The server exposes ${options.readmeTools} tools and 1 node types and 1 relationship types.\n`,
    'utf-8',
  );
  return root;
}

function runGate(root: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [GATE, '--root', root], { encoding: 'utf-8' }),
      stderr: '',
    };
  } catch (err) {
    const failure = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      stdout: (failure.stdout ?? '').toString(),
      stderr: (failure.stderr ?? '').toString(),
    };
  }
}

describe('doc-code-sync-gate', () => {
  it('passes when the documents state the counts the code has', () => {
    const result = runGate(buildRepo({ tools: 5, readmeTools: 5 }));

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('Every stated count matches the code');
  });

  it('fails when a document states a different count', () => {
    // The shape of the real failure: the README claimed 45 against a code with 48.
    const result = runGate(buildRepo({ tools: 48, readmeTools: 45 }));

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('claims 45 MCP tools, the code has 48');
  });

  it('counts calls rather than lines when arguments span several', () => {
    const result = runGate(buildRepo({ tools: 3, readmeTools: 3 }));

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('3 register calls');
  });

  it('reports calls and distinct names separately', () => {
    const root = buildRepo({ tools: 2, readmeTools: 2 });
    // Overwrite with a repeated name, which is what the real repository shows: 48 calls, 46 names.
    writeFileSync(
      join(root, 'packages/mcp/src/tools/index.ts'),
      `registry.register('dup', 'd');\nregistry.register('dup', 'd');\n`,
      'utf-8',
    );

    const result = runGate(root);

    expect(result.stdout).toContain('2 register calls (1 distinct names)');
    expect(result.stdout).toContain('a duplicate registration, or a name this parser did not read');
  });

  it('agrees with the code that is actually committed', () => {
    const out = execFileSync(process.execPath, [GATE, '--json'], { encoding: 'utf-8' });
    const parsed = JSON.parse(out) as {
      summary: {
        mcpToolCalls: number;
        pipelinePhases: number;
        nodeTypes: number;
        relationshipTypes: number;
      };
      failures: string[];
    };

    expect(parsed.failures).toEqual([]);
    expect(parsed.summary.mcpToolCalls).toBe(48);
    expect(parsed.summary.pipelinePhases).toBe(19);
    expect(parsed.summary.nodeTypes).toBe(36);
    expect(parsed.summary.relationshipTypes).toBe(43);
  });
});
