// What Java's capture layer records, where a taint flow needs it.
//
// **Four node shapes were missing and each one broke a different flow.** They are asserted here in the shape that
// found them — a statement whose value comes from the request and leaves through a sink — because the layer is easy
// to "improve" in a way that reads better and records less:
//
//   - `fileName = Utils.testfileDir + param;` — an **assignment** recorded neither the def it writes nor the uses it
//     reads, so taint could only cross a variable declared and passed on one line
//   - `new FileInputStream(new File(fileName))` — a **constructor** recorded nothing, and the path sink's argument is
//     exactly what a creation expression holds
//   - `for (Cookie theCookie : theCookies)` — the **loop variable** was invisible, which is the second arrow of the
//     cookie vector's chain
//   - `catch (Exception e)` — a caught exception is a binding a handler reads
//
// The vocabulary tests below exist for the same reason: the servlet API's sources are method names whose receiver's
// type is not knowable from the call, so the matcher has to compare the last dotted segment.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { JAVA_TAINT_VOCABULARY } from '../languages/java-taint.js';
import { JavaProvider } from '../languages/java.js';

interface Capture {
  tag?: string;
  name?: string;
  startLine?: number;
}

function capturesOf(code: string): Capture[] {
  return new JavaProvider().parse(code, 'A.java');
}

function namesAt(code: string, line: number, tag: string): string[] {
  return capturesOf(code)
    .filter((capture) => capture.startLine === line && capture.tag === tag)
    .map((capture) => capture.name ?? '');
}

