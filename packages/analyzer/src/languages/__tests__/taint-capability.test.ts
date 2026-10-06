// Taint extraction where the language has not claimed it.
//
// **The defect this exists for.** The base implements `extractTaintSources`, `extractTaintSinks` and
// `extractSanitizers` for every language, and its walks recognise nothing:
//
//   protected walkForTaintSources(node, sources): void {
//     // Base default: no taint sources are recognized. Subclasses override this
//     for (const child of childrenOf(node)) this.walkForTaintSources(child, sources);
//   }
//
// **So a language with no taint vocabulary paid a full parse and a full tree walk, three times per file, for three
// empty arrays.** On the corpus that was measured, TypeScript spent 14 + 13 + 17 ms per file and returned nothing
// each time.
//
// **And the follow-up corrected the reason.** TypeScript does override the walks - they delegate to
// `collectCLikeTaintSources` - so those forty-four milliseconds were **a correct scan of a file that happens to hold
// no taint sources**, not waste. The earlier reading, that eighteen seconds of the corpus were spent computing
// nothing, was wrong. **The waste is narrower and real**: the base's own walks traverse the entire tree and collect
// nothing, and only a language that never overrode them reaches that.
//
// **A language that overrides `extractTaintSources` itself never reaches the base and is unaffected**, which is why
// the claim is read only from the walks: toml, sql and markdown implement the method directly.

import { describe, expect, it } from 'vitest';

import { claimsTaintExtraction } from '../tree-sitter-base.js';
import { getOrLoadProvider } from '../../pipeline/phase-helpers.js';

/** A provider whose prototype declares a taint walk, built without subclassing the abstract base. */
function withADeclaredWalk<T extends object>(provider: T): T {
  const proto = Object.create(Object.getPrototypeOf(provider) as object) as Record<string, unknown>;
  proto['walkForTaintSources'] = function walkForTaintSources(): void {};
  return Object.assign(Object.create(proto) as object, provider) as T;
}

describe('the taint capability claim', () => {
  it('is claimed by TypeScript, whose walks delegate to a real collector', async () => {
    const ts = await getOrLoadProvider('typescript');
    expect(ts).not.toBeNull();
    // **True, and that is the corrected finding**: it overrides the walks, so its cost is a real scan rather than
    // the base's traverse-and-collect-nothing. The guard leaves it alone.
    expect(claimsTaintExtraction(ts)).toBe(true);
  });

  it('is not claimed by a provider whose chain never declares a walk', async () => {
    const ts = (await getOrLoadProvider('typescript')) as unknown as object;
    // The base class itself, which declares the walks that collect nothing.
    const { TreeSitterBaseProvider } = await import('../tree-sitter-base.js');
    const bare = Object.create(TreeSitterBaseProvider.prototype) as object;
    expect(claimsTaintExtraction(bare)).toBe(false);
    expect(withADeclaredWalk(ts)).toBeTruthy();
  });

  it('costs no parse when the capability is not claimed, and one parse when it is', async () => {
    const ts = (await getOrLoadProvider('typescript')) as unknown as Record<string, unknown>;
    let parses = 0;
    const counting = {
      parse: () => {
        parses += 1;
        return { rootNode: { type: 'program', children: [], text: '' } };
      },
    };

    // Unclaimed: a provider whose chain never declares a walk. TypeScript claims it, so this uses the base directly.
    const { TreeSitterBaseProvider } = await import('../tree-sitter-base.js');
    const bare = Object.assign(Object.create(TreeSitterBaseProvider.prototype), ts, { parser: counting });
    parses = 0;
    expect((bare as unknown as { extractTaintSources(s: string): unknown[] }).extractTaintSources('const x = 1;')).toHaveLength(0);
    expect((bare as unknown as { extractTaintSinks(s: string): unknown[] }).extractTaintSinks('const x = 1;')).toHaveLength(0);
    expect((bare as unknown as { extractSanitizers(s: string): unknown[] }).extractSanitizers('const x = 1;')).toHaveLength(0);
    // **The assertion the artifact cites**: three empty results used to cost three parses and three tree walks.
    expect(parses).toBe(0);

    // Claimed: the language pays for the walk it declared.
    const claimed = Object.assign(withADeclaredWalk(ts), { parser: counting, languageGrammar: {} });
    parses = 0;
    (claimed as unknown as { extractTaintSources(s: string): unknown[] }).extractTaintSources('const x = 1;');
    expect(parses).toBe(1);
  });
});
