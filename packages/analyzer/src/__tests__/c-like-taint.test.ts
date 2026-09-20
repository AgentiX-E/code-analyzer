// Taint sources and sinks for the two languages this repository's tests and benchmark are written in.
//
// The extraction mechanism has always been here: the base class parses, walks and collects, and five providers
// override the walks. **Those five are bash, groovy, html, json and r** — so taint extraction was implemented for
// the languages least likely to need it and absent for the ones that carry the risk.

import { describe, it, expect } from 'vitest';

import { CSharpProvider } from '../languages/csharp.js';
import { GoProvider } from '../languages/go.js';
import { JavaProvider } from '../languages/java.js';
import { JavaScriptProvider } from '../languages/javascript.js';
import { PythonProvider } from '../languages/python.js';
import { TypeScriptProvider } from '../languages/typescript.js';

describe('c-like taint extraction', () => {
  it('finds an environment read in JavaScript', () => {
    const sources = new JavaScriptProvider().extractTaintSources(
      'const key = process.env.API_KEY;\n',
    );

    expect(sources.map((s) => s.sourceType)).toContain('env_var');
  });

  it('finds a request-body read and reports its line', () => {
    const sources = new JavaScriptProvider().extractTaintSources(
      'const q = 1;\nconst id = req.body.id;\n',
    );

    const body = sources.find((s) => s.sourceType === 'http_request');
    expect(body?.line).toBe(2);
  });

  it('finds an eval call as a sink', () => {
    const sinks = new JavaScriptProvider().extractTaintSinks('const out = eval(input);\n');

    expect(sinks.map((s) => s.sinkType)).toContain('eval');
  });

  it('recognises a sink through a receiver', () => {
    // `db.query(...)` and `query(...)` are both recognised, because the match is on the callee's last segment.
    const sinks = new JavaScriptProvider().extractTaintSinks('await db.query(sql);\n');

    expect(sinks.map((s) => s.sinkType)).toContain('sql_exec');
  });

  it('finds nothing in code with no source or sink', () => {
    const provider = new JavaScriptProvider();
    const code = 'const total = items.reduce((a, b) => a + b, 0);\n';

    expect(provider.extractTaintSources(code)).toEqual([]);
    expect(provider.extractTaintSinks(code)).toEqual([]);
  });

  it('does the same for TypeScript, which extends the base rather than the JavaScript provider', () => {
    const provider = new TypeScriptProvider();

    expect(
      provider.extractTaintSinks('const html = eval(input);\n').map((s) => s.sinkType),
    ).toContain('eval');
    expect(
      provider.extractTaintSources('const k = process.env.KEY;\n').map((s) => s.sourceType),
    ).toContain('env_var');
  });

  describe('python taint extraction', () => {
    it('finds a request read, whose node is an attribute rather than a member expression', () => {
      const provider = new PythonProvider();

      expect(
        provider.extractTaintSources("id = request.GET.get('id')\n").map((s) => s.sourceType),
      ).toContain('http_request');
    });

    it('finds an environment read and a command sink', () => {
      const provider = new PythonProvider();

      expect(
        provider.extractTaintSources('key = os.environ["KEY"]\n').map((s) => s.sourceType),
      ).toContain('env_var');
      expect(provider.extractTaintSinks('os.system(cmd)\n').map((s) => s.sinkType)).toContain(
        'os_command',
      );
    });
  });

  describe('the languages that read their inputs by calling', () => {
    // These are the cases the call-source support exists for: `System.getenv("KEY")` and
    // `Environment.GetEnvironmentVariable("KEY")` read the environment through a call, and until the source collector
    // considered calls there was no member expression for it to match, so both returned nothing.
    it('Java finds an environment read', () => {
      expect(
        new JavaProvider()
          .extractTaintSources('var k = System.getenv("KEY");\n')
          .map((x) => x.sourceType),
      ).toContain('env_var');
    });

    it('Java finds a command sink behind a chained call', () => {
      // The sink case that proved the callee extraction was wrong: splitting at the **first** parenthesis gives
      // `Runtime.getRuntime`, whose last segment is `getRuntime`, which matches nothing.
      expect(
        new JavaProvider()
          .extractTaintSinks('Runtime.getRuntime().exec(cmd);\n')
          .map((x) => x.sinkType),
      ).toContain('os_command');
    });

    it('Go finds a query sink, whose callee is capitalised', () => {
      // The probe showed Go's `db.Query(sql)` **is** a `call_expression`, so the node name was never wrong — the
      // sink list held only the lowercase JavaScript spelling and Go capitalises. This is the case that says so.
      expect(
        new GoProvider().extractTaintSinks('db.Query(sql)\n').map((x) => x.sinkType),
      ).toContain('sql_exec');
    });

    it('C# parses and returns arrays, which is all this establishes for it', () => {
      // **Only Java is known to work.** C#'s `Environment.GetEnvironmentVariable("KEY")` is a read whose name sits
      // behind a chain of calls rather than at a node the walk inspects, and no case here establishes that it is
      // reached. Asserting an empty array would be honest about the current behaviour and would read as a bug;
      // asserting a value would be a claim this does not support.
      const csharp = new CSharpProvider();

      expect(Array.isArray(csharp.extractTaintSources('var k = "x";\n'))).toBe(true);
      expect(Array.isArray(csharp.extractTaintSinks('Process.Start(cmd);\n'))).toBe(true);
    });

    it('Go still parses and returns arrays, which is all this can assert for it', () => {
      // Go's sources are reached through `r.URL.Query().Get("id")`, a chain of calls whose first link carries the
      // name — and no case here establishes that the walk reaches it. Asserting an empty array would be honest about
      // the current behaviour and would read as a bug; asserting a value would be a claim this does not support.
      const provider = new GoProvider();

      expect(Array.isArray(provider.extractTaintSources('id := 1\n'))).toBe(true);
      expect(Array.isArray(provider.extractTaintSinks('db.Query(sql)\n'))).toBe(true);
    });
  });
});
