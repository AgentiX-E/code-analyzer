#!/usr/bin/env node
// Measure the regular expressions CodeQL calls polynomial, instead of believing the label.
//
// **A rule that fires seventy-six times is a rule whose findings have to be sorted before they can be believed.** The
// previous iteration sorted thirty-five of them by hand, in a scratch file, in an order nobody could reproduce: the
// adversarial string was lifted out of CodeQL's own message, replayed in a child process with a kill timer, and the
// result - twenty-two real, thirteen not - was written into an audit page where it cannot be re-run. **A measurement
// that lives only in a paragraph is a measurement the next person has to take on trust**, which is the same defect as a
// figure whose script cannot be found.
//
// So the sort is a program:
//
//     node scripts/redos-assay.mjs                       # every open ReDoS finding, measured
//     node scripts/redos-assay.mjs --json redos.json     # and written down
//     node scripts/redos-assay.mjs --fail-if-quadratic    # exit 1 if any measured pattern is still quadratic
//
// **The adversarial string is CodeQL's claim, not this script's guess.** Its message names the input - *"strings
// starting with `X` and with many repetitions of `Y`"* - and the assay rebuilds exactly that string at two sizes. A
// pattern that survives the input it was accused of is a finding to dismiss with evidence; a pattern that does not is a
// defect, and the ratio between the two sizes says which kind.
//
// **Ten times the input, a hundred times the cost is quadratic.** The threshold below is a wall-clock one because that is
// what the caller feels, but the ratio is recorded beside it so a reader can tell a quadratic pattern from a merely slow
// one: a 200 ms `O(n)` scan at 40 KB is a slow scan, and it is not this rule's business.
//
// **A pattern this script cannot locate is reported, not passed.** The alternative - counting only what was measured and
// printing the total as if it were the corpus - is the counting error `docs/SECURITY.md` §1.6 was written about.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { collectAllPages } from '../.github/scripts/lib/paginate.mjs';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;

/** The two sizes every finding is replayed at. Ten times the input separates quadratic from linear without waiting. */
export const SIZES = Object.freeze([4_096, 40_960]);

/** **What counts as slow.** 200 ms at 40 KB, or no answer at all inside the kill window. */
export const SLOW_MS = 200;

/**
 * **How much growth over ten times the input is growth that cannot be linear.**
 *
 * The wall-clock threshold above is what a caller feels and it is the wrong *only* measure: `structure-lens` measured
 * 94 ms at 40 KB, which is under 200 and is still ×95 over the smaller size - **a quadratic pattern with a small
 * constant**. On the 600 KB line a generated file can supply that is 225 times the cost, and calling it fast because it
 * was quick on a short input is the error this instrument exists to catch.
 *
 * Linear work grows ×10; quadratic grows ×100. **Thirty is the line between them** with room for a cache and a
 * measurement that rounds.
 */
export const QUADRATIC_GROWTH = 30;

/** **How long a single replay may take before it is killed.** A catastrophic pattern hangs the harness that measures it. */
export const KILL_MS = 5_000;

/** The rules this assay is about, and nothing else - a report that widened would be an audit, not an instrument. */
export const REDOS_RULES = Object.freeze(['js/polynomial-redos', 'js/redos']);

/** Characters that can end an expression, after which a `/` is a division rather than a regular expression. */
const EXPRESSION_ENDS = new Set([')', ']', '}']);

/**
 * **Every regular-expression literal in a source file, with the line it starts and ends on.**
 *
 * Not a parser: a scanner that knows the four states a JavaScript file can be in - code, string, template, comment - and
 * takes the one local decision that distinguishes a regex from a division. **A literal that spans lines carries both
 * lines**, because CodeQL reports the line the expression is *used* on and an expression may be written across three.
 *
 * @param {string} source
 * @returns {Array<{ pattern: string, flags: string, startLine: number, endLine: number, assignedTo: string | null }>}
 */
