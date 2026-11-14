// @code-analyzer/intelligence — the comments a human reviewer makes that are not about a defect
//
// **The measurement this file was written after.** On fifty pull requests of `Alibaba-Aone/aacr-bench`, fifty sampled
// goldens that the file arm failed to match were read one at a time and sorted: **forty-one of them are a remark the
// engine never attempts to make.** They are not wrong, and neither is the engine's comment at the same place - the two
// are answers to different questions. `FemVTKTools.cpp` says "remove commented-out code"; the arm said something about
// the manual loop. `SoDatumLabel.cpp` says "`2.0f`, not `2.0`"; the arm said something about the datum's sign.
// `PropertyStandard.cpp` says "declare `maxEnumValue` as `const auto`"; the arm said nothing there at all.
//
// **Why a lane and not a prompt.** Every one of those sentences is decidable from the syntax of one construct, and
// **none of them is decidable from a diff read as prose**: a model asked to find defects describes defects, which is
// what the five lanes were asked for. The remarks above belong to a different task, so they get a different instrument
// - deterministic, free, and switchable, because **a lane that changes what the product says must be a lane a caller
// chooses, or every published figure silently belongs to a different product.**
//
// **Precision is the constraint, not coverage.** This lane fires only on a line the patch added (a reviewer cannot
// comment on a line the pull request did not touch), each rule carries the narrowest reading that decides it, and each
// rule is capped per file. **One rule that reads the whole file would put forty remarks on a FreeCAD pull request**,
// and the corpus scores every one of them: a remark that is true but unwanted costs exactly what a wrong one costs.
//
// **Every rule names its golden.** A rule whose evidence is not in this header is a rule somebody added on taste, and
// the header is what lets the next reader retire it on evidence instead.

import type { LLMFinding } from './llm/prompts.js';
import type { ReviewCategory, Severity } from '@code-analyzer/shared';

/** What a rule is allowed to read: the patch, and nothing else. */
export interface IdiomInput {
  /** The file the patch belongs to, which is what decides which rules apply. */
  readonly path: string;
  /** **The lines the patch added, keyed by the file line number they land on.** A rule reads only these. */
  readonly addedLines: ReadonlyMap<number, string>;
  /** The patch text, for the declarations a rule needs in order to be sure of a verdict. */
  readonly patch: string;
}

/** The source language, coarse enough that a rule either applies or does not. */
type Language = 'cxx' | 'javascript' | 'other';

/** **No rule may flood a file.** Two remarks of one kind per file is a review; the third is a refactor request. */
const MAX_PER_RULE = 2;

/** Which family a path belongs to. The `.h` case is C++ by this repository's convention and by the corpus's. */
export function languageOf(path: string): Language {
  const lower = path.toLowerCase();
  if (/\.(?:c|h|cc|cpp|cxx|hpp|hxx|m|mm|ino)$/.test(lower)) return 'cxx';
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(lower)) return 'javascript';
  return 'other';
}

/** One finding, before the coordinates are attached. */
interface Draft {
  readonly id: string;
  readonly line: number;
  readonly category: ReviewCategory;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly suggestion: string;
}

// ---------------------------------------------------------------------------
// Reading a comment's body
// ---------------------------------------------------------------------------

/**
 * **The text a line says once its comment marker is removed, or `null` when the line is not a comment.**
 *
 * The three markers are the corpus's: `//` (C++, C#, JS, Go), `#` (Python, shell) and `--` (Lua, SQL). **`#` needs
 * guarding**, because a preprocessor directive starts with the same character and `#define X 1` is not a comment -
 * the directive keywords are excluded rather than the line, since a directive's own body is what the macro rule reads.
 */
const DIRECTIVE =
  /^\s*#\s*(?:define|include|pragma|if|ifdef|ifndef|else|elif|endif|undef|error|warning|line)\b/;

