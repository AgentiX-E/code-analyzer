// @code-analyzer/intelligence — where a quoted line actually is
//
// **A review comment is a claim about a line, and the line number is the part of the claim the model is worst at.** The
// competitor solved this with a contract rather than with trust: its `code_comment` tool takes an `existing_code`
// string, and `internal/diff/resolver.go` matches that string against the diff's hunks, then against the new file's
// content, then - when both fail - hands the comment to an LLM relocation task with the snippet and the diff and asks
// for the minimal contiguous range. **The number the model wrote is never used.** The string it quoted is, and the
// string is checkable.
//
// **This is the same idea with the arithmetic made explicit**, and one improvement: the match is *scored*, and a match
// that needed a hint to disambiguate says so. Their resolver returns the first candidate; a snippet that appears three
// times in a file is three places a finding can be filed, and a reviewer that silently picks the first has moved the
// defect to wherever the file repeats itself. **Which one was chosen, and whether a tie had to be broken, is a fact
// this module reports** - because the next iteration's question about a wrong location is *was it ambiguous*, and that
// is unanswerable from a line number alone.

import type { RepositoryFile } from './repository.js';

/** How the snippet was found. */
export type LocationQuality =
  /** The quoted text occurs exactly once, character for character. */
  | 'exact'
  /** It occurs once after whitespace and indentation are normalised. */
  | 'normalised'
  /** It occurs more than once, and the caller's line hint chose between them. */
  | 'disambiguated'
  /** No occurrence of the whole snippet; the first line anchored it and the rest was contiguous enough. */
  | 'anchored';

/** A located span, 1-based and inclusive, in the coordinates of the text that was searched. */
export interface LocatedSpan {
  startLine: number;
  endLine: number;
  quality: LocationQuality;
  /** How many lines of the snippet were matched, and how many it had. **A reader can disagree with `anchored`.** */
  matchedLines: number;
  snippetLines: number;
}

/** Strip the diff markers a model adds when it quotes from a patch rather than from a file. */
function stripDiffMarkers(lines: ReadonlyArray<string>): string[] {
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) return [];
  const marked = nonEmpty.every((line) => /^[+\- ]/.test(line));
  if (!marked) return lines.map((line) => line.replace(/\r$/, ''));
  return lines.map((line) => (/^[+\- ]/.test(line) ? line.slice(1) : line).replace(/\r$/, ''));
}

/** Collapse the whitespace a model is allowed to get wrong: indentation, tabs, trailing spaces. */
function normaliseLine(line: string): string {
  return line.replace(/\r$/, '').replace(/\s+/g, ' ').trim();
}

/** **A quote without its blank edges**, which is what a fenced block has. */
function trimBlankEdges(lines: ReadonlyArray<string>): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && normaliseLine(lines[start]!) === '') start += 1;
  while (end > start && normaliseLine(lines[end - 1]!) === '') end -= 1;
  return lines.slice(start, end);
}

/**
 * **The line sequence, found.**
 *
 * Exact first, because an exact match cannot be wrong; then normalised, because a model re-indents; then anchored on the
 * first line, because a model that quotes a long block usually gets the first line right and the tail approximately -
 * and **a comment anchored at the right line is worth more than no comment at all, as long as it says it was anchored**.
 */
