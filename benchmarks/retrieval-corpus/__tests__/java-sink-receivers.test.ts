// `write` is not one sink. It is a method on a response writer, on a file, and on a string builder, and only the
// first sends a value to a browser.
//
// **Why this file exists.** On the OWASP corpus, `fw.write("secret_value=" + encoded)` inside a `Crypto` test case was
// reported as cross-site scripting. The case's own vulnerability is about the cipher it chose, and every one of the 85
// safe `Crypto` cases that scored as a false positive scored that way: the value went into a file whose path was
// fixed when the writer was constructed. The sink list matched on the method name alone, so the destination — the one
// thing that decides what the danger is — never entered the decision.

import { describe, expect, it } from 'vitest';

import { JavaProvider } from '../java.js';

const provider = new JavaProvider();

function htmlSinks(source: string): readonly string[] {
  return provider
    .extractTaintSinks(source)
    .filter((sink) => sink.sinkType === 'html')
    .map((sink) => `${sink.line}:${sink.name}`);
}

describe('a write whose destination decides whether it is an HTML sink', () => {
  it('does not call a FileWriter write cross-site scripting, because the destination is a file', () => {
    const source = `
import java.io.FileWriter;
class T {
  void f(String param) throws Exception {
    java.io.FileWriter fw = new java.io.FileWriter("/tmp/out.txt", true);
    fw.write("secret=" + param + "\\n");
    fw.close();
  }
}`;
    expect(htmlSinks(source)).toEqual([]);
    // **And the path is still a sink**, because that is the argument whose content decides which file is written.
    const fileWrites = provider
      .extractTaintSinks(source)
      .filter((sink) => sink.sinkType === 'file_write')
      .map((sink) => sink.name);
    expect(fileWrites.some((name) => name.includes('FileWriter'))).toBe(true);
  });

  it('keeps a response writer a sink even though it is also declared as a local', () => {
    const source = `
class T {
  void f(String param, javax.servlet.http.HttpServletResponse response) throws Exception {
    java.io.PrintWriter out = response.getWriter();
    out.println(param);
  }
}`;
    expect(htmlSinks(source)).toContain('5:out.println');
  });

  it('keeps a writer whose type is unknown, because an unknown destination is not a safe one', () => {
    const source = `
class T {
  void f(String param, java.io.Writer sink) throws Exception {
    sink.write(param);
  }
}`;
    expect(htmlSinks(source)).toContain('4:sink.write');
  });

  it('does not call a StringBuilder append cross-site scripting, because a builder is not a destination', () => {
    const source = `
class T {
  void f(String param) {
    StringBuilder sb = new StringBuilder();
    sb.append(param);
  }
}`;
    expect(htmlSinks(source)).toEqual([]);
  });

  it('does not call a BufferedWriter wrapping a FileWriter cross-site scripting', () => {
    const source = `
class T {
  void f(String param) throws Exception {
    java.io.BufferedWriter bw = new java.io.BufferedWriter(new java.io.FileWriter("/tmp/a"));
    bw.write(param);
  }
}`;
    expect(htmlSinks(source)).toEqual([]);
  });

  it('still treats a chained response writer as a sink, because the receiver is a call and not a variable', () => {
    const source = `
class T {
  void f(String param, javax.servlet.http.HttpServletResponse response) throws Exception {
    response.getWriter().println("value: " + param);
  }
}`;
    expect(htmlSinks(source)).toContain('4:response.getWriter().println');
  });
  it('keeps a bare write with no receiver, because an unknown destination is not a safe one', () => {
    // **The conservative default, tested rather than assumed.** `writesToResponseBody` filters `html` sinks whose
    // receiver is a declared non-response writer; a call with no receiver at all has no destination to ask about, and
    // the filter must leave it alone or it becomes a way to lose findings quietly.
    const source = `
class T {
  native void write(String value);
  void f(String param) {
    write(param);
  }
}`;
    expect(htmlSinks(source)).toContain('5:write');
  });

  it('reads a writer declared with an unqualified type name', () => {
    // The other arm of the simple-name rule: `new FileWriter(...)` with no package prefix. Both spellings declare the
    // same type, and the filter has to recognise both.
    const source = `
class T {
  void f(String param) throws Exception {
    FileWriter fw = new FileWriter("/tmp/out.txt");
    fw.write(param);
  }
}`;
    expect(htmlSinks(source)).toEqual([]);
  });
});
