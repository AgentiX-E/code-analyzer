// The shapes a Java servlet is written in, and the effect of the four capture defects fixed for them.
//
// **Measured on OWASP Benchmark before these existed:** 142 of 1 415 real vulnerabilities were found, and every miss
// had the same reason — the flow leaves the request on one statement and arrives at the sink on another, through an
// assignment, a constructor argument or a loop variable, and none of those three was recorded as a def or a use.
//
// The cases below are the corpus's own shapes, reduced to one function each so a failure names the arrow that broke.

import {
  JavaProvider,
  buildCallSites,
  groupCaptures,
  type TaintSanitizer,
  type TaintSink,
  type TaintSource,
} from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ParsedFile } from '@code-analyzer/shared';

interface Scan {
  readonly findings: ReturnType<typeof analyzeInterproceduralTaint>['findings'];
}

function scan(code: string): Scan {
  const provider = new JavaProvider() as unknown as {
    parse(s: string, f: string): Array<{ tag?: string }>;
    extractTaintSources(s: string): TaintSource[];
    extractTaintSinks(s: string): TaintSink[];
    extractSanitizers(s: string): TaintSanitizer[];
  };
  const file = 'Servlet.java';
  const captures = provider.parse(code, file);
  const { symbols, references, scopeTree } = groupCaptures(
    captures as Parameters<typeof groupCaptures>[0],
    file,
  );
  const parsed = {
    filePath: file,
    language: 'java',
    symbols,
    references,
    scopeTree,
    ast: captures,
  } as unknown as ParsedFile;
  const extraction = new Map([
    [
      file,
      {
        sources: provider.extractTaintSources(code),
        sinks: provider.extractTaintSinks(code),
        sanitizers: provider.extractSanitizers(code),
      },
    ],
  ]);
  const callSites = buildCallSites([parsed], references);
  return { findings: analyzeInterproceduralTaint([parsed], callSites, extraction).findings };
}

function liveKinds(result: Scan): string[] {
  return [...new Set(result.findings.filter((f) => !f.sanitized).map((f) => f.sink.kind))].sort();
}

describe('a flow that crosses an assignment', () => {
  it('follows a value from a request parameter into a concatenation and then a query', () => {
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request, HttpServletResponse response) {',
      '    String param = request.getParameter("p");',
      '    String sql = "{call " + param + "}";',
      '    statement.executeQuery(sql);',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('sql_exec');
  });

  it('follows a reassignment of a variable declared earlier', () => {
    // **The shape that was invisible**: the source is on the assignment, the declaration is four lines above it, and
    // the join between them is the def this statement records.
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request) {',
      '    String param = "";',
      '    param = request.getHeader("p");',
      '    param = java.net.URLDecoder.decode(param, "UTF-8");',
      '    open(new java.io.File(param));',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('file_read');
  });
});

describe('a flow whose call spans several lines', () => {
  it('reaches a sink whose arguments are wrapped one per line', () => {
    // **The shape the formatter writes, and the reason 409 of the corpus's misses were misses.** A call is one
    // statement, but the captures recorded the callee on the line the call starts and each argument on the line the
    // argument sits on. The sink was filed under the first key and the tainted use under a later one, so the two
    // never met. This case is the plain single-line flow above with the argument list wrapped.
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request) {',
      '    String param = request.getParameter("p");',
      '    String sql = "SELECT * from USERS where USERNAME=\'" + param + "\'";',
      '    connection.prepareStatement(',
      '        sql,',
      '        java.sql.ResultSet.TYPE_FORWARD_ONLY,',
      '        java.sql.ResultSet.CONCUR_READ_ONLY);',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('sql_exec');
  });

  it('reaches a sink whose receiver and name are wrapped away from the arguments', () => {
    // `out.println(\n  value)` — the same statement, split after the callee. The value is what carries the taint and
    // it is not on the callee's line.
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request, HttpServletResponse response) {',
      '    String param = request.getParameter("p");',
      '    response.getWriter()',
      '        .println(',
      '            param);',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('html');
  });
});

