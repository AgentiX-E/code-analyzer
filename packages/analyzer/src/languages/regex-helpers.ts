// @code-analyzer/analyzer — Regex Provider Helpers
//
// Shared utilities for pure-regex LanguageProviders. These are plain functions
// so every regex-based parser normalizes input identically, computes 1-based
// line numbers the same way, and performs config-secret taint detection alike.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { lineOf } from './line-index.js';

import type { TaintSource } from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

/**
 * Normalize input before parsing:
 * 1. Strip a leading BOM (U+FEFF)
 * 2. Strip zero-width characters (U+200B/U+200C/U+200D) and any other BOM
 * 3. Normalize line endings (CRLF and CR) to LF
 *
 * This keeps regex parsing deterministic on files with invisible characters.
 */
export function sanitizeSource(source: string): string {
  return source
    .replace(/^\uFEFF/, '') // BOM at start
    .replace(/[\u200B\u200C\u200D]/g, '') // zero-width spaces/joiners
    .replace(/\uFEFF/g, '') // BOM anywhere
    .replace(/\r\n/g, '\n') // CRLF -> LF
    .replace(/\r/g, '\n'); // CR -> LF
}

/** 1-based line number for a byte offset within `source`. */
export function lineNumber(source: string, offset: number): number {
  return lineOf(source, offset);
}

/**
 * Line-oriented scan for configuration secrets (password/token/api_key/...).
 * Returns one TaintSource per line that contains any keyword (first match wins).
 */
export function extractSecretSources(
  source: string,
  sourceType: string,
  keywords: string[],
): TaintSource[] {
  const sources: TaintSource[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        sources.push({ name: kw, sourceType, line: i + 1, text: lines[i]!.trim(), properties: {} });
        break;
      }
    }
  }
  return sources;
}

/**
 * The doc comments in a source, as captures a text-based provider can publish.
 *
 * **A provider that reads text has no comment node, so `Docstrings/JSDoc` was a row it could not back.** The
 * tree-sitter providers get their comments from the grammar and hand them to the base class's attach pass; these three
 * have only the text, and the text does say which lines are documentation: `///` in Dart and Zig, `---`-free `--` in
 * Lua, all of them written immediately above the declaration they document.
 *
 * **The association is by line, and by one line**, because that is the only adjacency a scanner can be sure of: a
 * comment block whose last line is the line before a declaration's first line documents that declaration, and the
 * declaration records it as the `docstring` property every other provider writes. A block with a blank line between it
 * and the declaration documents nothing, which is the same answer the tree-sitter pass gives.
 */
export function captureDocComments(
  source: string,
  filePath: string,
  markers: readonly string[],
  declarations: UnifiedCapture[],
): UnifiedCapture[] {
  const lines = source.split('\n');
  const captures: UnifiedCapture[] = [];
  let block: { from: number; to: number; text: string[] } | null = null;

  const flush = (): void => {
    if (block === null) return;
    const text = block.text.join('\n');
    captures.push({
      tag: CAPTURE_TAGS.DOCSTRING,
      text,
      startLine: block.from,
      endLine: block.to,
      startByte: 0,
      endByte: 0,
      properties: { filePath },
    });
    // **The declaration directly below this block owns it.** One line, not "within a few": a blank line ends a doc
    // comment in every one of these languages, and a rule that reached further would document the wrong declaration.
    const below = declarations.find((declaration) => declaration.startLine === block!.to + 1);
    if (below !== undefined) {
      below.properties = { ...below.properties, docstring: text };
    }
    block = null;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();
    // **The marker is taken off here, where it is known, rather than by a second pass that has to guess it.** A pass
    // that re-tested every line would carry a branch for a line with no marker — and no such line can reach it, because
    // only a line that matched is pushed. **The arm existed and could never be taken**, which is what a coverage report
    // says about dead code whether or not the code is wrong.
    const marker = markers.find((candidate) => trimmed.startsWith(candidate));
    if (marker !== undefined) {
      block ??= { from: index + 1, to: index + 1, text: [] };
      block.to = index + 1;
      block.text.push(trimmed.slice(marker.length).trim());
      continue;
    }
    if (trimmed.length === 0 && block !== null) {
      // **A blank line ends the block and it documents nothing — it does not end the capture.** The comment is still in
      // the file, and the attachment rule below cannot reach a declaration two lines away, so flushing here yields the
      // capture and no `docstring`. **Setting the block to null without flushing dropped it**, which meant a documented
      // declaration followed by a blank line, and every doc comment at the end of a file — every file ends with a
      // newline — vanished from the capture list entirely.
      flush();
      continue;
    }
    flush();
  }
  flush();

  return captures;
}