function commentBody(line: string): string | null {
  const match = /^\s*(?:\/\/[/!]?|#(?!\s*[![])|--)\s?(.*)$/.exec(line);
  if (match === null) return null;
  if (DIRECTIVE.test(line)) return null;
  return match[1] ?? '';
}

/** Markers a reader uses to say "this is not a statement": a task, a tag, a reference, a URL. */
const NOT_CODE =
  /^(?:TODO|FIXME|NOTE|XXX|HACK|BUG|REVIEW|NOSONAR)\b|^[@<]|https?:\/\/|\bsee\s+\S+\.(?:md|rst|txt)\b/i;

/** The shapes a statement takes when it is quoted inside a comment. */
const STATEMENT_SHAPES: readonly RegExp[] = [
  // A call, with or without a receiver: `Fill(0.0)`, `this->dispose();`, `self.mesh.reset()`.
  /^[A-Za-z_][\w.:>[\]()-]*\s*\([^)]*\)\s*;?$/,
  // An assignment or an update: `x = 1;`, `count += step;`.
  /^[A-Za-z_][\w.:>[\]]*\s*(?:[+\-*/%&|^]|\*\*)?=(?!=).*;?$/,
  // A control-flow head or a bare block boundary.
  /^(?:return|if|for|while|switch|else|do|try|catch|throw|new|delete|await|yield)\b/,
  /^[{}]$/,
];

/** Whether a comment's body is a statement somebody commented out rather than a sentence about the code. */
function isCommentedOutCode(body: string): boolean {
  const text = body.trim();
  if (text.length === 0 || NOT_CODE.test(text)) return false;
  // **A sentence ends with a period; a statement ends with a semicolon or a brace.** The distinction is what keeps
  // `// Returns the scale.` out, and it is why the shapes below are anchored rather than searched: a prose line can
  // contain a parenthesis, and a statement quoted in a comment starts with its own first token.
  return STATEMENT_SHAPES.some((shape) => shape.test(text));
}

// ---------------------------------------------------------------------------
// Rule: commented-out code
// ---------------------------------------------------------------------------

/**
 * **Corpus: `FemVTKTools.cpp:1434` - "Remove commented-out code. If `Fill(0.0)` is not needed, the commented lines
 * should be removed."**
 *
 * The remark is a maintenance one: a commented statement is code that no compiler checks and no reader can trust, and
 * the two possible repairs - delete it, or restore it - are both decisions the author is the only one who can make. It
 * is therefore `maintainability` rather than `style`: the count that matters is whether a reader would act.
 */
function commentedOutCode(line: number, text: string): Draft | null {
  const body = commentBody(text);
  if (body === null || !isCommentedOutCode(body)) return null;
  const quoted = body.trim();
  return {
    id: 'commented-out-code',
    line,
    category: 'maintainability',
    severity: 'low',
    title: 'Commented-out code should be deleted or restored',
    description:
      `The added line comments out a statement: \`${quoted}\`. Commented-out code is not checked by the compiler ` +
      'and cannot be trusted by a reader - it either still matters, in which case it belongs in the code, or it does ' +
      'not, in which case it belongs in the history.',
    suggestion: 'Delete the commented statements, or uncomment them if they are still needed.',
  };
}

// ---------------------------------------------------------------------------
// Rule: double literal in float arithmetic
// ---------------------------------------------------------------------------

/** A `float` declaration, which is the evidence that the literal beside it widens the expression. */
const FLOAT_DECLARATION = /\bfloat\s+([A-Za-z_]\w*)\b/g;

/** A double literal used in a multiplication or a division, without an `f` suffix. */
const DOUBLE_LITERAL = /(?<![\w.])(\d+\.\d+)(?![\d.fF])\s*[*/]\s*([A-Za-z_]\w*)/g;

/**
 * **Corpus: `SoDatumLabel.cpp:84` - "consider using float literal `2.0f` instead of double literal `2.0`. The current
 * code still performs double arithmetic (2.0 * float)."**
 *
 * **The declaration is required, and it must be in the patch.** A rule that fired on every `2.0 *` in a C++ file would
 * be reporting an arithmetic style that most of the corpus's files use correctly; what makes this a finding is that
 * the author declared the variable as `float` and then multiplied it by a `double`, which widens the product back.
 */
