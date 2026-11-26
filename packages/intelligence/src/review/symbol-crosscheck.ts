// @code-analyzer/intelligence — a verifier over the comments the arm already posts
//
// **The deficit this is aimed at is predicative, and that is a measurement rather than an impression.** §166 read the
// published Martian artifact and found that **27 of the 33 goldens only the competitor credits sit on a symbol our own
// comment already names** - against **27 of 33** inside the set and **99 of 125** outside it, which is the number that
// says adjacency locates and cannot select. So the comments are in the right places and ask different questions about
// them. The prize, priced on the same 227 comments with nothing added and nothing moved, is F1 `0.3221 → 0.3896`.
//
// **What this pass does, in the corpus's own words.** Take a comment the arm already posts; take the symbol that comment
// already names; ask one question: *what is the other side of this symbol, and do the two agree?* Both sides must be
// **quoted verbatim** from the lines the comment is about, so an answer that cannot quote is an answer that is not
// applied. Only a quoted disagreement rewrites the sentence, and the rewrite must name the symbol it is about.
//
// **What it may not do, and why that is the whole safety argument.** §166.4's prize is *the same 227 comments, the
// sentences corrected* - the count is the premise of the arithmetic that licensed the device. So this pass **may only
// edit**: one finding in, one finding out, same order, same path, same line, no comment added and none dropped. A pass
// that deleted what it could not verify would move the denominator and every figure downstream with it, and the figure
// would then be a measurement of a different arm.
//
// **And it is the mirror of `adjudication/falsifier.ts` in exactly one respect.** That gate drops and may never edit;
// this edits and may never drop. Two devices whose permitted actions are disjoint do not belong behind one flag, and
// §165's refusal of a sixth lane is why this is a pass over the emission rather than another question asked of the diff.
//
// **The literature that says this shape is the deployable one.** `arXiv 2607.03316` (31 073 accepted-and-rejected AI
// comments) finds 56.3 % of AI review comments rejected and that the deployable device is a **pre-filter rather than a
// rewrite**; `arXiv 2604.19049` finds ~79 % of candidates killed before disclosure by a device that requires evidence
// rather than agreement. This is the rewrite half of that trade, and it is constrained to the one case where a rewrite
// has evidence: **two quoted lines that do not say the same thing about one symbol.**

import type { CompletionOptions, CompletionResult, LLMProvider } from './llm/provider.js';

/** The contract's name, carried in the artifact, because a figure has to say which rule produced it. */
export const CROSSCHECK_CONTRACT = 'two-sides-v1';

/**
 * **The second contract, and the reason it exists.**
 *
 * §167 asked about one name and moved nothing: 3 of the 27 prize entries rewritten, 0 credited. The rewrites were real -
 * two quoted lines that genuinely disagree - so the failure was in the choosing. `two-sides-v1` takes the **first**
 * backticked name in a comment, which is usually the sentence's subject, while a golden's concern is the
 * **correspondence between two names**: 24 of the 27 entries were never asked about.
 *
 * `two-related-names-v1` asks about a **pair the comment already relates** and requires **one of the two quotes to be the
 * anchor's own line**, so an answer cannot drift elsewhere in the file and still count. Everything else is unchanged: one
 * finding in, one out, `cannot` free, both quotes verified, one question per comment.
 */
export const RELATED_NAMES_CONTRACT = 'two-related-names-v1';

/** The three answers the model is allowed to give to *do the two sides agree*. */
export const AGREEMENTS = Object.freeze(['yes', 'no', 'cannot'] as const);
export type Agreement = (typeof AGREEMENTS)[number];

/**
 * **The five things a comment has to carry for this pass to have anything to ask.**
 *
 * Structural rather than nominal: the review engine's `ReviewComment` carries `content`, the benchmark's rows carry
 * `description`, and **a device that only understood one of them would be a device that silently did nothing on the other
 * surface**. `path`, `startLine` and `pr` are read and written back untouched - they are here so that the invariant is
 * checkable by the caller rather than promised by a comment.
 */
export interface TwoSidedFinding {
  path?: string;
  startLine?: number;
  endLine?: number;
  /** The pull request the finding belongs to, when the caller has one. Used only for the per-diff cap. */
  pr?: string;
  title?: string;
  /** The benchmark surface's sentence. */
  description?: string;
  /** The product surface's sentence. */
  content?: string;
  /**
   * **The name the caller wants asked about, when it has one.**
   *
   * The plan §166 priced addresses each entry by the symbol the competitor's comment sits on, and a device that ignored it
   * would be answering a question the prize was not computed on. Ignored when the comment does not name it, because an
   * anchor the sentence never mentions is not an anchor.
   */
  anchor?: string;
  /** Set on a rewritten finding, so a reader can tell a checked sentence from an unchecked one. */
  crosschecked?: string;
}

