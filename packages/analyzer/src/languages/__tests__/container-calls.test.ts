// The calls a file makes on a container, read from the tree.
//
// **The captures could not answer this and no amount of reading them could.** A `METHOD_CALL` carries the method name
// and `VARIABLE_ACCESS` carries each argument, but a map access is decided by a *literal* - `map.put("keyB", param)`
// against `map.get("keyA")` - and literals are not captures. Every OWASP Benchmark case that round-trips a value
// through a collection differs in exactly that string, which is why the fact is asserted per grammar here.

import { describe, expect, it } from 'vitest';

import {
  CONTAINER_OPERATIONS,
  JAVA_CONTAINERS,
  MEMBER_CALLEE_CONTAINERS,
  PYTHON_CONTAINERS,
  extractContainerCalls,
} from '../container-calls.js';
import { JavaProvider } from '../java.js';
import { JavaScriptProvider } from '../javascript.js';
import { JsonProvider } from '../json.js';
import { PythonProvider } from '../python.js';
import { TypeScriptProvider } from '../typescript.js';

import type { TreeSitterSyntaxNode } from '../tree-sitter-base.js';

/** The container calls one Java source produces, as `receiver.method(key, value)` strings. */
function shapes(code: string): string[] {
  const calls = new JavaProvider().extractContainerCalls(code) ?? [];
  return calls.map((call) => {
    const args = call.args.map((arg) => arg.literal ?? `{${arg.names.join(',')}}`);
    return `${call.receiver}.${call.method}(${args.join(', ')})`;
  });
}