function floatLiteralInFloatArithmetic(
  line: number,
  text: string,
  floats: ReadonlySet<string>,
): Draft | null {
  if (floats.size === 0) return null;
  DOUBLE_LITERAL.lastIndex = 0;
  const match = DOUBLE_LITERAL.exec(text);
  if (match === null) return null;
  const literal = match[1] ?? '';
  const variable = match[2] ?? '';
  if (!floats.has(variable)) return null;
  return {
    id: 'float-literal-in-float-arithmetic',
    line,
    category: 'maintainability',
    severity: 'low',
    title: 'Double literal widens float arithmetic',
    description:
      `\`${literal}\` is a double literal, so \`${literal} * ${variable}\` is evaluated in double precision and the ` +
      `result is narrowed back when it is stored beside \`${variable}\`. Writing \`${literal}f\` keeps the whole ` +
      'expression in float arithmetic, which is what the declared type says was intended.',
    suggestion: `Use \`${literal}f\` instead of \`${literal}\`.`,
  };
}

// ---------------------------------------------------------------------------
// Rule: async with nothing to await
// ---------------------------------------------------------------------------

/** A method declared `async`, which is the only shape this rule reads. */
const ASYNC_METHOD =
  /^\s*(?:export\s+)?(?:(?:public|private|protected|static|readonly|override|abstract)\s+)*async\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;

/**
 * **Corpus: `index.ts:460` - "Remove async keyword as this method doesn't perform any asynchronous operations. This is
 * misleading and unnecessary."**
 *
 * **The body has to be closed inside the patch before the rule speaks.** `async` on a method whose remaining body the
 * patch does not show is not evidence of anything - the `await` may be four hundred lines down - so an unclosed block
 * is a silence rather than a guess.
 */
function redundantAsync(
  line: number,
  text: string,
  lines: readonly string[],
  at: number,
): Draft | null {
  if (!ASYNC_METHOD.test(text)) return null;
  const openAt = text.lastIndexOf('{');
  if (openAt < 0) return null;
  let depth = 1;
  let sawAwait = false;
  const rest = `${text.slice(openAt + 1)}`;
  const walk = [rest, ...lines.slice(at + 1)];
  for (let index = 0; index < walk.length; index += 1) {
    const current = walk[index] ?? '';
    if (/\bawait\b/.test(current)) sawAwait = true;
    for (const character of current) {
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    if (depth <= 0) break;
  }
  // **An unclosed block is the truncation case**, and it is the one where a finding would be a claim about code the
  // lane never saw.
  if (depth > 0 || sawAwait) return null;
  const name = ASYNC_METHOD.exec(text)?.[1] ?? 'method';
  return {
    id: 'redundant-async',
    line,
    category: 'maintainability',
    severity: 'low',
    title: '`async` method performs no asynchronous work',
    description:
      `\`${name}\` is declared \`async\` but its body contains no \`await\`, so it returns an already-settled promise. ` +
      'Every caller has to `await` a value that was available synchronously, and the signature says the method does ' +
      'work that it does not do.',
    suggestion:
      'Remove `async` and return the value directly, or `await` the work it is meant to do.',
  };
}

// ---------------------------------------------------------------------------
// Rule: loose equality
// ---------------------------------------------------------------------------

/** A loose comparison, with the strict forms excluded by the lookarounds. */
const LOOSE_EQUALITY = /(?:^|[^=!<>])(==|!=)(?!=)/;

/** The operands whose loose comparison is the idiomatic spelling of a null guard. */
const NULLISH_OPERANDS = new Set(['null', 'undefined']);

/** The identifier ending just before `at`, or `''` when the operand is not a name. */
function operandBefore(text: string, at: number): string {
  return /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, at))?.[1] ?? '';
}

/** The identifier starting just after `at`, or `''` when the operand is not a name. */
function operandAfter(text: string, at: number): string {
  return /^\s*([A-Za-z_$][\w$]*)/.exec(text.slice(at))?.[1] ?? '';
}

/**
 * **Corpus: `ExtrudeGeometry.js:406` - "Use strict equality === instead of ==. The checklist requires using === and !==
 * for all comparisons."**
 *
 * **`== null` is excluded, and it is the only exclusion.** It is the single expression that covers both `null` and
 * `undefined`, which is why it is idiomatic rather than sloppy; a rule that fired on it would be arguing with the
 * language. A comparison against any other value coerces, and coercion is what the corpus's checklist forbids.
 */