export function regexLiteralsIn(source) {
  /** @type {Array<{ pattern: string, flags: string, startLine: number, endLine: number, assignedTo: string | null }>} */
  const found = [];
  let line = 1;
  /** The last character that was not whitespace, which is how `/` is classified. */
  let previous = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') line += 1;
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === '\n') line += 1;
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      previous = quote;
      continue;
    }
    const startsExpression =
      previous === '' || !(/[\w$]/.test(previous) || EXPRESSION_ENDS.has(previous));
    if (char === '/' && startsExpression) {
      const startLine = line;
      let cursor = index + 1;
      let pattern = '';
      let inClass = false;
      let closed = false;
      while (cursor < source.length) {
        const inner = source[cursor];
        if (inner === '\\') {
          pattern += inner + (source[cursor + 1] ?? '');
          cursor += 2;
          continue;
        }
        if (inner === '\n') break;
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) {
          closed = true;
          break;
        }
        pattern += inner;
        cursor += 1;
      }
      if (!closed) {
        // **A division that looked like a regex opener.** Treat the slash as an operator and keep scanning, because a
        // scanner that gave up here would lose every literal after the first `a / b` in the file.
        previous = char;
        index += 1;
        continue;
      }
      cursor += 1;
      let flags = '';
      while (cursor < source.length && /[a-z]/.test(source[cursor])) {
        flags += source[cursor];
        cursor += 1;
      }
      found.push({
        pattern,
        flags,
        startLine,
        endLine: line,
        assignedTo: assignmentTarget(source, index),
      });
      previous = '/';
      index = cursor;
      continue;
    }
    if (!/\s/.test(char)) previous = char;
    index += 1;
  }
  return found;
}

/**
 * **The input CodeQL said would be slow, recovered from its own sentence.**
 *
 * Two shapes are emitted by the rule, and both name the pump: *"strings with many repetitions of `Y`"* and *"strings
 * starting with `X` and with many repetitions of `Y`"*. Anything else returns `null` rather than a guessed input, because
 * **an invented pump measures the author's imagination and reports it as the rule's claim.**
 *
 * @param {string} message
 * @returns {{ prefix: string, pump: string } | null}
 */
export function pumpFromMessage(message) {
  const text = String(message ?? '');
  const pump = /many repetitions of '(.*)'\./.exec(text);
  if (!pump) return null;
  const prefix = /starting with '(.*)' and (?:with|containing)/.exec(text);
  return { prefix: prefix ? prefix[1] : '', pump: pump[1] };
}

/**
 * **The string the claim describes, at the size asked for.**
 *
 * A pump of `''` would make the string a constant and the measurement meaningless, so it is refused here rather than
 * silently producing a fast result for a pattern nobody tested.
 *
 * @param {{ prefix: string, pump: string }} claim
 * @param {number} size
 * @returns {string}
 */
export function adversarialString(claim, size) {
  if (claim.pump === '') throw new Error('a pump of nothing is not an input');
  const repeats = Math.max(
    1,
    Math.ceil(Math.max(0, size - claim.prefix.length) / claim.pump.length),
  );
  return claim.prefix + claim.pump.repeat(repeats);
}

/**
 * The child that does the timing.
 *
 * **A separate process, because the pattern under test is allowed to hang** and a harness that hangs with it reports
 * nothing about the seventy-five findings that came after it - which is what the first attempt at this did, for nine
 * minutes. It reads one JSON payload from stdin and writes one JSON line, so no shell quoting can reach the regex.
 */
const CHILD = `
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const re = new RegExp(payload.pattern, payload.flags);
const input = payload.input;
const started = process.hrtime.bigint();
let hits = 0;
if (payload.flags.includes('g')) {
  let match;
  let guard = 0;
  while ((match = re.exec(input)) !== null) {
    hits += 1;
    if (match[0] === '') re.lastIndex += 1;
    if (++guard > 100000) break;
  }
} else {
  hits = re.test(input) ? 1 : 0;
}
const ms = Number(process.hrtime.bigint() - started) / 1e6;
process.stdout.write(JSON.stringify({ ms, hits }));
`;

/**
 * **One replay, and the honest four answers it can give.**
 *
 * `ms` is the measurement; `killed` is a pattern that did not return inside the window, which is the strongest form of
 * "slow" and is recorded as such rather than as a large number nobody measured; `error` is a pattern that could not be
 * compiled, which is a finding about the finding.
 *
 * @param {{ pattern: string, flags: string }} literal
 * @param {string} input
 * @param {{ killMs?: number }} [options]
 * @returns {{ ms: number | null, killed: boolean, error: string | null }}
 */
