// What a call hands back, through the real provider, the real CFG builder and the real pipeline.
//
// **This is the user story rather than the unit.** A servlet reads an attacker-controlled parameter and passes it to a
// helper; whether the file is reported depends entirely on what the helper does with it. Four helper bodies below are
// the four answers a real codebase gives, and every one of them is routed through `JavaProvider` — no stubs, because a
// stub is where a mistake about what the provider records hides.
//
// The fifth case is the one the model must *not* answer: a helper that puts the value into a collection and returns
// something else. This model cannot follow the collection, so the honest answer is the conservative one, and the case
// exists to keep a future "optimisation" from turning that silence into a clean bill of health.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { buildFunctionCfgs } from '../cfg/from-parsed-files.js';
import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ExtractedFileFacts } from '../cfg/from-parsed-files.js';
import type { ParsedFile } from '@code-analyzer/shared';

const provider = new JavaProvider();

/** A servlet whose helper body is spelled out, so the only variable is what the helper does. */
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
    '    }',
    '  }',
    '}',
  ].join('\n');
}

interface Outcome {
  readonly findings: number;
  readonly live: number;
  readonly sanitized: number;
}

/** Analyze the source the way the benchmark does, optionally without the return facts. */
function analyze(source: string, options: { returns?: boolean } = {}): Outcome {
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
    // **`undefined` is the provider that cannot read returns**, and the case exists because the difference between
    // "no returns" and "returns not read" is the whole soundness of the negative answer.
    ...(options.returns === false ? {} : { returnLines: provider.extractReturnLines(source) }),
  };

  const cfgs = buildFunctionCfgs(
    [parsed],
    buildCallSites([parsed], grouped.references),
    new Map([[file, facts]]),
  );
  const result = analyzeInterproceduralTaint(
    [parsed],
    buildCallSites([parsed], grouped.references),
    new Map([[file, facts]]),
  );
  void cfgs;
  const live = result.findings.filter((finding) => !finding.sanitized).length;
  return { findings: result.findings.length, live, sanitized: result.findings.length - live };
}

describe('a call hands back what the callee returns', () => {
  it('reports the flow when the helper returns its argument', () => {
    const outcome = analyze(servlet(['return param;']));
    expect(outcome.live).toBeGreaterThan(0);
  });

  it('reports nothing when the helper never reads the argument', () => {
    // **A helper whose result cannot come from `param` ends the flow.** `Utils.constant()` is not a constant this
    // analysis can fold, so the only fact that can stop the flow is the callee's own summary: `param` is read nowhere
    // in its body, no return reads it, and nothing of it vanished into a call.
    const outcome = analyze(
      servlet(['String bar = org.owasp.benchmark.helpers.Utils.constant();', 'return bar;']),
    );
    expect(outcome.findings).toBe(0);
  });

  it('reports the flow as neutralised when the helper escapes its argument', () => {
    const outcome = analyze(
      // `encodeForHTML` is the escape this project's vocabulary knows; a helper that applies it and returns the
      // result hands the caller a value that is escaped *for this sink kind*, which is a different answer from
      // "untainted" and is the reason the exclusions travel with the return.
      servlet(['return org.owasp.esapi.ESAPI.encoder().encodeForHTML(param);']),
    );
    // The path exists and the engine saw it; what the callee did to the value is why it is not a vulnerability.
    expect(outcome.findings).toBeGreaterThan(0);
    expect(outcome.live).toBe(0);
    expect(outcome.sanitized).toBeGreaterThan(0);
  });

  it('keeps reporting when the helper puts the value into a collection it cannot follow', () => {
    // **The one answer this model must not give.** `map.put("k", param)` writes no name, so the walk stops there; the
    // collection hands the value back through a `get` that no def→use edge connects. The measured consequence of
    // assuming otherwise was 104 real vulnerabilities going quiet.
    const outcome = analyze(
      servlet([
        'java.util.HashMap<String, Object> map = new java.util.HashMap<String, Object>();',
        'map.put("k", param);',
        'String bar = org.owasp.benchmark.helpers.Utils.constant();',
        'return bar;',
      ]),
    );
    expect(outcome.live).toBeGreaterThan(0);
  });

  it('keeps reporting when the provider cannot read the callee at all', () => {
    const outcome = analyze(servlet(['return param;']), { returns: false });
    expect(outcome.live).toBeGreaterThan(0);
  });
});
