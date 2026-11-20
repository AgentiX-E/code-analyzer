// The ArkTS corpus this repository did not have, and the two defects the first run over it found.
//
// **Why a real application and not another hand-written snippet.** Every ArkTS case in `arkts.test.ts` is a string this
// repository wrote, and **a grammar is only ever as good as the code nobody in this repository wrote**: the `struct`
// production was found by a probe, and a probe is a case someone thought of. These six files were written by people
// building HarmonyOS applications. Five are the dialect the provider claims; **the sixth is ArkTS 1.2, which spells a
// memoised closure `wrapper = @memo () => {…}` and which grammar 0.3.0 cannot parse at all.**
//
// **The failing file is in the corpus on purpose.** A corpus that keeps only what passes reports one hundred per cent
// forever. The tripwire below names the construct and the file, so the day the grammar gains it this test fails and asks
// for a raised floor rather than quietly staying green.
//
// **And it found two things a synthetic case could not:**
//
// | what the corpus said | mechanism | before | after |
// | --- | --- | --- | --- |
// | `Column() { … }` is not a call | the grammar spells it `arkui_component_expression` | 0 of 25 components | 25 of 25 |
// | one unsupported statement costs the file | any `ERROR` demoted the file to the regex reader | 0 components, 0 methods | 5 and 3, on the page that has the error |

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAPTURE_TAGS } from '../../packages/shared/src/index.js';
import Parser from 'tree-sitter';
import { describe, expect, it } from 'vitest';

import { ArkTSProvider } from '../../packages/analyzer/src/languages/arkts.js';

const require = createRequire(import.meta.url);
const ArkTSGrammar = require('tree-sitter-arkts') as unknown as Parser.Language;

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/corpus/arkts');

interface Source {
  file: string;
  repo: string;
  commit: string;
  path: string;
  license: string;
  sha256: string;
}

const sources = (
  JSON.parse(readFileSync(join(CORPUS, 'SOURCES.json'), 'utf8')) as { sources: Source[] }
).sources;

const files = sources.map((source) => ({
  source,
  text: readFileSync(join(CORPUS, source.file), 'utf8'),
}));

const parser = new Parser();
parser.setLanguage(ArkTSGrammar);

/** What the tree says about one file, independent of the provider under test. */
function facts(text: string) {
  const root = parser.parse(text).rootNode;
  let errors = 0;
  let components = 0;
  const structs: string[] = [];
  const errorTexts: string[] = [];
  const walk = (node: Parser.SyntaxNode | null): void => {
    if (!node) return;
    if (node.type === 'ERROR') {
      errors += 1;
      errorTexts.push(node.text);
    }
    if (node.type === 'arkui_component_expression') components += 1;
    if (node.type === 'struct_declaration') {
      const name = node.childForFieldName('name');
      if (name) structs.push(name.text);
    }
    for (let at = 0; at < node.childCount; at += 1) walk(node.child(at));
  };
  walk(root);
  return { errors, components, structs, errorTexts };
}

/**
 * **The same provider with one policy restored**, so the before-and-after below is measured on one file rather than
 * quoted from a run.
 *
 * This is not a mock of the thing under test: `readsThroughErrors` is the switch the base class added, and this subclass
 * is the base class's answer. **A control that is a copy of the old behaviour is the only control that can price the
 * new one.**
 */
class Conservative extends ArkTSProvider {
  protected override readsThroughErrors(): boolean {
    return false;
  }
}

const drawn = (captures: ReturnType<ArkTSProvider['parse']>) =>
  captures.filter((capture) => capture.properties?.['arkuiComponent'] === 'true');

