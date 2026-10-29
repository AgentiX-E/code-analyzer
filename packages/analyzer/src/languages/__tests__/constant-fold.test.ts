// What the tree says about the values a name can hold, read from real grammars.
//
// **Every case below is a shape from a corpus, not an invention.** The first two are OWASP Benchmark's safe and
// vulnerable variants of the same test - identical but for which arm of one conditional is dead - because a fold that
// gets only one of them right would trade a false positive for a false negative on the same benchmark.

import { describe, expect, it } from 'vitest';

import { C_FAMILY_CONSTANTS, PYTHON_CONSTANTS, extractConstantFacts } from '../constant-fold.js';
import { JavaProvider } from '../java.js';
import { PythonProvider } from '../python.js';
import { TypeScriptProvider } from '../typescript.js';

import type { ConstantDialect, ConstantFacts } from '../constant-fold.js';

/** The parser a provider already holds, which is `protected` on purpose and reached on purpose. */
function parserOf(provider: unknown): { parse(source: string): unknown } {
  return (provider as { parser: { parse(s: string): unknown } }).parser;
}

/** The whole tree for a source, so the walk can start at its root. */
function rootOf(provider: unknown, source: string): { walk(): unknown } {
  const tree = parserOf(provider).parse(source) as { rootNode: { walk(): unknown } };
  return tree.rootNode;
}

function factsFor(source: string, dialect?: ConstantDialect): ConstantFacts {
  const provider = dialect === PYTHON_CONSTANTS ? new PythonProvider() : new JavaProvider();
  return extractConstantFacts(
    rootOf(provider, source) as Parameters<typeof extractConstantFacts>[0],
    dialect,
  );
}

/** The value a name holds, ignoring which scope it was written in - there is one scope per fixture. */
function valueOf(facts: ConstantFacts, name: string): unknown {
  for (const [key, value] of facts.constants) {
    if (key.endsWith(`:${name}`)) return value;
  }
  return undefined;
}

/** The benchmark's two variants of one test, which differ only in which arm is dead. */
const OWASP_TEMPLATE = (consequence: string, alternative: string): string => `
public class BenchmarkTest00053 extends TestCase {
    public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String param = java.net.URLDecoder.decode(request.getHeader("X"), "UTF-8");
        String bar;
        int num = 106;
        bar = (7 * 18) + num > 200 ? ${consequence} : ${alternative};
        response.getWriter().println("result: " + bar);
    }
}
`;

describe('the benchmark construction, in both directions', () => {
  it('folds the constant arm of the safe variant, so the tainted name never reaches the sink', () => {
    const facts = factsFor(OWASP_TEMPLATE('"This_should_always_happen"', 'param'));
    expect(valueOf(facts, 'num')).toBe(106);
    expect(valueOf(facts, 'bar')).toBe('This_should_always_happen');
    // The source itself is not a constant, and must not be reported as one.
    expect(valueOf(facts, 'param')).toBeUndefined();
  });

  it('refuses to fold the vulnerable variant, whose live arm is the tainted name', () => {
    const facts = factsFor(OWASP_TEMPLATE('param', '"This_should_always_happen"'));
    expect(valueOf(facts, 'num')).toBe(106);
    expect(valueOf(facts, 'bar')).toBeUndefined();
  });
});

describe('what counts as a single write', () => {
  it('ignores a declaration that has no initialiser', () => {
    const facts = factsFor(`
class T {
  void run() {
    String bar;
    int num = 106;
    bar = (7 * 18) + num > 200 ? "constant" : "other";
  }
}
`);
    // `String bar;` writes nothing, so `bar` has exactly one write and folds.
    expect(valueOf(facts, 'bar')).toBe('constant');
  });

  it('refuses a name assigned twice, even to the same value', () => {
    const facts = factsFor(`
class T {
  void run() {
    int num = 106;
    num = 106;
    String bar = (7 * 18) + num > 200 ? "constant" : "other";
  }
}
`);
    expect(valueOf(facts, 'num')).toBeUndefined();
    expect(valueOf(facts, 'bar')).toBeUndefined();
  });

  it('keeps the names of two methods apart', () => {
    const facts = factsFor(`
class T {
  void first() {
    int num = 106;
  }
  void second() {
    int num = 1;
    String bar = num > 0 ? "constant" : "other";
  }
}
`);
    // **One write per scope, so both fold** - and the point of the scope key is that the second method's `num` is 1,
    // not the first method's 106. A file-level environment would have folded `bar` against the wrong value.
    const byName = [...facts.constants].map(([key, value]) => [
      key.split(':').slice(1).join(':'),
      value,
    ]);
    expect(byName).toEqual([
      ['num', 106],
      ['num', 1],
      ['bar', 'constant'],
    ]);
  });

  it('reads TypeScript declarations and assignments the same way', () => {
    const provider = new TypeScriptProvider();
    const facts = extractConstantFacts(
      rootOf(
        provider,
        `
function run(param: string): string {
  const limit = 106;
  let out;
  out = (7 * 18) + limit > 200 ? "constant" : param;
  return out;
}
`,
      ) as Parameters<typeof extractConstantFacts>[0],
      C_FAMILY_CONSTANTS,
    );
    expect(valueOf(facts, 'limit')).toBe(106);
    expect(valueOf(facts, 'out')).toBe('constant');
  });

  it('reads Python order, where the condition sits between the arms', () => {
    const facts = factsFor(
      `
def run(param):
    num = 106
    bar = "constant" if (7 * 18) + num > 200 else param
    return bar
`,
      PYTHON_CONSTANTS,
    );
    expect(valueOf(facts, 'num')).toBe(106);
    expect(valueOf(facts, 'bar')).toBe('constant');
  });
});