/** One side of a symbol: the line it was quoted from and the quotation itself. */
export interface Side {
  line: number;
  quote: string;
}

/** What the model answered, in the shape it was asked for. */
export interface Verdict {
  symbol: string;
  left: Side;
  right: Side;
  agree: Agreement;
  rewrite: string | null;
}

/**
 * **The same answer with the pair attached**, which is what the second contract asks about.
 *
 * `anchor` is the name one of the quotes must stand on; `other` is the name the comment relates it to. The two are carried
 * rather than re-derived, so that the check after the call reads the question that was actually asked.
 */
export interface RelationVerdict extends Verdict {
  anchor: string;
  other: string;
}

/** The two names a question is asked about. */
export interface Pair {
  anchor: string;
  other: string;
}

/** Why a verdict did not change the sentence, spelled out so a run can be disagreed with rather than merely read. */
export type KeepReason =
  | 'no-evidence'
  | 'no-symbol'
  | 'budget'
  | 'pull-request-cap'
  | 'failed'
  | 'unreadable'
  | 'cannot'
  | 'unquoted'
  | 'same-side'
  | 'off-anchor'
  | 'agree'
  | 'no-rewrite'
  | 'identical'
  | 'toolong'
  | 'unnamed';

/** The verdict applied to one comment. */
export interface AppliedVerdict {
  finding: TwoSidedFinding;
  action: 'rewritten' | 'kept';
  reason: 'rewritten' | KeepReason;
}

/** What a run of the pass did, including everything it declined to do. */
export interface CrosscheckReport {
  contract: string;
  considered: number;
  called: number;
  rewritten: number;
  failed: number;
  /** Calls whose completion carried a price the provider knew. */
  callsPriced: number;
  spendUsd: number;
  budgetExhausted: boolean;
  /** Every path out of the pass, counted. A silent verifier and a strict one are told apart here or nowhere. */
  kept: Record<KeepReason, number>;
  /** Per-symbol tallies, because "which names does this device actually work on" is the next iteration's input. */
  bySymbol: Array<{ symbol: string; called: number; rewritten: number }>;
}

/** Where the lines a comment is about come from. Supplied by the caller, so this module does no IO. */
export type EvidenceOf = (finding: TwoSidedFinding) => string[];

export interface CrosscheckOptions {
  /**
   * **Which contract to run, and the default is the one the record was produced under.**
   *
   * A caller that says nothing reproduces the published reading rather than a newer one, which is what makes an old
   * artifact re-derivable and a new one a deliberate purchase. The workflow and the harness name the newer contract
   * explicitly; `--contract two-sides-v1` is the ablation.
   */
  contract?: CrosscheckContract;
  /** The whole pass's call budget. Default `250`, which is ~6 % of the fifty-pull-request run it rides on. */
  maxCalls?: number;
  /** Calls per pull request, so one busy diff cannot carry the bill. Default `5`. */
  maxPerPullRequest?: number;
  /** Questions per comment, so a comment naming three symbols is not three calls by default. Default `2`. */
  maxSymbolsPerComment?: number;
  /** The shortest token this pass will call a symbol. Default `4`, the same floor `scripts/lib/symbol-anatomy.mjs` uses. */
  minSymbolLength?: number;
  /** The longest rewrite that may replace a sentence. Default `400`. */
  maxRewriteChars?: number;
  /** The ledger tag, so the bill says which pass spent it. Default `crosscheck`. */
  tag?: string;
}

const DEFAULTS = {
  contract: CROSSCHECK_CONTRACT,
  maxCalls: 250,
  maxPerPullRequest: 5,
  maxSymbolsPerComment: 2,
  minSymbolLength: 4,
  maxRewriteChars: 400,
  tag: 'crosscheck',
} as const;

/** The two rules this module knows how to run, so a caller cannot pass a third and be silently answered by one of them. */
export type CrosscheckContract = typeof CROSSCHECK_CONTRACT | typeof RELATED_NAMES_CONTRACT;

/**
 * **The tokens that are never a symbol, whatever the comment puts in backticks.**
 *
 * The first paid run of this pass asked its opening questions about `` `await` `` and `` `async` ``, and eight of twelve
 * answers came back `cannot` - because a keyword has no two sides to compare. **A stoplist is the cheapest form of the fix
 * that a question cannot buy: it costs nothing, it is checkable, and it removes the class of question no answer could
 * have justified.** The list is deliberately the union of the languages this product reads, because a comment about
 * Java's `synchronized` is the same non-question as one about JavaScript's `await`.
 */
const RESERVED = new Set(
  (
    'abstract any as async await base bool boolean break byte case catch char class const continue debugger default ' +
    'defer def delete do double elif else enum export extends false final finally float fn for from func function get ' +
    'global goto if impl implements import in instanceof int interface is lambda let long module namespace native new ' +
    'nil noexcept null of operator or override package pass private protected public raise readonly record ref return ' +
    'sealed set short static strictfp string struct super switch synchronized this throw throws trait transient true ' +
    'try type typeof union unsigned using val var virtual void volatile where while with yield'
  ).split(' '),
);

