// @code-analyzer/analyzer — call sites for the providers that read text rather than a tree
//
// **A provider that parses with a regular expression has no node to hand `emitCallCapture`, so it had no calls at
// all.** Dart, Zig and Lua are in that position: their grammars ship no compiled `Language` object, the reader is the
// whole implementation, and each of them claimed `Function Calls` in `docs/language-support.md` while emitting no
// call site of any kind. This is the one place a text-based provider gets the same fact the tree-based ones do.

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { lineNumber } from './regex-helpers.js';

import type { UnifiedCapture } from '@code-analyzer/shared';

/** What a provider has to say for its own language, and nothing else. */
export interface RegexCallOptions {
  readonly filePath: string;
  /**
   * The names that cannot be a callee or a word before one: keywords, and the words a declaration is introduced by.
   *
   * **One set serves both questions, because both are the same question asked about one word.** `if (x)` is not a
   * call to `if` — the callee is a keyword. `String topLevel(…)` is not a call to `topLevel` — the word *before* the
   * callee is a type. So the rule is: a callee is a call unless a word stands in front of it, and a word in front of
   * it is a keyword only when the language says so. That single rule replaced a per-language "declaration" pattern,
   * which could not tell `return helper(x)` from `String helper(x)` because both put a word there.
   */
  readonly skip: ReadonlySet<string>;
}

/** `name(`, `a.b(`, `a.b.c(` — a callee is a dotted name and the parenthesis that follows it. */
const CALLEE = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;

/** How far back the declaration pattern is offered, which is one type name and the space after it. */
const LOOKBEHIND = 48;

/**
 * The call sites in a sanitised source.
 *
 * **The count is read from the parentheses rather than assumed**, because a declaration admitting a call is decided by
 * its arity: `draw(1, 2)` and `draw(1, 2, 3)` are different declarations under one name. A spread (`...items`) is a
 * list whose length is a runtime fact, so the call states no count rather than a wrong one — the same rule the
 * tree-based providers follow for `f(*args)`.
 */
export function captureRegexCallSites(
  sanitized: string,
  options: RegexCallOptions,
): UnifiedCapture[] {
  const captures: UnifiedCapture[] = [];
  // **A call inside a string is not a call.** These three providers read text, and the text holds doc comments, log
  // messages and test fixtures that say `helper(x)` without calling anything — so the scan runs over a copy whose
  // strings and comments are blanked, at the same length and with newlines kept, and every offset stays the file's.
  const code = blankNonCode(sanitized);
  CALLEE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CALLEE.exec(code)) !== null) {
    const callee = match[1]!;
    const bare = callee.split('.').pop()!.trim();
    const open = match.index + match[0].length - 1;

    // **A keyword is not a call and a declaration is not a use.** `if (x)` in Dart opens a parenthesis where a callee
    // would go, and `String topLevel(` opens one too; both would otherwise be filed as calls to `if` and `topLevel`.
    if (options.skip.has(bare)) continue;
    const before = code.slice(Math.max(0, match.index - LOOKBEHIND), match.index);
    // **A word in front of the callee means the callee is being declared**, unless the language says that word is a
    // keyword: `String topLevel(` declares and `fn topLevel(` declares, while `return helper(` and `= helper(` call.
    const precedingWord = /([A-Za-z_$][\w$]*)\s*$/.exec(before)?.[1];
    if (precedingWord !== undefined && !options.skip.has(precedingWord)) continue;
    // `@import(` in Zig is a builtin, not a function the checkout declares.
    if (before.endsWith('@')) continue;

    const args = readArguments(code, open);
    if (args === null) continue;

    const isMethod = callee.includes('.');
    const line = lineNumber(sanitized, match.index);
    captures.push({
      tag: isMethod ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL,
      text: callee,
      startLine: line,
      endLine: lineNumber(sanitized, open),
      startByte: match.index,
      endByte: open + 1,
      name: bare,
      properties: {
        filePath: options.filePath,
        callType: isMethod ? 'method' : 'function',
        ...(args.count === undefined ? {} : { argumentCount: String(args.count) }),
      },
    });
    // **The scan continues inside the argument list**, because `outer(inner(1))` is two calls and a scanner that
    // jumped past the list found only the outer one.
  }

  return captures;
}

/**
 * The source with everything that is not code replaced by spaces, at the same length.
 *
 * **A regular expression has no idea what a string is**, and `"retry helper(x) later"` in a log message was a call to
 * `helper` for the first version of this scanner. Blanking the literals and the comments keeps every offset, so the
 * captures point at the same bytes as a tree-based provider's would, and the four literal forms these three languages
 * write are the four handled here: `/* … *\/`, `// …`, `--[[ … ]]`, `-- …`, and the three string quotings around them.
 */
function blankNonCode(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to && index < out.length; index++) {
      if (out[index] !== '\n') out[index] = ' ';
    }
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end < 0 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (character === '-' && next === '-') {
      const blockEnd = source.startsWith('--[[', index) ? source.indexOf(']]', index + 4) : -1;
      const stop =
        blockEnd >= 0
          ? blockEnd + 2
          : (() => {
              const end = source.indexOf('\n', index);
              return end < 0 ? source.length : end;
            })();
      blank(index, stop);
      index = stop;
      continue;
    }
    if (character === '"' || character === "'") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === character) break;
        cursor++;
      }
      const stop = Math.min(cursor + 1, source.length);
      blank(index, stop);
      index = stop;
      continue;
    }
    index++;
  }

  return out.join('');
}

/**
 * The argument list that starts at the `(` at `open`: its arity, or `null` when the parenthesis is never closed.
 *
 * **A niladic call and a call with no list at all are the same fact here**, and both are zero: a regular expression
 * cannot tell `helper()` from `helper` followed by a group, so it says nothing rather than something wrong.
 */
function readArguments(
  source: string,
  open: number,
): { readonly count: number | undefined; readonly end: number } | null {
  let depth = 0;
  let commas = 0;
  let spread = false;
  let hasContent = false;

  for (let index = open; index < source.length; index++) {
    const character = source[index]!;
    if (character === '(') {
      depth++;
      continue;
    }
    if (character === ')') {
      depth--;
      if (depth === 0) {
        const count = !hasContent ? 0 : spread ? undefined : commas + 1;
        return { count, end: index + 1 };
      }
      continue;
    }
    if (depth !== 1) continue;
    if (character === ',') {
      commas++;
      continue;
    }
    if (character === '.' && source.startsWith('..', index)) {
      spread = true;
      continue;
    }
    if (character.trim().length > 0) hasContent = true;
  }

  return null;
}
