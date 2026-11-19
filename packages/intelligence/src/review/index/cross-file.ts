// @code-analyzer — The index's second reader: what a file's names reach, said in one line a prompt can carry
//
// **`impactOf` answers a query, and a reviewer does not ask queries.** §95 built the edge layer and measured it as a
// selector: a fact about a file's shape cannot separate two comments filed against the same shape, and the cross-file
// witness it produced was the fourth null in four attempts. **What the four nulls had in common is that all four were
// filters.** The fact was computed after the sentences existed, and a filter can only delete sentences.
//
// **This is the same fact, placed before the sentence.** A lane reading one file's diff cannot see the caller that
// still passes the old arity, because the caller is in another file and the diff does not contain it — and that
// sentence, *"three callers still pass two arguments"*, is the class of remark a repo-level reviewer sells and this
// engine had no way to make. **The index knows it for free and knows it before the call.**
//
// **What it is not.** It is not a finding and it is not a check: it is a list of names and the lines that read them, and
// whether one of those lines is now wrong is the lane's judgement. **An index that asserted the defect would be a
// linter, and this corpus already measured what a linter's assertions are worth on it (§93).**

import type { RepoIndex } from './repo-index.js';

/** One name this file declares, and where outside this file it is read. */
export interface ReachName {
  readonly name: string;
  /** `path:line`, in the order the index sorted them, at most `SITES_PER_NAME` of them. */
  readonly sites: readonly string[];
  /** How many sites there were before the cap, so a truncated list says how much it truncated. */
  readonly siteCount: number;
}

/**
 * **What one changed file reaches, in the shape a prompt renders and a test can assert.**
 *
 * `lines` is one entry per name another file reads, already formatted, because **the formatting is part of the
 * measurement**: a block of prose costs tokens and a block of `name ← path:line` does not, and the same fact written
 * twice would be two prices for one device.
 */
export interface ReachNote {
  readonly path: string;
  readonly lines: readonly string[];
  /** Names this file declares that nothing outside it reads, which is the other half of *what does this change reach*. */
  readonly unread: number;
  /** Distinct files that read at least one name from this file. */
  readonly importers: number;
}

/** How many reading sites one name lists before it is summarised. Three, because a fourth adds a token and no fact. */
export const SITES_PER_NAME = 3;

/** How many names one note lists. Six, and a note that lists everything is a note that costs more than it says. */
export const NAMES_PER_NOTE = 6;

/**
 * **The note for one file, or `null` when the index has nothing to say about it.**
 *
 * `null` and an empty note are deliberately different answers. `null` is *this file declares nothing any other file
 * could read* — a configuration file, a test, a fixture — and the caller omits the section entirely. An empty note
 * would render a heading with nothing under it, which reads as *nothing outside reads this*, and that is a different
 * claim: a file that declares twenty names nothing imports is a change whose blast radius is itself.
 */
export function reachNoteOf(
  index: RepoIndex,
  path: string,
  limits: { names?: number; sites?: number } = {},
): ReachNote | null {
  const symbols = index.files.get(path)?.symbols ?? [];
  const declared = new Set(symbols.map((symbol) => symbol.name));
  if (declared.size === 0) return null;

  const names = Math.max(1, limits.names ?? NAMES_PER_NOTE);
  const sitesLimit = Math.max(1, limits.sites ?? SITES_PER_NAME);

  const byName = new Map<string, string[]>();
  const importers = new Set<string>();
  for (const reference of index.references) {
    if (reference.toPath !== path) continue;
    const at = `${reference.fromPath}:${String(reference.fromLine)}`;
    const bucket = byName.get(reference.toName);
    if (bucket === undefined) byName.set(reference.toName, [at]);
    else bucket.push(at);
    importers.add(reference.fromPath);
  }

  const read = [...byName.keys()].sort();
  const lines: string[] = [];
  for (const name of read.slice(0, names)) {
    const all = byName.get(name)!;
    const shown = all.slice(0, sitesLimit).join(', ');
    const more = all.length > sitesLimit ? ` (+${String(all.length - sitesLimit)})` : '';
    lines.push(`${name} ← ${shown}${more}`);
  }
  const hidden = read.length - Math.min(read.length, names);
  if (hidden > 0)
    lines.push(`${String(hidden)} more name${hidden === 1 ? '' : 's'} read outside this file`);

  return {
    path,
    lines,
    unread: [...declared].filter((name) => !byName.has(name)).length,
    importers: importers.size,
  };
}

/**
 * **One line a prompt can carry**, which is the form a pull-request call needs: five changed files, five lines.
 *
 * The separator is `; ` rather than a newline because a pull-request block that gave each file three lines would be
 * fifteen lines of context for a call that already carries a diff, and **the reach of the second file is read after the
 * reach of the first only if the block is short enough to be read at all.**
 */
export function reachLine(note: ReachNote): string {
  const read = note.lines.join('; ');
  const unread =
    note.unread === 0
      ? ''
      : `${String(note.unread)} name${note.unread === 1 ? '' : 's'} declared here ${note.unread === 1 ? 'is' : 'are'} read by no other file`;
  return [read, unread].filter((part) => part.length > 0).join(' · ');
}
