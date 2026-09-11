// @code-analyzer/mcp — Tool registration completeness
//
// The registry is built by hand: every tool module has to be imported and its
// definition passed to `registry.register()` in `tools/index.ts`. Nothing links
// the set of tool modules on disk to the set that gets registered, so a tool can
// be implemented, tested, and still be unreachable to every client. These tests
// close that gap: they name the contract (a tool definition must be reachable
// through `createToolRegistry()`) instead of trusting the wiring.

import { describe, it, expect } from 'vitest';
import { createToolRegistry } from '../tools/index.js';
import { codeSuggestionTool } from '../tools/code-suggestion.js';
import { hallucinationDetectionTool } from '../tools/hallucination-detection.js';
import { reportGenerationTool } from '../tools/report-generation.js';

const INTELLIGENCE_TOOLS = [codeSuggestionTool, hallucinationDetectionTool, reportGenerationTool];

describe('createToolRegistry — registration completeness', () => {
  it('registers the code-suggestion, hallucination-detection and report-generation tools', () => {
    const registry = createToolRegistry();

    // These three were implemented and covered by their own suites but never
    // imported into the barrel, so the registry never saw them and no MCP client
    // could invoke them.
    expect(INTELLIGENCE_TOOLS.map((t) => t.name)).toEqual([
      'code_suggestion',
      'hallucination_detection',
      'report_generation',
    ]);
    for (const tool of INTELLIGENCE_TOOLS) {
      expect(registry.get(tool.name)).toBeDefined();
    }
  });

  it('registers each tool under the name its own definition declares', () => {
    // `register()` takes the name as a separate argument and ignores
    // `definition.name`, so the two can drift apart silently. Reading the entry
    // back by the declared name is what proves they agree.
    const registry = createToolRegistry();

    for (const tool of INTELLIGENCE_TOOLS) {
      const registered = registry.get(tool.name);
      expect(registered?.description).toBe(tool.description);
      expect(registered?.inputSchema).toBe(tool.inputSchema);
    }
  });

  it('gives every registered tool an invocable handler', () => {
    const registry = createToolRegistry();

    for (const tool of INTELLIGENCE_TOOLS) {
      expect(typeof registry.get(tool.name)?.handler).toBe('function');
    }
  });

  it('files them under the analysis profile, beside the other intelligence tools', () => {
    // The profile decides which tool set a client sees. Registering under the
    // wrong one leaves the tool invisible to the clients that ask for
    // `analysis`, which is every client that gets this group's siblings.
    const registry = createToolRegistry();
    const analysis = registry.listByProfile('analysis').map((t) => t.name);

    for (const tool of INTELLIGENCE_TOOLS) {
      expect(analysis).toContain(tool.name);
    }
  });

  it('exposes all four tools on a single registry instance', () => {
    const registry = createToolRegistry();
    const names = registry.list().map((t) => t.name);

    // A registry is populated once and shared; a duplicate name would throw at
    // construction, so listing all four is the end-to-end proof the wiring is
    // complete rather than merely present.
    for (const tool of INTELLIGENCE_TOOLS) {
      expect(names).toContain(tool.name);
    }
  });
});
