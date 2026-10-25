// The tools phase, on the pattern that has no capture group.
//
// **The defect this exists for.** The phase reads a tool's name from a regex match's first group:
//
//   // The pattern's first group is the tool name and is not optional, so a
//   // match always carries it.
//   const toolName = match[1]!;
//   ...
//   if (toolName.length < 3 || ...)      // <- Cannot read properties of undefined
//
// **And one of the patterns has no capture group at all** - the Slack slash-command matcher is
// `/\/[a-z][a-z0-9_-]*\s+.+/g`, which matches a whole command line and captures nothing. So `match[1]` is
// `undefined`, the `!` told the compiler to stop asking, and the phase has been returning `failed` on every corpus
// since it was written. **A comment asserted a property of the patterns, and nothing checked the comment.**
//
// **What the test asserts is both halves**: the phase succeeds, and the pattern that has no group is still used -
// because a fix that simply skipped it would make the failure disappear without making the matcher work.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getDefaultConfig } from '@code-analyzer/core';

import { PipelineOrchestrator } from '../../orchestrator.js';
import { createAllPhases } from '../index.js';

import type { PipelineContext } from '@code-analyzer/shared';

/** A file containing one Slack slash command, which is the pattern with no capture group. */
// **A command is a line that begins with one.** This fixture used to be a route string in the middle of a line
// (`app.post("/deploy now please", …)`), which the unanchored pattern read as a Slack command - the same reading that
// turned `spring-petclinic` into 33 tools. The markdown below is what the pattern is actually for.
const SLASH_COMMAND = [
  '# Commands',
  '',
  '/deploy Deploy the service to staging',
  '/rollback Roll back the last release',
  '',
].join('\n');

async function runTools(dir: string) {
  const ctx = {
    projectId: 'tools-phase',
    rootPath: dir,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
  return new PipelineOrchestrator(createAllPhases()).execute(ctx);
}

describe('the tools phase and a pattern that captures nothing', () => {
  it('does not fail, which it did on every corpus before', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tools-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'commands.md'), SLASH_COMMAND, 'utf8');

    const result = await runTools(dir);
    const tools = result.phases.find((p) => p.phaseId === 'tools');

    // **The phase's own status, not the run's** - the run reports `partial` and swallows this.
    expect(tools?.status).toBe('success');
    expect(result.errors.map((e) => e.phaseId)).not.toContain('tools');

    // **And the fix has to keep the matcher working.** Skipping a pattern with no group would make the failure
    // disappear while leaving the pattern dead, so the command it was written to find has to be in the graph.
    const toolNodes = [...result.graph.nodes.values()].filter((n) => n.label === 'Tool');
    expect(toolNodes.length).toBeGreaterThan(0);
    expect(toolNodes.some((n) => n.name.startsWith('/deploy'))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  }, 300_000);
});