describe('extractContainerCalls', () => {
  it('reads a map round-trip, keys and all', () => {
    const code = [
      'class A {',
      '  String run(String param) {',
      '    java.util.HashMap<String, Object> m = new java.util.HashMap<String, Object>();',
      '    m.put("keyA", "a_Value");',
      '    m.put("keyB", param);',
      '    bar = (String) m.get("keyB");',
      '    return bar;',
      '  }',
      '}',
    ].join('\n');
    expect(shapes(code)).toEqual(['m.put(keyA, a_Value)', 'm.put(keyB, {param})', 'm.get(keyB)']);
  });

  it('reads a list build and the index it is read back at', () => {
    const code = [
      'class A {',
      '  String run(String param) {',
      '    java.util.List<String> l = new java.util.ArrayList<String>();',
      '    l.add("safe");',
      '    l.add(param);',
      '    l.remove(0);',
      '    bar = l.get(1);',
      '    return bar;',
      '  }',
      '}',
    ].join('\n');
    expect(shapes(code)).toEqual(['l.add(safe)', 'l.add({param})', 'l.remove(0)', 'l.get(1)']);
  });

  it('cannot see a container addressed through an expression, and says so by recording nothing', () => {
    const code = [
      'class A {',
      '  String run(String param) {',
      '    this.cache.put("k", param);',
      '    getMap().put("k", param);',
      '  }',
      '}',
    ].join('\n');
    // **The absence is the guarantee.** A slot is resolvable only because every access to it was seen; following a
    // receiver through an expression means modelling fields and call results, and a model that guessed would be
    // claiming a container is empty when it had merely not looked.
    expect(shapes(code)).toEqual([]);
  });

  it('ignores methods that are questions about a container rather than uses of its contents', () => {
    const code =
      'class A { void run() { m.put("k", 1); m.size(); m.isEmpty(); m.containsKey("k"); } }';
    expect(shapes(code)).toEqual(['m.put(k, 1)']);
  });

  it('reads a builder, whose contents leave it through `toString`', () => {
    const code = [
      'class A {',
      '  String run(String param) {',
      '    StringBuilder sb = new StringBuilder();',
      '    sb.append(param);',
      '    return sb.toString();',
      '  }',
      '}',
    ].join('\n');
    expect(shapes(code)).toEqual(['sb.append({param})', 'sb.toString()']);
  });

  it('reads the same shapes from TypeScript, JavaScript and Python', () => {
    const ts =
      'function run(param: string) { const l: string[] = []; l.push(param); return l.get(0); }';
    const tsCalls = new TypeScriptProvider().extractContainerCalls(ts) ?? [];
    expect(tsCalls.map((call) => `${call.receiver}.${call.method}`)).toEqual(['l.push', 'l.get']);

    const js = 'function run(param) { const m = new Map(); m.set("k", param); return m.get("k"); }';
    const jsCalls = new JavaScriptProvider().extractContainerCalls(js) ?? [];
    expect(jsCalls.map((call) => call.args[0]?.literal)).toEqual(['k', 'k']);

    const py = 'def run(param):\n    m = {}\n    m.set("k", param)\n    return m.get("k")\n';
    const pyCalls = new PythonProvider().extractContainerCalls(py) ?? [];
    expect(pyCalls.map((call) => `${call.receiver}.${call.method}`)).toEqual(['m.set', 'm.get']);
  });

  it('answers `null` for a grammar it cannot describe, which is not the same as an empty list', () => {
    // **The two answers differ.** A file with no container calls is a file whose values cannot come back out of a
    // collection; a grammar this project has no vocabulary for is a question nobody asked, and treating the second as
    // the first is how a value goes quiet.
    expect(new JsonProvider().extractContainerCalls('{"a": 1}')).toBeNull();
    // A dialect with no receiver field and no member node can never name a receiver, so it records nothing rather than
    // reading the wrong hand's fields.
    expect(MEMBER_CALLEE_CONTAINERS.callTypes).toEqual(['call_expression']);
    expect(PYTHON_CONTAINERS.callTypes).toEqual(['call']);
    expect(JAVA_CONTAINERS.memberTypes).toEqual([]);
  });

  it('does not record a plain call, which has no receiver to be a container', () => {
    // `doThing(param)` is a call whose callee is a bare name: the member shape does not apply and this dialect has no
    // direct receiver field, so there is nothing on the left of a dot and the call is not a container access. A reader
    // that fell through to the other hand's fields would read the callee as the receiver.
    expect(
      new JavaScriptProvider().extractContainerCalls('function run(param) { doThing(param); }'),
    ).toEqual([]);
    expect(
      new PythonProvider().extractContainerCalls('def run(param):\n    doThing(param)\n'),
    ).toEqual([]);
  });

  it('records every name a compound argument reads, and nothing for a dialect with no argument field', () => {
    // `map.put("k", helper(param) + other)` carries two names under one argument, and the walk visits the identifier
    // it arrives at first rather than descending past it.
    const root = new ProbeableJava().rootOf(
      'class A { void run(String param, String other) { map.put("k", helper(param) + other); } }',
    );
    const calls = extractContainerCalls(root, JAVA_CONTAINERS);
    expect(calls.map((entry) => entry.args[1]?.names)).toEqual([['helper', 'param', 'other']]);

    // **A dialect is data, and a wrong table is the mistake the seam invites.** One that names no callee field yields
    // no calls rather than a crash, and one that names no argument field yields the call with no arguments — which is
    // what a grammar without an argument list means.
    expect(extractContainerCalls(root, { ...JAVA_CONTAINERS, calleeField: '' })).toEqual([]);
    const noArguments = extractContainerCalls(root, { ...JAVA_CONTAINERS, argumentField: '' });
    expect(noArguments.map((entry) => [entry.method, entry.args.length])).toEqual([['put', 0]]);
  });
});

/** A provider that lends its parse tree out, so a test can drive the extractor with a dialect of its own. */
class ProbeableJava extends JavaProvider {
  rootOf(source: string): TreeSitterSyntaxNode {
    const tree = this.cachedTree(source);
    if (!tree) throw new Error('the Java grammar did not load');
    return tree.rootNode;
  }
}

describe('CONTAINER_OPERATIONS', () => {
  it('answers every role the model can act on', () => {
    const roles = new Set([...CONTAINER_OPERATIONS.values()].map((operation) => operation.role));
    // **Every role is reachable, and this is the assertion that keeps the model's branches honest**: a role with no
    // entry is a branch of `applyCall`/`readOf` no vocabulary can reach, and a role with no handler is a call the
    // analysis reads and then ignores.
    expect([...roles].sort()).toEqual(['append', 'clear', 'read', 'read-all', 'remove', 'write']);
  });

  it('names an argument for every write and every read', () => {
    for (const [name, operation] of CONTAINER_OPERATIONS) {
      if (operation.role === 'write' || operation.role === 'append') {
        expect(operation.valueArgument, name).toBeGreaterThanOrEqual(0);
      }
      if (operation.role === 'write' || operation.role === 'read' || operation.role === 'remove') {
        expect(operation.keyArgument, name).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
