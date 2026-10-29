// A value that goes into a collection and comes back out, in both of the corpus's shapes.
//
// **The question is not "is there a map in the file" but "does *this* read receive *this* value".** A helper that writes
// the parameter under one key and reads another hands its caller a clean string, and the analysis used to report the
// caller's sink anyway: the value went into a call that wrote no name, the summary could not follow it, and
// `ReturnSummary.lost` is the field that turns "cannot follow" into "will not say". Every safe case of that family was
// a false positive for exactly that reason.
//
// Routed through `JavaProvider` and the real CFG builder, because the fact being tested is what a *program* looks like,
// not what a fixture says about one. Each pair below differs in one line: which key is read back, or which index.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ExtractedFileFacts } from '../cfg/from-parsed-files.js';
import type { ParsedFile } from '@code-analyzer/shared';

const provider = new JavaProvider();

/** A servlet whose helper does something with the parameter and hands back `bar`. */
function servlet(helperBody: readonly string[]): string {
  return [
    'public class T extends HttpServlet {',
    '  public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {',
    '    String param = request.getParameter("p");',
    '    String bar = new Test().doSomething(request, param);',
    '    response.getWriter().println(bar);',
    '  }',
    '  private class Test {',
    '    public String doSomething(HttpServletRequest request, String param) throws IOException {',
    ...helperBody.map((line) => `      ${line}`),
    '      return bar;',
    '    }',
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
  };

  const result = analyzeInterproceduralTaint(
    [parsed],
    buildCallSites([parsed], grouped.references),
    new Map([[file, facts]]),
  );
  return result.findings.filter((finding) => !finding.sanitized).length;
}

describe('a map round-trip, end to end', () => {
  it('reports the value the read receives, and stays quiet about the one it does not', () => {
    const writes = [
      'java.util.HashMap<String, Object> m = new java.util.HashMap<String, Object>();',
      'm.put("keyA", "a_Value");',
      'm.put("keyB", param);',
      'm.put("keyC", "another_Value");',
    ];

    // The value is read back: the caller's sink receives what the input put in.
    expect(
      liveFlows(servlet(['String bar = "safe!";', ...writes, 'bar = (String) m.get("keyB");'])),
    ).toBeGreaterThan(0);

    // The value is read back and then overwritten by the safe entry, which is the whole of the safe case: the last
    // write to a name is the one that reaches its readers.
    expect(
      liveFlows(
        servlet([
          'String bar = "safe!";',
          ...writes,
          'bar = (String) m.get("keyB");',
          'bar = (String) m.get("keyA");',
        ]),
      ),
    ).toBe(0);
  });
});

describe('a list round-trip, end to end', () => {
  const build = [
    'java.util.List<String> values = new java.util.ArrayList<String>();',
    'values.add("safe");',
    'values.add(param);',
    'values.add("moresafe");',
  ];

  it('follows the index an element moved to', () => {
    // After `remove(0)` the value is at position 0 and `get(1)` reads `"moresafe"`.
    expect(
      liveFlows(
        servlet([
          'String bar = "alsosafe";',
          ...build,
          'values.remove(0);',
          'bar = values.get(1);',
        ]),
      ),
    ).toBe(0);

    // Without the removal the value is at position 1, which is what `get(1)` asks for.
    expect(
      liveFlows(servlet(['String bar = "alsosafe";', ...build, 'bar = values.get(1);'])),
    ).toBeGreaterThan(0);
  });

  it('follows a removal that moves the value into the position being read', () => {
    expect(
      liveFlows(
        servlet([
          'String bar = "alsosafe";',
          ...build,
          'values.remove(0);',
          'bar = values.get(0);',
        ]),
      ),
    ).toBeGreaterThan(0);
  });
});

describe('a builder, end to end', () => {
  it('reports what was appended, because `toString` hands the whole thing back', () => {
    expect(
      liveFlows(
        servlet([
          'StringBuilder sb = new StringBuilder();',
          'sb.append(param);',
          'String bar = sb.toString();',
        ]),
      ),
    ).toBeGreaterThan(0);

    // A builder nothing was appended to hands back an empty string, and the sink receives nothing tainted.
    expect(
      liveFlows(
        servlet([
          'StringBuilder sb = new StringBuilder();',
          'sb.append("constant");',
          'String bar = sb.toString();',
        ]),
      ),
    ).toBe(0);
  });
});
