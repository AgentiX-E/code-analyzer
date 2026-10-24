// The base provider's own answers: the ones a subclass inherits when it claims nothing.
//
// **Six methods here had never run**: the three default taint walkers and their three regex fallbacks. That is not an
// accident of the test corpus - `extractTaintSources` refuses to walk for a provider that does not override the walker
// (`claimsTaintExtraction`), and every provider that *does* override it therefore replaces the base implementation
// before it can be called. **So the defaults are reachable only from a subclass, and a subclass is exactly what these
// cases are**: the same code path a new provider would inherit, exercised through the public contract rather than
// through a stub.
//
// **The tree is parsed by tree-sitter, not by a hand-built node object.** A fake node would prove that the loop reads
// `childCount` from whatever it was handed, which is the one thing that cannot be wrong about it.

import Parser from 'tree-sitter';
import Kotlin from 'tree-sitter-kotlin';
import { describe, expect, it } from 'vitest';

import { GoProvider } from '../languages/go.js';
import { KotlinProvider } from '../languages/kotlin.js';
import { TreeSitterBaseProvider } from '../languages/tree-sitter-base.js';

import type {
  TaintSanitizer,
  TaintSink,
  TaintSource,
  TreeSitterSyntaxNode,
} from '../languages/tree-sitter-base.js';

/** Kotlin claims no taint extraction, so these three calls resolve to the base implementations. */
class ExposedKotlin extends KotlinProvider {
  walkSources(node: TreeSitterSyntaxNode, out: TaintSource[]): void {
    this.walkForTaintSources(node, out);
  }

  walkSinks(node: TreeSitterSyntaxNode, out: TaintSink[]): void {
    this.walkForTaintSinks(node, out);
  }

  walkSanitizersOf(node: TreeSitterSyntaxNode, out: TaintSanitizer[]): void {
    this.walkForSanitizers(node, out);
  }
}

/** Kotlin with no parser, which is the state a provider is in before its grammar resolves. */
class ParserlessKotlin extends KotlinProvider {
  constructor() {
    super();
    this.parser = null;
    this.languageGrammar = null;
  }
}

/** Go with no parser: Go *claims* taint extraction, so this reaches the base's regex fallbacks. */
class ParserlessGo extends GoProvider {
  constructor() {
    super();
    this.parser = null;
    this.languageGrammar = null;
  }
}

function kotlinTree(source: string): TreeSitterSyntaxNode {
  const parser = new Parser();
  // `tree-sitter-kotlin` ships the same binding shape as the other grammars; the cast is the one the providers
  // themselves make when they hand a grammar to `setLanguage`.
  parser.setLanguage(Kotlin as unknown as Parameters<Parser['setLanguage']>[0]);
  return parser.parse(source).rootNode as unknown as TreeSitterSyntaxNode;
}

describe('tree-sitter base defaults', () => {
  it('collects no taint source, sink or sanitizer when a language claims none', () => {
    const provider = new ExposedKotlin();
    const root = kotlinTree('fun f(cmd: String) { Runtime.getRuntime().exec(cmd) }\n');
    const sources: TaintSource[] = [];
    const sinks: TaintSink[] = [];
    const sanitizers: TaintSanitizer[] = [];
    provider.walkSources(root, sources);
    provider.walkSinks(root, sinks);
    provider.walkSanitizersOf(root, sanitizers);
    expect(sources).toEqual([]);
    expect(sinks).toEqual([]);
    expect(sanitizers).toEqual([]);
  });

  it('answers an empty extraction for a language that claims none, without parsing', () => {
    const provider = new ParserlessKotlin();
    expect(provider.extractTaintSources('fun f() {}')).toEqual([]);
    expect(provider.extractTaintSinks('fun f() {}')).toEqual([]);
    expect(provider.extractSanitizers('fun f() {}')).toEqual([]);
  });

  it('falls back to the regex collectors when a claiming language has no parser', () => {
    // Go overrides the three walkers, so `claimsTaintExtraction` lets the call through; with no parser the base's
    // regex fallbacks are what answers, and theirs is the empty answer.
    const provider = new ParserlessGo();
    expect(provider.extractTaintSources('system(cmd)')).toEqual([]);
    expect(provider.extractTaintSinks('system(cmd)')).toEqual([]);
    expect(provider.extractSanitizers('system(cmd)')).toEqual([]);
  });

  it('reports no exports for a language with no parser instead of parsing nothing', () => {
    expect(new ParserlessKotlin().exportedNames('export default 1')).toEqual(new Set());
  });

  it('derives the base class from a subclass the way the claim check walks', () => {
    // The claim check compares the first prototype in the chain that owns `walkForTaintSources` against the base's
    // own - so Kotlin (which does not override) must compare equal, and Go (which does) must not.
    expect(
      Object.prototype.hasOwnProperty.call(KotlinProvider.prototype, 'walkForTaintSources'),
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(GoProvider.prototype, 'walkForTaintSources')).toBe(
      true,
    );
    expect(Object.getPrototypeOf(KotlinProvider.prototype)).toBe(TreeSitterBaseProvider.prototype);
  });
});
