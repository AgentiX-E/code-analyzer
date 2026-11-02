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
  /** The file the callee is declared in, because two declarations of one name are the whole point of the cases below. */
  readonly calleeFile: string;
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
    'Filter.java',
    `package demo;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;

public interface Filter {
    boolean accept(File file);

    boolean accept(File file, String name);

    default boolean accept(Path path, BasicFileAttributes attributes) {
        return accept(path.toFile());
    }
}
`,
  );
  write(
    'AbstractFilter.java',
    `package demo;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;

public abstract class AbstractFilter implements Filter {
    public boolean accept(final File file) { return true; }

    public boolean accept(final File file, final String name) { return true; }

    public void preVisit(final Path dir, final BasicFileAttributes attributes) {
        accept(dir, attributes);
    }
}
`,
  );
  write(
    'Reader.java',
    `package demo;

public class Reader {
    public boolean measure(final Object other) {
        return ((Case) other).checkEquals("a", "b");
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
          calleeFile: (target.filePath ?? '').split(/[\\/]/).pop() ?? '',
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

  it('answers a call on a cast, because the cast writes the type the name does not', () => {
    // **`((Case) other).checkEquals(…)` states its type in the brackets.** `equals` in every mutable type of
    // `commons-lang` reaches its own value this way, and a receiver read as a name finds no binding for the expression.
    expect(callsFrom('measure', 'checkEquals')).toMatchObject({ arm: 'receiverType' });
  });

  it('answers a call by the types it passes, and lands on the declaration that fits them', () => {
    // **Two arguments, two declarations, two files.** `AbstractFilter` declares `accept(File)` and `accept(File, String)`;
    // `Filter` declares `accept(Path, BasicFileAttributes)` as a default method. `preVisit` passes a `Path` and a
    // `BasicFileAttributes`, and an arity-only walk answers the class's own two-argument method - an edge javac does not
    // have. The types are what pick the contract's declaration, and the file the edge lands in is the proof.
    const answered = calls().filter(
      (call) => call.caller === 'preVisit' && call.callee === 'accept',
    );
    expect(answered).toEqual([expect.objectContaining({ calleeFile: 'Filter.java' })]);
  });

  it('claims no call the checkout does not contain', () => {
    // **`String` is not in this checkout**, and neither is `Object`. A graph that answered them would be claiming an
    // edge into a declaration nobody wrote - which is the failure mode every rule above is measured against.
    expect(calls().filter((call) => call.callee === 'equals')).toHaveLength(0);
  });
});