/**
 * **The keywords that make an occurrence a declaration.**
 *
 * Lexical, and deliberately so: a parser would be the wrong instrument here for the reason §166.8 gives about the symbol
 * rule itself - **the rule's job is to find something worth one cheap question, and a wrong answer costs one call rather
 * than one defect.** A parameter counts as a use under this rule (the keyword is not adjacent to it), which can only ever
 * add a question, never remove a sentence.
 */
const DECLARATION_KEYWORDS =
  '(?:function|const|let|var|class|interface|type|enum|def|fn|func|struct|trait|record)';

/** One occurrence of a name inside the lines, with where it was. */
interface Occurrence {
  name: string;
  line: number;
  declaration: boolean;
}

/** ` 12| const a = b;` → `12` and `const a = b;`, which is the only shape the prompt and the quote check both read. */
export function numberedLine(raw: string): { line: number; text: string } | null {
  const match = /^\s*(\d+)\s*[|:]\s?(.*)$/.exec(String(raw));
  if (match === null) return null;
  return { line: Number(match[1]), text: match[2] ?? '' };
}

/** Whitespace collapsed and trimmed, because a model copying indentation is not a model in error. */
function reflow(value: string): string {
  return String(value).replace(/\s+/g, ' ').trim();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether a sentence names a symbol, on a word boundary, so `id` is not found inside `credentialId`. */
export function namesSymbol(sentence: string, symbol: string): boolean {
  if (symbol === '') return false;
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeForRegExp(symbol)}(?![A-Za-z0-9_$])`).test(sentence);
}

/** Every identifier-shaped occurrence in the lines, marked as a declaration when a keyword sits in front of it. */
function occurrences(lines: string[], minLength: number): Occurrence[] {
  const found: Occurrence[] = [];
  const declaration = new RegExp(`${DECLARATION_KEYWORDS}\\s+$`);
  for (const raw of lines) {
    const parsed = numberedLine(raw);
    if (parsed === null) continue;
    for (const match of parsed.text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
      const name = match[0];
      if (name.length < minLength) continue;
      // `index` is a number on every `RegExpExecArray`, so a `?? 0` here would be a branch no test could ever take.
      const at = match.index;
      found.push({
        name,
        line: parsed.line,
        declaration: declaration.test(parsed.text.slice(0, at)),
      });
    }
  }
  return found;
}

/**
 * **The symbols a comment names, in the order it wrote them.**
 *
 * A backticked name first, because a comment that reached for a backtick has said which token it means; then any other
 * identifier the comment uses that the evidence also contains. **A name that occurs only where it is declared is not a
 * symbol for this pass** - it has no other side to agree or disagree with, and the whole question is a correspondence.
 * That single rule is why a comment about `refresh` asks about `credentialId` and `findUser` rather than about the
 * function it is standing in.
 */
export function symbolsInComment(
  text: string,
  lines: string[],
  options: { max?: number; minLength?: number } = {},
): string[] {
  const max = options.max ?? DEFAULTS.maxSymbolsPerComment;
  const minLength = options.minLength ?? DEFAULTS.minSymbolLength;
  const seen = occurrences(lines, minLength);
  const usable = new Set(
    seen
      .filter((occurrence) => !occurrence.declaration && !RESERVED.has(occurrence.name))
      .map((occurrence) => occurrence.name),
  );
  const present = new Set(seen.map((occurrence) => occurrence.name));

  const ticked: string[] = [];
  for (const match of String(text).matchAll(/`([^`]+)`/g)) {
    const name = (match[1] ?? '').trim();
    if (name.length < minLength) continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    if (!present.has(name) || !usable.has(name)) continue;
    if (!ticked.includes(name)) ticked.push(name);
  }

  const ordered = [...ticked];
  if (ordered.length < max) {
    for (const match of String(text).matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
      const name = match[0];
      if (name.length < minLength) continue;
      if (ordered.includes(name)) continue;
      if (!usable.has(name)) continue;
      ordered.push(name);
      if (ordered.length >= max) break;
    }
  }
  return ordered.slice(0, max);
}

/**
 * **How far apart two names may stand and still be one claim.**
 *
 * 120 characters, which on this corpus is about one sentence of a review comment. It is a distance rather than a parse:
 * the pass has a model for grammar, and what it needs from this side is a rule a reader can check by looking.
 */
const CLAUSE_CHARS = 120;

/** Where a name first appears in a sentence, or `-1`. Word-bounded, so `id` is not found inside `credentialId`. */
function firstMention(text: string, name: string): number {
  const match = new RegExp(`(?<![A-Za-z0-9_$])${escapeForRegExp(name)}(?![A-Za-z0-9_$])`).exec(
    text,
  );
  return match === null ? -1 : match.index;
}

