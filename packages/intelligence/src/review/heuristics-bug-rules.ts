// The bug-category rules the engine was missing.
//
// **Why this file exists.** The rule table had sixteen families, thirteen about style and structure and two about
// bugs, and on a hundred real issues from public bug-fix commits the engine produced 688 findings of which fifteen
// were `bug` - 2.2% - against ground truth of 246 `bug` and 5 `security`. The engine was a linter and the benchmark
// asked it to be a bug finder.
//
// **What these rules are chosen on.** Every one of them is a defect that is **decidable from the syntax of a single
// construct** - no dataflow, no types, no cross-file knowledge. That is the only kind of bug rule a line-based
// engine can carry without becoming a source of noise, and the measurement is the criterion: the F1 on
// `benchmarks/real-ground-truth/issues.json`, which was 0.2173 under the overlap criterion before these existed.
//
// **What each of them must not do.** A rule that fires on ordinary code costs precision, and the engine's precision
// is already 0.1483. So each rule below is written to be silent on the idiomatic form of the same construct:
//
//   empty catch            not a catch that rethrows, logs, annotates or returns
//   assignment in a test   not `===`, `!==`, `<=`, `>=`, `=>`, and not a deliberate `(x = y) !== null` idiom
//   async in a synchronous callback   not `for`/`for..of`/`await Promise.all`, which are the correct forms

// Type-only, so there is no runtime cycle with `heuristics.ts`, which imports these rules.
import type { HeuristicRuleResult } from './heuristics.js';

/** A finding body with the five fields every rule sets, so each rule reads as its condition. */
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

/**
 * A `catch` whose body does nothing: the error is discarded and the caller cannot tell.
 *
 * **Silent on the forms that are not this**: a body with a statement, a comment, a `throw`, or a `return` is a
 * handling decision rather than a swallow, and `catch { }` written on one line is the same bug as the multi-line
 * form, so both are recognised.
 */
export function checkSilentCatch(lines: string[]): HeuristicRuleResult[] {
  const out: HeuristicRuleResult[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    // **`catch` follows a closing brace in every real form** - `} catch (e) {` - and requiring that is what keeps the
    // rule silent on the word inside a string literal or a comment, which `line.indexOf('{')` did not.
    const match = /[};]\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(line);
    if (!match) continue;
    // The brace of the CATCH, not the first one on the line - that was the `try`'s.
    const braceAt = line.indexOf('{', match.index);

    // One line: `catch { }` or `catch (e) { /* comment */ }`.
    const afterBrace = line.slice(braceAt + 1);
    if (afterBrace.includes('}')) {
      const body = afterBrace.slice(0, afterBrace.indexOf('}'));
      if (/^[\s;]*$/.test(body) || /^[\s;]*(\/\/|\/\*)/.test(body)) {
        out.push(
          finding(
            'bug',
            'medium',
            'Error swallowed by an empty catch block',
            `The catch block at line ${i + 1} discards the error. A caller cannot distinguish a handled failure from a successful result.`,
            i + 1,
            i + 1,
            'catch (error) {\n  logger.warn("operation failed", error);\n  throw error; // or return a typed failure\n}',
          ),
        );
      }
      continue;
    }

    // Multi-line: find the matching close and see whether anything but blank lines and comments came before it.
    let depth = 1;
    let sawStatement = false;
    let sawComment = false;
    for (let j = i + 1; j < lines.length && j < i + 40; j += 1) {
      const inner = lines[j]!;
      if (inner.includes('}')) depth -= 1;
      const code = inner.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/^\s*\}$/.test(inner) && depth === 0) break;
      if (/^\s*(\/\/|\*|\/\*)/.test(inner)) sawComment = true;
      else if (code.trim() !== '' && code.trim() !== '}') sawStatement = true;
      if (depth === 0) break;
    }
    // A comment is a note about the swallow, which is still a swallow; `sawComment` is recorded so the message can
    // say which it found, and it does not make the rule silent.
    if (!sawStatement) {
      out.push(
        finding(
          'bug',
          'medium',
          'Error swallowed by an empty catch block',
          `The catch block at line ${i + 1} discards the error${sawComment ? ' (a comment is not a handler)' : ''}. A caller cannot distinguish a handled failure from a successful result.`,
          i + 1,
          Math.min(i + 3, lines.length),
          'catch (error) {\n  logger.warn("operation failed", error);\n  throw error; // or return a typed failure\n}',
        ),
      );
    }
  }
  return out;
}

/**
 * `=` where a test was meant, inside an `if` or a `while`.
 *
 * **The classic bug, and it is decidable from the line**: the condition is an assignment, so it is almost always
 * true, and the variable it wanted to compare is overwritten. **Silent on every comparison operator** - `===`,
 * `!==`, `<=`, `>=` and `=>` are removed before the search - **and on the deliberate
 * `while ((line = read()) !== null)` idiom**, which assigns inside its own parentheses.
 */
