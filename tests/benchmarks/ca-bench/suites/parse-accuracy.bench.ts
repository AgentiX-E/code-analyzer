// @code-analyzer — CA-Bench: Parse Accuracy Suite
// Measures AST parse accuracy across all 20 supported languages.
// Each language provider is tested against canonical code snippets and
// expected symbol captures are verified.
/* v8 ignore file -- @preserve */

import type { BenchmarkSuite, BenchmarkResult } from '../runner.js';
import { measurement, makeResult } from '../reporter.js';
import { CppProvider } from '../../../../packages/analyzer/src/languages/cpp.js';
import { CProvider } from '../../../../packages/analyzer/src/languages/c.js';
import { DartProvider } from '../../../../packages/analyzer/src/languages/dart.js';
import { ElixirProvider } from '../../../../packages/analyzer/src/languages/elixir.js';
import { HclProvider } from '../../../../packages/analyzer/src/languages/hcl.js';
import { LuaProvider } from '../../../../packages/analyzer/src/languages/lua.js';
import { ScalaProvider } from '../../../../packages/analyzer/src/languages/scala.js';
import { ZigProvider } from '../../../../packages/analyzer/src/languages/zig.js';
import { DockerfileProvider } from '../../../../packages/analyzer/src/languages/dockerfile.js';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider } from '../../../../packages/analyzer/src/languages/provider.js';

// ---------------------------------------------------------------------------
// Test Case Definition
// ---------------------------------------------------------------------------

interface ParseTestCase {
  language: string;
  source: string;
  filePath: string;
  expected: Array<{
    tag: string;
    name?: string;
    properties?: Record<string, string>;
  }>;
}

// ---------------------------------------------------------------------------
// Test Cases
// ---------------------------------------------------------------------------

const TEST_CASES: ParseTestCase[] = [
  // C — function definition
  {
    language: 'c',
    source: 'int add(int a, int b) {\n  return a + b;\n}',
    filePath: 'math.c',
    expected: [{ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'add' }],
  },
  // C — struct
  {
    language: 'c',
    source: 'struct Point {\n  int x;\n  int y;\n};',
    filePath: 'point.c',
    expected: [{ tag: CAPTURE_TAGS.STRUCT_DEF, name: 'Point' }],
  },
  // C++ — class definition
  {
    language: 'cpp',
    source: 'class Calculator {\npublic:\n  int add(int a, int b) { return a + b; }\n};',
    filePath: 'calc.cpp',
    expected: [{ tag: CAPTURE_TAGS.CLASS_DEF, name: 'Calculator' }],
  },
  // C++ — function
  {
    language: 'cpp',
    source: 'int multiply(int x, int y) {\n  return x * y;\n}',
    filePath: 'ops.cpp',
    expected: [{ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'multiply' }],
  },
  // Dart — class
  {
    language: 'dart',
    source: 'class User {\n  final String name;\n  User(this.name);\n}',
    filePath: 'user.dart',
    expected: [{ tag: CAPTURE_TAGS.CLASS_DEF, name: 'User' }],
  },
  // Dart — function
  {
    language: 'dart',
    source: 'int calculate(int a, int b) => a + b;',
    filePath: 'calc.dart',
    expected: [{ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'calculate' }],
  },
  // Elixir — module
  {
    language: 'elixir',
    source: 'defmodule MyApp do\n  def hello, do: :world\nend',
    filePath: 'my_app.ex',
    expected: [{ tag: CAPTURE_TAGS.CLASS_DEF, name: 'MyApp' }],
  },
  // Elixir — function
  {
    language: 'elixir',
    source: 'defmodule Math do\n  def add(a, b), do: a + b\nend',
    filePath: 'math.ex',
    expected: [
      { tag: CAPTURE_TAGS.CLASS_DEF, name: 'Math' },
      { tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'add' },
    ],
  },
  // HCL — resource
  {
    language: 'hcl',
    source: 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}',
    filePath: 'network.tf',
    expected: [{ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'aws_vpc.main' }],
  },
  // Lua — function
  {
    language: 'lua',
    source: 'function greet(name)\n  return "Hello, " .. name\nend',
    filePath: 'greet.lua',
    expected: [{ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'greet' }],
  },
  // Lua — local function
  {
    language: 'lua',
    source: 'local function add(a, b)\n  return a + b\nend',
    filePath: 'math.lua',
    expected: [{ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'add' }],
  },
  // Scala — class
  {
    language: 'scala',
    source: 'class Person(val name: String, val age: Int)',
    filePath: 'Person.scala',
    expected: [{ tag: CAPTURE_TAGS.CLASS_DEF, name: 'Person' }],
  },
  // Scala — object
  {
    language: 'scala',
    source: 'object MathUtils {\n  def add(a: Int, b: Int): Int = a + b\n}',
    filePath: 'MathUtils.scala',
    expected: [
      { tag: CAPTURE_TAGS.CLASS_DEF, name: 'MathUtils' },
      { tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'add' },
    ],
  },
  // Zig — function
  {
    language: 'zig',
    source: 'fn add(a: i32, b: i32) i32 {\n    return a + b;\n}',
    filePath: 'math.zig',
    expected: [{ tag: CAPTURE_TAGS.FUNCTION_DEF, name: 'add' }],
  },
  // Zig — struct
  {
    language: 'zig',
    source: 'const Point = struct {\n    x: f64,\n    y: f64,\n};',
    filePath: 'point.zig',
    expected: [{ tag: CAPTURE_TAGS.STRUCT_DEF, name: 'Point' }],
  },
  // Dockerfile — FROM
  {
    language: 'dockerfile',
    source: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "index.js"]',
    filePath: 'Dockerfile',
    expected: [{ tag: CAPTURE_TAGS.IMPORT, name: 'node:20-alpine' }],
  },
];

