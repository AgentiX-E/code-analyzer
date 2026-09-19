// Taint sources and sinks for the two languages this repository's tests and benchmark are written in.
//
// The extraction mechanism has always been here: the base class parses, walks and collects, and five providers
// override the walks. **Those five are bash, groovy, html, json and r** — so taint extraction was implemented for
// the languages least likely to need it and absent for the ones that carry the risk.

import { describe, it, expect } from 'vitest';

import { JavaScriptProvider } from '../languages/javascript.js';

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
});
