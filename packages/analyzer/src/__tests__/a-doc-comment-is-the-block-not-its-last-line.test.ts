// **A doc comment is the block, and one line of it is not the block.**
//
// Every question in the cross-repository corpus is the **first sentence** of the symbol's `docstring`, and the answer is
// that symbol. So a provider that keeps only the last line of a three-line comment asks a question nobody wrote, against
// an answer key that is still correct - and the retrieval figure falls with nothing in it to say why.
//
// `tree-sitter-base.ts` joins consecutive line comments into one block, and its own comment says so: *"Go documents a
// function with three `//` lines and Godoc renders all three; a pass that kept only the last line would hand the graph
// the third of three sentences."* **For Rust it does exactly that.** tree-sitter-rust spells `/// text` as a
// `line_comment` node that *contains* an `outer_doc_comment_marker` and a `doc_comment`, and the pass that collects
// comments from the tree sees both: two captures for one line, with two different texts (`/// text` and ` text`). The
// join rule reads "the next capture starts on the line after the pending one" and the duplicate starts on the *same*
// line, so it replaces the block instead of extending it - and a four-line doc comment arrives as its last sentence.
//
// These tests hold the block together, in the two languages whose documentation the corpus is about to grow into.

import { describe, expect, it } from 'vitest';

import { GoProvider } from '../languages/go.js';
import { KotlinProvider } from '../languages/kotlin.js';
import { RustProvider } from '../languages/rust.js';

import type { UnifiedCapture } from '@code-analyzer/shared';

/** The `docstring` a capture carries, or `undefined` when it carries none. */
function docstringOf(capture: UnifiedCapture): string | undefined {
  const value = (capture.properties as Record<string, unknown>)['docstring'];
  return typeof value === 'string' ? value : undefined;
}

/** The one declaration capture in a parse, by name. **A test that found two would be measuring the wrong thing.** */
function documented(captures: readonly UnifiedCapture[], name: string): string | undefined {
  const matches = captures.filter(
    (capture) =>
      capture.name === name &&
      (capture.tag === 'function.def' ||
        capture.tag === 'method.def' ||
        capture.tag === 'class.def'),
  );
  expect(matches).toHaveLength(1);
  return docstringOf(matches[0]!);
}

describe('a doc comment is the block, not its last line', () => {
  it('joins a two-line Go comment, which is how godoc documents a function', () => {
    const source = `package kinetic

// KineticEnergy returns the energy of a body of the given mass moving at the given speed.
// It is the quantity that the collision model integrates over.
func KineticEnergy(mass, speed float64) float64 {
	return 0.5 * mass * speed * speed
}
`;
    // **Both sentences, in the order they were written**, because the first one is what a question is taken from and the
    // second is what says which quantity is meant.
    expect(documented(new GoProvider().parse(source, 'kinetic.go'), 'KineticEnergy')).toBe(
      'KineticEnergy returns the energy of a body of the given mass moving at the given speed.\nIt is the quantity that the collision model integrates over.',
    );
  });

  it('joins a Rust doc comment across its empty `///` separator line', () => {
    const source = `/// Returns the kinetic energy of a body, in joules.
///
/// The caller is responsible for keeping the units consistent.
pub fn kinetic_energy(mass: f64, speed: f64) -> f64 {
    0.5 * mass * speed * speed
}
`;
    const doc = documented(new RustProvider().parse(source, 'kinetic.rs'), 'kinetic_energy');

    // **The first sentence survives.** It is the one the corpus turns into a question, and the one a provider that keeps
    // the last line throws away.
    expect(doc).toContain('Returns the kinetic energy of a body, in joules.');
    expect(doc).toContain('The caller is responsible for keeping the units consistent.');
    // **And the marker is not prose.** `///` is three characters of syntax; a docstring that begins with it would be
    // indexed, embedded and searched as a sentence that starts with punctuation.
    expect(doc).not.toContain('///');
  });

  it('does not put the same sentence in the index twice', () => {
    const source = `/// Momentum of a body, conserved in a closed system.
pub fn momentum_of(mass: f64, velocity: f64) -> f64 {
    mass * velocity
}
`;
    const doc = documented(new RustProvider().parse(source, 'kinetic.rs'), 'momentum_of');

    // **One sentence, once.** The duplicate capture is what replaces the block rather than extending it, so counting the
    // occurrences is the same test as checking the join - and it is the one that fails loudest when the rule regresses.
    expect(doc).toBe('Momentum of a body, conserved in a closed system.');
    expect(doc!.match(/Momentum/g) ?? []).toHaveLength(1);
  });

  it('keeps a Kotlin block comment whole, because the block is one node there', () => {
    const source = `/**
 * Computes the kinetic energy of a body.
 *
 * The caller owns the units.
 */
fun kineticEnergy(mass: Double, speed: Double): Double = 0.5 * mass * speed * speed
`;
    const doc = documented(new KotlinProvider().parse(source, 'kinetic.kt'), 'kineticEnergy');

    // **The control for the join rule**: Kotlin writes one `/** … */` node, so this passed before the fix and has to
    // keep passing after it. A change that repairs Rust by rewriting how blocks are joined would break this.
    expect(doc).toContain('Computes the kinetic energy of a body.');
    expect(doc).toContain('The caller owns the units.');
    expect(doc).not.toContain('/**');
    expect(doc).not.toContain('*');
  });
});
