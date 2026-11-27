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

/**
 * **The capture group at `index`, which every pattern in this file guarantees is there.**
 *
 * `noUncheckedIndexedAccess` types an index into a match as `string | undefined`, because the compiler cannot read a
 * regular expression. Written as `match[1] ?? ''`, that becomes **a branch no test can ever take the other side of** -
 * the group is present whenever the match is - and the per-file coverage gate counts each one as a half-measured
 * branch. Nine of them were 86.17% of this file's branches, which is the arithmetic that made the gate fail rather
 * than a gap in the tests. **One assertion in one place, with the reason, rather than nine that each look like a
 * decision about what to do when a group is missing.**
 */
function group(match: ReadonlyArray<string>, index: number): string {
  return match[index] as string;
}

/** What a rule may read besides its own line: the patch's `float` and `enum` declarations, and the lines after it. */
interface RuleContext {
  readonly floats: ReadonlySet<string>;
  /** **The enums the patch declares**, which is the only evidence that makes a `const X&` parameter wrong. */
  readonly enums: ReadonlySet<string>;
  readonly lines: readonly string[];
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
  return group(match, 1);
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
function commentedOutCode(line: number, text: string): Draft[] {
  const body = commentBody(text);
  if (body === null || !isCommentedOutCode(body)) return [];
  const quoted = body.trim();
  return [
    {
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
    },
  ];
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
): Draft[] {
  if (floats.size === 0) return [];
  DOUBLE_LITERAL.lastIndex = 0;
  const match = DOUBLE_LITERAL.exec(text);
  if (match === null) return [];
  const literal = group(match, 1);
  const variable = group(match, 2);
  if (!floats.has(variable)) return [];
  return [
    {
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
    },
  ];
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
function redundantAsync(line: number, text: string, lines: readonly string[], at: number): Draft[] {
  const declared = ASYNC_METHOD.exec(text);
  if (declared === null) return [];
  const openAt = text.lastIndexOf('{');
  if (openAt < 0) return [];
  let depth = 1;
  let sawAwait = false;
  const walk = [text.slice(openAt + 1), ...lines.slice(at + 1)];
  for (const current of walk) {
    if (/\bawait\b/.test(current)) sawAwait = true;
    for (const character of current) {
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    if (depth <= 0) break;
  }
  // **An unclosed block is the truncation case**, and it is the one where a finding would be a claim about code the
  // lane never saw.
  if (depth > 0 || sawAwait) return [];
  const name = group(declared, 1);
  return [
    {
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
    },
  ];
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
  const found = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, at));
  return found === null ? '' : group(found, 1);
}

/** The identifier starting just after `at`, or `''` when the operand is not a name. */
function operandAfter(text: string, at: number): string {
  const found = /^\s*([A-Za-z_$][\w$]*)/.exec(text.slice(at));
  return found === null ? '' : group(found, 1);
}

/**
 * **Corpus: `ExtrudeGeometry.js:406` - "Use strict equality === instead of ==. The checklist requires using === and !==
 * for all comparisons."**
 *
 * **`== null` is excluded, and it is the only exclusion.** It is the single expression that covers both `null` and
 * `undefined`, which is why it is idiomatic rather than sloppy; a rule that fired on it would be arguing with the
 * language. A comparison against any other value coerces, and coercion is what the corpus's checklist forbids.
 */
function looseEquality(line: number, text: string): Draft[] {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return [];
  const match = LOOSE_EQUALITY.exec(text);
  if (match === null) return [];
  const operator = group(match, 1);
  // **The operator's own offset, not the match's.** The match carries one leading character (the lookbehind that keeps
  // `===` out), so the operands are read from the operator rather than from the pattern's start.
  const operatorAt = match.index + match[0].length - operator.length;
  const left = operandBefore(text, operatorAt);
  const right = operandAfter(text, operatorAt + operator.length);
  if (NULLISH_OPERANDS.has(left) || NULLISH_OPERANDS.has(right)) return [];
  return [
    {
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
    },
  ];
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
    // **`[A-Za-z][a-z]+` is two characters or more**, so there is no empty noun to skip - a guard for it would be a
    // branch the pattern already excludes.
    const article = group(match, 1);
    const noun = group(match, 2);
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
function macroNameCase(line: number, text: string): Draft[] {
  const declared = OBJECT_MACRO.exec(text);
  if (declared === null) return [];
  const name = group(declared, 1);
  if (!/[a-z]/.test(name)) return [];
  const upper = name.replace(/[a-z]/g, (character) => character.toUpperCase());
  return [
    {
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
    },
  ];
}

// ---------------------------------------------------------------------------
// Reading a comment's body, including the block syntaxes
// ---------------------------------------------------------------------------

/**
 * **The text of a comment in any of the five syntaxes the corpus uses, or `null`.**
 *
 * `commentBody` above reads the three line markers. **A block comment is a comment too** - `/* HACK: ... *&#47;` and a
 * generated file's leading ` * ` continuation line are how half of this corpus writes prose - and a rule that only saw
 * `//` would be a rule blind to C and to every doc-comment header.
 */
function anyCommentBody(line: string): string | null {
  const block = /^\s*\/\*(.*?)(?:\*\/)?\s*$/.exec(line);
  if (block !== null)
    return group(block, 1)
      .replace(/\*\/\s*$/, '')
      .trim();
  const continuation = /^\s*\*(?!\/)\s?(.*)$/.exec(line);
  if (continuation !== null) return group(continuation, 1);
  return commentBody(line);
}

// ---------------------------------------------------------------------------
// Rule: a word written twice
// ---------------------------------------------------------------------------

/**
 * **Words English really does double**, which a rule that fired on them would be wrong about.
 *
 * `that that` and `had had` are correct in a subordinate clause, `long long` is a type, and `ha ha` is a laugh. **The
 * list is short on purpose**: every word on it is one a reviewer would have to dismiss, and the rule's value is that it
 * is almost never wrong.
 */
const DOUBLED_LEGITIMATELY = new Set(['that', 'had', 'long', 'ha', 'no', 'so', 'very', 'blah']);

/** A word repeated with only whitespace between the two copies. */
const DOUBLED_WORD = /\b([A-Za-z][A-Za-z']*)\s+\1\b/i;

/**
 * **Corpus: `DlgOnlineHelpImp.h:35` - "Typo: \"an an\" should likely be \"and an\"" - and the same line drew a second
 * independent golden from another reviewer.** One line, two reviewers, is the strongest evidence in the key that this
 * shape is worth a rule rather than a reading.
 */
function doubledWord(line: number, text: string): Draft[] {
  const body = anyCommentBody(text);
  if (body === null) return [];
  const match = DOUBLED_WORD.exec(body);
  if (match === null) return [];
  const word = group(match, 1);
  if (DOUBLED_LEGITIMATELY.has(word.toLowerCase())) return [];
  return [
    {
      id: 'doubled-word',
      line,
      category: 'maintainability',
      severity: 'low',
      title: `The word \`${word}\` appears twice in a row`,
      description:
        `The added comment reads \`${word} ${word}\`. A word written twice is the one typo a reader cannot help ` +
        'seeing, and it is the kind of slip that survives a review because everybody reads what they meant.',
      suggestion: `Delete one of the two \`${word}\`s.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule: a third-person subject with `don't`
// ---------------------------------------------------------------------------

/** The subjects that take `doesn't`, and the contraction that does not agree with them. **Anchored on the subject**, so
 * a plural one is out of scope by construction rather than by a second pattern. */
const DISAGREEING_CONTRACTION = /\b(this|that|it|he|she)\s+don['’]t\b/gi;

/**
 * **Corpus: `DrawTile.cpp:46` - "'don't' should be 'doesn't' for proper subject-verb agreement with 'this'."**
 *
 * And `ViewProviderProjGroupItem.cpp:157` carries the same sentence, one revision later, still uncorrected: **a golden
 * nobody acted on is a golden a rule should still file**, which is the case for reading this from syntax rather than
 * from a habit.
 */
function subjectVerbAgreement(line: number, text: string): Draft[] {
  const body = anyCommentBody(text);
  if (body === null) return [];
  DISAGREEING_CONTRACTION.lastIndex = 0;
  const match = DISAGREEING_CONTRACTION.exec(body);
  if (match === null) return [];
  const subject = group(match, 1);
  return [
    {
      id: 'subject-verb-agreement',
      line,
      category: 'maintainability',
      severity: 'low',
      title: `\`${subject} don't\` does not agree`,
      description:
        `The added comment says \`${subject} don't\`, and \`${subject}\` is singular. The verb a reader expects is ` +
        "`doesn't`. A comment is the part of a change nobody compiles, so a slip in it is a slip that stays.",
      suggestion: `Write \`${subject} doesn't\`.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule: a TODO left in the change
// ---------------------------------------------------------------------------

/** A task marker at the start of a comment, which is what makes it a promise rather than a mention. */
const TASK_MARKER = /^(TODO|FIXME|XXX|HACK)\b\s*[:(]?\s*(.*)$/;

/**
 * **Corpus: `DrawProjGroup.cpp:1144` - "Unresolved TODO comment left in code regarding potential refactoring of
 * identical functions to DrawView."**
 *
 * **The promise is read from the marker's own block**, because "moved to DrawView" - the half of the sentence that says
 * what is owed - is on the next comment line, and a finding that quoted only the first line would be quoting a word.
 */
function todoInCode(
  line: number,
  text: string,
  at: number,
  context: RuleContext,
): readonly Draft[] {
  const body = anyCommentBody(text);
  if (body === null) return [];
  const match = TASK_MARKER.exec(body.trim());
  if (match === null) return [];
  const marker = group(match, 1);
  const said = [group(match, 2).trim()];
  // **The rest of the block, at most two more lines**, because a TODO's content is a paragraph and the finding has to
  // carry the paragraph rather than its first clause.
  for (let next = at + 1; next < context.lines.length && said.length < 3; next += 1) {
    const following = anyCommentBody(context.lines[next] as string);
    if (following === null) break;
    if (following.trim().length > 0) said.push(following.trim());
  }
  const promise = said.filter((part) => part.length > 0).join(' ');
  return [
    {
      id: 'todo-in-code',
      line,
      category: 'maintainability',
      severity: 'low',
      title: `A ${marker} is left in the change`,
      description:
        `The change adds a \`${marker}\`${promise.length === 0 ? '' : `: ${promise}`} A task marker in code is a ` +
        'promise with no owner and no date, and the next reader cannot tell whether it is a plan or a note to self.',
      suggestion:
        'File the task where it can be tracked, and say in the code what the reader should do meanwhile.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule: a parameter of a heap-owning type, by value
// ---------------------------------------------------------------------------

/**
 * **The types whose copy is a heap allocation**, per family and per language.
 *
 * A `Base::Vector3d` is three doubles and passing it by value is right, so it is not on the list; **the rule's whole
 * claim is that the copy is expensive**, and a rule that fired on every by-value parameter would be reporting a
 * convention rather than a cost.
 */
const HEAP_OWNING_TEMPLATES = [
  'vector',
  'map',
  'set',
  'unordered_map',
  'unordered_set',
  'list',
  'deque',
  'multimap',
]
  .map((name) => `(?:std::)?${name}`)
  .concat(['QList', 'QVector', 'QMap', 'QHash', 'QSet', 'QStringList'])
  .join('|');

/** A parameter is a name followed by `,` or `)` - **the only two characters that can follow one**, and the reason a
 * local declaration is out of reach: a declaration is followed by `;`, `=` or `{`. */
const BY_VALUE_PARAMETER = new RegExp(
  `\\b(?:const\\s+)?(?:(?:std::|Q)[A-Za-z_]\\w*::)*(?:${HEAP_OWNING_TEMPLATES})\\b` +
    `(?:\\s*<[^;{}()]*>)?\\s+([A-Za-z_]\\w*)\\s*[,)]`,
  'g',
);

/** The non-template class types with the same property, written out because they have no `<>` to recognise them by. */
const BY_VALUE_NAMED =
  /\b(?:const\s+)?(?:std::)?(?:string|wstring|u16string|u32string|QString|QByteArray)\s+([A-Za-z_]\w*)\s*[,)]/g;

/**
 * **Corpus: `CommandCreateDims.cpp:2384` - `std::string type` by value - and `DimensionValidators.h`'s "The string
 * parameter in `isCosmeticVertex` should be passed by const reference instead of by value to avoid unnecessary
 * copying."**
 */
function parameterByValue(line: number, text: string): Draft[] {
  for (const pattern of [BY_VALUE_PARAMETER, BY_VALUE_NAMED]) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match === null) continue;
    const name = group(match, 1);
    const declared = match[0].replace(/[,)]\s*$/, '').trim();
    return [
      {
        id: 'parameter-by-value',
        line,
        category: 'performance',
        severity: 'medium',
        title: `\`${name}\` is passed by value`,
        description:
          `\`${declared}\` declares \`${name}\` by value, and this type owns a buffer: every call copies it. ` +
          'A reference costs an indirection and no allocation, and the callee cannot tell the difference unless it ' +
          'means to modify its own copy.',
        suggestion: `Take it as \`const ${declared.split(/\s+/).slice(0, -1).join(' ')}& ${name}\`.`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rule: an enum passed by const reference
// ---------------------------------------------------------------------------

/**
 * **Corpus: `DrawProjGroup.h:133` - "Enums should typically be passed by value (they are small integral types).
 * Passing by `const&` adds indirection and can complicate usage."**
 *
 * **The evidence has to be in the patch**, the same rule `float-literal-in-float-arithmetic` applies: the type's
 * `enum` declaration is what makes the reference wrong, and a rule that assumed every `const X&` was an enum would fire
 * on every string parameter in the corpus - the exact opposite finding.
 */
function enumByConstReference(line: number, text: string, enums: ReadonlySet<string>): Draft[] {
  if (enums.size === 0) return [];
  for (const name of enums) {
    const pattern = new RegExp(
      `\\bconst\\s+(?:(?:[A-Za-z_]\\w*)::)*${name}\\s*&\\s*([A-Za-z_]\\w*)\\s*[,)]`,
    );
    const match = pattern.exec(text);
    if (match === null) continue;
    const parameter = group(match, 1);
    return [
      {
        id: 'enum-by-const-reference',
        line,
        category: 'maintainability',
        severity: 'low',
        title: `Enum \`${name}\` is passed by const reference`,
        description:
          `\`${name}\` is an enum declared in this change, and it is four or eight bytes. Passing it as ` +
          `\`const ${name}&\` makes every call dereference a pointer to an integer and makes the parameter's ` +
          'lifetime look like something the callee has to think about.',
        suggestion: `Take it by value: \`${name} ${parameter}\`.`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rule: a plural written with an `s`
// ---------------------------------------------------------------------------

/** An identifier, which is the only place this rule looks. */
const IDENTIFIER = /\b[A-Za-z_]\w*\b/g;

/**
 * **A name whose plural was written with an `s` on a consonant**, which is the one morphology error an identifier can
 * carry that no compiler will ever mention: `Geometry` + `s` is `Geometrys`, and English wants `Geometries`.
 *
 * **The stem has to be four letters or more**, which excludes `sys` (a stem of `s`), and **the letter before `ys` has to
 * be a consonant**, which excludes `keys` and `toys`. Between the two guards the rule is silent on names that are not
 * plurals, and `directoryEntrys` and `acceptableDimensionGeometrys` both survive.
 */
const CONSONANT_PLURAL = /([A-Za-z]{4,}[bcdfghjklmnpqrstvwxz])ys$/;

/**
 * **Corpus: `DimensionValidators.h:70` - "`acceptableDimensionGeometrys` is an incorrect plural (should be
 * `acceptableDimensionGeometries`). Since this is part of the function signature in a header, the typo propagates."**
 */
function pluralYs(line: number, text: string): Draft[] {
  // A string literal is not a name, and a comment is not code: **both are removed rather than skipped**, so a line that
  // mentions `Geometrys` in prose is still read for the identifier beside it.
  const code = text.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
  if (anyCommentBody(code) !== null) return [];
  for (const match of code.matchAll(IDENTIFIER)) {
    const name = match[0];
    const stem = CONSONANT_PLURAL.exec(name);
    if (stem === null) continue;
    const fixed = `${group(stem, 1)}ies`;
    return [
      {
        id: 'plural-ys',
        line,
        category: 'maintainability',
        severity: 'low',
        title: `\`${name}\` pluralises a consonant with an \`s\``,
        description:
          `\`${name}\` ends in \`${group(stem, 1)}ys\`. A word ending in a consonant and a \`y\` takes \`ies\`, and an ` +
          'identifier in a signature carries the slip to every call site that autocompletes it.',
        suggestion: `Rename it to \`${fixed}\`.`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

/** What one rule reads and what it says. **The verdict is a list**, so a rule may report zero and the lane's dispatch
 * needs no null check of its own. */
type RuleRun = (line: number, text: string, at: number, context: RuleContext) => readonly Draft[];

/**
 * **Every rule, with the languages it applies to and the golden it came from.**
 *
 * The three things sit in one row because they are one decision: **a rule that applies to nothing is a rule nobody
 * measured**, and a rule whose corpus line is not written down is a rule somebody added on taste. The language list is
 * also what makes the dispatch below a loop rather than six `if`s - two of the six apply to every language, so two of
 * those six were conditions no test could make false.
 */
interface RuleRow {
  readonly id: string;
  readonly languages: readonly Language[];
  readonly corpus: string;
  readonly run: RuleRun;
}

/** The rows, in the order the lane runs them. */
const RULE_TABLE: readonly RuleRow[] = [
  {
    id: 'commented-out-code',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'FemVTKTools.cpp:1434',
    run: commentedOutCode,
  },
  {
    id: 'float-literal-in-float-arithmetic',
    languages: ['cxx'],
    corpus: 'SoDatumLabel.cpp:84',
    run: (line, text, _at, context) => floatLiteralInFloatArithmetic(line, text, context.floats),
  },
  {
    id: 'redundant-async',
    languages: ['javascript'],
    corpus: 'index.ts:460',
    run: (line, text, at, context) => redundantAsync(line, text, context.lines, at),
  },
  {
    id: 'loose-equality',
    languages: ['javascript'],
    corpus: 'ExtrudeGeometry.js:406',
    run: looseEquality,
  },
  {
    id: 'article-agreement-in-comment',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'lv_observer.h:610',
    run: articleAgreement,
  },
  { id: 'macro-name-case', languages: ['cxx'], corpus: 'usb_ids.h:63', run: macroNameCase },
  // **The six that this slice's goldens are actually about.** `scripts/idiom-reach.mjs` priced the six rows above at
  // 3 of 364 goldens on the wide arm, because they were derived from a sample whose remarks were `const auto&` and
  // `2.0f`. These are derived from the remarks this slice's reviewers wrote, each naming the golden it came from.
  {
    id: 'doubled-word',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'DlgOnlineHelpImp.h:35',
    run: doubledWord,
  },
  {
    id: 'subject-verb-agreement',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'DrawTile.cpp:46',
    run: subjectVerbAgreement,
  },
  {
    id: 'todo-in-code',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'DrawProjGroup.cpp:1144',
    run: todoInCode,
  },
  {
    id: 'parameter-by-value',
    languages: ['cxx'],
    corpus: 'CommandCreateDims.cpp:2384',
    run: parameterByValue,
  },
  {
    id: 'enum-by-const-reference',
    languages: ['cxx'],
    corpus: 'DrawProjGroup.h:133',
    run: (line, text, _at, context) => enumByConstReference(line, text, context.enums),
  },
  {
    id: 'plural-ys',
    languages: ['cxx', 'javascript', 'other'],
    corpus: 'DimensionValidators.h:70',
    run: pluralYs,
  },
];

/** The rule table as the lane and the artifact read it: frozen, so a caller cannot add a rule to a shared array. */
export const IDIOM_RULES: readonly RuleRow[] = Object.freeze(RULE_TABLE);

/** The `float` declarations in the patch, which are the evidence that a literal beside one widens the expression. */
function floatDeclarations(patch: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of patch.matchAll(FLOAT_DECLARATION)) names.add(group(match, 1));
  return names;
}

/** The `enum` names the patch declares, which are the evidence that a `const X&` parameter is indirection around an int. */
const ENUM_DECLARATION = /\benum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)/g;

function enumDeclarations(patch: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of patch.matchAll(ENUM_DECLARATION)) names.add(group(match, 1));
  return names;
}

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
  /**
   * **A line's text, with the carriage return a CRLF file leaves on it removed.**
   *
   * `numberedAddedLines` reads the patch format and does not touch the bytes, so a file authored on Windows arrives with
   * `\r` at the end of every line - and **four of these rules anchor on `$`**, which without the multiline flag matches
   * only at the very end of a string that no longer ends where the line does. Measured: on `FreeCAD`'s `DlgOnlineHelpImp.h`
   * the doubled `an an` is on an added line and every rule stayed silent, because the only difference between the text the
   * rule was written against and the text it was handed was one character. **The lane is where the rules live, so the
   * lane is where the line ends.**
   */
  const entries = [...input.addedLines.entries()]
    .map(([line, text]) => [line, text.replace(/\r$/, '')] as const)
    .sort((left, right) => left[0] - right[0]);
  const context: RuleContext = {
    floats: floatDeclarations(input.patch),
    enums: enumDeclarations(input.patch),
    lines: entries.map(([, text]) => text),
  };

  const drafts: Draft[] = [];
  for (const [at, [line, text]] of entries.entries()) {
    for (const rule of IDIOM_RULES) {
      // **The table decides which rules apply, not a branch per rule in this function** - a seventh rule cannot be
      // added without saying which languages it is for, and the dispatch stays one condition deep.
      if (!rule.languages.includes(language)) continue;
      drafts.push(...rule.run(line, text, at, context));
    }
  }

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
