// @code-analyzer — What a change reaches, in the form a prompt can carry and a test can check
//
// **§95 built the edge layer and every device built on it was null**, and the four nulls had one thing in common: each
// was a filter over sentences that already existed. §100 places the same fact before the sentence, and the placement is
// the whole device - so what is worth testing is not the graph (it has its own suite) but **the shape the graph is
// rendered into**, because that shape is the cost and the value at once: one line per name, the file and line of every
// reader, and a stated count of what a truncated list left out.
//
// **Three properties are load-bearing and each is asserted below.**
//
//   1. **A name and its readers, sorted**, so two runs over one repository produce one block.
//   2. **A cap that says what it hid** - `(+2)` and *"3 more names read outside this file"* - because a list that
//      silently stops is a list whose reader cannot tell a small file from a clipped one.
//   3. **`null` and an empty block are different answers.** A file that declares nothing is silent; a file that
//      declares twelve names nothing imports says so, because that is a change whose blast radius is itself.

import { describe, expect, it } from 'vitest';

import { describeTarget } from '../../llm/prompts.js';
import { reachLine, reachNoteOf } from '../cross-file.js';
import { buildRepoIndex } from '../repo-index.js';

import type { RepoFile } from '../repo-index.js';

/** A repository of four files: one that is read, two that read it, and one nothing reads. */
const FILES: RepoFile[] = [
  {
    path: 'src/limit.ts',
    text: [
      'export function withinLimit(total: number): boolean {',
      '  return total < 10;',
      '}',
      'export function limitFor(kind: string): number {',
      '  return kind === "a" ? 10 : 20;',
      '}',
      'export const UNREAD_MARKER = "nothing imports this";',
    ].join('\n'),
  },
  {
    path: 'src/caller.ts',
    text: [
      'import { withinLimit, limitFor } from "./limit.js";',
      '',
      'export function first(): boolean {',
      '  const limit = limitFor("a");',
      '  return withinLimit(limit);',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/other.ts',
    text: [
      'import { limitFor } from "./limit.js";',
      '',
      'export function second(): number {',
      '  return limitFor("b");',
      '}',
    ].join('\n'),
  },
  { path: 'src/solo.ts', text: ['export const ALONE = 1;'].join('\n') },
];

describe('the reach of a file, as the index answers it', () => {
  it('lists every name another file reads, with the file and line of each reader', () => {
    const index = buildRepoIndex(FILES);
    const note = reachNoteOf(index, 'src/limit.ts');

    expect(note).not.toBeNull();
    // **Sorted by name**, because the block is a prompt fragment and two runs over one repository have to produce one
    // fragment - a Map's insertion order is the order the files happened to be indexed in.
    expect(note!.lines).toEqual([
      'limitFor ← src/caller.ts:4, src/other.ts:4',
      'withinLimit ← src/caller.ts:5',
    ]);
    expect(note!.importers).toBe(2);
    // **`UNREAD_MARKER` is declared and read by nothing outside this file**, which is the other half of the answer.
    expect(note!.unread).toBeGreaterThan(0);
  });

  it('answers null for a file that declares nothing a reader could reach', () => {
    const index = buildRepoIndex([...FILES, { path: 'src/empty.ts', text: '' }]);
    // **A silent file and an unreached file are different facts.** The first gets no section; the second gets a
    // sentence saying its change is contained, which is why the two answers are not both `null`.
    expect(reachNoteOf(index, 'src/empty.ts')).toBeNull();
    expect(reachNoteOf(index, 'src/solo.ts')).not.toBeNull();
    // **And a path the index does not hold is silent too**, which is the case a review meets when it is handed a file
    // the checkout does not contain - a deleted file, or one the corpus fetched from another head.
    expect(reachNoteOf(index, 'src/never-indexed.ts')).toBeNull();
  });

  it('says how much a capped list left out, in both directions', () => {
    const index = buildRepoIndex(FILES);
    const clipped = reachNoteOf(index, 'src/limit.ts', { names: 1, sites: 1 });

    // One name listed, the rest counted; and the one name lists one site with the remainder in brackets.
    expect(clipped!.lines[0]).toContain('(+1)');
    expect(clipped!.lines.at(-1)).toBe('1 more name read outside this file');
    // The cap changes the rendering and not the facts, which is what makes it safe to tune against a token budget.
    expect(clipped!.unread).toBe(reachNoteOf(index, 'src/limit.ts')!.unread);
  });

  it('counts the names it did not list, in the plural it deserves', () => {
    const index = buildRepoIndex([
      {
        path: 'src/three.ts',
        text: 'export const A = 1;\nexport const B = 2;\nexport const C = 3;',
      },
      {
        path: 'src/user.ts',
        text: 'import { A, B, C } from "./three.js";\nexport const sum = A + B + C;',
      },
    ]);
    const clipped = reachNoteOf(index, 'src/three.ts', { names: 1 });
    expect(clipped!.lines[0]).toBe('A ← src/user.ts:2');
    // **Two names hidden, and the sentence says so in the plural.** A list that stopped at one name without this line
    // would be indistinguishable from a file with one reader.
    expect(clipped!.lines.at(-1)).toBe('2 more names read outside this file');
  });

  it('renders one line per file, and names the files when there is more than one', () => {
    const index = buildRepoIndex(FILES);
    const read = reachLine(reachNoteOf(index, 'src/limit.ts')!);
    expect(read).toContain('withinLimit ← src/caller.ts:5');

    const solo = reachLine(reachNoteOf(index, 'src/solo.ts')!);
    // **A file nothing reads still says so**, in one clause, because that is the sentence a reviewer needs and an
    // empty string would be the sentence a reviewer reads as "unknown".
    expect(solo).toContain('read by no other file');
  });

  it('counts what no one reads in the number the count actually is', () => {
    const index = buildRepoIndex([
      { path: 'src/two.ts', text: 'export const A = 1;\nexport const B = 2;\nexport const C = 3;' },
      { path: 'src/one.ts', text: 'export const D = 4;' },
    ]);
    // **Two unread names and one unread name are one character apart and one plural apart.** A block that wrote
    // "1 names" would be a block whose reader has to decide whether the number or the noun is wrong.
    expect(reachLine(reachNoteOf(index, 'src/two.ts')!)).toContain(
      '3 names declared here are read by no other file',
    );
    expect(reachLine(reachNoteOf(index, 'src/one.ts')!)).toContain(
      '1 name declared here is read by no other file',
    );
  });

  it('drops the second clause when every declared name is read somewhere', () => {
    const index = buildRepoIndex([
      { path: 'src/all.ts', text: 'export const ONE = 1;' },
      { path: 'src/use.ts', text: 'import { ONE } from "./all.js";\nexport const two = ONE + 1;' },
    ]);
    const line = reachLine(reachNoteOf(index, 'src/all.ts')!);
    // **The clause is omitted rather than written as "0 names"**: a separator with nothing after it is a token a
    // prompt pays for and a reader has to parse, and the absence of the claim is the claim.
    expect(line).toBe('ONE ← src/use.ts:2');
    expect(line).not.toContain('·');
  });
});

describe('where the block sits in a prompt', () => {
  const base = { diffContent: 'diff --git a/src/limit.ts b/src/limit.ts', changeType: 'modified' };

  it('is absent when the review has no repository, byte for byte', () => {
    const without = describeTarget({ ...base, filePath: 'src/limit.ts' });
    const empty = describeTarget({ ...base, filePath: 'src/limit.ts', reach: '' });
    // **The off switch and the empty answer are one prompt**, so a run with a provider that found nothing is
    // comparable with a run that had none - otherwise the section would be a difference the arm did not make.
    expect(empty).toBe(without);
    expect(without).not.toContain('Cross-file reach');
  });

  it('sits in the file-specific block, beside the change type rather than after the diff', () => {
    const prompt = describeTarget({
      ...base,
      filePath: 'src/limit.ts',
      reach: 'withinLimit ← src/caller.ts:5',
    });
    expect(prompt).toContain('Cross-file reach');
    expect(prompt).toContain('withinLimit ← src/caller.ts:5');
    // **The evidence-not-a-finding sentence is part of the block**, because a model handed a list of callers reports
    // the list: the block has to say what it is for.
    expect(prompt).toContain('not a finding');
    // And it comes before the diff, which `sharedPrefix` appends, so the cached prefix of the five lanes is untouched.
    expect(prompt.indexOf('Cross-file reach')).toBeLessThan(prompt.length);
  });

  it('names each file when the call covers a pull request', () => {
    const prompt = describeTarget({
      ...base,
      scope: 'pull-request',
      filePath: 'src/limit.ts (+1 more)',
      paths: ['src/limit.ts', 'src/caller.ts'],
      reach: 'src/limit.ts: withinLimit ← src/caller.ts:5',
    });
    expect(prompt).toContain('src/limit.ts: withinLimit');
    // **Before the path list**, because the list is what the model reads last and the block is what it reads first.
    expect(prompt.indexOf('Cross-file reach')).toBeLessThan(
      prompt.indexOf('Paths in this pull request'),
    );
  });
});
