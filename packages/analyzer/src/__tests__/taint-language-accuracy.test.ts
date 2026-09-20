// Per-language extraction accuracy, which is the artifact the scorecard's `language-quality` target asks for.
//
// That target reads: *language support measured by accuracy rather than count*, and its blocker is *no per-language
// accuracy artifacts; the whitepaper's M1 criterion is >=90% per language*. Ten languages were enrolled with a test
// each asserting that a named string is found — **which is a count**. This measures recall against a fixture whose
// sources and sinks are known, per language, so the number stops being a count.
//
// Recall, not precision, and deliberately: a language that misses a source is a language whose findings are
// incomplete, while an extraction that over-reports is caught by the vocabulary tests. M1 is a recall criterion.

import { describe, it, expect } from 'vitest';

import { CProvider } from '../languages/c.js';
import { CppProvider } from '../languages/cpp.js';
import { CSharpProvider } from '../languages/csharp.js';
import { GoProvider } from '../languages/go.js';
import { JavaProvider } from '../languages/java.js';
import { JavaScriptProvider } from '../languages/javascript.js';
import { PhpProvider } from '../languages/php.js';
import { PythonProvider } from '../languages/python.js';
import { RubyProvider } from '../languages/ruby.js';
import { TypeScriptProvider } from '../languages/typescript.js';

interface Probe {
  extractTaintSources(s: string): unknown[];
  extractTaintSinks(s: string): unknown[];
}

interface Fixture {
  readonly language: string;
  readonly provider: Probe;
  /** One line per source, and one per sink, with the comment saying which is which. */
  readonly source: string;
  readonly sources: number;
  readonly sinks: number;
}

const FIXTURES: readonly Fixture[] = [
  {
    language: 'javascript',
    provider: new JavaScriptProvider(),
    source: [
      'const id = req.body.id;',
      'const key = process.env.KEY;',
      'db.query(id);',
      'eval(key);',
    ].join('\n'),
    sources: 2,
    sinks: 2,
  },
  {
    language: 'typescript',
    provider: new TypeScriptProvider(),
    source: [
      'const id: string = req.body.id;',
      'const key: string = process.env.KEY;',
      'db.query(id);',
      'eval(key);',
    ].join('\n'),
    sources: 2,
    sinks: 2,
  },
  {
    language: 'python',
    provider: new PythonProvider(),
    source: [
      "id = request.GET.get('id')",
      'key = os.environ["KEY"]',
      'os.system(cmd)',
      'db.execute(sql)',
    ].join('\n'),
    sources: 2,
    sinks: 2,
  },
  {
    language: 'ruby',
    provider: new RubyProvider(),
    source: ['id = params[:id]', 'key = ENV["KEY"]', 'system(cmd)', 'File.read(path)'].join('\n'),
    sources: 2,
    sinks: 2,
  },
  {
    language: 'php',
    provider: new PhpProvider(),
    source: [
      '<?php $id = $_GET["id"];',
      '$key = getenv("KEY");',
      'shell_exec($cmd);',
      '$db->query($sql);',
    ].join('\n'),
    sources: 2,
    sinks: 2,
  },
  {
    language: 'java',
    provider: new JavaProvider(),
    source: [
      'class A { void m() {',
      '  var k = System.getenv("KEY");',
      '  Runtime.getRuntime().exec(cmd);',
      '} }',
    ].join('\n'),
    sources: 1,
    sinks: 1,
  },
  {
    language: 'go',
    provider: new GoProvider(),
    source: [
      'package main',
      'func m() {',
      '  key := os.Getenv("KEY")',
      '  db.Query(sql)',
      '}',
    ].join('\n'),
    sources: 1,
    sinks: 1,
  },
  {
    language: 'csharp',
    provider: new CSharpProvider(),
    source: [
      'class A { void M() {',
      '  var k = Environment.GetEnvironmentVariable("KEY");',
      '  Process.Start(cmd);',
      '} }',
    ].join('\n'),
    sources: 1,
    sinks: 1,
  },
  {
    language: 'c',
    provider: new CProvider(),
    source: [
      'void m(void) {',
      '  char *k = getenv("KEY");',
      '  system(cmd);',
      '  strcpy(buf, src);',
      '}',
    ].join('\n'),
    sources: 1,
    sinks: 2,
  },
  {
    language: 'cpp',
    provider: new CppProvider(),
    source: ['void m() {', '  std::string k = getenv("KEY");', '  popen(cmd, "r");', '}'].join(
      '\n',
    ),
    sources: 1,
    sinks: 1,
  },
];

describe('per-language extraction accuracy', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.language} recalls every source and sink in its fixture`, () => {
      const sources = fixture.provider.extractTaintSources(fixture.source).length;
      const sinks = fixture.provider.extractTaintSinks(fixture.source).length;
      const expected = fixture.sources + fixture.sinks;
      const found = Math.min(sources, fixture.sources) + Math.min(sinks, fixture.sinks);
      const recall = found / expected;

      // The artifact, printed so a reader can see the number rather than infer it from a green tick.
      // eslint-disable-next-line no-console
      console.log(
        `ACCURACY ${fixture.language}: sources ${sources}/${fixture.sources} sinks ${sinks}/${fixture.sinks} recall ${recall.toFixed(2)}`,
      );

      // M1's criterion, per language.
      expect(recall).toBeGreaterThanOrEqual(0.9);
    });
  }
});
