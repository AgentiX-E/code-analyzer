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

  // **A class that writes no constructor still has one**, and it calls the base it extends.
  write(
    'AbstractThing.java',
    `package demo;

public abstract class AbstractThing {
    protected AbstractThing() { }

    public int size() { return 0; }
}
`,
  );
  write(
    'Thing.java',
    `package demo;

public class Thing extends AbstractThing {
}
`,
  );
  // **A stream is a view of one collection**, so the element a lambda is handed is the collection's.
  write(
    'Range.java',
    `package demo;

public class Range {
    public boolean contains(final char ch) { return false; }
}
`,
  );
  write(
    'Ranges.java',
    `package demo;

import java.util.HashSet;
import java.util.Set;

public class Ranges {
    private final Set<Range> ranges = new HashSet<>();

    public boolean check(final char ch) {
        return ranges.stream().anyMatch(range -> range.contains(ch));
    }
}
`,
  );
  // **A generic factory names its result by naming its argument.**
  write(
    'Visitor.java',
    `package demo;

public class Visitor {
    public int getCount() { return 0; }
}
`,
  );
  write(
    'Factory.java',
    `package demo;

public class Factory {
    public static <T extends Visitor> T walk(final T visitor, final String path) {
        return visitor;
    }

    public static int use(final String path) {
        return walk(new Visitor(), path).getCount();
    }
}
`,
  );
  // **A hop names a member of the class or of a base**, which is what a member is.
  write(
    'Style.java',
    `package demo;

public class Style {
    public String text() { return ""; }
}
`,
  );
  write(
    'AbstractView.java',
    `package demo;

public class AbstractView {
    public Style style() { return new Style(); }
}
`,
  );
  write(
    'View.java',
    `package demo;

public class View extends AbstractView {
    public String read() { return this.style().text(); }
}
`,
  );

  // **A field a class does not declare is still a field of the class**, and a bare name is how Java reads it.
  write(
    'Buffer.java',
    `package demo;

public class Buffer {
    public int size() { return 0; }
}
`,
  );
  write(
    'AbstractSource.java',
    `package demo;

public class AbstractSource {
    protected final Buffer buffer = new Buffer();
}
`,
  );
  write(
    'PeekSource.java',
    `package demo;

public class PeekSource extends AbstractSource {
    public int peek() { return buffer.size(); }
}
`,
  );
  // **A class written inside a class is written inside a scope**, and `toPath` is the outer class's private static.
  write(
    'Deferred.java',
    `package demo;

public class Deferred {
    private static String toPath(final String directory) { return directory; }

    public static class Bucket {
        private String path;

        public Bucket setDirectory(final String directory) {
            this.path = toPath(directory);
            return this;
        }
    }
}
`,
  );
  // **An enum writes two methods and names neither**, and `Stream.of(values())` is how the corpus iterates them.
  write(
    'CaseFinder.java',
    `package demo;

import java.util.stream.Stream;

public class CaseFinder {
    public static Case exact(final String name) {
        return Case.valueOf(name);
    }

    public static Case find(final String name) {
        return Stream.of(Case.values()).filter(c -> c.checkEquals(name, name)).findFirst().orElse(null);
    }
}
`,
  );
  // **`Stream.of(array)` is a stream of the array's elements**, which is the second way a Java file opens one.
  write(
    'Token.java',
    `package demo;

public class Token {
    public int value() { return 0; }
}
`,
  );
  write(
    'Tokens.java',
    `package demo;

import java.util.stream.Stream;

public class Tokens {
    public static boolean has(final Token[] tokens) {
        return Stream.of(tokens).anyMatch(token -> token.value() == 1);
    }
}
`,
  );

  // **The enclosing walk is one step at a time**, so a class two deep reaches the outermost only by passing through
  // its parent - which is the order the language resolves in and the shape a one-step rule would miss.
  write(
    'Nest.java',
    `package demo;

public class Nest {
    private static String label() { return ""; }

    public static class Middle {
        public static class Inner {
            public String read() { return label(); }
        }
    }
}

class Sibling {
    private static String label() { return "sibling"; }

    public String get() { return label(); }
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

  it('answers the constructor a class writes none of, and the base constructor it calls', () => {
    // **`class Thing extends AbstractThing { }` writes no constructor and still has one**, and its first act is
    // `super()`. Twenty of the forty pairs `javac` expected and this graph claimed nothing for were this shape.
    expect(callsFrom('Thing', 'AbstractThing')).toMatchObject({ calleeFile: 'AbstractThing.java' });
  });

  it('answers a lambda parameter with the element of the collection its stream was opened from', () => {
    // **`ranges.stream().anyMatch(range -> …)`** - the stream is a view of `ranges`, so `range` holds a `Range` and the
    // call it makes is `Range.contains`.
    expect(callsFrom('check', 'contains')).toMatchObject({ calleeFile: 'Range.java' });
  });

  it('answers what a generic factory returns, from the argument that fills its variable', () => {
    // **`<T extends Visitor> T walk(T visitor, String path)`** returns what it was handed, so
    // `walk(new Visitor(), path).getCount()` is a call on `Visitor`.
    expect(callsFrom('use', 'getCount')).toMatchObject({ calleeFile: 'Visitor.java' });
  });

  it('answers a call on a getter the base declares, and not only one the class does', () => {
    // **`this.style().text()`** - `style` is `AbstractView`'s, and a hop that asked only the class the call is written in
    // found no declaration and refused the whole receiver.
    expect(callsFrom('read', 'text')).toMatchObject({ calleeFile: 'Style.java' });
  });

  it('answers a call on a field the class inherits rather than declares', () => {
    // **`buffer.size()` names a field of `AbstractSource`**, and a name written without `this` was looked for on the
    // class the call sits in alone: `commons-io`'s `PeekableInputStream.peek` reads its base's `buffer` twice.
    expect(callsFrom('peek', 'size')).toMatchObject({
      arm: 'receiverType',
      calleeFile: 'Buffer.java',
    });
  });

  it('answers a member of the class that encloses a nested class', () => {
    // **`Builder.setDirectory` calls `DeferredFileOutputStream.toPath`**, which is the outer class's private static
    // method: Java's lookup walks outward through the classes that lexically contain the call, and this walk stopped at
    // the class the call is written in. Two edges on `commons-io`, one on `commons-lang`.
    expect(callsFrom('setDirectory', 'toPath')).toMatchObject({ calleeFile: 'Deferred.java' });
  });

  it('walks outward one enclosing class at a time', () => {
    // **`Inner.read` calls `Nest.label` through `Middle`**, which declares the name nowhere: the walk passes through
    // the class that does not answer rather than stopping at it.
    expect(callsFrom('read', 'label')).toMatchObject({ arm: 'enclosing', calleeFile: 'Nest.java' });
  });

  it('answers the two methods an enum declares without writing them', () => {
    // **`Case.valueOf(name)` and `Case.values()` have declarations the source never mentions.** `IOCase.forName` in
    // `commons-io` filters its own `values()` and calls `getName()` on each, and neither answered.
    expect(callsFrom('exact', 'valueOf')).toMatchObject({ calleeFile: 'Case.java' });
    expect(callsFrom('find', 'values')).toMatchObject({ calleeFile: 'Case.java' });
    expect(callsFrom('find', 'checkEquals')).toMatchObject({ calleeFile: 'Case.java' });
  });

  it('answers a stream opened with Stream.of, element by element', () => {
    // **`Stream.of(tokens)` holds the elements of `tokens`**, so the lambda is handed a `Token` and its `value()` is a
    // call on that class - `commons-lang`'s `DurationFormatUtils.Token.containsTokenWithValue` is the same three tokens.
    expect(callsFrom('has', 'value')).toMatchObject({ calleeFile: 'Token.java' });
  });

  it('claims no call the checkout does not contain', () => {
    // **`String` is not in this checkout**, and neither is `Object`. A graph that answered them would be claiming an
    // edge into a declaration nobody wrote - which is the failure mode every rule above is measured against.
    expect(calls().filter((call) => call.callee === 'equals')).toHaveLength(0);
  });
});
