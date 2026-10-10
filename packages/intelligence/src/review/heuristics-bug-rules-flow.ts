// Three more bug shapes, on the same principle the existing bug rules were chosen on.
//
// **The principle, stated in `heuristics-bug-rules.ts` and followed here**: *a defect that is decidable from the
// syntax of a single construct* - **no dataflow, no types, no cross-file knowledge.** A line-based engine that
// reaches further **becomes a source of noise**, and **its precision is the scarce resource** - the ground truth is
// 246 bugs against 767 findings, so **one false positive costs more than one missed bug.**
//
// **And each of these three is also a shape whose correct form looks almost identical**, which is why **every test
// asserts both directions**: a rule that fires on the idiomatic version of its own construct **trades recall for
// precision it cannot afford.**

import type { HeuristicRuleResult } from './heuristics.js';

/** A finding with the five fields every rule sets, so each rule reads as its condition. */
function finding(
  category: string,
  severity: 'low' | 'medium' | 'high',
  title: string,
  description: string,
  startLine: number,
  endLine: number,
  suggestionCode?: string,
): HeuristicRuleResult {
  return {
    triggered: true,
    category: category as HeuristicRuleResult['category'],
    severity,
    title,
    description,
    suggestionCode: suggestionCode ?? null,
    startLine,
    endLine,
  };
}

/** The brace depth at the *end* of each line, so a rule can ask where a block ends. */
function depthByLine(lines: readonly string[]): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const line of lines) {
    // **Braces inside strings and comments are counted, and the errors cancel**: this decides whether a line is
    // inside a block, **and a `{` in a string is as often balanced by a `}` in the same string as not.**
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    // **The depth *after* the line**, because a `finally {` written on one line as `} finally {` closes one block and
    // opens another, and **a depth taken before the line would report the same number for the body and for the
    // statement after it** - which is the difference this rule decides on.
    depths.push(depth);
  }
  return depths;
}

/**
 * A `return` inside a `finally` block.
 *
 * **The bug is that it erases the failure.** A `return` in `finally` **discards whatever the `try` was throwing**, so
 * **the caller receives a value where it should have received an exception** - and **the exception is not logged,
 * not rethrown, and not visible at the call site.**
 *
 * **Silent on the form that is everywhere**: a `finally` that closes, resets or logs. Only a `return` inside the
 * block fires.
 */
export function checkReturnInFinally(lines: string[]): HeuristicRuleResult[] {
  const depths = depthByLine(lines);
  const found: HeuristicRuleResult[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bfinally\b/.test(lines[i]!)) continue;
    // **The finally's body starts at its `{`** - its own line or the next - and **ends when the depth returns to the
    // depth the `finally` keyword sat at.**
    const openDepth = depths[i]!;
    for (let j = i + 1; j < lines.length; j += 1) {
      // **A line at or above the opening depth has left the block**, whether it is the closing brace or a statement
      // after it.
      if (depths[j]! <= openDepth - 1) break;
      // **A `return` inside the block**, and not one after it.
      if (/\breturn\b/.test(lines[j]!)) {
        found.push(
          finding(
            'bug',
            'high',
            'A return in a finally discards the exception',
            'A `return` inside `finally` replaces whatever the `try` or `catch` was throwing, so the caller receives a value where it should have received a failure.',
            j + 1,
            j + 1,
            'Remove the return; let the exception propagate, or assign to a variable and return after the block.',
          ),
        );
        break;
      }
    }
  }
  return found;
}

/**
 * `JSON.parse` whose result is used without a guard.
 *
 * **`JSON.parse` throws on malformed input**, and **a throw at that point is a crash rather than a value** - so
 * **a call site with no `try`, no `.catch` and no `??` fallback is a failure path nobody wrote.**
 *
 * **Silent on the two forms that are handling**: inside a `try` block, and with a fallback written in the same
 * expression - **`??`, `||`, or a `catch` on the line.**
 */
export function checkJsonParseUnwrapped(lines: string[]): HeuristicRuleResult[] {
  const found: HeuristicRuleResult[] = [];

  // **One forward pass records how many `try` blocks enclose each line**, which is the only reliable way to ask the
  // question: **a backward scan has to decide, from braces alone, whether a `try` it passed is still open**, and a
  // `finally {` written after a closing brace makes that ambiguous. **A stack of open blocks answers it directly.**
  const openTries: number[] = [];
  const guardedBy: number[] = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    // **The protection is whatever is open at the start of this line.**
    guardedBy.push(openTries.length);
    const opensTry = /\btry\b/.test(line);
    for (const ch of line) {
      if (ch === '{') {
        depth += 1;
        if (opensTry) openTries.push(depth);
      } else if (ch === '}') {
        // **A block closing at this depth is no longer enclosing the next line**, and `try` has no handler of its own
        // to distinguish it from `catch` or `finally` - which is correct here, because **all three are handling.**
        if (openTries.length > 0 && depth === openTries[openTries.length - 1]) openTries.pop();
        depth -= 1;
      }
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!/JSON\.parse\s*\(/.test(line)) continue;
    // **A fallback in the same expression is a handling decision**, and `??`/`||`/`.catch` on the line are all of them.
    if (/\?\?|\|\||\.catch\s*\(/.test(line)) continue;
    if ((guardedBy[i] ?? 0) > 0) continue;

    found.push(
      finding(
        'bug',
        'medium',
        'JSON.parse without handling malformed input',
        '`JSON.parse` throws on malformed input, and this call site has no `try`, no `.catch` and no fallback, so a malformed payload becomes a crash rather than a handled case.',
        i + 1,
        i + 1,
        'Wrap the call in a try, or supply a fallback: `JSON.parse(raw) ?? defaultValue`.',
      ),
    );
  }
  return found;
}

/**
 * A bare `return` inside a `forEach` callback.
 *
 * **The bug is a misread API.** `forEach` ignores its callback's return value, so **`return` inside it exits one
 * invocation rather than the loop** - **the author expects to stop iterating and the iteration continues** - which
 * **produces a silent no-op rather than a wrong answer**, the hardest kind to notice.
 *
 * **Silent on `map`, `filter`, `some` and `every`**, where a returned value is the point, **and silent on a real
 * loop**, where `return` does what it says.
 */
export function checkForEachWithReturn(lines: string[]): HeuristicRuleResult[] {
  const found: HeuristicRuleResult[] = [];
  let forEachDepth: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (forEachDepth === null && /\.forEach\s*\(/.test(line)) {
      forEachDepth = 0;
    }
    if (forEachDepth === null) continue;

    // **The callback body**, tracked so a `return` after the `});` is not attributed to it.
    for (const ch of line) {
      if (ch === '(') forEachDepth += 1;
      else if (ch === ')') forEachDepth -= 1;
    }

    // **A bare `return;` or `return` at the end of a line inside the callback**, and **not `return something`**, which
    // carries a value out of a different method misread as this one.
    if (/\breturn\s*;?\s*$/.test(line) && forEachDepth > 0) {
      found.push(
        finding(
          'bug',
          'medium',
          'A return inside forEach does not stop the loop',
          '`forEach` ignores the callback’s return value, so this exits one invocation rather than the iteration. A loop or `some`/`every` expresses the intent.',
          i + 1,
          i + 1,
          'Use a `for..of` loop, or `some`/`every` when the intent is to stop early.',
        ),
      );
    }

    if (forEachDepth <= 0) forEachDepth = null;
  }
  return found;
}

/** The three shapes, in the order they should be tried. */
export const FLOW_BUG_RULES = [checkReturnInFinally, checkJsonParseUnwrapped, checkForEachWithReturn];
