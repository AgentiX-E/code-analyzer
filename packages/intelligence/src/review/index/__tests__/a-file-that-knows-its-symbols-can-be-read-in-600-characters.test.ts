// A file that knows its own symbols can be read in 600 characters instead of 6 000
//
// **The measurement this answers.** `code-context.ts` records it in its own header: of 160 rejected findings on 36 pull
// requests, 91 were rejected on the golden's exact line - "the reviewer was not looking in the wrong place, it was saying
// the wrong thing about the right one". §78 answered that with 6 000 characters of surrounding lines and returned
// −0.0022 F1. **The window was the wrong instrument**: it shows a reader lines around a change without saying what those
// lines belong to.
//
// **What replaces it is an index, and the shape of the index is the whole argument.** `aoci-spec/aoci-code` carries 628
// lines of index for a 188 020-line repository - one line per file, naming what the file is for, what must be read with
// it, what callers depend on and which constraint cannot be inferred. `Wilfred/difftastic` narrows the other way: it
// computes which lines are novel and hands over only those. **Both are indexes; neither widens.** A window is what you
// read when you have no index, and this file is the first that reads one instead.
//
// **The index here is derived rather than written, and the difference is stated rather than glossed.** `aoci-code`'s own
// `s-field-discipline` forbids building `F`/`R`/`A`/`S` from an AST, an import scan or a regular expression, on the
// ground that a regex-extracted invariant is not an invariant but a string that happens to sit next to one. That rule is
// right about *semantics* and says nothing about *structure*: which name is declared on which line, whether it is
// exported, and which guard sits inside it are facts a lexer can establish and a reader can check by opening the file.
// **So this module produces structure and refuses to produce meaning** - there is no `responsibility` field and no
// `constraint` field, and a future model-written pass would add them beside these rather than instead of them.

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex, selectIndexedContext } from '../symbols.js';

const SERVICE = [
  '// The queue that decides which pull requests are reviewed.',
  "import { open } from './store.js';",
  '',
  'export interface QueueEntry {',
  '  readonly id: string;',
  '  readonly attempts: number;',
  '}',
  '',
  'const RETRY_LIMIT = 3;',
  '',
  'export function claim(id: string): QueueEntry | null {',
  '  const entry = open(id);',
  '  if (entry === null) {',
  '    throw new Error(`no entry ${id}`);',
  '  }',
  '  if (entry.attempts >= RETRY_LIMIT) {',
  '    return null;',
  '  }',
  '  return entry;',
  '}',
  '',
  'export class Worker {',
  '  private readonly name: string;',
  '',
  '  constructor(name: string) {',
  '    this.name = name;',
  '  }',
  '',
  '  run(): number {',
  '    return RETRY_LIMIT;',
  '  }',
  '}',
].join('\n');

describe('a file read as symbols rather than as lines', () => {
  it('names every declaration with the lines it occupies', () => {
    const index = buildSymbolIndex('src/queue.ts', SERVICE);

    expect(
      index.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.startLine, symbol.endLine]),
    ).toEqual([
      ['QueueEntry', 'interface', 4, 7],
      ['RETRY_LIMIT', 'const', 9, 9],
      ['claim', 'function', 11, 20],
      ['Worker', 'class', 22, 32],
    ]);
  });

  it('separates what the file offers from what it keeps', () => {
    const index = buildSymbolIndex('src/queue.ts', SERVICE);

    expect(index.exported).toEqual(['QueueEntry', 'claim', 'Worker']);
  });

  it('keeps the signature and drops the body, because the body is what the finding is about', () => {
    const index = buildSymbolIndex('src/queue.ts', SERVICE);
    const claim = index.symbols.find((symbol) => symbol.name === 'claim');

    expect(claim?.signature).toBe('export function claim(id: string): QueueEntry | null {');
  });

  it('reads a member as a member rather than as a second top-level declaration', () => {
    const index = buildSymbolIndex('src/queue.ts', SERVICE);
    const worker = index.symbols.find((symbol) => symbol.name === 'Worker');

    expect(worker?.members.map((member) => [member.name, member.kind])).toEqual([
      ['name', 'property'],
      ['Worker', 'constructor'],
      ['run', 'method'],
    ]);
  });
});

describe('a lexer that must not be fooled by text that is not code', () => {
  it('does not read a declaration out of a comment', () => {
    const index = buildSymbolIndex(
      'src/a.ts',
      ['// export function ghost() {}', 'export const real = 1;'].join('\n'),
    );

    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['real']);
  });

  it('does not read one out of a string, or count its braces', () => {
    const index = buildSymbolIndex(
      'src/a.ts',
      ['const label = "export function ghost() {";', 'export const real = 1;'].join('\n'),
    );

    expect(index.symbols.map((symbol) => symbol.name)).toEqual(['label', 'real']);
  });

  it('carries an open template literal across lines instead of ending the symbol in it', () => {
    const index = buildSymbolIndex(
      'src/a.ts',
      [
        'export function render(): string {',
        '  return `',
        '  { not a block }',
        '  `;',
        '}',
        'export const after = 2;',
      ].join('\n'),
    );

    // The template's braces must not close the function early, and the declaration after it must still be found.
    expect(index.symbols.map((symbol) => [symbol.name, symbol.endLine])).toEqual([
      ['render', 5],
      ['after', 6],
    ]);
  });
});

describe('the context a claim is given once the file is indexed', () => {
  const index = buildSymbolIndex('src/queue.ts', SERVICE);

  it('answers with the symbol the claim stands in, not with the lines around it', () => {
    const context = selectIndexedContext({ index, lines: [15] }).text;

    // The signature, and the guards that could refute a sentence about the line - and nothing from `Worker`.
    expect(context).toContain('L11: export function claim(id: string): QueueEntry | null {');
    expect(context).toContain('L15:');
    expect(context).toContain('throw new Error');
    expect(context).not.toContain('constructor');
  });

  it('says what the file offers, because a claim about a private helper is a different claim', () => {
    const context = selectIndexedContext({ index, lines: [15] }).text;

    expect(context).toContain('exports: QueueEntry, claim, Worker');
  });

  it('costs a fortieth of the window it replaces', () => {
    const context = selectIndexedContext({ index, lines: [15] }).text;
    // §78's surrounding block was 6 000 characters; the bar here is 600, and the ratio is the device's whole claim.
    expect(context.length).toBeLessThanOrEqual(600);
    expect(context.length).toBeGreaterThan(100);
  });

  it('fails open on a line no symbol contains, with the line and its neighbours rather than with nothing', () => {
    const bare = buildSymbolIndex(
      'src/b.ts',
      ['const a = 1;', '', 'type Ghost = { x: 1 };'].join('\n'),
    );
    const context = selectIndexedContext({ index: bare, lines: [2] }).text;

    // A prompt that says nothing about a claim is a prompt the reader answers from the diff alone, which is where it was.
    expect(context).toContain('L2:');
    expect(context).toContain('L1: const a = 1;');
  });

  it('spends its whole budget on several claims before it spends a line beyond it', () => {
    const context = selectIndexedContext({ index, lines: [15, 29], budget: 400 }).text;

    expect(context.length).toBeLessThanOrEqual(400);
    // Two claims, two symbols, and the budget is shared rather than given to the first.
    expect(context).toContain('claim');
    expect(context).toContain('run');
  });
});