export function measureOnce(literal, input, options = {}) {
  const killMs = options.killMs ?? KILL_MS;
  const result = spawnSync(process.execPath, ['-e', CHILD], {
    input: JSON.stringify({ pattern: literal.pattern, flags: literal.flags, input }),
    encoding: 'utf8',
    timeout: killMs,
    maxBuffer: 1 << 20,
  });
  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === 'ETIMEDOUT') {
    return { ms: null, killed: true, error: null };
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.error?.message || '').trim().split('\n').pop() ?? '';
    return {
      ms: null,
      killed: false,
      error: message === '' ? 'the child exited without a message' : message,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return { ms: Number(parsed.ms), killed: false, error: null };
  } catch {
    return { ms: null, killed: false, error: 'the child did not answer with a measurement' };
  }
}

/**
 * **The name a literal is bound to, if it is bound to one.**
 *
 * CodeQL reports an alert on the line the expression is *used*, and the use is almost always `pattern.exec(line)` three
 * lines below `const pattern = /…/`. **Nearest-line matching found the literal for sixteen of seventy-six findings and
 * declared the other sixty unmeasurable**, which reads in a summary as "the corpus is small" rather than "the locator is
 * blind" - so the locator reads the assignment instead, and the caller matches on the name the call site uses.
 *
 * @param {string} source
 * @param {number} offset
 * @returns {string | null}
 */
export function assignmentTarget(source, offset) {
  // **Two hundred characters rather than the current line**, because a long pattern is written on its own line:
  // `const methodPattern =` ends the line above and the literal begins the next one, so a same-line lookback reads
  // whitespace and calls the pattern anonymous - which it did for four findings.
  const prefix = source.slice(Math.max(0, offset - 200), offset);
  const match = /([A-Za-z_$][\w$]*)\s*[:=]\s*$/.exec(prefix);
  return match ? match[1] : null;
}

/**
 * **The identifiers a line passes a regular expression through**, in the order they appear.
 *
 * The receiver for the two methods that hang off a pattern - `pattern.exec`, `pattern.test` - and the **argument** for
 * the four that hang off a string and take a pattern: `line.match(re)`, `line.matchAll(re)`, `line.split(re)`,
 * `line.replace(re, …)`. **`line` is not a candidate in `line.match(re)`** even though it sits where a pattern sits in
 * `pattern.exec(line)`, and a locator that offered it as one would bind the alert to whatever literal `line` happened to
 * hold.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function regexConsumers(line) {
  /** @type {string[]} */
  const names = [];
  for (const match of line.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*(?:exec|test)\s*\(/g)) {
    names.push(match[1]);
  }
  for (const match of line.matchAll(
    /\.\s*(?:match|matchAll|replace|split)\s*\(\s*([A-Za-z_$][\w$]*)/g,
  )) {
    names.push(match[1]);
  }
  return names;
}

/**
 * **Which literal an alert is about, and how sure that is.**
 *
 * Three answers, in decreasing strength: the line *is* the literal; the line names the variable the literal is bound to;
 * the literal is the nearest one above the line. **A guess is labelled a guess** rather than folded into the same column
 * as a fact, because the difference between them is what a dismissal is allowed to rest on.
 *
 * @param {{ line: number }} finding
 * @param {ReturnType<typeof regexLiteralsIn>} literals
 * @param {string} source
 * @returns {{ literal: ReturnType<typeof regexLiteralsIn>[number] | null, locatedBy: string | null }}
 */
