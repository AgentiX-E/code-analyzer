// One file, one tree.
//
// **Why this file exists.** The index asked a provider for the same file's syntax tree five times: `parse` built one
// to walk for captures, `extractImports` built one for imports, and the three taint extractors each built their own —
// four of the five thrown away immediately after a single walk. **Measured on this repository's own TypeScript: the
// parse phase spent 23.6 s of a 30.4 s index and held 2.5 GB**, and the duplicated trees were most of both.
//
// **And the cache that was supposed to prevent this did not reach the one caller that mattered.** `isExported` and
// `exportedNames` shared a cache keyed on the source they were handed; `parse` parsed a *sanitised* copy and stored
// nothing, so the keys never matched and every file was parsed twice as well.
//
// **A test of the count, not of the answer.** The answer was always right — five identical trees agree with each other
// — which is exactly why nothing caught this. The observable property is that a provider hands its parser **one**
// source string **once**, and that is what is counted here, by wrapping the parser the provider already holds.

import { describe, expect, it, vi } from 'vitest';

import { JavaProvider } from '../java.js';
import { TypeScriptProvider } from '../typescript.js';

/**
 * The provider's parser, which is `protected` on purpose and reached here on purpose.
 *
 * A public accessor would be a production API added for a test's convenience; the field exists, the test knows the
 * class, and a cast in a test file is honest about that.
 */
function parserOf(provider: unknown): { parse(source: string): unknown } {
  return (provider as { parser: { parse(s: string): unknown } }).parser;
}

const TS_SOURCE = `
export const LIMIT = 10;

export class Counter {
  private total = 0;

  /** Adds one, and says so. */
  increment(by: number): number {
    this.total += by;
    return this.total;
  }
}

function helper(name: string): string {
  return name.trim();
}
`;

const JAVA_SOURCE = `
import java.io.FileWriter;
public class T {
  public void handle(String param) throws Exception {
    FileWriter fw = new FileWriter("/tmp/out.txt", true);
    fw.write("v=" + param);
    fw.close();
  }
}
`;

describe('a file is parsed once, and every reader shares the tree', () => {
  it('parses the TypeScript source once across captures, exports, imports and taint', () => {
    const provider = new TypeScriptProvider();
    // Constructed before the spy: the constructor is where the grammar and the parser are loaded.
    const parser = parserOf(provider);
    const spy = vi.spyOn(parser, 'parse');

    const captures = provider.parse(TS_SOURCE, 'counter.ts');
    expect(captures.length).toBeGreaterThan(0);
    // The four readers the parse phase runs after the walk, each of which used to parse on its own.
    expect(provider.exportedNames(TS_SOURCE).has('Counter')).toBe(true);
    expect(provider.isExported(TS_SOURCE, 'Counter')).toBe(true);
    provider.extractImports(TS_SOURCE);
    provider.extractTaintSinks(TS_SOURCE);
    provider.extractTaintSources(TS_SOURCE);
    provider.extractSanitizers(TS_SOURCE);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('parses the Java source once across captures and all three taint extractors', () => {
    const provider = new JavaProvider();
    const parser = parserOf(provider);
    const spy = vi.spyOn(parser, 'parse');

    provider.parse(JAVA_SOURCE, 'T.java');
    const sinks = provider.extractTaintSinks(JAVA_SOURCE);
    provider.extractTaintSources(JAVA_SOURCE);
    provider.extractSanitizers(JAVA_SOURCE);

    // The extraction still sees the file — a cached tree that answered nothing would satisfy the count and fail the
    // product.
    expect(sinks.some((sink) => sink.sinkType === 'file_write')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('parses again when the source changes, because a tree describes one text', () => {
    const provider = new TypeScriptProvider();
    const parser = parserOf(provider);
    const spy = vi.spyOn(parser, 'parse');

    provider.parse(TS_SOURCE, 'counter.ts');
    const renamed = TS_SOURCE.replace(/Counter/g, 'Tally');
    expect(provider.exportedNames(renamed).has('Tally')).toBe(true);

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('answers the same container for every sibling in a class, from one climb', () => {
    const provider = new TypeScriptProvider();
    const captures = provider.parse(TS_SOURCE, 'counter.ts');
    const members = captures.filter((capture) => capture.containerName === 'Counter');
    // The class itself, its field and its method: three captures, one container, and the memo is what makes the second
    // and third lookups free.
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(members.every((capture) => capture.containerName === 'Counter')).toBe(true);
    expect(provider['containerCache'].size).toBeGreaterThan(0);
  });
});