export function locateSnippetLines(
  fileLines: ReadonlyArray<string>,
  snippet: string,
  hintLine?: number | null,
): LocatedSpan | null {
  // **A snippet is compared without its blank edges**, because a model fences its quote and the fence travels.
  const wantedRaw = trimBlankEdges(stripDiffMarkers(snippet.split('\n')));
  if (wantedRaw.length === 0) return null;
  if (wantedRaw.length > fileLines.length) return null;

  const wantedNormalised = wantedRaw.map(normaliseLine);
  const fileNormalised = fileLines.map(normaliseLine);

  const candidates: number[] = [];
  for (let start = 0; start + wantedNormalised.length <= fileNormalised.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < wantedNormalised.length; offset += 1) {
      if (fileNormalised[start + offset] !== wantedNormalised[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) candidates.push(start);
  }

  const exactRaw = wantedRaw.join('\n');
  const rawText = fileLines.join('\n');
  const exactAt = rawText.indexOf(exactRaw);

  if (candidates.length === 1) {
    const start = candidates[0]!;
    // **`exact` only when the bytes agreed too** - the distinction is what tells a reader whether the model quoted the
    // file or paraphrased it, and a paraphrase that happens to normalise equal is still a paraphrase.
    const byteExact = exactAt >= 0 && lineOfOffset(rawText, exactAt) === start;
    return {
      startLine: start + 1,
      endLine: start + wantedRaw.length,
      quality: byteExact ? 'exact' : 'normalised',
      matchedLines: wantedRaw.length,
      snippetLines: wantedRaw.length,
    };
  }

  if (candidates.length > 1) {
    const chosen = nearest(candidates, hintLine);
    return {
      startLine: chosen + 1,
      endLine: chosen + wantedRaw.length,
      quality: 'disambiguated',
      matchedLines: wantedRaw.length,
      snippetLines: wantedRaw.length,
    };
  }

  // **Anchored**: the first line is unique, and at least half of the rest follows it in order.
  const firstNormalised = wantedNormalised[0]!;
  if (firstNormalised.length < 8) return null;
  const anchors: number[] = [];
  for (let at = 0; at < fileNormalised.length; at += 1) {
    if (fileNormalised[at] === firstNormalised) anchors.push(at);
  }
  if (anchors.length === 0) return null;
  // **Seeded from the first anchor rather than from `null`**, because `anchors` is not empty at this point and a
  // `best === null` test inside the loop would be a branch that cannot fire.
  let best = { start: anchors[0]!, matched: 0 };
  for (const start of anchors) {
    let matched = 1;
    let cursor = start + 1;
    for (let offset = 1; offset < wantedNormalised.length; offset += 1) {
      const needle = wantedNormalised[offset]!;
      let found = -1;
      for (let probe = cursor; probe < Math.min(cursor + 4, fileNormalised.length); probe += 1) {
        if (fileNormalised[probe] === needle) {
          found = probe;
          break;
        }
      }
      if (found === -1) continue;
      cursor = found + 1;
      matched += 1;
    }
    if (matched > best.matched) best = { start, matched };
  }
  // **Half is the floor, and it is a floor rather than a fit.** A snippet the model half-remembered is not evidence
  // that the claim is at that line; a snippet whose majority is there is.
  if (best.matched * 2 < wantedNormalised.length) return null;
  return {
    startLine: best.start + 1,
    endLine: Math.min(best.start + wantedRaw.length, fileLines.length),
    quality: 'anchored',
    matchedLines: best.matched,
    snippetLines: wantedRaw.length,
  };
}

/** The 0-based line an offset sits on. */
function lineOfOffset(text: string, offset: number): number {
  let line = 0;
  for (let at = 0; at < offset && at < text.length; at += 1) {
    if (text.charCodeAt(at) === 10) line += 1;
  }
  return line;
}

/** The candidate closest to the hint, and the first one when there is no hint. **Deterministic, not random.** */
function nearest(candidates: ReadonlyArray<number>, hintLine?: number | null): number {
  if (hintLine === undefined || hintLine === null || !Number.isFinite(hintLine) || hintLine <= 0) {
    return candidates[0]!;
  }
  let best = candidates[0]!;
  let bestDistance = Math.abs(best + 1 - hintLine);
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(candidate + 1 - hintLine);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Locate a snippet in a file the reviewer read. */
export function locateInFile(
  file: RepositoryFile,
  snippet: string,
  hintLine?: number | null,
): LocatedSpan | null {
  const lines = file.text.split('\n');
  const located = locateSnippetLines(lines, snippet, hintLine);
  if (located === null) return null;
  // **The file's own first line is added back**, because a ranged read reports the line it started at and a span
  // reported in the wrong coordinates is precisely the defect this module exists to remove.
  return {
    ...located,
    startLine: located.startLine + file.firstLine - 1,
    endLine: located.endLine + file.firstLine - 1,
  };
}

/**
 * Locate a snippet in a unified diff, **in the new file's coordinates**.
 *
 * The fallback for a comment whose file could not be read: the diff still contains the added lines, and a comment about
 * a changed line can be grounded against it. **Context and removed lines are skipped**, because a comment anchored on a
 * line the change deleted cannot be posted and cannot be checked.
 */
export function locateInDiff(
  diff: string,
  snippet: string,
  hintLine?: number | null,
): LocatedSpan | null {
  const lines = diff.split('\n');
  const numbered: Array<{ line: number; text: string }> = [];
  let newLine = 0;
  for (const raw of lines) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header !== null) {
      newLine = Number(header[1]);
      continue;
    }
    if (raw.startsWith('diff --git') || raw.startsWith('index ') || raw.startsWith('--- '))
      continue;
    if (raw.startsWith('+++ ')) continue;
    if (raw.startsWith('+')) {
      numbered.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) continue;
    if (raw.startsWith(' ')) {
      numbered.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
    }
  }
  if (numbered.length === 0) return null;
  const located = locateSnippetLines(
    numbered.map((entry) => entry.text),
    snippet,
    hintLine,
  );
  if (located === null) return null;
  // **Both indices are in range by construction**: the span was located inside `numbered`, whose length is checked
  // before the search. A fallback here would be a second answer to a question already answered.
  const start = numbered[located.startLine - 1]!.line;
  const end = numbered[located.endLine - 1]!.line;
  return { ...located, startLine: start, endLine: end };
}