/**
 * **The pair a comment already relates, which is the question §167 should have asked.**
 *
 * The anchor is the caller's when the caller has one and the sentence names it - the plan §166 priced addresses each entry
 * by the symbol the competitor's comment sits on - and otherwise the first name the sentence reached a backtick for.
 *
 * **The anchor may be a name that occurs only where it is declared.** That is the one place this contract departs from
 * `symbolsInComment`'s rule, and it is deliberate: a function being introduced at the top of a hunk is exactly the name a
 * comment is about, and §167's silence came from refusing to ask about it because it had "no other side". In a pair the
 * other side is the **partner name**, not a second occurrence of the anchor.
 *
 * **The partner may itself be a declaration**, because a declaration is a side: "set here, read there" is exactly the kind
 * of disagreement this device is looking for. What it may not be is a reserved word or a name in **another clause** - no
 * sentence break between the two, and no more than `CLAUSE_CHARS` characters apart. Two names in different sentences are
 * two claims, and pairing them would be asking a question the comment did not write. Nearest first, so the same comment
 * always yields the same pair.
 *
 * **One pair by default.** The acceptance is a share of the comments the arm posts, so a second question on the same
 * comment is a second chance to rewrite it - which is exactly the kind of second chance a measurement must not hand the
 * device it is measuring.
 */