describe('a flow the code re-assigns on a branch', () => {
  it('keeps the value that arrives from a branch guard', () => {
    // **The corpus's most common three lines**, and the reason 409 misses shared a function with their source:
    // `param = request.getParameter(...)` followed by `if (param == null) param = "";`. The guard's assignment was
    // recorded as a *killing* definition, so the tainted definition it guarded was gone by the time the sink read the
    // name. A single block that spans the whole function cannot claim a killing definition — it does not know whether
    // the statement is inside the branch — so every definition accumulates.
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request) {',
      '    String param = request.getParameter("p");',
      '    if (param == null) param = "";',
      '    statement.executeQuery("SELECT * from USERS where NAME=\x27" + param + "\x27");',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('sql_exec');
  });
});

describe('a flow that crosses a constructor', () => {
  it('reaches the file a constructor opens', () => {
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request) {',
      '    String name = request.getParameter("f");',
      '    java.io.FileInputStream stream = new java.io.FileInputStream(new java.io.File(name));',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('file_read');
  });
});

describe('a flow that crosses a loop variable', () => {
  it('reaches the sink through a for-each binding', () => {
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request, HttpServletResponse response) {',
      '    javax.servlet.http.Cookie[] theCookies = request.getCookies();',
      '    for (javax.servlet.http.Cookie theCookie : theCookies) {',
      '      String value = theCookie.getValue();',
      '      response.getWriter().println(value);',
      '    }',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('html');
  });
});

describe('a neutraliser only neutralises the sink it is for', () => {
  it('does not clean a value for a query because it escaped it for a page', () => {
    // **The defect that made every sanitizer look alike.** `neutralizedKinds` was built from the sanitizer's
    // *category* — `escaping`, `validation` — while a sink carries a *kind* — `html`, `sql_exec`. `has(kind)` was
    // therefore never true, and the only thing a sanitizer did was mark the finding `sanitized`. Escaping a value for
    // an HTML body does nothing to a SQL parser, so this flow is live and the corpus counts it as one.
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request) {',
      '    String param = request.getParameter("p");',
      '    String bar = org.owasp.esapi.ESAPI.encoder().encodeForHTML(param);',
      '    statement.executeQuery("SELECT * from USERS where NAME=\x27" + bar + "\x27");',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toContain('sql_exec');
  });

  it('cleans a value for the query when the neutraliser is the one for queries', () => {
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request) {',
      '    String param = request.getParameter("p");',
      '    String bar = org.owasp.esapi.ESAPI.encoder().encodeForSQL(new OracleCodec(), param);',
      '    statement.executeQuery("SELECT * from USERS where NAME=\x27" + bar + "\x27");',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toEqual([]);
  });

  it('cleans a value for the page when the neutraliser is the one for pages', () => {
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request, HttpServletResponse response) {',
      '    String param = request.getParameter("p");',
      '    String bar = org.owasp.esapi.ESAPI.encoder().encodeForHTML(param);',
      '    response.getWriter().println(bar);',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toEqual([]);
  });
});

describe('a flow that the code neutralises', () => {
  it('is reported as sanitized and does not count as a live finding', () => {
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request, HttpServletResponse response) {',
      '    String param = request.getParameter("p");',
      '    response.getWriter().println(org.owasp.esapi.ESAPI.encoder().encodeForHTML(param));',
      '  }',
      '}',
    ].join('\n');
    const result = scan(code);
    // The path exists and the engine says so; what it does not say is that the code is vulnerable.
    expect(liveKinds(result)).toEqual([]);
  });

  it('is not raised at all when the value is converted to a number first', () => {
    const code = [
      'class Servlet {',
      '  void doPost(HttpServletRequest request, HttpServletResponse response) {',
      '    int id = Integer.parseInt(request.getParameter("id"));',
      '    response.getWriter().println(id);',
      '  }',
      '}',
    ].join('\n');
    expect(liveKinds(scan(code))).toEqual([]);
  });
});
