// The receiver shapes a Java codebase writes and nothing else does — measured through the whole pipeline.
//
// **Every case below is a user's question and not a module's unit.** "Who calls `CloseableURLConnection.getInputStream`?"
// is asked of the graph the product hands back, over a checkout written to disk and analysed from scan to call graph, so
// what is asserted is that the answer exists rather than that some function returned a string. The four shapes are the
// ones iteration 61 found unanswered on `apache/commons-io@2.16.1` and `apache/commons-lang@3.14.0`:
//
//   1. a resource declared by a try-with-resources header,
//   2. a constant of an enum used as a receiver,
//   3. a field whose type is a type parameter, bound by `extends`,
//   4. `Outer.this`, which an inner class writes to reach the object it is nested in.
//
// Each one is a declaration the language states and this product used to step past. The corpus numbers in
// `benchmarks/callgraph-java-quality.json` say how much they are worth; this file says what they mean.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDefaultConfig } from '@code-analyzer/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import { createAllPhases } from '../pipeline/phases/index.js';

import type { KnowledgeGraph, PipelineContext } from '@code-analyzer/shared';

const ROOT = mkdtempSync(join(tmpdir(), 'ca-java-receivers-'));
const SOURCE = join(ROOT, 'src', 'main', 'java', 'demo');

interface Call {
  readonly caller: string;
  readonly callee: string;
  readonly arm: string;
}

let graph: KnowledgeGraph;

/** Write one file of the fixture checkout, creating its directories. */
function write(name: string, body: string): void {
  mkdirSync(SOURCE, { recursive: true });
  writeFileSync(join(SOURCE, name), body, 'utf8');
}

beforeAll(async () => {
  write(
    'CloseableUrlConnection.java',
    `package demo;

public class CloseableUrlConnection {
    public static CloseableUrlConnection open(String url) { return new CloseableUrlConnection(); }
    public int getInputStream() { return 0; }
    public int setConnectTimeout(int millis) { return millis; }
}
`,
  );
  write(
    'Case.java',
    `package demo;

public enum Case {
    SYSTEM("System"), INSENSITIVE("Insensitive");

    Case(String name) { }

    public boolean checkEquals(String a, String b) { return a.equals(b); }
}
`,
  );
  write(
    'Base.java',
    `package demo;

public interface Base<T, S extends Base<T, S, B>, B extends Object> {
    S unwrap();
}
`,
  );
  write(
    'Wrapper.java',
    `package demo;

public class Wrapper<T, S extends Base<T, S, B>, B extends Object> {
    private final S delegate;

    public Wrapper(final S delegate) { this.delegate = delegate; }

    public Object run() { return delegate.unwrap(); }
}
`,
  );
  write(
    'Outer.java',
    `package demo;

public class Outer {
    private int size() { return 0; }

    public class Inner {
        public int read() { return Outer.this.size(); }
    }
}
`,
  );
  write(
    'Caller.java',
    `package demo;

public class Caller {
    public void copy(final String url) throws Exception {
        try (CloseableUrlConnection urlConnection = CloseableUrlConnection.open(url)) {
            urlConnection.setConnectTimeout(10);
            urlConnection.getInputStream();
        }
    }

    public boolean same(final String a, final String b) {
        return Case.SYSTEM.checkEquals(a, b);
    }
}
`,
  );

  const ctx = {
    projectId: 'java-receivers',
    rootPath: ROOT,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
  graph = (await new PipelineOrchestrator(createAllPhases()).execute(ctx)).graph;
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** Every `CALLS` edge, as the pair of names a reader would ask about plus the arm that claimed it. */
function calls(): Call[] {
  const byId = new Map([...graph.nodes.values()].map((node) => [node.id, node]));
  return [...graph.edges.values()]
    .filter((edge) => edge.type === 'CALLS')
    .flatMap((edge) => {
      const source = byId.get(edge.sourceId);
      const target = byId.get(edge.targetId);
      if (source === undefined || target === undefined) return [];
      const arm = edge.properties?.['resolution'];
      return [
        {
          caller: String(source.name),
          callee: String(target.name),
          arm: typeof arm === 'string' ? arm : '',
        },
      ];
    });
}

/** Whether the graph answers "does `caller` call `callee`". */
function callsFrom(caller: string, callee: string): Call | undefined {
  return calls().find((call) => call.caller === caller && call.callee === callee);
}

describe('a Java checkout answers what its own declarations say', () => {
  it('answers a call on a resource the try header declares', () => {
    // **`try (CloseableUrlConnection urlConnection = …)` declares a local**, and the grammar calls it a `resource`
    // rather than a `local_variable_declaration` - so the two calls on it were unanswered on `commons-io`, where 35
    // headers are written this way.
    expect(callsFrom('copy', 'setConnectTimeout')).toMatchObject({ arm: 'receiverType' });
    expect(callsFrom('copy', 'getInputStream')).toMatchObject({ arm: 'receiverType' });
  });

  it('answers a call on a constant of an enum', () => {
    // **A constant is a value of its enum and writes no type.** `Case.SYSTEM.checkEquals(…)` asks the enum for a member
    // through a name the grammar never calls a field.
    expect(callsFrom('same', 'checkEquals')).toMatchObject({ arm: 'receiverType' });
  });

  it('answers a call on a field whose type is a type parameter', () => {
    // **`S extends Base<T, S, B>` is the only place the language says what an `S` may be.** Without the bound the walk
    // asked for a class named `S` and ended: 14 calls in one file of `commons-io`.
    expect(callsFrom('run', 'unwrap')).toMatchObject({ arm: 'receiverType' });
  });

  it('answers a call an inner class writes on its outer instance', () => {
    // **`Outer.this.size()` names the enclosing object**, because the inner class's own `this` is a different one.
    expect(callsFrom('read', 'size')).toBeDefined();
  });

  it('claims no call the checkout does not contain', () => {
    // **`String` is not in this checkout**, and neither is `Object`. A graph that answered them would be claiming an
    // edge into a declaration nobody wrote - which is the failure mode every rule above is measured against.
    expect(calls().filter((call) => call.callee === 'equals')).toHaveLength(0);
  });
});