function looseEquality(line: number, text: string): Draft | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return null;
  const match = LOOSE_EQUALITY.exec(text);
  if (match === null) return null;
  const operator = match[1] ?? '==';
  // **The operator's own offset, not the match's.** The match carries one leading character (the lookbehind that keeps
  // `===` out), so the operands are read from the operator rather than from the pattern's start.
  const operatorAt = (match.index ?? 0) + match[0].length - operator.length;
  const left = operandBefore(text, operatorAt);
  const right = operandAfter(text, operatorAt + operator.length);
  if (NULLISH_OPERANDS.has(left) || NULLISH_OPERANDS.has(right)) return null;
  return {
    id: 'loose-equality',
    line,
    category: 'bug',
    severity: 'medium',
    title: 'Loose equality coerces its operands',
    description:
      `\`${operator}\` compares after type coercion, so \`0\`, \`""\` and \`false\` all compare equal to each other ` +
      'and a mistyped operand becomes a silent pass rather than a failed comparison. The checklist requires `===` and ' +
      '`!==` for every comparison.',
    suggestion: `Use \`${operator === '==' ? '===' : '!=='}\` instead of \`${operator}\`.`,
  };
}

// ---------------------------------------------------------------------------
// Rule: article agreement
// ---------------------------------------------------------------------------

/**
 * **Corpus: `lv_observer.h:610` - `"an Scale" should be "a Scale"`; `observer.rst:581` - the same error in the section
 * heading.** Both were filed as review comments on documentation the pull request added.
 *
 * **The rule reads sounds, not letters**, because the words that make it wrong are the ones where the two disagree:
 * `an hour` and `a user` are correct, and a rule matching `[aeiou]` alone reports both of them. The two tables below
 * are the whole of that knowledge, and they are short because the corpus is about code documentation rather than prose.
 */
const SILENT_H = new Set(['hour', 'hours', 'honest', 'honor', 'honour', 'heir', 'herb']);

/** Vowel letters that are pronounced as a consonant: `a user`, `a union`, `a one-off`, `a European`. */
const CONSONANT_SOUND =
  /^(?:un(?:ion|animous|i(?:t|vers|que|form|son|sex))|use|usa|uti|ubu|ure|uro|eu|ewe|one|once)/;

const ARTICLE = /\b(a|an)\s+([A-Za-z][a-z]+)/g;

function startsWithVowelSound(word: string): boolean {
  const lower = word.toLowerCase();
  if (SILENT_H.has(lower)) return true;
  if (CONSONANT_SOUND.test(lower)) return false;
  return /^[aeiou]/.test(lower);
}

