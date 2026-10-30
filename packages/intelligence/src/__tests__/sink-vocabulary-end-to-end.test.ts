// **A sink the vocabulary does not name is a vulnerability the engine cannot find**, whatever the analysis does with it.
//
// Two families of names were missing from the Java sink list, and both were measured on the corpus before they were
// added: `PrintWriter.printf(format, args)` writes its format string into the response body exactly as `print` does,
// and Spring's `JdbcTemplate` answers the SQL question through `queryForRowSet`, `queryForList`, `queryForMap`,
// `queryForObject`, `queryForLong` and `batchUpdate` rather than through JDBC's `executeQuery`. The two together were
// 105 of the corpus's 208 silent vulnerable cases.
//
// Routed through `JavaProvider` and the real taint entry point, because the fact being tested is whether a name in a
// file becomes a finding.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ExtractedFileFacts } from '../cfg/from-parsed-files.js';
import type { ParsedFile } from '@code-analyzer/shared';

const provider = new JavaProvider();

/** Analyze one file the way the benchmark does and report how many live flows it found. */
function liveFlows(body: readonly string[]): number {
  const source = [
    'import javax.servlet.http.HttpServletRequest;',
    'import javax.servlet.http.HttpServletResponse;',
    'public class T extends HttpServlet {',
    '  public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {',
    ...body.map((line) => `    ${line}`),
    '  }',
    '}',
  ].join('\n');

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
    scopeRegions: provider.extractScopeRegions(source),
  };

  const result = analyzeInterproceduralTaint(
    [parsed],
    buildCallSites([parsed], grouped.references),
    new Map([[file, facts]]),
  );
  return result.findings.filter((finding) => !finding.sanitized).length;
}

describe('a sink written with `printf`', () => {
  it('carries the value into the response body', () => {
    // The corpus's `xss` shape for 51 of its cases: `printf` takes the format string first, and a tainted format
    // string is written into the page exactly as `println` would write it.
    expect(
      liveFlows([
        'String param = request.getParameter("p");',
        'Object[] obj = {"a", "b"};',
        'response.getWriter().printf(param, obj);',
      ]),
    ).toBeGreaterThan(0);
  });

  it('stays quiet when the format string is a constant', () => {
    // The pair, and the reason the first answer is about the flow rather than about the word: the same call with a
    // literal in the format position has nothing to report, and a vocabulary entry that reported it would be noise.
    expect(
      liveFlows([
        'String param = request.getParameter("p");',
        'Object[] obj = {"a", "b"};',
        'String bar = "constant";',
        'response.getWriter().printf(bar, obj);',
      ]),
    ).toBe(0);
  });
});

describe('a sink written with Spring`s JdbcTemplate', () => {
  it('reports a concatenated query handed to `queryForRowSet`', () => {
    // The corpus's `sqli` shape for 22 of its cases. `executeQuery` was the only name the list knew, and a Spring
    // application does not call it.
    expect(
      liveFlows([
        'String param = request.getParameter("p");',
        'String sql = "SELECT * from USERS where PASSWORD=\'" + param + "\'";',
        'org.springframework.jdbc.support.rowset.SqlRowSet results =',
        '    org.owasp.benchmark.helpers.DatabaseHelper.JDBCtemplate.queryForRowSet(sql);',
        'response.getWriter().println("Your results are: ");',
      ]),
    ).toBeGreaterThan(0);
  });

  it('reports `queryForList` and `batchUpdate` for the same reason', () => {
    // Two more spellings of the same call, because a list that named one of them would have been a list of one
    // project's habits rather than of the framework's surface.
    for (const call of ['queryForList', 'queryForMap', 'batchUpdate']) {
      expect(
        liveFlows([
          'String param = request.getParameter("p");',
          'String sql = "SELECT * from USERS where PASSWORD=\'" + param + "\'";',
          `org.owasp.benchmark.helpers.DatabaseHelper.JDBCtemplate.${call}(sql);`,
        ]),
      ).toBeGreaterThan(0);
    }
  });

  it('stays quiet when the query is a constant', () => {
    expect(
      liveFlows([
        'String sql = "SELECT * from USERS";',
        'org.owasp.benchmark.helpers.DatabaseHelper.JDBCtemplate.queryForRowSet(sql);',
      ]),
    ).toBe(0);
  });
});
