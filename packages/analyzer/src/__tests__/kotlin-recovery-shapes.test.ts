/**
 * The Kotlin shapes a walk has to survive rather than the ones it was written for.
 *
 * **Iteration 86 found these by reading the coverage report and asking what each uncovered arm was for.** Four of them
 * were import and property shapes no test had written, and the rest were the half-written declarations a formatter run
 * leaves in a file that is being saved while it is indexed. A parser that throws on those loses the whole file; one that
 * answers with what it can see keeps the other ninety percent of it, which is why the guards exist and why they are
 * tested here rather than annotated as unreachable.
 */

import { describe, expect, it } from 'vitest';

import { KotlinProvider } from '../languages/kotlin.js';

const provider = new KotlinProvider();

const names = (source: string): string[] =>
  provider
    .extractImports(source)
    .flatMap((entry) => entry.names)
    .sort();

describe('the shapes a Kotlin import is written in', () => {
  it('takes the last segment of a plain named import', () => {
    expect(names('import java.util.List')).toEqual(['List']);
  });

  it('takes the last segment of a nested one', () => {
    expect(names('import kotlinx.coroutines.flow.collectLatest')).toEqual(['collectLatest']);
  });

  it('prefers the alias over the last segment', () => {
    const imports = provider.extractImports('import java.util.List as JList');
    expect(imports.map((entry) => entry.names)).toEqual([['JList']]);
    expect(imports[0]!.source).toBe('java.util.List');
  });

  it('reads a wildcard as an import of every name in a package', () => {
    const imports = provider.extractImports('import java.util.*');
    expect(imports[0]!.names).toEqual([]);
    expect(imports[0]!.type).toBe('wildcard');
  });

  /**
   * **A truncated aliased import is what a save-in-progress looks like.** The Kotlin grammar builds no `import_header`
   * for `import a.b as` — the fragment is wrapped in an error node — so the honest answer is that this file declares no
   * import, rather than an import of a name nobody wrote.
   */
  it('reads no import out of a truncated one', () => {
    expect(provider.extractImports('import java.util.List as')).toEqual([]);
  });
});

describe('the shapes a Kotlin property is written in', () => {
  it('reads the declared type of a top-level property', () => {
    const captures = provider.parse('val limit: Int = 3', 'a.kt');
    const declared = captures.filter((capture) => capture.tag === 'variable.def');
    expect(declared.some((capture) => capture.name === 'limit')).toBe(true);
  });

  /**
   * **A property with no initialiser is a field and not a declaration.** Kotlin allows `var count: Int` in a class
   * body, and the fact the resolver needs is the type the class files under that name — which is what `fieldTypes`
   * carries, keyed by the name the class declares.
   */
  it('files the type of a property with no initialiser under its class', () => {
    const [capture] = provider.parse('class A {\n  var count: Int\n}', 'a.kt');
    expect(JSON.parse(capture!.properties?.['fieldTypes'] as string)).toEqual({ count: 'Int' });
  });

  it('survives a property whose type is missing', () => {
    expect(() => provider.parse('class A {\n  val = 1\n}', 'a.kt')).not.toThrow();
  });

  it('files a constructor property under its class', () => {
    const [capture] = provider.parse('class Box(val width: Int, var height: Int)', 'a.kt');
    expect(JSON.parse(capture!.properties?.['fieldTypes'] as string)).toEqual({
      width: 'Int',
      height: 'Int',
    });
  });

  /**
   * **A constructor property with no enclosing class cannot be filed under one.** The shape reaches this code through
   * error recovery — `val width: Int` inside a class header that was cut off — and the walk has to say nothing rather
   * than invent an owner.
   */
  it('says nothing about a constructor property with no class around it', () => {
    expect(() => provider.parse('(val width: Int)', 'a.kt')).not.toThrow();
  });
});

describe('the shapes a Kotlin class header is written in', () => {
  it('separates the superclass from the interfaces', () => {
    const captures = provider.parse('class A : Base(), Runnable, Closeable', 'a.kt');
    const declared = JSON.stringify(captures);
    expect(declared).toContain('Base');
    expect(declared).toContain('Runnable');
    expect(declared).toContain('Closeable');
  });

  it('survives a supertype that names nothing', () => {
    expect(() => provider.parse('class A : ()', 'a.kt')).not.toThrow();
  });
});
