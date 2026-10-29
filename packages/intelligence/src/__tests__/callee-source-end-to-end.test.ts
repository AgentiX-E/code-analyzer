// A function that reads the input itself, called by a function that trusts the result.
//
// **This is the generative half of the return channel, and it was permanently empty.** A callee's *parameter* reaching a
// return is the half that stops flows; a callee's own *source* reaching a return is the half that starts them, and no
// number of caller-side facts can produce it: the caller passed `request`, not a value, and only the callee knows it
// read the input with it. Without this, an application that funnels every read through one helper looks clean to the
// analysis - which is exactly the shape a real codebase has.
//
// Routed through `JavaProvider` and the real CFG builder, because the fact being tested is what the provider records about
// `request.getParameter` inside a callee, not what a fixture says about it.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ExtractedFileFacts } from '../cfg/from-parsed-files.js';
import type { ParsedFile } from '@code-analyzer/shared';

const provider = new JavaProvider();

/** A servlet whose helper body is spelled out, so the only variable is what the helper does with the request. */
function servlet(
  helperBody: readonly string[],
  helperParameters = 'HttpServletRequest request',
): string {
  return [
    'public class T extends HttpServlet {',
    '  public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {',
    '    String bar = new Test().doSomething(request);',
    '    response.getWriter().println(bar);',
    '  }',
    '  private class Test {',
    `    public String doSomething(${helperParameters}) throws IOException {`,
    ...helperBody.map((line) => `      ${line}`),
    '    }',
    '  }',
    '}',
  ].join('\n');
}

interface CrossFinding {
  readonly sourceFn: string;
  readonly sinkFn: string;
  readonly sanitized: boolean;
}

/** Analyze one file the way the benchmark does, and keep the facts about where each flow started and ended. */
function analyze(source: string): CrossFinding[] {
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
  };

  const result = analyzeInterproceduralTaint(
    [parsed],
    buildCallSites([parsed], grouped.references),
    new Map([[file, facts]]),
  );
  return result.findings.map((finding) => ({
    sourceFn: finding.sourceFn,
    sinkFn: finding.sinkFn,
    sanitized: finding.sanitized,
  }));
}

describe('a callee that reads the input itself is a source for its callers', () => {
  it('reports the flow across the call when the helper returns what it read', () => {
    const findings = analyze(servlet(['String bar = request.getParameter("p");', 'return bar;']));

    // The value starts in `doSomething` and ends at the caller's `println`. That is the whole point: the caller never
    // touched a tainted name, so nothing on the caller's side could have reported this.
    const across = findings.filter((finding) => finding.sourceFn !== finding.sinkFn);
    expect(across.length).toBeGreaterThan(0);
    expect(across.some((finding) => finding.sourceFn.endsWith('doSomething'))).toBe(true);
    expect(across.some((finding) => finding.sinkFn.endsWith('doPost'))).toBe(true);
  });

  it('records one source once, however many returns hand it back', () => {
    // Two returns of the same value are two return sites and one source. The summary names the source once - a caller
    // that destructures a tuple is reading a field of one value, and a duplicate entry would be a second call result for
    // a call that produced one.
    const twoReturns = analyze(
      servlet([
        'String bar = request.getParameter("p");',
        'if (bar != null) return bar;',
        'return bar;',
      ]),
    );
    const singleReturn = analyze(
      servlet(['String bar = request.getParameter("p");', 'return bar;']),
    );
    const across = (findings: readonly CrossFinding[]): number =>
      findings.filter((finding) => finding.sourceFn !== finding.sinkFn).length;

    expect(across(twoReturns)).toBe(across(singleReturn));
    expect(across(twoReturns)).toBeGreaterThan(0);
  });

  it('does not make a caller tainted when the helper reads the input and returns something else', () => {
    // **The value goes nowhere it can come back from.** `Utils.constant()` is not a constant this analysis can fold, so
    // the only fact that keeps this clean is the callee's own summary: its returns read no source.
    const findings = analyze(
      servlet([
        'String ignored = request.getParameter("p");',
        'String bar = org.owasp.benchmark.helpers.Utils.constant();',
        'return bar;',
      ]),
    );

    expect(findings.filter((finding) => finding.sourceFn !== finding.sinkFn)).toHaveLength(0);
  });

  it('does not attribute a helper source to a parameter position', () => {
    // The helper declares no parameter at all, so there is no position a caller's argument could align with - and the
    // flow still has to be found, because the value is the helper's own.
    const findings = analyze(
      servlet(['String bar = request.getParameter("p");', 'return bar;'], 'String unused'),
    );

    expect(
      findings.filter((finding) => finding.sourceFn !== finding.sinkFn).length,
    ).toBeGreaterThan(0);
  });
});