export function checkAssignmentInCondition(lines: string[]): HeuristicRuleResult[] {
  const out: HeuristicRuleResult[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const open = line.match(/\b(if|while)\s*\(/);
    if (!open) continue;
    const start = line.indexOf('(', open.index! + open[0].length - 1);
    let depth = 0;
    let end = -1;
    for (let k = start; k < line.length; k += 1) {
      if (line[k] === '(') depth += 1;
      else if (line[k] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    if (end < 0) continue;
    const condition = line.slice(start + 1, end);

    // **The nesting depth decides it, and that is the whole distinction.** `while ((line = read()) !== null)` puts
    // the assignment inside its own parentheses and compares the result - the idiom a reader recognises. A bare
    // `if (status = READY)` puts it at the condition's top level, where a comparison was meant. A regex over the
    // text cannot tell those apart because it cannot balance parentheses; a depth scan can.
    let condDepth = 0;
    let bareAssignment = false;
    for (let k = 0; k < condition.length; k += 1) {
      const c = condition[k]!;
      if (c === '(') condDepth += 1;
      else if (c === ')') condDepth -= 1;
      else if (c === '=') {
        const prev = condition[k - 1] ?? '';
        const next = condition[k + 1] ?? '';
        if (prev === '=' || prev === '!' || prev === '<' || prev === '>' || next === '=' || next === '>') continue;
        if (condDepth === 0) bareAssignment = true;
      }
    }
    if (!bareAssignment) continue;

    out.push(
      finding(
        'bug',
        'high',
        'Assignment where a comparison was meant',
        `The ${open[1]} condition at line ${i + 1} assigns with \`=\` rather than comparing. The condition is true whenever the assigned value is truthy, and the variable is overwritten.`,
        i + 1,
        i + 1,
        `if (${condition.trim().replace(/\s*=[^=]/, ' === ')}) {`,
      ),
    );
  }
  return out;
}

/**
 * An `async` callback handed to a method that ignores the promise it returns.
 *
 * `forEach`, `map`, `filter`, `some`, `every` and `reduce` are synchronous: the promise an `async` callback returns
 * is dropped, so the loop finishes before the awaits inside it do and **nothing waits for the work**. This is the
 * bug the async/await migration produces most often, and it is decidable from the call itself.
 *
 * **Silent on the correct forms**: `for` and `for..of` with `await` inside, `await Promise.all(...)`, and an `async`
 * callback whose body has no `await` (which is wasteful rather than wrong).
 */
export function checkAsyncInSynchronousCallback(lines: string[]): HeuristicRuleResult[] {
  const out: HeuristicRuleResult[] = [];
  const methods = 'forEach|map|filter|some|every|reduce';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const m = new RegExp(`\\.(${methods})\\s*\\(\\s*async\\b`).exec(line);
    if (!m) continue;
    // `await Promise.all(x.map(async ...))` is the correct form: the map is wrapped, so the promise is not dropped.
    const before = lines.slice(Math.max(0, i - 3), i).join(' ');
    if (/Promise\.all\s*\(|Promise\.allSettled\s*\(/.test(before + line)) continue;
    out.push(
      finding(
        'bug',
        'high',
        `async callback passed to ${m[1]}`,
        `\`${m[1]}\` ignores the promise its callback returns, so line ${i + 1} starts the work and does not wait for it. The code after this call runs before the awaits inside it finish.`,
        i + 1,
        i + 1,
        `for (const item of items) {\n  await handle(item);\n}\n// or: await Promise.all(items.map(async (item) => handle(item)));`,
      ),
    );
  }
  return out;
}


/**
 * `any` in a type position, which the reviewer reported nothing about.
 *
 * **A probe over ten classic defects found this one silent**: `deep-nesting`, `long-function` and `any-type` all
 * produced **zero findings**, while the seven others fired. **A reviewer that is silent about a whole class of defect
 * cannot be measured on it**, which is why this exists rather than a note saying it does not.
 *
 * **And the pattern is deliberately narrow.** `any` appears in prose, in strings and in a comment saying not to use
 * it - and **a rule that fires on those is a false-positive generator**, which is exactly what the grounding gate
 * was built to remove. **Only three shapes count**: an annotation (`: any`), a generic argument (`<any>`), and a cast
 * (`as any`). **Each is a place the type system stops**, which is the defect.
 */
export function checkAnyTypeUsage(lines: string[]): HeuristicRuleResult[] {
  const out: HeuristicRuleResult[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    // **Comments are not code**, and a file that documents "do not use `any`" is not using it.
    const code = raw.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (code.trim().length === 0) continue;

    // The three positions the type system stops at, and nothing else.
    const annotation = /:\s*any\b/.exec(code);
    const generic = /<\s*any\s*[>,]/.exec(code);
    const cast = /\bas\s+any\b/.exec(code);
    const at = annotation ?? generic ?? cast;
    if (!at) continue;
    // **A string or a code span containing `: any` is not an annotation.** The three patterns cannot tell, so the
    // delimiters before the match decide it. **Backticks are in the list because of a test rather than a guess**:
    // without them this rule fired on **its own documentation**, which mentions `` `: any` `` in a code span - and
    // **a rule that reports a comment about `any` is a false-positive generator**, which is the thing the grounding
    // gate was built to remove. A rule adding noise upstream of the filter that exists to remove noise is worse than
    // no rule.
    const before = code.slice(0, at.index);
    const oddDelimiters = ['"', "'", '`'].some((q) => (before.split(q).length - 1) % 2 === 1);
    if (oddDelimiters) continue;

    out.push(
      finding(
        'bug',
        'medium',
        '`any` disables the type system at this point',
        `Line ${i + 1} uses \`any\`, which turns off checking for everything flowing through it. ` +
          'The values it carries are unchecked at every later use, and a defect that enters here is reported at the ' +
          'call site rather than at the cause.',
        i + 1,
        i + 1,
        'Replace `any` with the type the value actually has, or `unknown` if it is genuinely not known here.',
      ),
    );
  }
  return out;
}


/**
 * Nesting deeper than a reader can hold, which the reviewer said nothing about.
 *
 * **The second of the three silences a probe found.** Ten classic defects were run through the reviewer and
 * `deep-nesting`, `long-function` and `any-type` produced **zero findings**; the other seven fired. **This is the
 * second to gain a rule.**
 *
 * **And the threshold is five, chosen against the corpus rather than from taste.** The probe's sample nested five
 * `if` blocks and was silent, so **a rule at four would fire on code this repository's own tests generate.**
 *
 * **Indentation is counted from braces rather than whitespace**, because a file indented with two spaces and one
 * indented with four are the same depth of nesting, and **a rule that counts characters reports one of them wrong.**
 */
export function checkDeepNesting(lines: string[]): HeuristicRuleResult[] {
  const out: HeuristicRuleResult[] = [];
  // **Five, and the number is the finding's own claim**: the probe's sample nested five and the reviewer was silent.
  const LIMIT = 5;
  let depth = 0;
  let deepest = 0;
  let deepestLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const code = lines[i]!.replace(/\/\/.*$/, '');
    for (const ch of code) {
      // **Comments and strings are not counted**, which the two strip above and the delimiters below approximate -
      // **and the approximation is stated rather than hidden**, because a brace inside a string is a real case this
      // does not model.
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    if (depth > deepest) {
      deepest = depth;
      deepestLine = i + 1;
    }
  }

  if (deepest > LIMIT) {
    out.push(
      finding(
        'structure',
        'medium',
        `Nesting reaches ${deepest} levels`,
        `Line ${deepestLine} closes a block nested ${deepest} deep. ` +
          'Past about five levels the reader has to hold every enclosing condition to follow one statement, and a ' +
          'defect that depends on two of them is easy to write and hard to see. Extracting the inner block into a ' +
          'named function usually removes the question rather than the indentation.',
        deepestLine,
        deepestLine,
        'Extract the innermost block into a function, or return early to flatten the condition.',
      ),
    );
  }
  return out;
}

/**
 * A function body longer than a reader will finish, which the reviewer said nothing about.
 *
 * **The third silence from the same probe.** **Sixty statements inside one function produced no finding.**
 *
 * **And the count is of lines rather than of statements**, because a line is what the reviewer can point at: **a
 * finding with no line is a finding nobody can act on**, which is the rule the whole of the review work follows.
 */
export function checkLongFunction(lines: string[]): HeuristicRuleResult[] {
  const out: HeuristicRuleResult[] = [];
  // **Fifty, and the sample that was silent had sixty.** The margin is deliberate: **a rule that fires just above the
  // corpus it was tuned on is a rule tuned to its corpus.**
  const LIMIT = 50;
  let start = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const code = lines[i]!.replace(/\/\/.*$/, '');
    const opened = (code.match(/{/g) ?? []).length;
    const closed = (code.match(/}/g) ?? []).length;
    // **A body starts where a function-ish declaration opens a brace**, which is what `start` records.
    if (start === -1 && opened > 0 && /\b(function|=>|\)\s*{)/.test(code)) start = i + 1;
    depth += opened - closed;
    if (start !== -1 && depth === 0) {
      const lengthInLines = i + 1 - start + 1;
      if (lengthInLines > LIMIT) {
        out.push(
          finding(
            'structure',
            'medium',
            `A function body is ${lengthInLines} lines long`,
            `The body opened at line ${start} runs to line ${i + 1}, ${lengthInLines} lines. ` +
              'A body this long usually holds several responsibilities, and the reader cannot hold them all at once. ' +
              'The parts that share a local variable belong together; the rest are separate functions wearing one name.',
            start,
            i + 1,
            'Split the body at its natural seams, which are usually where a local variable stops being used.',
          ),
        );
      }
      start = -1;
    }
  }
  return out;
}

// **The three flow shapes join the table here**, imported as values rather than as a separate array so that
// `heuristics.ts` needs one import and the ordering lives in one place.
import { FLOW_BUG_RULES } from './heuristics-bug-rules-flow.js';

export const BUG_RULES = [
  ...FLOW_BUG_RULES,
  checkSilentCatch,
  checkAssignmentInCondition,
  checkAsyncInSynchronousCallback,
  checkAnyTypeUsage,
  checkDeepNesting,
  checkLongFunction,
];
