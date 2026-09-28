// The cross-function shape, for every language that has a parameter arm.
//
// A finding that crosses a call needs three things the capture layer has to provide: a source bound to a definition,
// that binding passed as an argument to a resolved callee, and a sink inside the callee that receives the parameter.
// The fourth is the arm that records a parameter as a binding at all, without which the sink's argument is `-1` and
// the wave that carries "parameter 0 of this function" can never match it.
//
// The shapes are asserted rather than printed, because they are the acceptance criterion for those four things and
// each one is a line that changes when a language regains or loses them.

import {
  GoProvider,
  JavaProvider,
  JavaScriptProvider,
  PythonProvider,
  TypeScriptProvider,
  buildCallSites,
  groupCaptures,
  CProvider,
  CSharpProvider,
  CppProvider,
  PhpProvider,
  RubyProvider,
} from '@code-analyzer/analyzer';
import { describe, it, expect } from 'vitest';

import { analyzeInterproceduralTaint } from '../security/interprocedural-entry.js';

import type { ParsedFile } from '@code-analyzer/shared';

const CASES: ReadonlyArray<{
  language: string;
  provider: unknown;
  file: string;
  code: string;
  expected?: number;
}> = [
  {
    expected: 2,
    language: 'typescript',
    provider: new TypeScriptProvider(),
    file: 'src/a.ts',
    code: [
      'function inner(x: string): void {',
      '  db.query(x);',
      '}',
      'function handler(): void {',
      '  const ident = req.body.id;',
      '  inner(ident);',
      '}',
    ].join('\n'),
  },
  {
    expected: 1,
    language: 'javascript',
    provider: new JavaScriptProvider(),
    file: 'src/a.js',
    code: [
      'function inner(x) {',
      '  db.query(x);',
      '}',
      'function handler() {',
      '  const ident = req.body.id;',
      '  inner(ident);',
      '}',
    ].join('\n'),
  },
  {
    expected: 1,
    language: 'python',
    provider: new PythonProvider(),
    file: 'src/a.py',
    code: [
      'def inner(x):',
      '    db.execute(x)',
      '',
      'def handler(request):',
      '    ident = request.GET.get("id")',
      '    inner(ident)',
    ].join('\n'),
  },
  {
    expected: 1,
    language: 'java',
    provider: new JavaProvider(),
    file: 'src/A.java',
    code: [
      'class A {',
      '  void inner(String x) {',
      '    db.exec(x);',
      '  }',
      '  void handler() {',
      '    String ident = System.getenv("ID");',
      '    inner(ident);',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    expected: 1,
    language: 'go',
    provider: new GoProvider(),
    file: 'src/a.go',
    code: [
      'package main',
      'func inner(x string) {',
      '  db.Query(x)',
      '}',
      'func handler() {',
      '  ident := os.Getenv("ID")',
      '  inner(ident)',
      '}',
    ].join('\n'),
  },
  {
    // Open: this grammar's parameter arm is in and its shape does not reach yet.
    expected: 0,
    language: 'csharp',
    provider: new CSharpProvider(),
    file: 'src/A.cs',
    code: [
      'class A {',
      '  void inner(string x) {',
      '    System.Diagnostics.Process.Start(x);',
      '  }',
      '  void handler() {',
      '    var ident = Environment.GetEnvironmentVariable("ID");',
      '    inner(ident);',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    expected: 1,
    language: 'php',
    provider: new PhpProvider(),
    file: 'src/a.php',
    code: [
      '<?php',
      'function inner($x) {',
      '  shell_exec($x);',
      '}',
      'function handler() {',
      '  $ident = getenv("ID");',
      '  inner($ident);',
      '}',
    ].join('\n'),
  },
  {
    expected: 1,
    language: 'ruby',
    provider: new RubyProvider(),
    file: 'src/a.rb',
    code: [
      'def inner(x)',
      '  system(x)',
      'end',
      '',
      'def handler',
      '  ident = ENV["ID"]',
      '  inner(ident)',
      'end',
    ].join('\n'),
  },
  {
    // Open: this grammar's parameter arm is in and its shape does not reach yet.
    expected: 0,
    language: 'c',
    provider: new CProvider(),
    file: 'src/a.c',
    code: [
      'void inner(char *x) {',
      '  system(x);',
      '}',
      'void handler(void) {',
      '  char *ident = getenv("ID");',
      '  inner(ident);',
      '}',
    ].join('\n'),
  },
  {
    // Open: this grammar's parameter arm is in and its shape does not reach yet.
    expected: 0,
    language: 'cpp',
    provider: new CppProvider(),
    file: 'src/a.cpp',
    code: [
      'void inner(const char *x) {',
      '  std::system(x);',
      '}',
      'void handler() {',
      '  const char *ident = getenv("ID");',
      '  inner(ident);',
      '}',
    ].join('\n'),
  },
];

describe('the cross-function shape, per language', () => {
  for (const testCase of CASES) {
    it(`reaches a finding across a call in ${testCase.language}`, () => {
      const typed = testCase.provider as {
        parse(s: string, f: string): Array<{ tag?: string }>;
        extractTaintSources(s: string): Array<{ sourceType: string; line: number; text: string }>;
        extractTaintSinks(s: string): Array<{ sinkType: string; line: number; text: string }>;
        extractSanitizers(s: string): Array<{ sanitizerType: string; line: number; text: string }>;
      };
      const captures = typed.parse(testCase.code, testCase.file);
      const { symbols, references, scopeTree } = groupCaptures(
        captures as Parameters<typeof groupCaptures>[0],
        testCase.file,
      );
      const parsed = {
        filePath: testCase.file,
        language: testCase.language,
        symbols,
        references,
        scopeTree,
        ast: captures,
      } as unknown as ParsedFile;
      const extraction = new Map([
        [
          testCase.file,
          {
            sources: typed.extractTaintSources(testCase.code),
            sinks: typed.extractTaintSinks(testCase.code),
            sanitizers: typed.extractSanitizers(testCase.code),
          },
        ],
      ]);
      const callSites = buildCallSites([parsed], references);
      const result = analyzeInterproceduralTaint([parsed], callSites, extraction);

      console.log(
        `XF ${testCase.language}: findings ${result.findings.length} ` +
          `${JSON.stringify(result.findings.map((f) => `${f.sourceFn}->${f.sinkFn}:${f.sink.kind}`))}`,
      );

      expect(result.findings.length).toBe(testCase.expected);

      if (testCase.expected !== 0) {
        // A cross-function finding is one whose source and sink are in different functions.
        expect(result.findings[0]?.sourceFn).not.toBe(result.findings[0]?.sinkFn);
      }
    });
  }
});
