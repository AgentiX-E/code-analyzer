// Per-language extraction accuracy — recall AND precision, which is the artifact `language-quality` asks for.
//
// The scorecard's target is *language support measured by accuracy rather than count*, blocked by *no per-language
// accuracy artifacts; the whitepaper's M1 criterion is >=90% per language*. The first version measured recall only
// and reported 1.00 for all ten languages **while every one of them over-reported**. Recall alone cannot see that.
//
// Matching is by the name's **last segment**: the extraction reports the expression as written (`req.body.id`,
// `db.query`) because that is what it can prove, and the vocabulary matches on the term inside it. Scoring by
// equality marked every one of those a miss. Counting is over **sets**, not occurrences: the first run printed
// `recall 1.50`, which is impossible, because one language captured the same expression twice. Duplicates are
// reported as their own fact rather than folded in.

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
  extractTaintSources(s: string): Array<{ name: string }>;
  extractTaintSinks(s: string): Array<{ name: string }>;
}

interface Fixture {
  readonly language: string;
  readonly provider: Probe;
  /** Real code, with ordinary variables and unrelated calls as decoys. */
  readonly source: string;
  /** The vocabulary terms genuinely present, by the name the extraction would report. */
  readonly sources: readonly string[];
  readonly sinks: readonly string[];
}

interface Scored {
  recall: number;
  precision: number;
  extra: readonly string[];
  duplicated: readonly string[];
}

/** The last segment of a name, splitting on `.` and on `->` as the sink matcher does. */
function lastSegment(name: string): string {
  return (
    name
      .split(/[.\-]>?|(?<![.\-])[.]/)
      .filter(Boolean)
      .pop() ?? name
  );
}

function score(found: readonly string[], expected: readonly string[]): Scored {
  const unique = [...new Set(found)];
  const duplicated = unique.filter((name) => found.filter((other) => other === name).length > 1);
  const isHit = (name: string): boolean =>
    expected.some(
      (term) =>
        name === term || lastSegment(name) === term || lastSegment(name) === lastSegment(term),
    );
  const hit = unique.filter(isHit);
  return {
    recall: expected.length === 0 ? 1 : Math.min(1, hit.length / expected.length),
    precision: unique.length === 0 ? 1 : hit.length / unique.length,
    extra: unique.filter((name) => !isHit(name)),
    duplicated,
  };
}

const FIXTURES: readonly Fixture[] = [
  {
    language: 'javascript',
    provider: new JavaScriptProvider(),
    source: [
      'const total = 0;',
      'const items = [1, 2];',
      'const id = req.body.id;',
      'const key = process.env.KEY;',
      'items.reduce((a, b) => a + b, 0);',
      'db.query(id);',
      'eval(key);',
    ].join('\n'),
    sources: ['req.body.id', 'process.env.KEY'],
    sinks: ['db.query', 'eval'],
  },
  {
    language: 'typescript',
    provider: new TypeScriptProvider(),
    source: [
      'const total: number = 0;',
      'const id: string = req.body.id;',
      'const key: string = process.env.KEY;',
      'db.query(id);',
      'eval(key);',
    ].join('\n'),
    sources: ['req.body.id', 'process.env.KEY'],
    sinks: ['db.query', 'eval'],
  },
  {
    language: 'python',
    provider: new PythonProvider(),
    source: [
      'total = 0',
      "id = request.GET.get('id')",
      'key = os.environ["KEY"]',
      'items = sorted(items)',
      'os.system(cmd)',
      'db.execute(sql)',
    ].join('\n'),
    sources: ['request.GET.get', 'os.environ'],
    sinks: ['os.system', 'db.execute'],
  },
  {
    language: 'ruby',
    provider: new RubyProvider(),
    source: [
      'total = 0',
      'id = params[:id]',
      'key = ENV["KEY"]',
      'items.map { |x| x }',
      'system(cmd)',
      'File.read(path)',
    ].join('\n'),
    sources: ['params', 'ENV'],
    sinks: ['system', 'File.read'],
  },
  {
    language: 'php',
    provider: new PhpProvider(),
    source: [
      '<?php',
      '$total = 0;',
      '$id = $_GET["id"];',
      '$key = getenv("KEY");',
      'sort($items);',
      'shell_exec($cmd);',
      '$db->query($sql);',
    ].join('\n'),
    sources: ['$_GET', 'getenv'],
    sinks: ['shell_exec', '$db->query'],
  },
  {
    language: 'java',
    provider: new JavaProvider(),
    source: [
      'class A { void m() {',
      '  int total = 0;',
      '  var k = System.getenv("KEY");',
      '  list.size();',
      '  Runtime.getRuntime().exec(cmd);',
      '} }',
    ].join('\n'),
    sources: ['System.getenv'],
    sinks: ['Runtime.getRuntime().exec'],
  },
  {
    language: 'go',
    provider: new GoProvider(),
    source: [
      'package main',
      'func m() {',
      '  total := 0',
      '  key := os.Getenv("KEY")',
      '  list := make([]int, 0)',
      '  db.Query(sql)',
      '}',
    ].join('\n'),
    sources: ['os.Getenv'],
    sinks: ['db.Query'],
  },
  {
    language: 'csharp',
    provider: new CSharpProvider(),
    source: [
      'class A { void M() {',
      '  int total = 0;',
      '  var k = Environment.GetEnvironmentVariable("KEY");',
      '  list.Clear();',
      '  Process.Start(cmd);',
      '} }',
    ].join('\n'),
    sources: ['Environment.GetEnvironmentVariable'],
    sinks: ['Process.Start'],
  },
  {
    language: 'c',
    provider: new CProvider(),
    source: [
      'void m(void) {',
      '  int total = 0;',
      '  char *k = getenv("KEY");',
      '  printf("%d", total);',
      '  system(cmd);',
      '  strcpy(buf, src);',
      '}',
    ].join('\n'),
    sources: ['getenv'],
    sinks: ['system', 'strcpy'],
  },
  {
    language: 'cpp',
    provider: new CppProvider(),
    source: [
      'void m() {',
      '  int total = 0;',
      '  std::string k = getenv("KEY");',
      '  vec.push_back(total);',
      '  popen(cmd, "r");',
      '}',
    ].join('\n'),
    sources: ['getenv'],
    sinks: ['popen'],
  },
];

