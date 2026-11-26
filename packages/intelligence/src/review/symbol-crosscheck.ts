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
  maxCalls: 250,
  maxPerPullRequest: 5,
  maxSymbolsPerComment: 2,
  minSymbolLength: 4,
  maxRewriteChars: 400,
  tag: 'crosscheck',
} as const;

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
      const at = match.index ?? 0;
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
  const usable = new Set(seen.filter((occurrence) => !occurrence.declaration).map((o) => o.name));
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
 * **The question, and the two sentences that keep it answerable.**
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
 * **Reading the answer, strictly.**
 *
 * A verdict that cannot be read is not a verdict and not a disagreement, which is the rule `judge-batch.mjs` states one
 * layer down. **An unreadable answer keeps the sentence**, so a model that stops answering produces the arm it was given
 * rather than a quieter one.
 */
export function parseVerdict(raw: string): Verdict | null {
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
  const symbol = typeof record['symbol'] === 'string' ? record['symbol'].trim() : '';
  if (symbol === '') return null;
  const agree = record['agree'];
  if (typeof agree !== 'string' || !(AGREEMENTS as readonly string[]).includes(agree)) return null;
  const left = side(record['left']);
  const right = side(record['right']);
  if (left === null || right === null) return null;
  const rewrite = record['rewrite'];
  if (rewrite !== undefined && rewrite !== null && typeof rewrite !== 'string') return null;
  return {
    symbol,
    left,
    right,
    agree: agree as Agreement,
    rewrite: typeof rewrite === 'string' && rewrite.trim() !== '' ? rewrite.trim() : null,
  };
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
  const rewritten: TwoSidedFinding = { ...finding, crosschecked: CROSSCHECK_CONTRACT };
  if (finding.description !== undefined) rewritten.description = verdict.rewrite;
  if (finding.content !== undefined) rewritten.content = verdict.rewrite;
  if (finding.description === undefined && finding.content === undefined) {
    rewritten.title = verdict.rewrite;
  }
  return { finding: rewritten, action: 'rewritten', reason: 'rewritten' };
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
 * **The pass itself: one call per symbol, one sentence in and one sentence out.**
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
      const symbols =
        lines.length === 0
          ? []
          : symbolsInComment(sentenceOf(finding), lines, {
              max: this.options.maxSymbolsPerComment,
              minLength: this.options.minSymbolLength,
            });
      if (lines.length === 0) {
        kept['no-evidence'] += 1;
        out.push(finding);
        continue;
      }
      if (symbols.length === 0) {
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
      for (const symbol of symbols) {
        if (called >= this.options.maxCalls) {
          kept['budget'] += 1;
          budgetExhausted = true;
          break;
        }
        if ((perPullRequest.get(pull) ?? 0) >= this.options.maxPerPullRequest) {
          kept['pull-request-cap'] += 1;
          break;
        }
        const tally = bySymbol.get(symbol) ?? { called: 0, rewritten: 0 };
        const prompt = buildCrosscheckPrompt({
          comment: sentenceOf(current),
          symbol,
          lines,
          maxRewriteChars: this.options.maxRewriteChars,
        });
        called += 1;
        perPullRequest.set(pull, (perPullRequest.get(pull) ?? 0) + 1);
        tally.called += 1;
        bySymbol.set(symbol, tally);

        let result: CompletionResult;
        try {
          result = await this.provider.complete(`${prompt.system}\n\n${prompt.user}`, {
            temperature: 0,
            maxTokens: 400,
            tag: this.options.tag,
          } satisfies CompletionOptions);
        } catch {
          failed += 1;
          kept['failed'] += 1;
          break;
        }
        if (typeof result.costUsd === 'number') {
          callsPriced += 1;
          spendUsd += result.costUsd;
        }
        const verdict = parseVerdict(result.content);
        if (verdict === null) {
          kept['unreadable'] += 1;
          break;
        }
        const applied = applyVerdict(current, verdict, lines, {
          maxRewriteChars: this.options.maxRewriteChars,
        });
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
        contract: CROSSCHECK_CONTRACT,
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
