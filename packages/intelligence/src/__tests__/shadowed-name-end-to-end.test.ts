// **A name is not a variable**, end to end, in the two shapes OWASP Benchmark's last false positives were written in.
//
// `String value` inside one loop and `Element value` inside another are two variables that share a spelling. The
// def→use graph is keyed by binding, so a model that gives both declarations one binding draws an edge between them: a
// taint into the first arrives at the second's sink, which is a false positive — and a write to the second ends the
// first's value, which is a false negative. Both directions are asserted here, plus the flow that must survive the
// change, because a precision fix that loses a real vulnerability is not a fix.
//
// Routed through `JavaProvider` and the real CFG builder, because the fact being tested is what a program looks like.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ExtractedFileFacts } from '../cfg/from-parsed-files.js';
import type { ParsedFile } from '@code-analyzer/shared';

const provider = new JavaProvider();

/** Analyze one file the way the benchmark does and report how many live flows it found. */
function liveFlows(body: readonly string[]): number {
  const source = [
    'import javax.servlet.http.HttpServletRequest;',
    'import javax.servlet.http.HttpServletResponse;',
    'public class T extends HttpServlet {',
    '  public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {',
    ...body.map((line) => `    ${line}`),
    '  }',
    '}',
  ].join('\n');

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

describe('two declarations of one spelling in two disjoint scopes', () => {
  it('stays quiet when the tainted one is read nowhere and the sink reads the other', () => {
    // The corpus's exact shape, `BenchmarkTest01479` and `BenchmarkTest02370`, with the names kept: the first loop
    // copies a request value into `value`, and the second loop reads its own `value` at a sink. One binding made the
    // first value arrive at the second loop's `println`; two bindings make the sink read the constant it was given.
    expect(
      liveFlows([
        'String param = "";',
        'java.util.Enumeration<String> names = request.getParameterNames();',
        'while (names.hasMoreElements()) {',
        '  String name = (String) names.nextElement();',
        '  String[] values = request.getParameterValues(name);',
        '  for (int i = 0; i < values.length; i++) {',
        '    String value = values[i];',
        '    if (value.equals("T")) { param = name; }',
        '  }',
        '}',
        'for (int i = 0; i < 3; i++) {',
        '  String value = "safe";',
        '  response.getWriter().println(value);',
        '}',
      ]),
    ).toBe(0);
  });

  it('reports the flow when the same two loops put the sink inside the loop that read the request', () => {
    // **One line moved, and the answer turns around.** The sink is now in the first loop, reading the `value` that
    // loop declared, so the flow is real and must be reported. The pair is what says the two bindings are read by
    // their own scopes rather than that one of them stopped existing.
    expect(
      liveFlows([
        'String param = "";',
        'java.util.Enumeration<String> names = request.getParameterNames();',
        'while (names.hasMoreElements()) {',
        '  String name = (String) names.nextElement();',
        '  String[] values = request.getParameterValues(name);',
        '  for (int i = 0; i < values.length; i++) {',
        '    String value = values[i];',
        '    response.getWriter().println(value);',
        '  }',
        '}',
        'for (int i = 0; i < 3; i++) {',
        '  String value = "safe";',
        '  System.out.println(value);',
        '}',
      ]),
    ).toBeGreaterThan(0);
  });
});

describe('one declaration read in two sibling scopes', () => {
  it('keeps the flow, because those two scopes see the same variable', () => {
    // The case the scope model must not break: a value written in one loop and read in another, with one declaration.
    // Both writes are may-definitions, so the value reaches the second loop — and it must, because that is the shape
    // every real vulnerability of this kind is written in.
    expect(
      liveFlows([
        'String param = request.getParameter("p");',
        'String value = "";',
        'for (int i = 0; i < 2; i++) { value = param; }',
        'for (int i = 0; i < 2; i++) { response.getWriter().println(value); }',
      ]),
    ).toBeGreaterThan(0);
  });
});
