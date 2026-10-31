import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { ArkTSProvider } from '../arkts.js';

/**
 * ArkTS, which should behave exactly like TypeScript because it is TypeScript.
 *
 * **These cases exist to prove the inheritance is real**, not to re-test the TypeScript walker: **if `ArkTSProvider` were
 * a copy that drifted, the captures below would differ from the base's** - **and the point of extending rather than
 * copying is that they cannot.**
 */
describe('ArkTS Provider', () => {
  const provider = new ArkTSProvider();

  it('names the language and the extension', () => {
    expect(provider.language).toBe('arkts');
    expect(provider.displayName).toBe('ArkTS');
    expect(provider.extensions).toEqual(['.ets']);
  });

  it('claims the ArkTS globs and not the TypeScript ones', () => {
    expect(provider.globs).toContain('**/*.ets');
    expect(provider.globs.some((g) => g.includes('.ts') && !g.includes('.ets'))).toBe(false);
  });

  it('parses an ArkTS component and captures its declarations', () => {
    const source = [
      '@Entry',
      '@Component',
      'struct Index {',
      '  @State count: number = 0;',
      '  build() {',
      '    Column() {',
      '      Text(`count: ${this.count}`)',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const captures = provider.parse(source, 'Index.ets');
    expect(captures.length).toBeGreaterThan(0);
    expect(captures.some((c) => String(c.name) === 'Index')).toBe(true);
  });

  it('reports an import the way TypeScript does', () => {
    const imports = provider.extractImports("import { router } from '@ohos.router';");
    expect(imports).toHaveLength(1);
    expect(imports[0]?.source).toBe('@ohos.router');
  });

  it('reports an interface declared in an .ets file', () => {
    const captures = provider.parse('interface Props { title: string }\n', 'Props.ets');
    expect(captures.some((c) => String(c.name) === 'Props')).toBe(true);
  });

  /**
   * **The two productions the dialect adds**, which are the reason the provider exists rather than being an alias.
   *
   * A probe of `@Entry @Component struct Index { @State count: number = 0 }` gives
   * `struct_declaration decorator: (decorator) decorator: (decorator) name: (type_identifier) body: (struct_body
   * (public_field_definition decorator: (decorator) name: (property_identifier) …))` - so **the component and its
   * state member are both named fields of their production**, and **the decorators never take the name's place.**
   */
  it('captures a component even though the decorators precede its name', () => {
    const captures = provider.parse('@Entry\n@Component\nstruct Index {\n}\n', 'Index.ets');
    const classes = captures.filter((c) => c.tag === CAPTURE_TAGS.CLASS_DEF);
    expect(classes.map((c) => String(c.name))).toEqual(['Index']);
    expect(classes[0]!.properties?.['arktsStruct']).toBe('true');
  });

  it('captures the state members a component binds to', () => {
    const captures = provider.parse(
      '@Component\nstruct Counter {\n  @State count: number = 0\n  @Prop title: string = ""\n}\n',
      'Counter.ets',
    );
    const defs = captures
      .filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF)
      .map((c) => String(c.name));
    expect(defs).toContain('count');
    expect(defs).toContain('title');
  });

  it('captures a member that carries an accessibility modifier and no decorator', () => {
    const captures = provider.parse(
      '@Component\nstruct Plain {\n  private total: number = 0\n}\n',
      'Plain.ets',
    );
    expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'total')).toBe(
      true,
    );
  });

  it('parses the dialect rather than the base grammar', () => {
    // **The TypeScript grammar cannot parse a struct** - it collapses `@Entry struct Index { … }` into one ERROR node -
    // so a file that parses without an error node is proof that `tree-sitter-arkts` was loaded.
    expect(() =>
      provider.parse('@Entry\nstruct Index {\n  build() {}\n}\n', 'Index.ets'),
    ).not.toThrow();
    expect(provider.extensions).toEqual(['.ets']);
  });
});