function articleAgreement(line: number, text: string): Draft[] {
  const body = commentBody(text);
  if (body === null || body.trim().length === 0) return [];
  const drafts: Draft[] = [];
  ARTICLE.lastIndex = 0;
  for (let match = ARTICLE.exec(body); match !== null; match = ARTICLE.exec(body)) {
    const article = match[1] ?? 'a';
    const noun = match[2] ?? '';
    if (noun.length === 0) continue;
    const agrees = article === 'an' ? startsWithVowelSound(noun) : !startsWithVowelSound(noun);
    if (agrees) continue;
    const shouldBe = article === 'an' ? 'a' : 'an';
    drafts.push({
      id: 'article-agreement-in-comment',
      line,
      category: 'style',
      severity: 'info',
      title: `Article does not agree with \`${noun}\``,
      description:
        `The comment says \`${article} ${noun}\`, but \`${noun}\` begins with a ` +
        `${startsWithVowelSound(noun) ? 'vowel' : 'consonant'} sound, so the article should be \`${shouldBe}\`.`,
      suggestion: `Write \`${shouldBe} ${noun}\` instead of \`${article} ${noun}\`.`,
    });
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Rule: macro name case
// ---------------------------------------------------------------------------

/** An object-like macro. The captured name is followed by whitespace, which is what tells it from a function-like one. */
const OBJECT_MACRO = /^\s*#\s*define\s+([A-Za-z_]\w*)(?=\s)/;

/**
 * **Corpus: `usb_ids.h:63` - "The added USB product definitions use inconsistent naming conventions (e.g., `SN30_Pro`
 * instead of `SN30_PRO`)"** - filed together with the missing space after `//` in the same block.
 *
 * **Function-like macros are excluded.** `#define MAX(a, b)` is a different construct with a different convention, and
 * the corpus's finding was about constants.
 */
function macroNameCase(line: number, text: string): Draft | null {
  const name = OBJECT_MACRO.exec(text)?.[1];
  if (name === undefined || !/[a-z]/.test(name)) return null;
  const upper = name.replace(/[a-z]/g, (character) => character.toUpperCase());
  return {
    id: 'macro-name-case',
    line,
    category: 'style',
    severity: 'low',
    title: `Macro \`${name}\` is not upper case`,
    description:
      `\`#define ${name}\` is a constant whose name is not in upper case, while the other definitions in this header ` +
      'are. The inconsistency makes the new constant read like a variable at the call site and like a different ' +
      'convention at the definition.',
    suggestion: `Rename it to \`${upper}\`.`,
  };
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

/** Every rule, with the languages it applies to. **A rule that applies to nothing is a rule nobody measured.** */
export const IDIOM_RULES: ReadonlyArray<{
  readonly id: string;
  readonly languages: readonly Language[];
  readonly corpus: string;
}> = Object.freeze([
  {
    id: 'commented-out-code',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'FemVTKTools.cpp:1434',
  },
  {
    id: 'float-literal-in-float-arithmetic',
    languages: ['cxx'],
    corpus: 'SoDatumLabel.cpp:84',
  },
  { id: 'redundant-async', languages: ['javascript'], corpus: 'index.ts:460' },
  { id: 'loose-equality', languages: ['javascript'], corpus: 'ExtrudeGeometry.js:406' },
  {
    id: 'article-agreement-in-comment',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'lv_observer.h:610',
  },
  { id: 'macro-name-case', languages: ['cxx'], corpus: 'usb_ids.h:63' },
]);

/**
 * **Every remark this lane has to make about one file, in line order, capped per rule.**
 *
 * The order is by line because the comments are filed by position; the cap is per rule because a file with twelve
 * commented-out statements is one refactor, and the twelve remarks a reader would have to dismiss are not twelve
 * findings. **A finding's `id` names the rule that produced it**, so the artifact can say which of the six earned
 * anything rather than crediting the lane as a whole.
 */
export function detectIdioms(input: IdiomInput): LLMFinding[] {
  const language = languageOf(input.path);
  const applies = new Set(
    IDIOM_RULES.filter((rule) => rule.languages.includes(language)).map((rule) => rule.id),
  );

  const entries = [...input.addedLines.entries()].sort((left, right) => left[0] - right[0]);
  const lines = entries.map(([, text]) => text);

  const floats = new Set<string>();
  for (const match of input.patch.matchAll(FLOAT_DECLARATION)) {
    if (match[1] !== undefined) floats.add(match[1]);
  }

  const drafts: Draft[] = [];
  entries.forEach(([line, text], at) => {
    if (applies.has('commented-out-code')) {
      const draft = commentedOutCode(line, text);
      if (draft !== null) drafts.push(draft);
    }
    if (applies.has('float-literal-in-float-arithmetic')) {
      const draft = floatLiteralInFloatArithmetic(line, text, floats);
      if (draft !== null) drafts.push(draft);
    }
    if (applies.has('redundant-async')) {
      const draft = redundantAsync(line, text, lines, at);
      if (draft !== null) drafts.push(draft);
    }
    if (applies.has('loose-equality')) {
      const draft = looseEquality(line, text);
      if (draft !== null) drafts.push(draft);
    }
    if (applies.has('article-agreement-in-comment')) {
      drafts.push(...articleAgreement(line, text));
    }
    if (applies.has('macro-name-case')) {
      const draft = macroNameCase(line, text);
      if (draft !== null) drafts.push(draft);
    }
  });

  const perRule = new Map<string, number>();
  const kept: LLMFinding[] = [];
  for (const draft of drafts) {
    const seen = perRule.get(draft.id) ?? 0;
    if (seen >= MAX_PER_RULE) continue;
    perRule.set(draft.id, seen + 1);
    kept.push({
      id: draft.id,
      startLine: draft.line,
      endLine: draft.line,
      severity: draft.severity,
      category: draft.category,
      title: draft.title,
      description: draft.description,
      suggestion: draft.suggestion,
      lane: 'idioms',
    });
  }
  return kept;
}