describe('per-language extraction accuracy', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.language} measures recall and precision against its fixture`, () => {
      const raisedSources = fixture.provider.extractTaintSources(fixture.source).map((x) => x.name);
      const raisedSinks = fixture.provider.extractTaintSinks(fixture.source).map((x) => x.name);
      const s = score(raisedSources, fixture.sources);
      const k = score(raisedSinks, fixture.sinks);

      const expected = fixture.sources.length + fixture.sinks.length;
      const unique = new Set(raisedSources).size + new Set(raisedSinks).size;
      const hits = s.recall * fixture.sources.length + k.recall * fixture.sinks.length;
      const recall = Math.min(1, hits / expected);
      const precision = unique === 0 ? 1 : hits / unique;
      const extras = [...s.extra, ...k.extra];
      const duplicated = [...s.duplicated, ...k.duplicated];

      // The artifact, printed so a reader sees the numbers rather than a green tick.
      // eslint-disable-next-line no-console
      console.log(
        `ACCURACY ${fixture.language}: recall ${recall.toFixed(2)} precision ${precision.toFixed(2)}` +
          ` (expected ${expected}, raised ${raisedSources.length + raisedSinks.length}, unique ${unique}` +
          `, extra ${JSON.stringify(extras)}, duplicated ${JSON.stringify(duplicated)})`,
      );

      // M1 is a recall floor. Precision is reported, not asserted: a threshold set before the numbers exist would be
      // a number invented to pass.
      expect(recall).toBeGreaterThanOrEqual(0.9);
    });
  }

  /**
   * Decoy-only samples: the vocabulary's terms appear, but never as an expression that reads or writes anything.
   *
   * A term inside a **string literal** is a `string` node and a term inside a **comment** is a `comment` node, so
   * neither should reach the matcher — but a walk that matched on the *file's* text rather than on nodes would find
   * both. This is the precision question the positive fixtures cannot ask: they check that the right things are found,
   * and this checks that nothing else is.
   */
  const DECOYS: ReadonlyArray<{ language: string; provider: Probe; source: string }> = [
    {
      language: 'javascript',
      provider: new JavaScriptProvider(),
      source: [
        'const query = "db.query(id)";',
        '// eval(key) is dangerous',
        'items.map((x) => x);',
      ].join('\n'),
    },
    {
      language: 'typescript',
      provider: new TypeScriptProvider(),
      source: [
        'const sql: string = "query(sql)";',
        '// process.env is read elsewhere',
        'items.map((x) => x);',
      ].join('\n'),
    },
    {
      language: 'python',
      provider: new PythonProvider(),
      source: ['sql = "os.system(cmd)"', '# request.GET is the read', 'items = sorted(items)'].join(
        '\n',
      ),
    },
    {
      language: 'ruby',
      provider: new RubyProvider(),
      source: ['sql = "system(cmd)"', '# params is the read', 'items.map { |x| x }'].join('\n'),
    },
    {
      language: 'php',
      provider: new PhpProvider(),
      source: ['<?php', '$sql = "shell_exec(cmd)";', '// $_GET is the read', 'sort($items);'].join(
        '\n',
      ),
    },
    {
      language: 'java',
      provider: new JavaProvider(),
      source: ['class A { void m() {', '  String sql = "exec(cmd)";', '  list.size();', '} }'].join(
        '\n',
      ),
    },
    {
      language: 'go',
      provider: new GoProvider(),
      source: [
        'package main',
        'func m() {',
        '  sql := "db.Query(x)"',
        '  list := make([]int, 0)',
        '}',
      ].join('\n'),
    },
    {
      language: 'csharp',
      provider: new CSharpProvider(),
      source: [
        'class A { void M() {',
        '  var sql = "Process.Start(x)";',
        '  list.Clear();',
        '} }',
      ].join('\n'),
    },
    {
      language: 'c',
      provider: new CProvider(),
      source: ['void m(void) {', '  char *sql = "system(cmd)";', '  printf("%s", sql);', '}'].join(
        '\n',
      ),
    },
    {
      language: 'cpp',
      provider: new CppProvider(),
      source: ['void m() {', '  std::string sql = "popen(cmd)";', '  vec.push_back(0);', '}'].join(
        '\n',
      ),
    },
  ];

  describe('per-language extraction precision on decoys', () => {
    for (const decoy of DECOYS) {
      it(`${decoy.language} finds nothing in a sample where the terms only appear as text`, () => {
        const sources = decoy.provider.extractTaintSources(decoy.source);
        const sinks = decoy.provider.extractTaintSinks(decoy.source);

        // eslint-disable-next-line no-console
        console.log(
          `DECOYS ${decoy.language}: sources ${JSON.stringify(sources.map((x) => x.name))} sinks ${JSON.stringify(sinks.map((x) => x.name))}`,
        );

        expect(sources).toHaveLength(0);
        expect(sinks).toHaveLength(0);
      });
    }
  });
});