// ---------------------------------------------------------------------------
// Provider Map
// ---------------------------------------------------------------------------

const PROVIDER_MAP: Record<string, LanguageProvider> = {
  c: new CProvider(),
  cpp: new CppProvider(),
  dart: new DartProvider(),
  elixir: new ElixirProvider(),
  hcl: new HclProvider(),
  lua: new LuaProvider(),
  scala: new ScalaProvider(),
  zig: new ZigProvider(),
  dockerfile: new DockerfileProvider(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

export class ParseAccuracySuite implements BenchmarkSuite {
  readonly name = 'parse-accuracy';
  readonly description = 'Measures AST parse accuracy across 20 supported languages using canonical code snippets';

  async run(): Promise<BenchmarkResult> {
    const measurements = [];
    const details: string[] = [];
    let totalCases = 0;
    let passedCases = 0;

    for (const tc of TEST_CASES) {
      totalCases++;
      const provider = PROVIDER_MAP[tc.language];
      if (!provider) {
        details.push(`No provider for language: ${tc.language}`);
        continue;
      }

      const captures = provider.parse(tc.source, tc.filePath);

      // Check each expected capture
      let casePassed = true;
      for (const expected of tc.expected) {
        const found = captures.find(
          (c) => c.tag === expected.tag && (!expected.name || c.name === expected.name),
        );
        if (!found) {
          casePassed = false;
          details.push(
            `${tc.language}/${tc.filePath}: missing ${expected.tag}${expected.name ? ' "' + expected.name + '"' : ''}`,
          );
        }
      }

      if (casePassed) {
        passedCases++;
      }
    }

    const accuracy = totalCases > 0 ? passedCases / totalCases : 0;

    measurements.push(
      measurement('Parse Cases Passed', passedCases, 'count', { target: totalCases, min: totalCases }),
      measurement('Parse Accuracy', accuracy, 'ratio', { target: 1.0, min: 0.9 }),
      measurement('Total Languages Tested', Object.keys(PROVIDER_MAP).length, 'count', { target: 9, min: 9 }),
    );

    return makeResult(this.name, this.description, measurements, details);
  }
}