describe('a switch a constant subject decides', () => {
  const SWITCH_TEMPLATE = (body: string): string => `
class T {
  void run(String param) {
    String bar;
    String guess = "ABC";
    char switchTarget = guess.charAt(1);
    switch (switchTarget) {
${body}
    }
    response.getWriter().println(bar);
  }
}
`;

  it('closes every arm but the one the subject selects', () => {
    const facts = factsFor(
      SWITCH_TEMPLATE(`      case 'A':
        bar = param;
        break;
      case 'B':
        bar = "bob";
        break;
      case 'C':
        bar = param;
        break;`),
    );
    // `'B'` is selected, so the `A` and `C` arms are dead - and only `bar`'s one reachable write remains, which folds.
    expect(valueOf(facts, 'switchTarget')).toBe('B');
    expect(valueOf(facts, 'bar')).toBe('bob');
  });

  it('keeps every arm after the selected one reachable while a fall-through is open', () => {
    const facts = factsFor(
      SWITCH_TEMPLATE(`      case 'A':
        bar = param;
      case 'B':
        bar = "bob";
        break;`),
    );
    // `'B'` is selected and it breaks, so `A` is closed - but the selected arm's own value is still the last write.
    expect(valueOf(facts, 'bar')).toBe('bob');
  });

  it('closes nothing when a label cannot be read', () => {
    const facts = factsFor(
      SWITCH_TEMPLATE(`      case SOME_CONSTANT:
        bar = param;
        break;
      case 'B':
        bar = "bob";
        break;`),
    );
    // Two writes are reachable, so nothing folds - which is the conservative answer.
    expect(valueOf(facts, 'bar')).toBeUndefined();
  });

  it('closes the whole body when nothing matches and there is no default', () => {
    const facts = factsFor(
      SWITCH_TEMPLATE(`      case 'A':
        bar = param;
        break;
      case 'C':
        bar = param;
        break;`),
    );
    // No arm runs at all, so no write survives and nothing is folded — but the arms' lines are recorded as dead.
    expect(facts.unreachableLines.size).toBeGreaterThan(0);
    expect(valueOf(facts, 'bar')).toBeUndefined();
  });

  it('closes the arms before a default that is the only one that runs', () => {
    const facts = factsFor(
      SWITCH_TEMPLATE(`      case 'A':
        bar = param;
        break;
      default:
        bar = "bob";
        break;`),
    );
    expect(valueOf(facts, 'bar')).toBe('bob');
  });

  it('closes nothing when the subject cannot be folded', () => {
    const facts = factsFor(`
class T {
  void run(String param) {
    String bar;
    switch (param) {
      case "a":
        bar = "a";
        break;
      default:
        bar = "b";
        break;
    }
  }
}
`);
    // The subject is the tainted name, so every arm may run: no line may be called dead.
    expect(facts.unreachableLines.size).toBe(0);
  });

  it('reads the arms past a comment inside the switch', () => {
    const facts = factsFor(
      SWITCH_TEMPLATE(`      // the case the constant selects
      case 'B':
        bar = "bob";
        break;
      default:
        bar = param;
        break;`),
    );
    // A comment is a child of the block, not a label; the arm under it is still read.
    expect(valueOf(facts, 'bar')).toBe('bob');
  });

  it('closes a default arm that a matching case shadows', () => {
    const facts = factsFor(
      SWITCH_TEMPLATE(`      case 'B':
        bar = "bob";
        break;
      default:
        bar = param;
        break;`),
    );
    // The case matched, so the jump never reaches the default behind it, whatever its place in the block.
    expect(valueOf(facts, 'bar')).toBe('bob');
    expect([...facts.unreachableLines].sort((a, b) => a - b)).toEqual([11, 12, 13]);
  });

  it('reads a TypeScript switch, whose label is a field rather than a node', () => {
    const provider = new TypeScriptProvider();
    const facts = extractConstantFacts(
      rootOf(
        provider,
        `
function run(param: string): string {
  const target = "B";
  let bar: string;
  switch (target) {
    case "A":
      bar = param;
      break;
    default:
      bar = "bob";
      break;
  }
  return bar;
}
`,
      ) as Parameters<typeof extractConstantFacts>[0],
      C_FAMILY_CONSTANTS,
    );
    // Same question, different grammar: the `case` carries its label in a field, and the `default` is a group of its own.
    expect(valueOf(facts, 'bar')).toBe('bob');
  });
});

