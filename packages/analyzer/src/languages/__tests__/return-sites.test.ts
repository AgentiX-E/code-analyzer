// The lines a file hands a value back from, read from the tree.
//
// **This question had no reader and no answer before it.** Nothing in the capture layer recorded a `return`, so a
// function's own returns read no names, `paramToReturns` was a permanent empty array, and every caller had to assume
// that a call passed its argument straight through. The facts here are the floor of the whole inter-procedural return
// channel, which is why they are asserted per grammar rather than once.

import { describe, expect, it } from 'vitest';

import { C_FAMILY_CONSTANTS, PYTHON_CONSTANTS } from '../constant-fold.js';
import { JavaProvider } from '../java.js';
import { JavaScriptProvider } from '../javascript.js';
import { JsonProvider } from '../json.js';
import { PythonProvider } from '../python.js';
import { TypeScriptProvider } from '../typescript.js';

/** The return lines a provider reports, or `null` when it cannot read them. */
function linesOf(
  provider: { extractReturnLines(source: string): readonly number[] | null },
  code: string,
): readonly number[] | null {
  return provider.extractReturnLines(code);
}

describe('extractReturnLines', () => {
  it('reads every return of a Java file, nested ones included', () => {
    const provider = new JavaProvider();
    const code = [
      'class A {',
      '  String run(int flag) {',
      '    if (flag > 0) {',
      '      return "yes";',
      '    }',
      '    return "no";',
      '  }',
      '  String other() {',
      '    return helper();',
      '  }',
      '}',
    ].join('\n');
    // **The division by function is the consumer's**, because the CFG is built per symbol and only it knows the
    // symbol's extent; this reader answers for the file.
    expect(linesOf(provider, code)).toEqual([4, 6, 9]);
  });

  it('reads a bare `return;` as a return line, because it is one', () => {
    const provider = new JavaProvider();
    expect(linesOf(provider, 'class A {\n  void run() {\n    return;\n  }\n}')).toEqual([3]);
  });

  it('reads TypeScript and JavaScript, which spell it the same way', () => {
    const code = [
      'function run(x) {',
      '  if (!x) {',
      '    return null;',
      '  }',
      '  return x;',
      '}',
    ].join('\n');
    expect(linesOf(new TypeScriptProvider(), code)).toEqual([3, 5]);
    expect(linesOf(new JavaScriptProvider(), code)).toEqual([3, 5]);
  });

  it('reads Python, whose `return` is its own statement type too', () => {
    const code = [
      'def run(flag):',
      '    if flag:',
      '        return "yes"',
      '    return "no"',
      '',
    ].join('\n');
    expect(linesOf(new PythonProvider(), code)).toEqual([3, 4]);
  });

  it('answers nothing at all for a grammar with no dialect, rather than claiming there are no returns', () => {
    // **`null` and `[]` are different answers.** An empty list is a file whose functions return nothing; `null` is a
    // grammar this reader cannot answer for, and a caller that treated the two alike would stop assuming a call passes
    // its argument through on the strength of a parse it never did.
    expect(linesOf(new JsonProvider(), '{ "a": 1 }')).toBeNull();
  });

  it('describes a grammar without returns by naming none, which is a different claim from failing to read them', () => {
    const silent = { ...C_FAMILY_CONSTANTS, returnTypes: [] };
    expect(silent.returnTypes).toEqual([]);
    // Python spells it the C-family way, and that spelling is the only field this reader consults.
    expect(PYTHON_CONSTANTS.returnTypes).toEqual(['return_statement']);
  });
});