export function relatedPairs(
  text: string,
  lines: string[],
  options: { max?: number; minLength?: number; anchor?: string } = {},
): Pair[] {
  const max = options.max ?? 1;
  if (max <= 0) return [];
  const sentence = String(text);
  const minLength = options.minLength ?? DEFAULTS.minSymbolLength;
  const present = new Set(occurrences(lines, minLength).map((occurrence) => occurrence.name));

  // The names the sentence actually writes, in the order it writes them - `symbolsInComment` orders by preference, which
  // is the wrong order for a distance rule.
  const mentioned: string[] = [];
  for (const match of sentence.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const name = match[0];
    if (name.length < minLength) continue;
    if (!present.has(name) || RESERVED.has(name)) continue;
    if (!mentioned.includes(name)) mentioned.push(name);
  }
  if (mentioned.length < 2) return [];

  const ticked: string[] = [];
  for (const match of sentence.matchAll(/`([^`]+)`/g)) {
    const name = (match[1] ?? '').trim();
    if (mentioned.includes(name) && !ticked.includes(name)) ticked.push(name);
  }
  const wanted = options.anchor ?? '';
  const anchor = mentioned.includes(wanted) ? wanted : (ticked[0] ?? (mentioned[0] as string));
  const at = firstMention(sentence, anchor);

  const ranked = mentioned
    .filter((name) => name !== anchor)
    .map((name) => {
      const other = firstMention(sentence, name);
      const gap = Math.abs(other - at);
      const between = sentence.slice(Math.min(at, other), Math.max(at, other));
      return { name, gap, sameClause: gap <= CLAUSE_CHARS && !/[.!?]\s/.test(between) };
    })
    .filter((entry) => entry.sameClause)
    .sort((left, right) => left.gap - right.gap || left.name.localeCompare(right.name));

  return ranked.slice(0, max).map((entry) => ({ anchor, other: entry.name }));
}

/**
 * **Whether one of the two quoted sides stands on the anchor's own line.**
 *
 * This is the clause that makes the second contract different in kind rather than in prompt wording: §167's answers could
 * quote any two lines in the file, so a "disagreement" could be found two functions away from the comment's subject. Here
 * the anchor's line has to be one of the two, so the disagreement is about the name the comment opened with.
 *
 * The comparison is **on the line's text, not on the quote**, because a model is allowed to quote a fragment of a line and
 * a fragment is not the place to be strict about.
 */
export function anchorAmongSides(verdict: Verdict, anchor: string, lines: string[]): boolean {
  const byLine = new Map<number, string>();
  for (const raw of lines) {
    const parsed = numberedLine(raw);
    if (parsed !== null) byLine.set(parsed.line, parsed.text);
  }
  const stands = (side: Side): boolean => {
    const text = byLine.get(side.line);
    return text !== undefined && namesSymbol(text, anchor);
  };
  return stands(verdict.left) || stands(verdict.right);
}

/**
 * **The question, asked about a pair, with the anchor rule stated to the model rather than only checked after it.**
 *
 * A rule only the checker knows is a rule that turns into a refusal after the money is spent, which is why the anchor
 * clause appears in the system message in the same words the check uses.
 */
export function buildRelationPrompt(input: {
  comment: string;
  anchor: string;
  other: string;
  lines: string[];
  maxRewriteChars?: number;
}): { system: string; user: string } {
  const bound = input.maxRewriteChars ?? DEFAULTS.maxRewriteChars;
  return {
    system: [
      'You are checking one code review comment against the code it is about.',
      `The comment relates two names. One question is asked about the pair: what do these lines say about ${input.anchor} ` +
        `and ${input.other}, and do they agree?`,
      'A side is a quoted line: where a name is declared, set, produced, or called - and where it is used, consumed, compared, or published.',
      '',
      'Rules:',
      '- Both quotes must be copied verbatim from the numbered lines. No paraphrase, no ellipsis, no reconstructed code.',
      '- The first name is the anchor: one of the two quotes must be the line where the first name stands, so the answer cannot drift elsewhere in the file.',
      '- If you cannot quote both sides from these lines, answer "cannot" and leave both quotes empty.',
      '- "no" only when the two quoted lines state different things about the pair. Anything else is "yes" or "cannot".',
      `- Only when the answer is "no", write a replacement for the comment that names both ${input.anchor} and ${input.other}, says what does not match, and is at most ${String(bound)} characters. Otherwise "rewrite" is null.`,
      '',
      'Answer with one JSON object and nothing else:',
      '{"left": {"line": 12, "quote": "..."}, "right": {"line": 18, "quote": "..."}, "agree": "yes"|"no"|"cannot", "rewrite": "..."|null}',
    ].join('\n'),
    user: [
      'Comment:',
      input.comment,
      '',
      `Relates: ${input.anchor} and ${input.other}`,
      '',
      'Lines:',
      ...input.lines,
    ].join('\n'),
  };
}

/**
 * **The first question, and the two sentences that keep it answerable.**
 *
 * `verbatim` and `cannot` are not politeness: the quote check downstream refuses a paraphrase, and the `cannot` branch is
 * the one that protects the arm - **a verifier whose free action is to keep the sentence cannot make the emission
 * worse**, which is the direction this device is allowed to fail in.
 */
export function buildCrosscheckPrompt(input: {
  comment: string;
  symbol: string;
  lines: string[];
  maxRewriteChars?: number;
}): { system: string; user: string } {
  const bound = input.maxRewriteChars ?? DEFAULTS.maxRewriteChars;
  return {
    system: [
      'You are checking one code review comment against the code it is about.',
      'The comment names a symbol, and one question is asked about that symbol: what are its two sides, and do they agree?',
      'A side is a quoted line: where the symbol is declared, set, produced, or called - and where it is used, consumed, compared, or published.',
      '',
      'Rules:',
      '- Both quotes must be copied verbatim from the numbered lines. No paraphrase, no ellipsis, no reconstructed code.',
      '- If you cannot quote both sides from these lines, answer "cannot" and leave both quotes empty.',
      '- "no" only when the two quoted lines state different things about the same symbol. Anything else is "yes" or "cannot".',
      `- Only when the answer is "no", write a replacement for the comment that names both sides, says what does not match, must name the symbol, and is at most ${String(bound)} characters. Otherwise "rewrite" is null.`,
      '',
      'Answer with one JSON object and nothing else:',
      '{"symbol": "...", "left": {"line": 12, "quote": "..."}, "right": {"line": 18, "quote": "..."}, "agree": "yes"|"no"|"cannot", "rewrite": "..."|null}',
    ].join('\n'),
    user: [
      'Comment:',
      input.comment,
      '',
      `Symbol: ${input.symbol}`,
      '',
      'Lines:',
      ...input.lines,
    ].join('\n'),
  };
}

/**
 * **The half of an answer both contracts read the same way**, and the shape the prompts ask for.
 *
 * This type exists because of a defect that cost a paid run: the relation prompt asked for four fields and the parser
 * demanded five, so **184 of 184 answers came back `unreadable`** and the pass rewrote nothing. A parser stricter than its
 * own prompt is a parser that reports the model's silence while the model was answering. The fields one contract needs and
 * the other does not - `symbol` for `two-sides-v1`, the pair for `two-related-names-v1` - are attached by that contract's
 * own reader below, and `a-question-about-two-names…` holds the invariant that **the example each prompt prints is an
 * answer its own reader accepts**.
 */
interface Answer {
  left: Side;
  right: Side;
  agree: Agreement;
  rewrite: string | null;
}

function answerOf(raw: string): { answer: Answer; record: Record<string, unknown> } | null {
  const stripped = String(raw ?? '')
    .replace(/```json|```/g, '')
    .trim();
  if (stripped === '') return null;
  let body: unknown;
  try {
    body = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const agree = record['agree'];
  if (typeof agree !== 'string' || !(AGREEMENTS as readonly string[]).includes(agree)) return null;
  const left = side(record['left']);
  const right = side(record['right']);
  if (left === null || right === null) return null;
  const rewrite = record['rewrite'];
  if (rewrite !== undefined && rewrite !== null && typeof rewrite !== 'string') return null;
  return {
    answer: {
      left,
      right,
      agree: agree as Agreement,
      rewrite: typeof rewrite === 'string' && rewrite.trim() !== '' ? rewrite.trim() : null,
    },
    record,
  };
}

/**
 * **Reading the first contract's answer, strictly.**
 *
 * A verdict that cannot be read is not a verdict and not a disagreement, which is the rule `judge-batch.mjs` states one
 * layer down. **An unreadable answer keeps the sentence**, so a model that stops answering produces the arm it was given
 * rather than a quieter one.
 */
export function parseVerdict(raw: string): Verdict | null {
  const read = answerOf(raw);
  if (read === null) return null;
  const symbol =
    typeof read.record['symbol'] === 'string' ? String(read.record['symbol']).trim() : '';
  // **`symbol` is required here and only here**, because this contract's rewrite is checked against it. The relation
  // contract carries its pair from the question rather than from the answer, so it does not ask for an echo.
  if (symbol === '') return null;
  return { symbol, ...read.answer };
}

/**
 * **Reading the second contract's answer, with the pair attached from the question.**
 *
 * The model is asked what the lines say about two names it is given; it is not asked to repeat them back, because an echo
 * is a field that can disagree with the question and then has to be checked. The pair here is the one that was asked, and
 * a `symbol` or `anchor` the model volunteers is ignored rather than trusted.
 */
export function parseRelationVerdict(raw: string, pair: Pair): RelationVerdict | null {
  const read = answerOf(raw);
  if (read === null) return null;
  return { ...read.answer, symbol: pair.anchor, anchor: pair.anchor, other: pair.other };
}

function side(value: unknown): Side | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const line = record['line'];
  const quote = record['quote'];
  if (typeof line !== 'number' || !Number.isInteger(line)) return null;
  if (typeof quote !== 'string') return null;
  return { line, quote };
}

/**
 * **The quote check, which is the only evidence this device has.**
 *
 * Each quotation has to appear in the line it is attributed to, compared with whitespace reflowed. **Two quotations of
 * the same text are not two sides** - `same-side` - because one side cannot be its own other side, and a model that
 * quoted the same line twice has answered a different question than the one asked.
 */
export function verifyQuotes(
  verdict: Verdict,
  lines: string[],
): { ok: true; reason: null } | { ok: false; reason: 'unquoted' | 'same-side' } {
  const byLine = new Map<number, string>();
  for (const raw of lines) {
    const parsed = numberedLine(raw);
    if (parsed !== null) byLine.set(parsed.line, parsed.text);
  }
  const quoted = (side: Side): boolean => {
    const line = byLine.get(side.line);
    const quote = reflow(side.quote);
    if (line === undefined || quote === '') return false;
    return reflow(line).includes(quote);
  };
  if (!quoted(verdict.left) || !quoted(verdict.right)) return { ok: false, reason: 'unquoted' };
  if (reflow(verdict.left.quote) === reflow(verdict.right.quote)) {
    return { ok: false, reason: 'same-side' };
  }
  return { ok: true, reason: null };
}

/** The sentence a finding carries, whichever surface it came from. */
function sentenceOf(finding: TwoSidedFinding): string {
  return String(finding.description ?? finding.content ?? finding.title ?? '');
}

/**
 * **What a verdict does to a sentence, with every refusal named.**
 *
 * The order of the checks is the order of their strength: an unreadable or unquotable answer is refused before an
 * agreement is even read, and a rewrite is refused unless it is bounded, different, and about the symbol it claims to be
 * about. **Nothing here reads or writes the anchor**, so "the comment count is unchanged" is a property of the type
 * rather than a promise in a comment.
 */
export function applyVerdict(
  finding: TwoSidedFinding,
  verdict: Verdict,
  lines: string[],
  options: { maxRewriteChars?: number } = {},
): AppliedVerdict {
  const bound = options.maxRewriteChars ?? DEFAULTS.maxRewriteChars;
  if (verdict.agree === 'cannot') return { finding, action: 'kept', reason: 'cannot' };
  const quotes = verifyQuotes(verdict, lines);
  if (!quotes.ok) return { finding, action: 'kept', reason: quotes.reason };
  if (verdict.agree === 'yes') return { finding, action: 'kept', reason: 'agree' };
  if (verdict.rewrite === null) return { finding, action: 'kept', reason: 'no-rewrite' };
  const original = sentenceOf(finding);
  if (reflow(verdict.rewrite) === reflow(original)) {
    return { finding, action: 'kept', reason: 'identical' };
  }
  if (verdict.rewrite.length > bound) return { finding, action: 'kept', reason: 'toolong' };
  if (!namesSymbol(verdict.rewrite, verdict.symbol)) {
    return { finding, action: 'kept', reason: 'unnamed' };
  }
  return {
    finding: rewrittenWith(finding, verdict.rewrite, CROSSCHECK_CONTRACT),
    action: 'rewritten',
    reason: 'rewritten',
  };
}

/** The finding, with its sentence replaced and the contract recorded on it. */
function rewrittenWith(
  finding: TwoSidedFinding,
  sentence: string,
  contract: CrosscheckContract,
): TwoSidedFinding {
  const rewritten: TwoSidedFinding = { ...finding, crosschecked: contract };
  if (finding.description !== undefined) rewritten.description = sentence;
  if (finding.content !== undefined) rewritten.content = sentence;
  if (finding.description === undefined && finding.content === undefined) {
    rewritten.title = sentence;
  }
  return rewritten;
}

/**
 * **What a pair verdict does to a sentence.**
 *
 * The order is the order of the evidence: an unreadable or unquotable answer is refused before an agreement is read, and
 * **an answer whose sides both stand away from the anchor is refused before the agreement is read too** - because a
 * disagreement between two lines that are not about the comment's subject is not evidence about the comment. A rewrite
 * then has to name **both** names: a sentence that names one of them has not stated a correspondence.
 */
export function applyRelationVerdict(
  finding: TwoSidedFinding,
  verdict: RelationVerdict,
  lines: string[],
  options: { maxRewriteChars?: number } = {},
): AppliedVerdict {
  const bound = options.maxRewriteChars ?? DEFAULTS.maxRewriteChars;
  if (verdict.agree === 'cannot') return { finding, action: 'kept', reason: 'cannot' };
  const quotes = verifyQuotes(verdict, lines);
  if (!quotes.ok) return { finding, action: 'kept', reason: quotes.reason };
  if (!anchorAmongSides(verdict, verdict.anchor, lines)) {
    return { finding, action: 'kept', reason: 'off-anchor' };
  }
  if (verdict.agree === 'yes') return { finding, action: 'kept', reason: 'agree' };
  if (verdict.rewrite === null) return { finding, action: 'kept', reason: 'no-rewrite' };
  if (reflow(verdict.rewrite) === reflow(sentenceOf(finding))) {
    return { finding, action: 'kept', reason: 'identical' };
  }
  if (verdict.rewrite.length > bound) return { finding, action: 'kept', reason: 'toolong' };
  if (
    !namesSymbol(verdict.rewrite, verdict.anchor) ||
    !namesSymbol(verdict.rewrite, verdict.other)
  ) {
    return { finding, action: 'kept', reason: 'unnamed' };
  }
  return {
    finding: rewrittenWith(finding, verdict.rewrite, RELATED_NAMES_CONTRACT),
    action: 'rewritten',
    reason: 'rewritten',
  };
}

/** Every keep reason, so a report cannot be missing one. */
const KEEP_REASONS: KeepReason[] = [
  'no-evidence',
  'no-symbol',
  'budget',
  'pull-request-cap',
  'failed',
  'unreadable',
  'cannot',
  'unquoted',
  'same-side',
  'off-anchor',
  'agree',
  'no-rewrite',
  'identical',
  'toolong',
  'unnamed',
];

function emptyKept(): Record<KeepReason, number> {
  const kept = {} as Record<KeepReason, number>;
  for (const reason of KEEP_REASONS) kept[reason] = 0;
  return kept;
}

/**
 * **One question, with the rule that applies its answer.**
 *
 * The two contracts differ in what is asked and in what counts as evidence, and in nothing else - so the budget, the cap,
 * the failure accounting and the count invariant are written once, above this type rather than inside each contract.
 */
interface Question {
  /** The tally key: the name for `two-sides-v1`, the pair for `two-related-names-v1`. */
  key: string;
  prompt: { system: string; user: string };
  /**
   * **The reader for this question's own answer.**
   *
   * It is on the question rather than chosen once for the pass because the two prompts ask for different shapes, and the
   * defect that cost run 4 was exactly a shared reader that demanded a field one prompt does not ask for.
   */
  parse: (raw: string) => Verdict | null;
  decide: (finding: TwoSidedFinding, verdict: Verdict) => AppliedVerdict;
}

/**
 * **The pass itself: one call per question, one sentence in and one sentence out.**
 *
 * The budget is checked before the call and not after it, so the pass cannot overspend by one; the per-diff cap is checked
 * the same way; and a provider that throws is counted rather than propagated, because **a single failed call is not a
 * failed run** and a review that stops mid-corpus reports a lower recall that looks like a measurement.
 */
export class SymbolCrosscheck {
  private readonly provider: LLMProvider;
  private readonly options: Required<CrosscheckOptions>;

  constructor(provider: LLMProvider, options: CrosscheckOptions = {}) {
    this.provider = provider;
    this.options = { ...DEFAULTS, ...options };
  }

  /** The questions one comment gets, under whichever contract this pass was constructed with. */
  private questionsFor(finding: TwoSidedFinding, lines: string[]): Question[] {
    const sentence = sentenceOf(finding);
    const bound = this.options.maxRewriteChars;
    if (this.options.contract === RELATED_NAMES_CONTRACT) {
      return relatedPairs(sentence, lines, {
        max: this.options.maxSymbolsPerComment,
        minLength: this.options.minSymbolLength,
        anchor: finding.anchor,
      }).map((pair) => ({
        key: `${pair.anchor}→${pair.other}`,
        prompt: buildRelationPrompt({
          comment: sentence,
          anchor: pair.anchor,
          other: pair.other,
          lines,
          maxRewriteChars: bound,
        }),
        parse: (raw) => parseRelationVerdict(raw, pair),
        decide: (current, verdict) =>
          applyRelationVerdict(
            current,
            { ...verdict, anchor: pair.anchor, other: pair.other },
            lines,
            { maxRewriteChars: bound },
          ),
      }));
    }
    return symbolsInComment(sentence, lines, {
      max: this.options.maxSymbolsPerComment,
      minLength: this.options.minSymbolLength,
    }).map((symbol) => ({
      key: symbol,
      prompt: buildCrosscheckPrompt({ comment: sentence, symbol, lines, maxRewriteChars: bound }),
      parse: parseVerdict,
      decide: (current, verdict) =>
        applyVerdict(current, verdict, lines, { maxRewriteChars: bound }),
    }));
  }

  async run(
    findings: TwoSidedFinding[],
    evidenceOf: EvidenceOf,
  ): Promise<{ findings: TwoSidedFinding[]; report: CrosscheckReport }> {
    const kept = emptyKept();
    const bySymbol = new Map<string, { called: number; rewritten: number }>();
    const out: TwoSidedFinding[] = [];
    const perPullRequest = new Map<string, number>();
    let called = 0;
    let rewritten = 0;
    let failed = 0;
    let callsPriced = 0;
    let spendUsd = 0;
    let budgetExhausted = false;

    for (const finding of findings) {
      const lines = evidenceOf(finding);
      if (lines.length === 0) {
        kept['no-evidence'] += 1;
        out.push(finding);
        continue;
      }
      const questions = this.questionsFor(finding, lines);
      if (questions.length === 0) {
        kept['no-symbol'] += 1;
        out.push(finding);
        continue;
      }
      const pull = String(finding.pr ?? '');
      if ((perPullRequest.get(pull) ?? 0) >= this.options.maxPerPullRequest) {
        kept['pull-request-cap'] += 1;
        out.push(finding);
        continue;
      }

      let current = finding;
      for (const question of questions) {
        if (called >= this.options.maxCalls) {
          kept['budget'] += 1;
          budgetExhausted = true;
          break;
        }
        if ((perPullRequest.get(pull) ?? 0) >= this.options.maxPerPullRequest) {
          kept['pull-request-cap'] += 1;
          break;
        }
        const tally = bySymbol.get(question.key) ?? { called: 0, rewritten: 0 };
        called += 1;
        perPullRequest.set(pull, (perPullRequest.get(pull) ?? 0) + 1);
        tally.called += 1;
        bySymbol.set(question.key, tally);

        let result: CompletionResult;
        try {
          result = await this.provider.complete(
            `${question.prompt.system}\n\n${question.prompt.user}`,
            {
              temperature: 0,
              // **600 rather than 400, because a cap that clips an answer reads as a model that cannot answer.** The
              // relation answer carries a rewrite that has to name both names, and the cost of the cap is paid only in
              // the tokens actually produced - while the cost of clipping is a verdict counted as `unreadable`.
              maxTokens: 600,
              tag: this.options.tag,
            } satisfies CompletionOptions,
          );
        } catch {
          failed += 1;
          kept['failed'] += 1;
          break;
        }
        if (typeof result.costUsd === 'number') {
          callsPriced += 1;
          spendUsd += result.costUsd;
        }
        const verdict = question.parse(result.content);
        if (verdict === null) {
          kept['unreadable'] += 1;
          break;
        }
        const applied = question.decide(current, verdict);
        if (applied.action === 'rewritten') {
          current = applied.finding;
          rewritten += 1;
          tally.rewritten += 1;
          break;
        }
        kept[applied.reason as KeepReason] += 1;
      }
      out.push(current);
    }

    return {
      findings: out,
      report: {
        contract: this.options.contract,
        considered: findings.length,
        called,
        rewritten,
        failed,
        callsPriced,
        spendUsd: Number(spendUsd.toFixed(6)),
        budgetExhausted,
        kept,
        bySymbol: [...bySymbol.entries()]
          .map(([symbol, tally]) => ({ symbol, ...tally }))
          .sort(
            (left, right) => right.called - left.called || left.symbol.localeCompare(right.symbol),
          ),
      },
    };
  }
}
