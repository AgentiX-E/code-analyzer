// A receiver that is configured and then executed, which is how a command injection is actually written.
//
// **The value reached a sink the whole time and no argument of that sink carried it.** `argList.add("echo " + param)`
// puts the value in a container, `pb.command(argList)` hands the container to the receiver, and `pb.start()` executes
// what the receiver holds — a call with no arguments at all whose own receiver is the thing that carries the danger.
// A model that only asks "which names did this call's arguments read" answers nothing here, and the engine's `start`
// sink had been in the table the whole time: it knew where the danger landed and not how the value got there.
//
// Routed through `JavaProvider` and the real CFG builder, because the fact under test is what a program looks like.
// Each pair below differs in one line: whether the container holds the parameter at all.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ExtractedFileFacts } from '../cfg/from-parsed-files.js';
import type { ParsedFile } from '@code-analyzer/shared';

const provider = new JavaProvider();

/** A servlet whose body is the lines under test, with a request parameter in scope. */
function servlet(body: readonly string[]): string {
  return [
    'public class T extends HttpServlet {',
    '  public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {',
    '    String param = request.getParameter("p");',
    ...body.map((line) => `    ${line}`),
    '  }',
    '}',
  ].join('\n');
}

/** Analyze one file the way the benchmark does and report how many live flows it found. */
function liveFlows(source: string): number {
  const file = 'T.java';
  const captures = provider.parse(source, file);
  const grouped = groupCaptures(captures, file);
  const parsed = {
    filePath: file,
    language: 'java',
    symbols: grouped.symbols,
    references: grouped.references,
    scopeTree: grouped.scopeTree,
    ast: captures,
  } as unknown as ParsedFile;

  const facts: ExtractedFileFacts = {
    sources: provider.extractTaintSources(source),
    sinks: provider.extractTaintSinks(source),
    sanitizers: provider.extractSanitizers(source),
    constants: provider.extractConstantFacts(source),
    returnLines: provider.extractReturnLines(source),
    containerCalls: provider.extractContainerCalls(source),
    conditionalRegions: provider.extractConditionalRegions(source),
    discardedValueRegions: provider.extractDiscardedValueRegions(source),
    scopeRegions: provider.extractScopeRegions(source),
  };

  const result = analyzeInterproceduralTaint(
    [parsed],
    buildCallSites([parsed], grouped.references),
    new Map([[file, facts]]),
  );
  return result.findings.filter((finding) => !finding.sanitized).length;
}

describe('a receiver configured and then executed, end to end', () => {
  it('reports the value a container carries into the call that executes it', () => {
    // The corpus's own shape, down to the two constant arguments that make the command a shell invocation.
    const source = servlet([
      'java.util.List<String> argList = new java.util.ArrayList<String>();',
      'argList.add("sh");',
      'argList.add("-c");',
      'argList.add("echo " + param);',
      'ProcessBuilder pb = new ProcessBuilder();',
      'pb.command(argList);',
      'Process p = pb.start();',
      'response.getWriter().println(p);',
    ]);
    expect(liveFlows(source)).toBeGreaterThan(0);
  });

  it('stays quiet when the same container holds only constants', () => {
    // One line differs from the case above, and it is the line that carries the value.
    const source = servlet([
      'java.util.List<String> argList = new java.util.ArrayList<String>();',
      'argList.add("sh");',
      'argList.add("-c");',
      'argList.add("echo safe");',
      'ProcessBuilder pb = new ProcessBuilder();',
      'pb.command(argList);',
      'Process p = pb.start();',
      'response.getWriter().println(p);',
    ]);
    expect(liveFlows(source)).toBe(0);
  });

  it('reports the container handed to the constructor, which is the same act spelled once', () => {
    const source = servlet([
      'java.util.List<String> argList = new java.util.ArrayList<String>();',
      'argList.add("echo " + param);',
      'ProcessBuilder pb = new ProcessBuilder(argList);',
      'Process p = pb.start();',
      'response.getWriter().println(p);',
    ]);
    expect(liveFlows(source)).toBeGreaterThan(0);
  });

  it('stays quiet about a constructor handed a container of constants', () => {
    const source = servlet([
      'java.util.List<String> argList = new java.util.ArrayList<String>();',
      'argList.add("echo safe");',
      'ProcessBuilder pb = new ProcessBuilder(argList);',
      'Process p = pb.start();',
      'response.getWriter().println(p);',
    ]);
    expect(liveFlows(source)).toBe(0);
  });

  it('does not read a receiver nothing wrote into, so a plain start stays quiet', () => {
    // **`start` reads the contents of a container, and this receiver has none.** Without that condition every
    // `timer.start()` in a servlet that read a parameter anywhere would be a command injection.
    const source = servlet([
      'javax.swing.Timer timer = new javax.swing.Timer(1000, null);',
      'timer.start();',
      'response.getWriter().println("ok");',
    ]);
    expect(liveFlows(source)).toBe(0);
  });
});
