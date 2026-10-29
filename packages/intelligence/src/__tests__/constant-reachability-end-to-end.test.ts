// Reachability, from source text to a CFG that knows which definitions can carry a value.
//
// **This is the user story rather than the unit**: a servlet reads an attacker-controlled header, the value is
// overwritten by a constant before it reaches a sink, and the analysis must not report the file. Every case below is a
// shape taken from OWASP Benchmark, through the real provider, the real CFG builder and the real summary join -
// nothing is stubbed, because the stub is where this kind of mistake hides.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';

import type { ExtractedFileFacts } from '../cfg/from-parsed-files.js';
import type { FunctionCfg, StatementFacts } from '../cfg/types.js';
import type { ParsedFile } from '@code-analyzer/shared';

const provider = new JavaProvider();

/** Everything `buildFunctionCfgs` needs, from the source alone. */
function cfgsFor(source: string): Map<string, FunctionCfg> {
  const file = 'BenchmarkTest.java';
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

  const extraction = new Map<string, ExtractedFileFacts>([
    [
      file,
      {
        sources: provider.extractTaintSources(source),
        sinks: provider.extractTaintSinks(source),
        sanitizers: provider.extractSanitizers(source),
        constants: provider.extractConstantFacts(source),
      },
    ],
  ]);

  return buildFunctionCfgs([parsed], buildCallSites([parsed], grouped.references), extraction);
}

/** Every binding index any function marks as constant, as `<function>:<binding name>`. */
function constantNames(cfgs: ReadonlyMap<string, FunctionCfg>): string[] {
  const names: string[] = [];
  for (const [fnQn, cfg] of cfgs) {
    const facts: StatementFacts = cfg.stmtFacts;
    for (const [, bindingIdxs] of facts.constantDefs ?? []) {
      for (const bindingIdx of bindingIdxs) {
        const name = cfg.bindings[bindingIdx]?.name;
        // The qualified name ends in `Class.method`, so the method is the last dotted segment.
        if (name !== undefined) names.push(`${fnQn.split('.').pop() ?? fnQn}:${name}`);
      }
    }
  }
  return names.sort();
}

const SERVLET = (assignment: string): string => `
public class BenchmarkTest extends TestCase {
    public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String param = java.net.URLDecoder.decode(request.getHeader("X"), "UTF-8");
        String bar;
        int num = 106;
        ${assignment}
        response.getWriter().println("result: " + bar);
    }
}
`;

describe('a constant condition decides which definition can carry a value', () => {
  it('marks the safe variant of the benchmark case', () => {
    const cfgs = cfgsFor(
      SERVLET('bar = (7 * 18) + num > 200 ? "This_should_always_happen" : param;'),
    );
    expect(constantNames(cfgs)).toContain('doPost:bar');
  });

  it('leaves the vulnerable variant unmarked, which is the half that must not regress', () => {
    const cfgs = cfgsFor(
      SERVLET('bar = (7 * 18) + num > 200 ? param : "This_should_always_happen";'),
    );
    expect(constantNames(cfgs)).not.toContain('doPost:bar');
  });

  it('marks it through a switch the same way', () => {
    const cfgs = cfgsFor(`
public class BenchmarkTest extends TestCase {
    public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String param = request.getHeader("X");
        String bar;
        String guess = "ABC";
        char switchTarget = guess.charAt(1);
        switch (switchTarget) {
            case 'A':
                bar = param;
                break;
            case 'B':
                bar = "bob";
                break;
            default:
                bar = param;
                break;
        }
        response.getWriter().println(bar);
    }
}
`);
    expect(constantNames(cfgs)).toContain('doPost:bar');
  });
});

describe('a function that can only return one value hands it to its caller', () => {
  const HELPER_CALLER = (calleeReturnsParam: boolean): string => `
public class BenchmarkTest extends TestCase {
    public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String param = request.getHeader("X");
        String bar = new Test().doSomething(request, param);
        response.getWriter().println(bar);
    }

    private class Test {
        public String doSomething(HttpServletRequest request, String param) {
            String bar;
            int num = 106;
            bar = (7 * 18) + num > 200 ? ${calleeReturnsParam ? 'param' : '"This_should_always_happen"'} : ${calleeReturnsParam ? '"This_should_always_happen"' : 'param'};
            return bar;
        }
    }
}
`;

  it('marks the caller’s definition when the callee always returns a constant', () => {
    const cfgs = cfgsFor(HELPER_CALLER(false));
    expect(constantNames(cfgs)).toContain('doPost:bar');
  });

  it('leaves the caller’s definition alone when the callee can return the argument', () => {
    const cfgs = cfgsFor(HELPER_CALLER(true));
    expect(constantNames(cfgs)).not.toContain('doPost:bar');
  });
});

describe('the neutral answer', () => {
  it('reports no constant definitions when the provider is given no reachability facts', () => {
    const file = 'T.java';
    const source = SERVLET('bar = (7 * 18) + num > 200 ? "This_should_always_happen" : param;');
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

    const cfgs = buildFunctionCfgs(
      [parsed],
      buildCallSites([parsed], grouped.references),
      new Map([[file, { sources: [], sinks: [] }]]),
    );

    for (const cfg of cfgs.values()) expect(cfg.stmtFacts.constantDefs).toBeUndefined();
  });
});
