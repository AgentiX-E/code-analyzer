// @code-analyzer/scripts — the names a change writes are not the words a sentence spells
//
// **What this file guards.** §169 rebuilt the symbol set `symbols/symbol-adjacency.mjs` prices its prize on, because
// §168.8 found that twenty-one of the twenty-seven plan entries names a word the golden's *sentence* happens to contain -
// `Potential`, `Calling`, `particularly`, `floor`. The new set is the identifiers **the pull request's own added lines**
// write, and the whole of the repair rests on two exclusions that have to be true of the extractor and not of a sample:
//
//   1. **a keyword is not a name** - `await` is in every diff and in every English sentence about one, so a set that
//      admitted it would re-import the bag of words through the front door;
//   2. **a comment is not code** - the added side of a diff carries prose as often as statements, and `particularly` in a
//      `// ...` line is exactly the kind of token the rarity rule used to admit.
//
// **The third fact is the one that would pass a weaker test and break a real run**: `https://` is not a line comment. A
// stripper that treated every `//` as a comment would drop every identifier on a line that happened to hold a link, and on
// this corpus those lines are the ones that declare the clients a change is about.

import { describe, expect, it } from 'vitest';

import {
  codeNamesOf,
  commentFamily,
  KEYWORDS,
  stripComments,
} from '../../../scripts/lib/code-names.mjs';
import { symbolsTheDiffNames } from '../../../scripts/lib/symbol-anatomy.mjs';

/** A one-file diff, in the shape GitHub returns, with the added and removed lines a caller cares about. */
function diffOf(path: string, added: string[], removed: string[] = []): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${String(Math.max(1, removed.length))} +1,${String(Math.max(1, added.length))} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    '',
  ].join('\n');
}

describe('a name is an identifier the change writes', () => {
  it('keeps the identifiers and drops the keywords', () => {
    const names = codeNamesOf(diffOf('src/app.ts', ['const calendarApp = await appStore.get()']));
    expect(names).toEqual(['appStore', 'calendarApp']);
    // The two that would break the set, named rather than implied.
    expect(names).not.toContain('const');
    expect(names).not.toContain('await');
    expect(KEYWORDS.has('await')).toBe(true);
  });

  it('drops the prose inside a line comment and keeps the statement beside it', () => {
    const names = codeNamesOf(
      diffOf('src/app.ts', [
        'const retryCount = 3; // This is particularly important for flakiness',
      ]),
    );
    expect(names).toContain('retryCount');
    expect(names).not.toContain('particularly');
    expect(names).not.toContain('flakiness');
  });

  it('drops a block comment that crosses lines, which a line-wise stripper cannot', () => {
    const names = codeNamesOf(
      diffOf('src/app.ts', ['/* Potential floor', '   Calling ceil */', 'total = floor(value)']),
    );
    expect(names).toContain('total');
    expect(names).toContain('floor');
    // `Potential`, `Calling` and `ceil` were the words §168.8 caught the old rule admitting; only `floor` survives, and it
    // survives because the statement below the comment calls it.
    expect(names).not.toContain('Potential');
    expect(names).not.toContain('Calling');
    expect(names).not.toContain('ceil');
  });

  it('reads a url as code rather than as the start of a comment', () => {
    const names = codeNamesOf(
      diffOf('src/client.ts', ['const endpoint = "https://api.github.com/v3"; expect(endpoint)']),
    );
    expect(names).toContain('endpoint');
    expect(names).toContain('expect');
    // The one character that distinguishes them is the colon, and a stripper without the rule loses this whole line.
    expect(stripComments('const a = "https://x/y"; const b = 1', 'a.ts')).toContain('const b = 1');
  });

  it('takes the added side only, because a removed name is one the reader cannot see', () => {
    const names = codeNamesOf(
      diffOf('src/app.ts', ['const keptName = 1'], ['const removedName = 2']),
    );
    expect(names).toContain('keptName');
    expect(names).not.toContain('removedName');
  });

  it('strips the comment syntax of the language the path names', () => {
    expect(codeNamesOf(diffOf('scripts/run.py', ['count = 1  # remarkable detail']))).not.toContain(
      'remarkable',
    );
    expect(
      codeNamesOf(diffOf('config/app.yaml', ['timeout: 30  # generous default'])),
    ).not.toContain('generous');
    expect(
      codeNamesOf(diffOf('pom.xml', ['<dependency artifact="junit" /> <!-- transitive only -->'])),
    ).toContain('dependency');
    expect(
      codeNamesOf(diffOf('pom.xml', ['<dependency artifact="junit" /> <!-- transitive only -->'])),
    ).not.toContain('transitive');
    expect(
      codeNamesOf(diffOf('db/schema.sql', ['SELECT orderId FROM cart -- deprecated'])),
    ).not.toContain('deprecated');
  });

  it('names the family a path belongs to, including the file with no extension', () => {
    expect(commentFamily('Dockerfile')).toBe('hash');
    expect(commentFamily('deploy/Makefile')).toBe('hash');
    expect(commentFamily('packages/app/src/index.ts')).toBe('c');
    expect(commentFamily('android/MainActivity.kt')).toBe('c');
    expect(commentFamily('ios/App.swift')).toBe('c');
    expect(commentFamily('harmony/Index.ets')).toBe('c');
    expect(commentFamily('pom.xml')).toBe('markup');
    expect(commentFamily('db/schema.sql')).toBe('dash');
    // A dotfile is a name rather than an extension, and the fallback is the family three of the four such files use.
    expect(commentFamily('.prettierrc')).toBe('hash');
  });

  it('sorts and de-duplicates, so that a record rebuilt from it is byte-stable', () => {
    const once = codeNamesOf(
      diffOf('src/a.ts', ['const alpha = beta + beta', 'const gamma = alpha']),
    );
    const twice = codeNamesOf(
      diffOf('src/a.ts', ['const alpha = beta + beta', 'const gamma = alpha']),
    );
    expect(once).toEqual(twice);
    expect(once).toEqual([...once].sort());
    expect(once.filter((name) => name === 'beta')).toHaveLength(1);
  });

  it('survives the markers a real diff carries', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-const oldName = 1',
      '+const newName = 2',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    expect(codeNamesOf(diff)).toEqual(['newName']);
  });

  it('is empty for a diff that names nothing, which is a fact and not an error', () => {
    expect(codeNamesOf('')).toEqual([]);
    expect(codeNamesOf(diffOf('src/a.ts', ['const x = 1 // nothing of substance']))).toEqual([]);
  });
});

describe('the intersection that makes a sentence about a change', () => {
  it('keeps the order of the symbols and drops the ones the change does not write', () => {
    expect(
      symbolsTheDiffNames(
        ['Potential', 'TopicUser', 'particularly', 'user_count'],
        new Set(['user_count', 'TopicUser']),
      ),
    ).toEqual(['TopicUser', 'user_count']);
  });

  it('is empty when the change writes none of them, which is what the rebuild is for', () => {
    expect(symbolsTheDiffNames(['Potential', 'Calling'], ['TopicUser'])).toEqual([]);
    expect(symbolsTheDiffNames(['TopicUser'], [])).toEqual([]);
    expect(symbolsTheDiffNames([], ['TopicUser'])).toEqual([]);
  });
});
