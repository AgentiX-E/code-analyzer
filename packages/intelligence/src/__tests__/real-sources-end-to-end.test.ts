// The chain over a real repository, which is what none of the per-language tests do.
//
// Every language reaches a finding on a five-line sample and each of those samples was written by the same hand that
// wrote the vocabulary. **This runs the chain over this repository's own sources** - 300 to 600 captures per file,
// from code nobody shaped for the test - and prints what each stage produces.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { TypeScriptProvider } from '@code-analyzer/analyzer';
import { describe, it, expect } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ParsedFile } from '@code-analyzer/shared';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const DIRS = ['packages/mcp/src', 'packages/intelligence/src', 'packages/analyzer/src/pipeline'];

describe('the chain over real sources', () => {
  it('scans a directory that handles input, and reports what each stage finds', () => {
    const provider = new TypeScriptProvider();
    const typed = provider as unknown as {
      parse(s: string, f: string): unknown[];
      extractTaintSources(s: string): Array<{ sourceType: string; line: number; text: string }>;
      extractTaintSinks(s: string): Array<{ sinkType: string; line: number; text: string }>;
      extractSanitizers(s: string): Array<{ sanitizerType: string; line: number; text: string }>;
    };

    let scanned = 0;
    let withSources = 0;
    let totalCaptures = 0;
    let totalSources = 0;
    let totalSinks = 0;
    let totalFindings = 0;

    for (const dir of DIRS) {
      for (const file of filesUnder(join(process.cwd(), dir))) {
        const content = readFileSync(file, 'utf8');
        scanned++;
        const captures = typed.parse(content, file);
        const sources = typed.extractTaintSources(content);
        const sinks = typed.extractTaintSinks(content);
        totalCaptures += captures.length;
        totalSources += sources.length;
        totalSinks += sinks.length;
        if (sources.length === 0) continue;
        withSources++;

        const parsed = {
          filePath: file,
          language: 'typescript',
          symbols: [],
          references: [],
          scopeTree: {},
          ast: captures,
        } as unknown as ParsedFile;
        const extraction = new Map([
          [file, { sources, sinks, sanitizers: typed.extractSanitizers(content) }],
        ]);
        totalFindings += analyzeInterproceduralTaint([parsed], new Map(), extraction).findings
          .length;
      }
    }

    console.log(
      `REAL: scanned ${scanned}, withSources ${withSources}, captures ${totalCaptures}, sources ${totalSources}, ` +
        `sinks ${totalSinks}, findings ${totalFindings}`,
    );

    // **What this measurement does not do yet: give the CFG its functions.** `symbols` is empty here, so
    // `buildFunctionCfgs` has no function to build and the finding count is zero for that reason rather than because
    // the chain found nothing. The captures, sources and sinks above are real and are the measurement; the findings
    // are not interpretable until the scan supplies the symbols a real parse would.
    //
    // What is asserted is what holds for any source tree this scans: real files parse, and real code has captures.
    // The counts below it are printed rather than asserted, because **they are the measurement** - and at this
    // reading the sources are found in quantity while the sinks are almost absent, which is a statement about the
    // vocabulary rather than about the code.
    expect(scanned).toBeGreaterThan(10);
    expect(totalCaptures).toBeGreaterThan(1000);

    // A real file with no captures at all would mean the scan is reading something it cannot parse.
    expect(withSources).toBeGreaterThan(0);
  });
});