export function locateLiteral(finding, literals, source) {
  const covering = literals.filter(
    (literal) => literal.startLine <= finding.line && literal.endLine >= finding.line,
  );
  if (covering.length > 0) return { literal: covering.at(-1), locatedBy: 'line' };

  const lineIndex = finding.line - 1;
  const lineText = source.split('\n')[lineIndex] ?? '';
  const consumers = regexConsumers(lineText);
  if (consumers.length > 0) {
    const named = literals.filter(
      (literal) => literal.assignedTo !== null && consumers.includes(literal.assignedTo),
    );
    if (named.length > 0) return { literal: named.at(-1), locatedBy: 'name' };
  }

  const above = literals.filter((literal) => literal.endLine <= finding.line);
  const nearest = above.at(-1) ?? null;
  if (nearest !== null && finding.line - nearest.endLine <= 15) {
    return { literal: nearest, locatedBy: 'adjacent' };
  }
  // **And a literal that starts below the line**, because a call written across three lines puts the argument under the
  // call: `trimmed.match(` on line 385, the pattern on 386. **A locator that only looked upwards called four findings
  // unmeasurable**, and "unmeasurable" in a summary is indistinguishable from "not there".
  const below = literals.find((literal) => literal.startLine >= finding.line);
  if (below !== undefined && below.startLine - finding.line <= 10) {
    return { literal: below, locatedBy: 'below' };
  }
  return { literal: null, locatedBy: null };
}

/**
 * **The decision, as a function, so it can be argued with.**
 *
 * Three ways to be quadratic and none of them alone is enough:
 *
 * - **it did not return** inside the kill window, which is the strongest evidence there is;
 * - **it grew by more than a linear scan can**, which catches the pattern with too small a constant to cross a
 *   wall-clock line at 40 KB;
 * - **it crossed the wall clock**, which catches a pattern that is merely enormous on every input.
 *
 * `null` measurements are not "fast": a pattern that failed to compile is `error`, and one that produced no number is
 * reported as unmeasured rather than counted in the safe column.
 *
 * @param {{ ms: number | null, growth: number | null, killed: boolean, slowMs?: number, growthLine?: number }} measured
 * @returns {'quadratic' | 'linear' | 'unmeasured'}
 */
export function verdictOf(measured) {
  const slowMs = measured.slowMs ?? SLOW_MS;
  const growthLine = measured.growthLine ?? QUADRATIC_GROWTH;
  if (measured.killed) return 'quadratic';
  if (measured.ms === null) return 'unmeasured';
  if (measured.ms >= slowMs) return 'quadratic';
  if (measured.growth !== null && measured.growth >= growthLine) return 'quadratic';
  return 'linear';
}

/**
 * **Every finding, measured, with the reason a reader needs on every row.**
 *
 * The pattern is located by line: an alert points at the expression's *use*, and the literal may start three lines above
 * it. When no literal covers the line the row says so - **`unextractable` is a value, not a gap** - because the corpus
 * this reports on is the corpus of findings, and a finding that vanished from the table between the API and the summary
 * is exactly the arithmetic `docs/SECURITY.md` §1.6 was written about.
 *
 * @param {Array<{ rule: string, file: string, line: number, message: string }>} findings
 * @param {(file: string) => string} readSource
 * @param {{ sizes?: readonly number[], killMs?: number, slowMs?: number, growthLine?: number }} [options]
 */
export function assay(findings, readSource, options = {}) {
  const sizes = options.sizes ?? SIZES;
  const killMs = options.killMs ?? KILL_MS;
  const slowMs = options.slowMs ?? SLOW_MS;
  const growthLine = options.growthLine ?? QUADRATIC_GROWTH;
  /** @type {Map<string, ReturnType<typeof regexLiteralsIn>>} */
  const sources = new Map();
  /** @type {Map<string, { ms: (number | null)[], killed: boolean, error: string | null }>} */
  const cache = new Map();

  return findings.map((finding) => {
    if (!sources.has(finding.file))
      sources.set(finding.file, regexLiteralsIn(readSource(finding.file)));
    const { literal, locatedBy } = locateLiteral(
      finding,
      sources.get(finding.file),
      readSource(finding.file),
    );
    if (!literal) {
      return {
        ...finding,
        pattern: null,
        flags: null,
        locatedBy: null,
        outcome: 'unlocated',
        ms: null,
        growth: null,
      };
    }
    const claim = pumpFromMessage(finding.message);
    if (!claim) {
      return {
        ...finding,
        pattern: literal.pattern,
        flags: literal.flags,
        locatedBy,
        outcome: 'no-claim',
        ms: null,
        growth: null,
      };
    }
    const identity = `${literal.pattern}/${literal.flags}`;
    if (!cache.has(identity)) {
      const timings = sizes.map((size) =>
        measureOnce(literal, adversarialString(claim, size), { killMs }),
      );
      cache.set(identity, {
        ms: timings.map((timing) => timing.ms),
        killed: timings.some((timing) => timing.killed),
        error: timings.find((timing) => timing.error !== null)?.error ?? null,
      });
    }
    const measured = cache.get(identity);
    const largest = measured.ms.at(-1);
    const smallest = measured.ms[0];
    const growth =
      smallest !== null && smallest > 0 && largest !== null
        ? Math.round((largest / smallest) * 10) / 10
        : null;
    const verdict = verdictOf({ ms: largest, growth, killed: measured.killed, slowMs, growthLine });
    return {
      ...finding,
      pattern: literal.pattern,
      flags: literal.flags,
      locatedBy,
      outcome: measured.error !== null ? 'error' : verdict,
      ms: largest,
      growth,
      error: measured.error,
      killed: measured.killed,
    };
  });
}

