// An index that cannot be checked is a paragraph, and a paragraph is not an index
//
// **The half of `aoci-code`'s index this repository can hold it to.** Its `F`/`R`/`A`/`S` fields are written by a model
// that read the file, because `s-field-discipline` forbids deriving them from an AST or a scan - a regex-extracted
// invariant is not an invariant. **What that discipline does not forbid is checking the result**: a written index is
// worth its build cost only if its lines can be refused, and a table of prose that anything accepts is a table that will
// fill with prose.
//
// **So this file is the check, and it is deliberately stricter than the format it parses.** Four things are refused:
// a line missing a field, an importance outside 1-9, a field longer than its importance band allows, and a path named
// twice. The first three are `aoci-code`'s own budget policy (`internal/cognitionbudget/policy.go`: `C9` may spend 90
// characters on `R` and 100 on `S`, `C1-C4` only 25 and 20); the fourth is this repository's, because two lines about one
// file is a reader that cannot say which one it read.
//
// **And one thing is refused that `aoci-code` accepts: a line with no `S`.** Its own clause 0 says the constraint is the
// field that cannot be inferred but must not be violated - which means a file with no stated constraint is a file nobody
// read, or a file with nothing to break. **The first is a defect and the second is a `none`, and they are not the same
// string.**

import { describe, expect, it } from 'vitest';

import { parseCognitionIndex, renderCognitionEntry } from '../cognition.js';

/** One line, written the way the format says to write it. */
const LINE =
  'src/queue.ts\tC6M\tF=claims one id and refuses past its retry limit\tR=src/store.ts\tA=claim(id)\tS=claim() never returns an entry past its limit';

describe('an index line, read and refused', () => {
  it('reads six fields into six names', () => {
    const { entries, problems } = parseCognitionIndex(LINE);

    expect(problems).toEqual([]);
    expect(entries).toEqual([
      {
        path: 'src/queue.ts',
        importance: 6,
        size: 'M',
        responsibility: 'claims one id and refuses past its retry limit',
        readWith: ['src/store.ts'],
        dependedOnBy: ['claim(id)'],
        constraint: 'claim() never returns an entry past its limit',
      },
    ]);
  });

  it('round-trips through the renderer, because the index is committed and diffed', () => {
    const { entries } = parseCognitionIndex(LINE);

    expect(renderCognitionEntry(entries[0]!)).toBe(LINE);
  });

  it('names the line and the field when one is missing', () => {
    const { entries, problems } = parseCognitionIndex('src/a.ts\tC6M\tF=something\tR=\tA=thing');

    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.path).toBe('src/a.ts');
    expect(problems[0]?.reason).toContain('S');
  });

  it('refuses an importance the scale does not have', () => {
    const { problems } = parseCognitionIndex(LINE.replace('C6M', 'C0M'));

    expect(problems[0]?.reason).toContain('importance');
  });

  it('spends the band the importance buys, and no more', () => {
    const long = 'x'.repeat(40);
    // A C1 file gets 25 characters for `F`, so forty is refused; the same line at C9 is inside its band.
    const cheap = parseCognitionIndex(`src/a.ts\tC1S\tF=${long}\tR=\tA=thing\tS=none`);
    const rich = parseCognitionIndex(`src/a.ts\tC9S\tF=${long}\tR=\tA=thing\tS=none`);

    expect(cheap.problems[0]?.reason).toContain('F');
    expect(rich.problems).toEqual([]);
  });

  it('refuses a path named twice, because a reader cannot say which line it read', () => {
    const { entries, problems } = parseCognitionIndex([LINE, LINE].join('\n'));

    expect(entries).toHaveLength(1);
    expect(problems[0]?.reason).toContain('twice');
  });

  it('refuses a stated "none" that is not the word, so silence cannot pass for a constraint', () => {
    const { problems } = parseCognitionIndex(
      LINE.replace('S=claim() never returns an entry past its limit', 'S='),
    );

    expect(problems[0]?.reason).toContain('none');
  });

  it('reads a comment and a blank line as neither an entry nor a problem', () => {
    const { entries, problems } = parseCognitionIndex(['# the index', '', LINE].join('\n'));

    expect(entries).toHaveLength(1);
    expect(problems).toEqual([]);
  });
});

describe('the three fields a model is most likely to leave thin', () => {
  it('refuses a row whose first column is empty, because there is no file it is about', () => {
    const { problems } = parseCognitionIndex('\tC6M\tF=x\tR=\tA=y\tS=none');

    expect(problems[0]?.reason).toContain('path');
  });

  it('refuses an F that is present and empty', () => {
    const { problems } = parseCognitionIndex('src/a.ts\tC6M\tF=\tR=\tA=y\tS=none');

    expect(problems[0]?.reason).toContain('nobody wrote');
  });

  it('names the tag when a row has no tag at all, rather than the path it does have', () => {
    const { problems } = parseCognitionIndex('src/only-a-path.ts');

    expect(problems[0]?.path).toBe('src/only-a-path.ts');
    expect(problems[0]?.reason).toContain('tag');
  });

  it('ignores a column that is none of the four fields', () => {
    const { entries, problems } = parseCognitionIndex(`${LINE}\tX=ignored`);

    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
  });

  it('refuses an S longer than the band its importance buys', () => {
    const { problems } = parseCognitionIndex(`src/a.ts\tC1S\tF=ok\tR=\tA=y\tS=${'z'.repeat(30)}`);

    expect(problems[0]?.reason).toContain('S spends');
  });
});