describe('the ArkTS corpus that came from an application rather than from this repository', () => {
  it('pins every file to a commit and a digest, and the digest still matches', () => {
    expect(sources.length).toBeGreaterThanOrEqual(6);
    for (const { source, text } of files) {
      expect(source.license).toBe('Apache-2.0');
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(createHash('sha256').update(text).digest('hex')).toBe(source.sha256);
    }
  });

  it('parses five of the six, and the sixth fails on one named construct', () => {
    const clean = files
      .filter(({ text }) => facts(text).errors === 0)
      .map(({ source }) => source.file);
    const broken = files
      .filter(({ text }) => facts(text).errors > 0)
      .map(({ source, text }) => ({ file: source.file, ...facts(text) }));

    expect(clean).toHaveLength(5);
    // **The tripwire.** One file, one error node, and its text is the ArkTS 1.2 memo closure - a decorator applied to an
    // arrow function, which `tree-sitter-arkts` 0.3.0 has no production for. If the grammar gains it this fails and says
    // which floor to raise; if a different construct starts failing it fails and says which.
    expect(broken).toHaveLength(1);
    expect(broken[0]!.file).toBe('camera-index.ets');
    expect(broken[0]!.errors).toBe(1);
    expect(broken[0]!.errorTexts[0]).toContain('@memo');
  });

  it('captures every component a real file draws, and the struct that draws it', () => {
    const provider = new ArkTSProvider();
    let components = 0;
    let structs = 0;

    for (const { source, text } of files) {
      const truth = facts(text);
      const captures = provider.parse(text, source.file);

      // **Equality rather than a floor**, because the walk sees every `arkui_component_expression` in the tree and the
      // provider's only rule for the production emits this one property: a lower count means a branch stopped matching,
      // a higher one means something else emits the property.
      expect(drawn(captures), `${source.file}: components drawn`).toHaveLength(truth.components);
      components += truth.components;

      const declared = captures.filter(
        (capture) =>
          capture.tag === CAPTURE_TAGS.CLASS_DEF && capture.properties?.['arktsStruct'] === 'true',
      );
      expect(
        declared.map((capture) => String(capture.name)).sort(),
        `${source.file}: structs`,
      ).toEqual(truth.structs.sort());
      structs += truth.structs.length;
    }

    // The corpus is worth carrying only if it carries both: **twenty-five components and seven structs** is the size at
    // which a grammar regression has somewhere to show up.
    expect(components).toBeGreaterThanOrEqual(25);
    expect(structs).toBeGreaterThanOrEqual(7);
  });

  /**
   * **A grammar error is a property of one span, and the page keeps the rest.**
   *
   * `camera-index.ets` is a real page: one struct, one `build()`, five layout components and three methods. The
   * conservative policy - any `ERROR` means the grammar cannot read the file - hands the whole page to the regular
   * expression reader, and **what comes back is its struct name, its twelve imports and nothing it contains.** Reading
   * through the error keeps the tree, steps over the one span with no structure, and returns **all five components and
   * all three methods**.
   *
   * **Both halves are asserted on the same file**, because the point is the difference and a difference needs two
   * numbers.
   */
  it('keeps the page a grammar error used to cost, and says that it read it partially', () => {
    const page = files.find(({ source }) => source.file === 'camera-index.ets')!;
    const truth = facts(page.text);
    expect(truth.errors).toBe(1);
    expect(truth.components).toBe(5);

    const conservative = new Conservative().parse(page.text, page.source.file);
    expect(drawn(conservative)).toHaveLength(0);
    expect(conservative.some((capture) => capture.name === 'build')).toBe(false);

    const provider = new ArkTSProvider();
    const captures = provider.parse(page.text, page.source.file);
    expect(drawn(captures)).toHaveLength(5);
    expect(
      captures
        .filter((capture) => capture.tag === CAPTURE_TAGS.METHOD_DEF)
        .map((capture) => String(capture.name)),
    ).toContain('build');
    expect(
      captures.some(
        (capture) =>
          capture.tag === CAPTURE_TAGS.CLASS_DEF && capture.properties?.['arktsStruct'] === 'true',
      ),
    ).toBe(true);

    // **And the caller can tell it was a partial read**, which is the difference between a number and a claim: a symbol
    // count from a file the grammar half-read is not the same evidence as one from a file it read.
    expect(provider.lastParseReadThroughErrors).toBe(true);
  });

  it('does not report a partial read on the files it read whole', () => {
    const provider = new ArkTSProvider();
    for (const { source, text } of files) {
      provider.parse(text, source.file);
      if (facts(text).errors > 0) continue;
      expect(provider.lastParseReadThroughErrors, `${source.file}`).toBe(false);
      expect(provider.lastParseWasARegularExpressionFallback, `${source.file}`).toBe(false);
    }
  });

  it('captures the lifecycle method every component has', () => {
    const provider = new ArkTSProvider();
    for (const { source, text } of files) {
      const captures = provider.parse(text, source.file);
      const methods = captures
        .filter((capture) => capture.tag === CAPTURE_TAGS.METHOD_DEF)
        .map((capture) => String(capture.name));
      expect(methods, `${source.file}: build()`).toContain('build');
    }
  });
});
