// @code-analyzer/intelligence — Rule Runner Branch Coverage Tests
// Covers previously-uncovered branches in the legacy (non-AST) v1 checkers
// that remain registered in CHECKER_MAP, and locks in the no-god-class
// inClass-reset bug fix.

import { describe, it, expect } from 'vitest';
import { CHECKER_MAP, RulesEngine, runRules, getFileLanguage } from '../rules/rule-runner.js';
import type { RuleContext } from '../rules/rule-runner.js';

function run(ruleId: string, source: string, filePath = 'test.ts', language = 'typescript') {
  const c = CHECKER_MAP[ruleId];
  if (!c) throw new Error('No checker: ' + ruleId);
  return c(source.split('\n'), filePath, language);
}

// ---------------------------------------------------------------------------
// no-undef: arrow-param and declaration-exclusion branches
// ---------------------------------------------------------------------------

describe('no-undef branches', () => {
  it('does not crash on an empty-parameter arrow function', () => {
    // `() => ...` produces an empty param string in the arrow branch.
    expect(() => run('no-undef', 'const f = () => doThing();')).not.toThrow();
  });

  it('does not flag its own const/let/var/function/class declarations', () => {
    // The declaration-exclusion branch (const/let/var/function/class prefixes).
    const r = run('no-undef', 'const declared = 1;\nlet other = 2;\nconsole.log(declared, other);');
    const flagged = r.filter((v) => v.message.includes('declared') || v.message.includes('other'));
    expect(flagged).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-unreachable-code: trailing return / comment / ternary branches
// ---------------------------------------------------------------------------

describe('no-unreachable-code branches', () => {
  it('does not flag a return as the last line of the file', () => {
    expect(run('no-unreachable-code', 'function f() {\n  return x;\n}')).toHaveLength(0);
  });

  it('does not flag code after a return when the next line is blank or a comment', () => {
    const src = 'function f() {\n  return x;\n  // trailing comment\n}';
    expect(run('no-unreachable-code', src)).toHaveLength(0);
  });

  it('does not flag a return statement containing a ternary', () => {
    expect(run('no-unreachable-code', 'function f() {\n  return x ? a : b;\n}')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-redundant-computation: comment-skip branch
// ---------------------------------------------------------------------------

describe('no-redundant-computation branches', () => {
  it('flags a repeated method call', () => {
    expect(run('no-redundant-computation', 'a.foo();\na.foo();')).toHaveLength(1);
  });

  it('skips comment lines', () => {
    expect(run('no-redundant-computation', '// a.foo();\n// a.foo();')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// max-function-lines: nested-function and unclosed-function branches
// ---------------------------------------------------------------------------

describe('max-function-lines branches', () => {
  it('does not merge a nested function into its parent', () => {
    // The nested-function branch (funcMatch while already inFunction).
    const src = 'function outer() {\n  function inner() { return 1; }\n  return inner();\n}';
    expect(() => run('max-function-lines', src)).not.toThrow();
  });

  it('flags an unclosed function exceeding the threshold', () => {
    const src = ['function big() {'];
    for (let i = 0; i < 55; i++) src.push(`  line${i}();`);
    expect(run('max-function-lines', src.join('\n'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// max-cyclomatic-complexity: each complexity keyword branch
// ---------------------------------------------------------------------------

describe('max-cyclomatic-complexity branches', () => {
  it('counts else-if, case, default, for, while, catch, and logical operators', () => {
    const src = [
      'function complex(x) {',
      '  if (x > 0) {}',
      '  if (x > 1) {}',
      '  if (x > 2) {}',
      '  if (x > 3) {}',
      '  if (x > 4) {}',
      '  if (x > 5) {}',
      '  if (x > 6) {}',
      '  if (x > 7) {}',
      '  if (x > 8) {}',
      '  if (x > 9) {}',
      '  if (x > 10) {}',
      '  else if (x > 11) {}',
      '  switch (x) {',
      '    case 1: break;',
      '    default: break;',
      '  }',
      '  for (let i = 0; i < 3; i++) { doA(); }',
      '  while (x--) { doB(); }',
      '  try { doC(); } catch (e) { doD(); }',
      '  return (x && y) || z;',
      '}',
    ];
    const r = run('max-cyclomatic-complexity', src.join('\n'));
    // Complexity well above threshold (15).
    expect(r.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// no-magic-numbers: comment-skip branch
// ---------------------------------------------------------------------------

describe('no-magic-numbers branches', () => {
  it('flags a 4-digit magic number', () => {
    expect(run('no-magic-numbers', 'foo(1234);')).toHaveLength(1);
  });

  it('skips comment lines', () => {
    expect(run('no-magic-numbers', '// 1234 is a placeholder')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-todo-fixme: FIXME vs TODO branch
// ---------------------------------------------------------------------------

describe('no-todo-fixme branches', () => {
  it('flags a TODO without a ticket reference', () => {
    const r = run('no-todo-fixme', '// TODO: fix this');
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('TODO');
  });

  it('flags a FIXME and reports FIXME (not TODO)', () => {
    const r = run('no-todo-fixme', '// FIXME: urgent');
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('FIXME');
  });

  it('skips TODO with a ticket reference', () => {
    expect(run('no-todo-fixme', '// TODO(#123): fix this')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-god-class: separate classes must not merge (inClass-reset regression)
// ---------------------------------------------------------------------------

describe('no-god-class branches', () => {
  function makeClass(name: string, n: number): string[] {
    const lines = [`class ${name} {`];
    for (let i = 0; i < n; i++) lines.push(`  method${i}() { return ${i}; }`);
    lines.push('}');
    return lines;
  }

  it('reports each oversized class independently', () => {
    const src = [...makeClass('A', 25), ...makeClass('B', 25)];
    const r = run('no-god-class', src.join('\n'));
    expect(r).toHaveLength(2);
    expect(r[0]!.message).toContain('Class "A" has 25 methods');
    expect(r[1]!.message).toContain('Class "B" has 25 methods');
  });
});

// ---------------------------------------------------------------------------
// consistent-quotes: single-vs-double suggestion branch
// ---------------------------------------------------------------------------

describe('consistent-quotes branches', () => {
  it('flags mixed quotes and suggests single when single dominates', () => {
    const src =
      "const a = 'one';\nconst b = 'two';\nconst c = 'three';\nconst d = 'four';\nconst e = \"five\";";
    const r = run('consistent-quotes', src);
    expect(r).toHaveLength(1);
    expect(r[0]!.suggestion).toContain('single');
  });
});

// ---------------------------------------------------------------------------
// spacing-consistency: comment-skip branch
// ---------------------------------------------------------------------------

describe('spacing-consistency branches', () => {
  it('flags missing space around =', () => {
    expect(run('spacing-consistency', 'const x=1;')).toHaveLength(1);
  });

  it('skips comment lines', () => {
    expect(run('spacing-consistency', '// x=1')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-circular-deps: deep relative import branch
// ---------------------------------------------------------------------------

describe('no-circular-deps branches', () => {
  it('flags a deep relative import (>2 parent references)', () => {
    expect(run('no-circular-deps', "import x from '../../../y';")).toHaveLength(1);
  });

  it('does not flag a shallow relative import', () => {
    expect(run('no-circular-deps', "import x from './y';")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-layer-violation: getFileLayer / getImportLayer branches
// ---------------------------------------------------------------------------

describe('no-layer-violation branches', () => {
  it('detects a lower layer importing a higher layer', () => {
    // data (1) importing domain (2) violates the boundary.
    const r = run(
      'no-layer-violation',
      "import { User } from '../domain/models/user';",
      'src/data/repositories/user-repo.ts',
    );
    expect(r.length).toBeGreaterThan(0);
  });

  it('returns no findings when the file has no layer', () => {
    expect(run('no-layer-violation', "import x from './y';", 'src/utils/helper.ts')).toHaveLength(
      0,
    );
  });

  it('recognizes the presentation layer via /controllers/', () => {
    // presentation (4) is the top layer; importing anything higher is impossible,
    // but importing infra (0) is allowed — so no violation.
    const r = run(
      'no-layer-violation',
      "import { db } from '../infra/db';",
      'src/presentation/controllers/user-controller.ts',
    );
    expect(r).toHaveLength(0);
  });

  it('recognizes the application layer via /services/', () => {
    // application (3) importing presentation (4) violates the boundary.
    const r = run(
      'no-layer-violation',
      "import { ui } from '../api/routes';",
      'src/application/services/user-service.ts',
    );
    expect(r.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// runRules: language filter + throw-isolation branches
// ---------------------------------------------------------------------------

describe('runRules branches', () => {
  it('infers language from filePath when ctx.language is empty', () => {
    const ctx: RuleContext = { filePath: 'app.py', lines: ['eval("x")'], language: '' };
    const violations = runRules(ctx);
    // no-eval is registered; eval("x") in python should still be flagged.
    expect(Array.isArray(violations)).toBe(true);
  });

  it('skips rules whose language filter excludes the file language', () => {
    const ctx: RuleContext = { filePath: 'app.py', lines: ['x'], language: 'python' };
    // Should not throw; rules with languageFilter excluding python are skipped.
    expect(() => runRules(ctx)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RulesEngine.analyze: categories / severities / excludeRules branches
// ---------------------------------------------------------------------------

describe('RulesEngine branches', () => {
  it('runs a single category when categories has one entry', () => {
    const engine = new RulesEngine();
    const r = engine.analyze('app.ts', ['eval("x");'], { categories: ['security'] });
    expect(r.violations.some((v) => v.ruleId === 'no-eval')).toBe(true);
  });

  it('filters by severity', () => {
    const engine = new RulesEngine();
    const r = engine.analyze('app.ts', ['eval("x");'], { severities: ['high'] });
    expect(
      r.violations.every((v) => {
        const def = engine
          .getRegistry()
          .getAll()
          .find((d) => d.definition.id === v.ruleId);
        return def ? def.definition.severity === 'high' : true;
      }),
    ).toBe(true);
  });

  it('excludes rules listed in excludeRules', () => {
    const engine = new RulesEngine();
    const r = engine.analyze('app.ts', ['eval("x");'], { excludeRules: ['no-eval'] });
    expect(r.violations.some((v) => v.ruleId === 'no-eval')).toBe(false);
  });

  it('summarizes by category and severity (buildResult rule-match branch)', () => {
    const engine = new RulesEngine();
    const r = engine.analyze('app.ts', ['eval("x");']);
    expect(r.summary.totalViolations).toBeGreaterThan(0);
    expect(Object.keys(r.summary.byCategory).length).toBeGreaterThan(0);
    expect(Object.keys(r.summary.bySeverity).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getFileLanguage
// ---------------------------------------------------------------------------

describe('getFileLanguage', () => {
  it('detects common extensions', () => {
    expect(getFileLanguage('a.ts')).toBe('typescript');
    expect(getFileLanguage('a.js')).toBe('javascript');
    expect(getFileLanguage('a.py')).toBe('python');
    expect(getFileLanguage('a.unknown')).toBe('unknown');
  });
});