describe('writes that are not simple names', () => {
  it('ignores a write to a field or through a pattern, which no caller can look up by name', () => {
    const facts = factsFor(`
class T {
  int count;
  void run() {
    this.count = 5;
    int num = 106;
    String bar = (7 * 18) + num > 200 ? "constant" : "other";
  }
}
`);
    // `this.count` is not a name in scope, so it writes nothing and cannot make anything look written twice.
    expect([...facts.constants].map(([key]) => key.split(':').slice(1).join(':'))).toEqual([
      'num',
      'bar',
    ]);
    expect(valueOf(facts, 'bar')).toBe('constant');
  });

  it('ignores a destructuring declaration on the same grounds', () => {
    const provider = new TypeScriptProvider();
    const facts = extractConstantFacts(
      rootOf(
        provider,
        `
function run(source: { a: number }): string {
  const { a } = source;
  const limit = 106;
  return (7 * 18) + limit > 200 ? "constant" : "other";
}
`,
      ) as Parameters<typeof extractConstantFacts>[0],
      C_FAMILY_CONSTANTS,
    );
    expect([...facts.constants].map(([key]) => key.split(':').slice(1).join(':'))).toEqual([
      'limit',
    ]);
  });
});

describe('branches a constant condition closes', () => {
  it('records the arm a true condition can never take', () => {
    const facts = factsFor(`
class T {
  void run() {
    int num = 106;
    if ((7 * 18) + num > 200) {
      System.out.println("always");
    } else {
      System.out.println("never");
    }
  }
}
`);
    // The `else` block is lines 7 to 9; the `if` and its condition are not closed.
    expect([...facts.unreachableLines].sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  it('records nothing when the condition is not decidable', () => {
    const facts = factsFor(`
class T {
  void run(String param) {
    if (param.length() > 0) {
      System.out.println("maybe");
    } else {
      System.out.println("also maybe");
    }
  }
}
`);
    expect(facts.unreachableLines.size).toBe(0);
  });

  it('records nothing for an `if` with no else, because the false path is the fall-through', () => {
    const facts = factsFor(`
class T {
  void run() {
    int num = 106;
    if ((7 * 18) + num > 200) {
      System.out.println("always");
    }
  }
}
`);
    // The consequence runs; there is no alternative to close.
    expect(facts.unreachableLines.size).toBe(0);
  });

  it('closes the consequence of an `if` that has no else when the condition is false', () => {
    const facts = factsFor(`
class T {
  void run() {
    int num = 106;
    if ((7 * 18) + num < 200) {
      System.out.println("never");
    }
    System.out.println("always");
  }
}
`);
    // The consequence block spans its own braces, lines 5 to 7; the statement after it stays reachable.
    expect([...facts.unreachableLines].sort((a, b) => a - b)).toEqual([5, 6, 7]);
  });
});

describe('what a function hands back', () => {
  it('names a function whose returns all fold to one value, and refuses the rest', () => {
    const facts = factsFor(`
class T {
  int field;
  static String one() {
    return "constant";
  }
  static String disagree(int num) {
    if (num > 0) {
      return "a";
    }
    return "b";
  }
  static String unreadable(String param) {
    return param;
  }
  static void bare() {
    return;
  }
}
`);
    // One return that folds is a fact a caller can use; two that disagree, or one the evaluator cannot read, are not.
    expect([...facts.constantReturns]).toEqual([['one', 'constant']]);
  });

  it('refuses a name declared twice in one file, because the caller only knows the name', () => {
    const facts = factsFor(`
class T {
  static String twin() {
    return "constant";
  }
  static String twin() {
    return "constant";
  }
}
`);
    expect(facts.constantReturns.size).toBe(0);
  });

  it('ignores a return on a line control cannot reach', () => {
    const facts = factsFor(`
class T {
  static String pick() {
    int flag = 1;
    if (flag > 2) {
      return "unreachable";
    }
    return "constant";
  }
}
`);
    // The dead return is not a second opinion, so the surviving one still names the function.
    expect([...facts.constantReturns]).toEqual([['pick', 'constant']]);
  });

  it('names a function whose two returns agree, because either path hands back the same value', () => {
    const facts = factsFor(`
class T {
  static String same(int num) {
    if (num > 0) {
      return "constant";
    }
    return "constant";
  }
}
`);
    expect([...facts.constantReturns]).toEqual([['same', 'constant']]);
  });

  it('gives an unnamed callable a scope without a name to return under', () => {
    const provider = new TypeScriptProvider();
    const facts = extractConstantFacts(
      rootOf(
        provider,
        `
const run = (param: string): string => {
  const num = 106;
  const bar = (7 * 18) + num > 200 ? "constant" : param;
  return bar;
};
`,
      ) as Parameters<typeof extractConstantFacts>[0],
      C_FAMILY_CONSTANTS,
    );
    // An arrow function has no `name` field, so its scope is keyed by line only - the values still fold.
    expect(valueOf(facts, 'bar')).toBe('constant');
    expect(facts.constantReturns.size).toBe(0);
  });
});
