// A repository shaped like the ones this tool is for: a handler reads a request and hands part of it to a shell, one
// call away, in another file.
//
// The scan over this repository's own sources produced five findings and could not produce an interprocedural one,
// because that code reads no untrusted input. This fixture is what the tool exists to read:
//
//   src/server.ts   handleSearch / handleExport read request.query and call runCommand
//   src/shell.ts    runCommand calls child_process.execSync - the sink, one file away
//   src/config.ts   readConfig returns configuration the handler concatenates into the command
//   src/safe.ts     the same shape, sanitized before the sink, which must not be reported

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TypeScriptProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, it, expect } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ParsedFile } from '@code-analyzer/shared';

const DIR = join(process.cwd(), 'tests/fixtures/app-with-taint/src');

function scanFixture(): ReturnType<typeof analyzeInterproceduralTaint> {
  const typed = new TypeScriptProvider() as unknown as {
    parse(s: string, f: string): Array<{ tag?: string }>;
    extractTaintSources(s: string): Array<{ sourceType: string; line: number; text: string }>;
    extractTaintSinks(s: string): Array<{ sinkType: string; line: number; text: string }>;
    extractSanitizers(s: string): Array<{ sanitizerType: string; line: number; text: string }>;
  };
  const files: ParsedFile[] = [];
  const extraction = new Map<string, unknown>();
  for (const name of readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
    const code = readFileSync(join(DIR, name), 'utf8');
    const captures = typed.parse(code, name);
    const { symbols, references, scopeTree } = groupCaptures(
      captures as Parameters<typeof groupCaptures>[0],
      name,
    );
    files.push({
      filePath: name,
      language: 'typescript',
      symbols,
      references,
      scopeTree,
      ast: captures,
    } as unknown as ParsedFile);
    extraction.set(name, {
      sources: typed.extractTaintSources(code),
      sinks: typed.extractTaintSinks(code),
      sanitizers: typed.extractSanitizers(code),
    });
  }
  const callSites = buildCallSites(
    files,
    files.flatMap((f) => f.references),
  );
  return analyzeInterproceduralTaint(files, callSites, extraction as never);
}

describe('a fixture repository with taint across files', () => {
  it('reports a finding whose source and sink are in different files', () => {
    const result = scanFixture();
     
    console.log(
      `APPTAIN files 4 findings ${result.findings.length} ` +
        `${JSON.stringify(result.findings.slice(0, 3).map((f) => `${f.sourceFn}->${f.sinkFn}:${f.sink.kind}`))}`,
    );

    // **The assertion that makes this different from every sample above it**: the two ends are in different files,
    // so nothing local to one function could have produced it.
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.some(
        (f) => (f.sourceFn ?? '').includes('server.ts') && (f.sinkFn ?? '').includes('shell.ts'),
      ),
    ).toBe(true);
  });
});