describe('Java captures an assignment that writes an existing variable', () => {
  const SOURCE = [
    'class A {',
    '  void run() {',
    '    String param = "";',
    '    param = request.getParameter("p");',
    '    use(param);',
    '  }',
    '}',
  ].join('\n');

  it('records the def on the assigning line, not only on the declaration', () => {
    expect(namesAt(SOURCE, 4, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(['param']);
  });

  it('records the uses the assignment reads', () => {
    expect(namesAt(SOURCE, 4, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('request');
    expect(namesAt(SOURCE, 4, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('getParameter');
  });

  it('treats a field assignment as a read of its receiver', () => {
    const field = ['class A {', '  void run() {', '    this.value = source();', '  }', '}'].join(
      '\n',
    );
    // `this.value` is not a binding, so the left side contributes no def — and the field it writes is still read,
    // which is what a flow through a field follows. (`this` is its own node type in tree-sitter-java, so the name
    // the walk finds is the field's.)
    expect(namesAt(field, 3, CAPTURE_TAGS.VARIABLE_DEF)).toEqual([]);
    expect(namesAt(field, 3, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('value');
  });
});

describe('Java captures a constructor call', () => {
  const CONSTRUCTOR = ['class A {', '  void run() {', '    open(new File(name));', '  }', '}'].join(
    '\n',
  );

  it('records the created type as a call and the arguments as uses', () => {
    expect(namesAt(CONSTRUCTOR, 3, CAPTURE_TAGS.FUNCTION_CALL)).toContain('File');
    expect(namesAt(CONSTRUCTOR, 3, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('name');
  });
});

describe('Java captures the binding a loop and a handler introduce', () => {
  it('records a for-each variable as a def and its iterable as a use', () => {
    const loop = [
      'class A {',
      '  void run() {',
      '    for (Cookie theCookie : theCookies) {',
      '      use(theCookie);',
      '    }',
      '  }',
      '}',
    ].join('\n');
    expect(namesAt(loop, 3, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(['theCookie']);
    expect(namesAt(loop, 3, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('theCookies');
  });

  it('records a caught exception as a def', () => {
    const handler = [
      'class A {',
      '  void run() {',
      '    try { work(); } catch (Exception e) {',
      '      use(e);',
      '    }',
      '  }',
      '}',
    ].join('\n');
    expect(namesAt(handler, 3, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(['e']);
  });
});

describe('the servlet vocabulary', () => {
  const provider = new JavaProvider();

  it('reads a request parameter, whatever the receiver is called', () => {
    for (const receiver of ['request', 'req', 'theRequest']) {
      const sources = provider.extractTaintSources(`String p = ${receiver}.getParameter("p");`);
      expect(sources.map((source) => source.sourceType)).toContain('http_request');
    }
  });

  it('reads a cookie value', () => {
    const sources = provider.extractTaintSources('String v = theCookie.getValue();');
    expect(sources.map((source) => source.sourceType)).toContain('cookie');
  });

  it('reads a request through the wrapper a corpus puts in front of it, and not the wrapper that lies', () => {
    // **A wrapper is a source exactly when its body is one.** `SeparateClassRequest.getTheParameter(p)` returns
    // `request.getParameter(p)`, so a servlet that reads its input through it is reading the request — and the matcher
    // compares the last dotted segment of the callee, so the direct name never sees it. Measured on OWASP Benchmark:
    // the same entry restored **84 of the corpus's silent vulnerable cases across seven categories**, and every one of
    // them read its input through this helper.
    //
    // **`getTheValue` is the same class, one method away, and it returns `"bar"`.** Adding it as a source was measured
    // as an injection: false positives 0 → 85, `xss` FPR 0.0000 → 0.1000, `xpathi` 0.0000 → 0.0500. The assertion
    // below is the one that keeps the next person from "completing" the family.
    const names = JAVA_TAINT_VOCABULARY.sources.map(([name]) => name);
    expect(names).toContain('getTheParameter');
    expect(names).toContain('getTheCookie');
    expect(names).not.toContain('getTheValue');

    const parameter = provider.extractTaintSources('String p = scr.getTheParameter("p");');
    expect(parameter.map((source) => source.sourceType)).toContain('http_request');
    const cookie = provider.extractTaintSources('String v = scr.getTheCookie("c");');
    expect(cookie.map((source) => source.sourceType)).toContain('cookie');
  });

  it('treats a servlet write as an html sink and a console write as nothing', () => {
    const writer = provider.extractTaintSinks('response.getWriter().println(value);');
    expect(writer.map((sink) => sink.sinkType)).toContain('html');

    // **`System.out.println` ends in the same segment as the servlet write and is not one.** Measured on the
    // benchmark's 1.2beta checkout, ninety-eight of 297 flagged safe cases contained console output counted as
    // cross-site scripting.
    const console = provider.extractTaintSinks('System.out.println(value);');
    expect(console).toEqual([]);
  });

  it('treats a JDBC call and a process start as sinks', () => {
    expect(
      provider.extractTaintSinks('statement.executeQuery(sql);').map((sink) => sink.sinkType),
    ).toContain('sql_exec');
    expect(
      provider
        .extractTaintSinks('ProcessBuilder builder = new ProcessBuilder(cmd);')
        .map((sink) => sink.sinkType),
    ).toContain('os_command');
  });

  it('recognises ESAPI escaping and type conversion as neutralisers', () => {
    for (const call of [
      'ESAPI.encoder().encodeForHTML(value)',
      'org.owasp.esapi.ESAPI.encoder().encodeForSQL(codec, value)',
      'Integer.parseInt(value)',
    ]) {
      const sanitizers = provider.extractSanitizers(`${call};`);
      expect(sanitizers.length).toBeGreaterThan(0);
    }
  });

  it('recognises Spring escaping for HTML, and not its inverse', () => {
    // **The list held three Apache escapers and no Spring one**, which is a vocabulary hole rather than a model
    // decision: `org.springframework.web.util.HtmlUtils.htmlEscape` is the escaper a Spring application reaches for,
    // and a scanner that does not know it charges the project for escaping its own output. Measured on OWASP
    // Benchmark v1.2: three of the 153 remaining false positives were this call and nothing else.
    const escaped = provider.extractSanitizers(
      'String bar = org.springframework.web.util.HtmlUtils.htmlEscape(param);',
    );
    expect(escaped.map((sanitizer) => sanitizer.neutralizes)).toContainEqual(['html']);
    expect(escaped.map((sanitizer) => sanitizer.arguments)).toContainEqual(['param']);

    // `htmlUnescape` puts the danger back, so it must stay outside the list. The matcher compares whole segments, so
    // this is a statement about the vocabulary rather than about prefix matching — and it would have passed even if
    // the entry were added, which is exactly why it is asserted against the list itself below.
    const unescaped = provider.extractSanitizers(
      'String bar = org.springframework.web.util.HtmlUtils.htmlUnescape(param);',
    );
    expect(unescaped).toEqual([]);
    // `sanitizers` is optional on the vocabulary type; absent would fail the assertion below rather than pass it.
    const names = (JAVA_TAINT_VOCABULARY.sanitizers ?? []).map(([name]) => name);
    expect(names).toContain('htmlEscape');
    expect(names).not.toContain('htmlUnescape');
  });

  it('names the sinks the corpus actually writes its dangerous calls with', () => {
    // **A sink the vocabulary does not name is a vulnerability the engine cannot find, whatever its analysis does.**
    // Two families were missing and each was measured: `PrintWriter.printf(format, args)` writes its format string
    // into the response body exactly as `print` does (51 vulnerable `xss` cases were silent for that one word), and
    // Spring's `JdbcTemplate` answers the same question through `queryForRowSet`, `queryForList`, `queryForMap`,
    // `queryForObject`, `queryForLong` and `batchUpdate` rather than through JDBC's `executeQuery` (52 more).
    //
    // **Asserted against the list and against the extraction**, because the two fail differently: a missing entry is a
    // vocabulary hole, and an entry the matcher cannot reach is a comparison hole - the same pair that produced the
    // `Process.Start` and `std::system` defects before it.
    const names = JAVA_TAINT_VOCABULARY.sinks.map(([name]) => name);
    for (const name of [
      'printf',
      'batchUpdate',
      'queryForList',
      'queryForLong',
      'queryForMap',
      'queryForObject',
      'queryForRowSet',
    ]) {
      expect(names).toContain(name);
    }

    const printed = provider.extractTaintSinks('response.getWriter().printf(param, obj);');
    expect(printed.map((sink) => sink.sinkType)).toContain('html');

    const queried = provider.extractTaintSinks(
      'org.owasp.benchmark.helpers.DatabaseHelper.JDBCtemplate.queryForRowSet(sql);',
    );
    expect(queried.map((sink) => sink.sinkType)).toContain('sql_exec');
  });

  it('keeps the C family vocabulary it extends, so nothing an earlier language relied on was dropped', () => {
    const shared = JAVA_TAINT_VOCABULARY.sources.map(([name]) => name);
    expect(shared).toContain('process.env');
    expect(shared).toContain('getParameter');
    expect(JAVA_TAINT_VOCABULARY.sinks.map(([name]) => name)).toContain('query');
  });
});

describe('Java captures a bare name in statement position', () => {
  it('records `x.y;` as a read of the field', () => {
    // **Java only permits an assignment, an increment or a call as a statement**, so this shape comes from a file
    // being edited rather than from a compilable program — and the provider is asked to parse files in that state.
    // It is a read either way, and asserting it keeps the branch from being reachable only in production.
    const captures = capturesOf('class A { void m() { x.y; } }');

    expect(
      captures.some(
        (capture) => capture.tag === CAPTURE_TAGS.VARIABLE_ACCESS && capture.name === 'x.y',
      ),
    ).toBe(true);
  });

  it('records `x;` as a read of the name', () => {
    const captures = capturesOf('class A { void m() { x; } }');

    expect(
      captures.some(
        (capture) => capture.tag === CAPTURE_TAGS.VARIABLE_ACCESS && capture.name === 'x',
      ),
    ).toBe(true);
  });
});
