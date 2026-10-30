// A value that is copied through a chain of statements, in the corpus's own shape.
//
// **The question is whether the value "disappeared" or merely "travelled".** `bar = new String(decode(encode(param)))`
// reads `param` on a line of its own, and that line stores no name — so a walk that treats "no definition here" as
// "cannot follow from here" records the value as lost. It is not lost: the statement it belongs to keeps the result in
// `bar`, and the walk reaches `bar` from the same definition. `map.put("k", param)` is the other case: the statement
// keeps nothing, and the value may come back through a side effect no def→use edge records.
//
// **38 of the corpus's 40 remaining false positives were this exact confusion**, each one a long chain of such
// statements ending in a call on a *constant* — the analysis asked the callee whether its argument could reach a
// return, got "no", and then refused to use that answer because a nested call in the chain had "lost" the value.
//
// Routed through `JavaProvider` and the real CFG builder, because the fact being tested is what a program looks like.

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
    discardedValueRegions: provider.extractDiscardedValueRegions(source),
  };

  const result = analyzeInterproceduralTaint(
    [parsed],
    buildCallSites([parsed], grouped.references),
    new Map([[file, facts]]),
  );
  return result.findings.filter((finding) => !finding.sanitized).length;
}

/** The chain every one of the 38 cases has: copy, wrap, cut, and then call something on the result. */
const CHAIN = [
  'String a = param;',
  'StringBuilder b = new StringBuilder(a);',
  'b.append(" SafeStuff");',
  'String c = b.toString();',
  'String d = c.substring(0, c.length() - 1);',
  'String e =',
  '    new String(',
  '        org.apache.commons.codec.binary.Base64.decodeBase64(',
  '            org.apache.commons.codec.binary.Base64.encodeBase64(',
  '                d.getBytes())));',
  'String f = e.split(" ")[0];',
  'org.owasp.benchmark.helpers.ThingInterface thing =',
  '    org.owasp.benchmark.helpers.ThingFactory.createThing();',
];

describe('a chain of statements that keep their value, end to end', () => {
  it('stays quiet when the chain ends in a call on a constant, because nothing travelled to the return', () => {
    // `thing.doSomething(f)` is a call the analysis cannot resolve, so the only question it can ask is what the
    // argument carries. Here the argument is a constant that replaced the chain.
    expect(
      liveFlows(
        servlet([
          ...CHAIN,
          'String g = "barbarians_at_the_gate";',
          'String bar = thing.doSomething(g);',
        ]),
      ),
    ).toBe(0);
  });

  it('reports the flow when the same call is made on the value itself', () => {
    // One token changed: the call now receives `f`, which is what the input became. The pair differs in nothing else,
    // which is what makes the first answer a statement about the chain rather than about the file.
    expect(liveFlows(servlet([...CHAIN, 'String bar = thing.doSomething(f);']))).toBeGreaterThan(0);
  });

  it('stays quiet when the chain ends in a constant that is never handed to anything', () => {
    expect(liveFlows(servlet([...CHAIN, 'String bar = "This_should_always_happen";']))).toBe(0);
  });
});

describe('a value handed to a statement that keeps nothing', () => {
  it('is still "cannot say", because a side effect may hand it back', () => {
    // **The boundary of the guarantee, stated as a test.** `store(param)` keeps no result, so the value may be sitting
    // anywhere the model cannot see, and the return reads a name whose value this file does not decide. The summary
    // declines the question rather than answering "no", which is the conservative direction and the reason the change
    // above is not "delete `lost`".
    expect(liveFlows(servlet(['store(param);', 'String bar = loadSomething();']))).toBeGreaterThan(
      0,
    );
  });

  it('is answered "no" when the return itself is a value this file decides', () => {
    // The same `store(param)` and a return that can only be the constant: the constant-return rule reads the callee's
    // whole set of returns and closes the question before the loss is ever consulted. Two rules, two shapes, and the
    // pair says which one is doing the work.
    expect(liveFlows(servlet(['store(param);', 'String bar = "This_should_always_happen";']))).toBe(
      0,
    );
  });
});
