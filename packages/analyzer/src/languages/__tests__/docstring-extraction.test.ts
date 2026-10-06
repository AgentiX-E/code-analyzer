// A symbol carries the doc comment written above it.
//
// **The defect this exists for.** `GraphNode.docstring` was `null` on **every node in every language**. The field, the
// `DOCSTRING` tag and the reader in `phase-helpers` all existed, and **no provider put anything in them** - so symbol
// documentation was never extracted, and everything that would use it was empty from the start.
//
// **It was found because a measurement needed it**: the plan for `semantic-search-accuracy` was to query a symbol by
// its own doc comment, which is a query set written by the code's authors rather than by a reviewer. **672
// JSDoc-annotated declarations are in this repository and none of them reached the graph.**
//
// **And the first attempt reached no language.** The consumption sat in the base's `emitCapture`, and **typescript and
// javascript override `walkAndCapture` and build their captures elsewhere** - so a change to the base never ran for
// them. There are two pieces now, and the second is the one that generalises:
//
//   `attachDocComment`          a method a walk can call, used by typescript's `buildCapture`
//   `attachDocCommentsInOrder`  a pass over a file's finished captures, run by the base's `parse`
//
// **The pass cannot be skipped by a walk, because the walk does not own it** - and the base's `parse` is what every
// language goes through, bar `php`, which replaces `parse` itself. **That is the difference between hooking a method
// and hooking a stage**: the first needs every provider to opt in and the second does not.
//
// **What the test asserts is the association, not the text.** A comment has to end up on the symbol it describes and
// not on the one before it, which is the part a walk gets wrong.

import { describe, expect, it } from 'vitest';

import { getOrLoadProvider, groupCaptures } from '../../pipeline/phase-helpers.js';

const SOURCES: Array<{ language: string; file: string; source: string }> = [
  {
    language: 'typescript',
    file: '/kinetic.ts',
    source: [
      '/**',
      ' * Compute the kinetic energy of a moving body.',
      ' *',
      ' * @param mass - kilograms',
      ' */',
      'export function kineticEnergy(mass: number, velocity: number): number {',
      '  return 0.5 * mass * velocity * velocity;',
      '}',
      '',
      'export function undocumented(a: number): number {',
      '  return a;',
      '}',
      '',
      '/** A single line describing the constant below. */',
      'export const PLANCK = 6.626e-34;',
      '',
    ].join('\n'),
  },
  {
    // **Javascript source for the javascript parser.** The first version fed it TypeScript, which has type annotations
    // it cannot read - so it took the regex fallback, and **a fallback that is not the path under test made this a
    // different measurement wearing the same test's name.**
    language: 'javascript',
    file: '/kinetic.js',
    source: [
      '/**',
      ' * Compute the kinetic energy of a moving body.',
      ' *',
      ' * @param mass - kilograms',
      ' */',
      'export function kineticEnergy(mass, velocity) {',
      '  return 0.5 * mass * velocity * velocity;',
      '}',
      '',
      'export function undocumented(a) {',
      '  return a;',
      '}',
      '',
      '/** A single line describing the constant below. */',
      'export const PLANCK = 6.626e-34;',
      '',
    ].join('\n'),
  },
];


describe.each(SOURCES)('the doc comment above a declaration in $language', ({ language, file, source }) => {
  it('reaches the symbol it describes, and not the one after it', async () => {
    const provider = await getOrLoadProvider(language);
    expect(provider).not.toBeNull();

    const grouped = groupCaptures(provider!.parse(source, file) as never, file) as {
      symbols?: Array<{ name: string; docstring?: string | null }>;
    };
    const symbols = grouped.symbols ?? [];
    const docOf = (name: string) => symbols.find((s) => s.name === name)?.docstring ?? '';

    // **The prose arrives without its syntax**: no leading `*`, no `/**`.
    expect(docOf('kineticEnergy')).toContain('kinetic energy of a moving body');
    expect(docOf('kineticEnergy')).not.toContain('*');
    // **And it does not land on the symbol after the one it describes**, which is what carrying a value forward
    // without clearing it produces.
    expect(docOf('undocumented')).toBe('');
    // **The single-line form is a different node shape** from a block comment and has to work too.
    expect(docOf('PLANCK')).toContain('A single line describing the constant');
    // **And exactly one symbol carries it.**
    expect(symbols.filter((s) => (s.docstring ?? '').includes('kinetic energy')).length).toBe(1);
  }, 300_000);
});
