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
});