/** The token, from the environment, never from a file. */
function token() {
  const value = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!value) {
    throw new Error(
      'no GITHUB_TOKEN or GH_TOKEN in the environment - an anonymous walk would be truncated by the rate limit',
    );
  }
  return value;
}

/** Every open alert of the two ReDoS rules, in one list, as the caller's shape. */
async function fetchFindings(repo) {
  const alerts = await collectAllPages(
    async (page) => {
      const response = await fetch(
        `${API}/repos/${repo}/code-scanning/alerts?state=open&per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
        {
          headers: {
            authorization: `Bearer ${token()}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
          },
        },
      );
      if (!response.ok) throw new Error(`HTTP ${String(response.status)} on page ${String(page)}`);
      return response.json();
    },
    { pageSize: PAGE_SIZE, what: 'code-scanning alerts' },
  );
  return alerts
    .filter((alert) => REDOS_RULES.includes(alert?.rule?.id))
    .map((alert) => ({
      rule: alert.rule.id,
      file: alert.most_recent_instance.location.path,
      line: alert.most_recent_instance.location.start_line,
      message: alert.most_recent_instance.message.text,
    }));
}

/** The table the console gets, which is the same rows the JSON carries. */
function print(rows, slowMs) {
  const quadratic = rows.filter((row) => row.outcome === 'quadratic');
  const linear = rows.filter((row) => row.outcome === 'linear');
  const other = rows.filter((row) => !['quadratic', 'linear'].includes(row.outcome));
  const width = Math.max(...rows.map((row) => `${row.file}:${String(row.line)}`.length), 10);
  for (const row of [...quadratic, ...linear, ...other]) {
    const wall = row.killed ? 'hang' : row.ms === null ? '—' : `${String(Math.round(row.ms))} ms`;
    const growth = row.growth === null ? '' : ` ×${String(row.growth)}`;
    const how = row.locatedBy === null ? '' : ` via ${row.locatedBy}`;
    process.stdout.write(
      `${row.outcome.padEnd(10)} ${`${row.file}:${String(row.line)}`.padEnd(width)}  ${wall.padStart(8)}${growth}${how}\n`,
    );
  }
  const tally = new Map();
  for (const row of other) tally.set(row.outcome, (tally.get(row.outcome) ?? 0) + 1);
  const tail = [...tally].map(([outcome, count]) => `${String(count)} ${outcome}`).join(', ');
  process.stdout.write(
    `\n${String(rows.length)} findings · ${String(quadratic.length)} quadratic at ${String(slowMs)} ms or ` +
      `${String(QUADRATIC_GROWTH)}× growth · ${String(linear.length)} linear · ${String(other.length)} not measured` +
      `${tail === '' ? '' : ` (${tail})`}\n`,
  );
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? null : (args[at + 1] ?? null);
  };
  const repo = process.env.GITHUB_REPOSITORY ?? flag('--repo') ?? 'AgentiX-E/code-analyzer';
  const findingsPath = flag('--findings');
  const findings = findingsPath
    ? JSON.parse(readFileSync(findingsPath, 'utf8')).findings
    : await fetchFindings(repo);
  const rows = assay(findings, (file) => readFileSync(file, 'utf8'));
  print(rows, SLOW_MS);
  const out = flag('--json');
  if (out)
    writeFileSync(
      out,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
    );
  if (args.includes('--fail-if-quadratic') && rows.some((row) => row.outcome === 'quadratic')) {
    process.exit(1);
  }
}
