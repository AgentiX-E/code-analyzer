// @code-analyzer/intelligence — one pull request's patch, split the way a reviewer reads it
//
// **Why this exists rather than a second parse.** The agent's repository reads a *diff per path*, because that is what a
// reviewer is shown and what `locateInDiff` searches when a file cannot be read. The CLI already has the whole patch -
// `resolveChangeSet` fetches it and then parses it into `GitDiff[]`, whose `ranges` carry line numbers and no text - so
// **the text is thrown away one frame after it arrives and the agent has nothing to quote.** Carrying the patch and
// splitting it here is one field and forty lines; re-rendering a diff from ranges and file contents would be a second
// renderer that has to agree with git's, and a synthetic diff that disagrees with the real one is a reviewer reading a
// change that never happened.
//
// **The key is the right-hand path**, the same choice `actionability.ts` makes and for the same reason: a comment anchors
// on the file as it stands after the change, and a rename has two paths with one of them gone.

import { diffHeaderPaths } from '../actionability.js';

/**
 * Split a unified diff into one chunk per file, keyed by the path after the change.
 *
 * **Chunk boundaries are `diff --git` lines and nothing else.** A hunk header, an index line or a `+++` line inside a
 * chunk that already has a path is content as far as this function is concerned: a file whose *added lines themselves*
 * begin with `diff --git` - a fixture in a parser's test corpus, for instance - must not become two files.
 *
 * A patch with no `diff --git` header produces an empty map, which is a fact the caller has to handle rather than a case
 * to paper over: the review then has file contents and no diff, and `ReviewAgent` reports that per file instead of
 * claiming the change was empty.
 */
export function splitPatchByPath(patch: string): Map<string, string> {
  const chunks = new Map<string, string>();
  let path: string | null = null;
  let lines: string[] = [];

  const flush = (): void => {
    if (path !== null && lines.length > 0) chunks.set(path, lines.join('\n'));
    lines = [];
  };

  for (const line of patch.split('\n')) {
    const header = diffHeaderPaths(line);
    if (header !== null) {
      flush();
      path = header.right;
      lines = [line];
      continue;
    }
    if (path !== null) lines.push(line);
  }
  flush();

  return chunks;
}
