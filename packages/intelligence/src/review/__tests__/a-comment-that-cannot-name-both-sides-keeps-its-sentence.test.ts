// @code-analyzer/intelligence — the verifier that may rewrite a sentence and may not add or remove one
//
// **The measurement this answers.** §166 read the published Martian artifact and found that **27 of the 33 goldens only the
// competitor credits sit on a symbol our own comment already names**, against a base rate of 79 % on the goldens neither
// arm credits. So the deficit is not where we looked: it is what the sentence at that place asserts. The prize, computed
// on the same 227 comments with nothing added and nothing moved, is F1 `0.3221 → 0.3896`, and the bar is `0.3735` - which
// makes the device the only thing standing between the arm and the bar.
//
// **What the device is, in one sentence.** Take a comment the arm already posts, take the symbol that comment already
// names, and ask one question about it: *what is the other side of this symbol, and do the two agree?* If both sides can
// be quoted from the lines the comment is about and they disagree, the comment is rewritten to name both. **If they
// cannot be quoted, the sentence is kept** - because a verifier whose failure mode is silence is a verifier whose failure
// mode is the arm it was given.
//
// **The invariant this file exists to hold.** §166.4's prize is "the same 227 comments, the sentences corrected", so the
// count is not an implementation detail - it is the premise of the arithmetic that licensed the device at all. A pass that
// dropped a comment it could not verify would change the denominator and the figure with it, and every number downstream
// would be a measurement of a different arm. **`run` returns one finding per finding it was given, in the same order,
// with the same path and the same line.**
//
// **And it is the inverse of `adjudication/falsifier.ts` in exactly one respect**, which is why it is a separate module
// rather than a contract on that one: a falsifier may only drop and may never edit, and this may only edit and may never
// drop. Two devices whose allowed actions are disjoint do not belong behind one flag.

import { describe, expect, it } from 'vitest';

import {
  CROSSCHECK_CONTRACT,
  SymbolCrosscheck,
  applyVerdict,
  buildCrosscheckPrompt,
  namesSymbol,
  numberedLine,
  parseVerdict,
  symbolsInComment,
  verifyQuotes,
  type TwoSidedFinding,
  type Verdict,
} from '../symbol-crosscheck.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../llm/provider.js';

/** The lines a comment is about, in the shape the prompt numbers them. */
const LINES = [
  ' 41| export async function refresh(credentialId: string) {',
  ' 42|   const user = await store.findUser(credentialId);',
  ' 43|   return user;',
  ' 44| }',
];

const FINDING: TwoSidedFinding = {
  path: 'src/auth/refresh.ts',
  startLine: 42,
  title: '`refresh` looks up a user by a credential id',
  description:
    '`refresh` is handed `credentialId` and passes it to `findUser`, which expects a user id.',
};

/**
 * **A provider that answers from a table, and is a real provider while it does it.**
 *
 * Not a stub of the module under test: `SymbolCrosscheck` is exercised end to end - prompt built, call made, answer
 * parsed, quotes verified against the lines, verdict applied - and only the network is replaced. **The alternative,
 * asserting on the prompt string alone, would leave the half of the device that reads the answer untested**, which is
 * where every one of this repository's parsing defects has been.
 */
class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-1';
  readonly prompts: string[] = [];
  private readonly answers: string[];

  constructor(answers: string[]) {
    this.answers = answers;
  }

  async complete(prompt: string, _options?: CompletionOptions): Promise<CompletionResult> {
    this.prompts.push(prompt);
    const answer = this.answers[Math.min(this.prompts.length - 1, this.answers.length - 1)] ?? '';
    return {
      content: answer,
      model: this.model,
      createdAt: '2026-11-26T00:00:00.000Z',
      finishReason: 'stop',
      costUsd: 0.0004,
    };
  }

  /** The pass never asks for tools, and a provider that refuses them is still a provider this pass can use. */
  async completeWithTools(prompt: string): Promise<CompletionResult> {
    return this.complete(prompt);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/** A verdict that satisfies every condition, so a test can break exactly one of them. */
const GOOD: Verdict = {
  symbol: 'credentialId',
  left: { line: 41, quote: 'export async function refresh(credentialId: string) {' },
  right: { line: 42, quote: 'const user = await store.findUser(credentialId);' },
  agree: 'no',
  rewrite:
    '`refresh(credentialId)` passes a credential id to `findUser`, which looks up a user id: the two sides disagree.',
};

const answer = (verdict: unknown) => JSON.stringify(verdict);

describe('a comment that cannot name both sides keeps its sentence', () => {
  it('is a contract with a name, because the artifact has to say which rule produced the sentence', () => {
    expect(CROSSCHECK_CONTRACT).toBe('two-sides-v1');
  });

  describe('the symbols a comment names', () => {
    it('reads the identifiers the comment names and the evidence contains', () => {
      expect(symbolsInComment(FINDING.description ?? '', LINES)).toEqual([
        'credentialId',
        'findUser',
      ]);
    });

    it('ignores a word of English that happens to look like an identifier', () => {
      // **`which` and `expected` are in the sentence and in no line**, so neither is a symbol the verifier can ask about.
      const text = '`refresh` returns which value is expected by the caller';
      expect(symbolsInComment(text, LINES)).toEqual([]);
    });

    it('ignores a token shorter than the floor, because a two-sided question needs a name', () => {
      expect(symbolsInComment('the `id` is used twice', [' 1| const id = 1;'])).toEqual([]);
    });

    it('prefers the names the comment puts in backticks, in the order it wrote them', () => {
      const text = '`findUser` is handed `credentialId`, which `findUser` does not want';
      expect(symbolsInComment(text, LINES, { max: 2 })).toEqual(['findUser', 'credentialId']);
    });

    it('finds a name the comment wrote without backticks, when the evidence carries it', () => {
      // **A comment that wrote no backticks is not a comment with no symbols**, and a rule that only read backticks would
      // silently skip every comment written in plain prose.
      expect(symbolsInComment('refresh hands credentialId to findUser', LINES)).toEqual([
        'credentialId',
        'findUser',
      ]);
    });

    it('stops at the count it was asked for, even when the sentence names more', () => {
      expect(symbolsInComment('credentialId and findUser both appear', LINES, { max: 1 })).toEqual([
        'credentialId',
      ]);
    });

    it('ignores a backticked phrase that is not a name at all', () => {
      expect(
        symbolsInComment('`the lookup` is wrong, and so is findUser', [
          ' 42| const user = await findUser(1);',
        ]),
      ).toEqual(['findUser']);
    });

    it('honours a longer floor when the caller asks for one', () => {
      expect(symbolsInComment('credentialId and findUser', LINES, { minLength: 12 })).toEqual([
        'credentialId',
      ]);
    });

    it('drops a backticked name the evidence does not contain, because there is nothing to quote', () => {
      expect(symbolsInComment('`refreshToken` is not rotated', LINES)).toEqual([]);
    });
  });

  describe('the question', () => {
    const prompt = buildCrosscheckPrompt({
      comment: FINDING.description ?? '',
      symbol: 'credentialId',
      lines: LINES,
    });

    it('names the comment and the symbol, so the answer is about one thing', () => {
      expect(prompt.user).toContain(FINDING.description);
      expect(prompt.user).toContain('Symbol: credentialId');
    });

    it('numbers the lines it shows, because both sides have to be quotable by line', () => {
      expect(prompt.user).toContain(' 41| export async function refresh(credentialId: string) {');
    });

    it('asks for both sides and for agreement, rather than for a category', () => {
      expect(prompt.system).toMatch(/two sides/i);
      expect(prompt.system).toMatch(/verbatim/i);
      expect(prompt.system).toContain('"agree"');
    });

    it('says what to do when both sides cannot be quoted, which is the branch that protects the arm', () => {
      expect(prompt.system).toMatch(/cannot quote both sides/i);
    });

    it('bounds the rewrite and requires the symbol, so a rewrite cannot lose the thread', () => {
      expect(prompt.system).toMatch(/at most \d+ characters/);
      expect(prompt.system).toMatch(/must name/i);
    });
  });

  describe('reading the answer', () => {
    it('reads a plain JSON object', () => {
      expect(parseVerdict(answer(GOOD))).toEqual(GOOD);
    });

    it('reads one wrapped in a fence, because a model that fences has still answered', () => {
      expect(parseVerdict('```json\n' + answer(GOOD) + '\n```')).toEqual(GOOD);
    });

    it('refuses an answer that is not JSON', () => {
      expect(parseVerdict('the two sides disagree')).toBeNull();
    });

    it('refuses an agreement that is not one of the three it asked for', () => {
      expect(parseVerdict(answer({ ...GOOD, agree: 'maybe' }))).toBeNull();
    });

    it('refuses a verdict with no symbol, because an unanchored question has no answer to apply', () => {
      expect(parseVerdict(answer({ ...GOOD, symbol: '' }))).toBeNull();
    });

    it('refuses a side without a quote', () => {
      expect(parseVerdict(answer({ ...GOOD, left: { line: 41 } }))).toBeNull();
    });

    it('refuses a rewrite that is not text, because a number is not a sentence', () => {
      expect(parseVerdict(answer({ ...GOOD, rewrite: 5 }))).toBeNull();
    });

    it('refuses a side whose line is not a whole number', () => {
      expect(
        parseVerdict(answer({ ...GOOD, left: { line: '41', quote: GOOD.left.quote } })),
      ).toBeNull();
      expect(
        parseVerdict(answer({ ...GOOD, left: { line: 41.5, quote: GOOD.left.quote } })),
      ).toBeNull();
    });

    it('refuses a side whose line is absent altogether', () => {
      expect(parseVerdict(answer({ ...GOOD, right: { quote: GOOD.right.quote } }))).toBeNull();
    });

    it('refuses a JSON body that is not an object', () => {
      expect(parseVerdict('"two sides"')).toBeNull();
      expect(parseVerdict('null')).toBeNull();
      expect(parseVerdict('')).toBeNull();
    });

    it('refuses an agreement that is not even text', () => {
      expect(parseVerdict(answer({ ...GOOD, agree: 5 }))).toBeNull();
    });

    it('refuses a symbol that is not a name', () => {
      expect(parseVerdict(answer({ ...GOOD, symbol: 5 }))).toBeNull();
    });

    it('refuses a side that is missing rather than empty', () => {
      expect(parseVerdict(answer({ ...GOOD, left: null }))).toBeNull();
    });

    it('reads a verdict with no rewrite key at all, because an agreement need not carry one', () => {
      const { rewrite: _omitted, ...withoutRewrite } = GOOD;
      expect(parseVerdict(answer({ ...withoutRewrite, agree: 'yes' }))?.rewrite).toBeNull();
    });
  });

  describe('the quotes, which are the only evidence the device has', () => {
    it('accepts two quotes that appear in the lines they name', () => {
      expect(verifyQuotes(GOOD, LINES)).toEqual({ ok: true, reason: null });
    });

    it('reads a quote whose whitespace was reflowed, because an indentation is not a lie', () => {
      const reflowed: Verdict = {
        ...GOOD,
        left: { line: 41, quote: 'export   async function refresh(credentialId: string) {' },
      };
      expect(verifyQuotes(reflowed, LINES)).toEqual({ ok: true, reason: null });
    });

    it('refuses a quote that appears nowhere, because a paraphrase is not a quotation', () => {
      const invented: Verdict = {
        ...GOOD,
        left: { line: 41, quote: 'export async function refresh(credential: string) {' },
      };
      expect(verifyQuotes(invented, LINES)).toEqual({ ok: false, reason: 'unquoted' });
    });

    it('refuses a quote attributed to a line that is not the line it is on', () => {
      const misplaced: Verdict = { ...GOOD, left: { ...GOOD.left, line: 43 } };
      expect(verifyQuotes(misplaced, LINES)).toEqual({ ok: false, reason: 'unquoted' });
    });

    it('refuses two quotes that are the same line, because one side cannot be its own other side', () => {
      const same: Verdict = { ...GOOD, right: { ...GOOD.left } };
      expect(verifyQuotes(same, LINES)).toEqual({ ok: false, reason: 'same-side' });
    });

    it('refuses a line that is not numbered, because a quote with no address cannot be checked', () => {
      expect(verifyQuotes(GOOD, ['export async function refresh(credentialId: string) {'])).toEqual(
        {
          ok: false,
          reason: 'unquoted',
        },
      );
    });

    it('reads a numbered line and its text, and refuses one without a number', () => {
      expect(numberedLine(' 41| const a = 1;')).toEqual({ line: 41, text: 'const a = 1;' });
      expect(numberedLine('const a = 1;')).toBeNull();
    });

    it('finds a symbol on a word boundary, and never inside a longer name', () => {
      expect(namesSymbol('the credentialId is passed', 'credentialId')).toBe(true);
      expect(namesSymbol('the credentialIdValue is passed', 'credentialId')).toBe(false);
      expect(namesSymbol('anything', '')).toBe(false);
    });
  });

  describe('what a verdict does to the sentence', () => {
    const base: TwoSidedFinding = { ...FINDING };

    it('rewrites when both sides are quoted and they disagree', () => {
      const result = applyVerdict(base, GOOD, LINES);
      expect(result.action).toBe('rewritten');
      expect(result.finding.description).toBe(GOOD.rewrite);
      expect(result.finding.crosschecked).toBe(CROSSCHECK_CONTRACT);
    });

    it('keeps the sentence when the two sides agree, because agreement is not a finding', () => {
      const result = applyVerdict(base, { ...GOOD, agree: 'yes', rewrite: null }, LINES);
      expect(result.action).toBe('kept');
      expect(result.reason).toBe('agree');
      expect(result.finding.description).toBe(base.description);
    });

    it('keeps the sentence when the model could not quote both sides', () => {
      const result = applyVerdict(
        base,
        { ...GOOD, agree: 'cannot', rewrite: null, left: { line: 41, quote: '' } },
        LINES,
      );
      expect(result.action).toBe('kept');
      expect(result.reason).toBe('cannot');
    });

    it('keeps the sentence when the disagreement came with no rewrite', () => {
      const result = applyVerdict(base, { ...GOOD, rewrite: null }, LINES);
      expect(result.reason).toBe('no-rewrite');
    });

    it('keeps the sentence when the rewrite does not name the symbol it is about', () => {
      const result = applyVerdict(
        base,
        { ...GOOD, rewrite: 'The lookup is wrong at this line.' },
        LINES,
      );
      expect(result.action).toBe('kept');
      expect(result.reason).toBe('unnamed');
    });

    it('keeps the sentence when the rewrite is longer than the bound', () => {
      const result = applyVerdict(
        base,
        { ...GOOD, rewrite: `${'credentialId '.repeat(40)}` },
        LINES,
        { maxRewriteChars: 100 },
      );
      expect(result.reason).toBe('toolong');
    });

    it('keeps the sentence when the rewrite is the sentence it already had', () => {
      const result = applyVerdict(base, { ...GOOD, rewrite: base.description ?? '' }, LINES);
      expect(result.reason).toBe('identical');
    });

    it('never moves the anchor, whatever it does to the sentence', () => {
      const result = applyVerdict(base, GOOD, LINES);
      expect(result.finding.path).toBe(base.path);
      expect(result.finding.startLine).toBe(base.startLine);
    });

    it('treats a comment carried in `content` the way it treats one carried in `description`', () => {
      const comment: TwoSidedFinding = { path: 'a.ts', startLine: 1, content: base.description };
      const result = applyVerdict(comment, GOOD, LINES);
      expect(result.action).toBe('rewritten');
      expect(result.finding.content).toBe(GOOD.rewrite);
    });

    it('treats a finding that carries no sentence at all as an empty one rather than crashing', () => {
      const bare: TwoSidedFinding = { path: 'a.ts', startLine: 1 };
      const result = applyVerdict(bare, GOOD, LINES);
      expect(result.action).toBe('rewritten');
      expect(result.finding.title).toBe(GOOD.rewrite);
    });

    it('rewrites a title when the title is the only sentence a finding carries', () => {
      const titled: TwoSidedFinding = {
        path: 'a.ts',
        startLine: 1,
        title: '`refresh` takes a credential id',
      };
      const result = applyVerdict(titled, GOOD, LINES);
      expect(result.finding.title).toBe(GOOD.rewrite);
      expect(result.finding.description).toBeUndefined();
    });
  });

  describe('the pass over a comment set', () => {
    const evidenceOf = () => LINES;

    it('returns one comment per comment it was given, in the same order', async () => {
      const provider = new ScriptedProvider([answer(GOOD), 'not json']);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10 });
      const findings: TwoSidedFinding[] = [
        { ...FINDING },
        { path: 'src/auth/refresh.ts', startLine: 41, description: '`store` is not awaited' },
        { path: 'src/other.ts', startLine: 9, description: 'nothing to see here' },
      ];
      const { findings: out } = await pass.run(findings, evidenceOf);
      expect(out).toHaveLength(findings.length);
      expect(out.map((finding) => finding.path)).toEqual(findings.map((finding) => finding.path));
      expect(out.map((finding) => finding.startLine)).toEqual(
        findings.map((finding) => finding.startLine),
      );
    });

    it('never spends a call on a comment that names nothing the evidence contains', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10 });
      const { report } = await pass.run(
        [{ path: 'src/other.ts', startLine: 9, description: 'the retry policy is unclear' }],
        evidenceOf,
      );
      expect(provider.prompts).toHaveLength(0);
      expect(report.considered).toBe(1);
      expect(report.called).toBe(0);
      expect(report.kept['no-symbol']).toBe(1);
    });

    it('never spends a call on a comment whose evidence is empty, because there is nothing to quote', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10 });
      const { report } = await pass.run([{ ...FINDING }], () => []);
      expect(provider.prompts).toHaveLength(0);
      expect(report.kept['no-evidence']).toBe(1);
    });

    it('stops at its call budget rather than at the end of the list', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 1 });
      const findings = Array.from({ length: 5 }, () => ({ ...FINDING }));
      const { report } = await pass.run(findings, evidenceOf);
      expect(provider.prompts).toHaveLength(1);
      expect(report.called).toBe(1);
      expect(report.budgetExhausted).toBe(true);
      expect(report.kept.budget).toBe(4);
    });

    it('holds the per-pull-request cap, so one busy diff cannot carry the whole bill', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 50, maxPerPullRequest: 2 });
      const findings = Array.from({ length: 5 }, () => ({ ...FINDING, pr: 'o/r/pull/1' }));
      const { report } = await pass.run(findings, evidenceOf);
      expect(report.called).toBe(2);
      expect(report.kept['pull-request-cap']).toBe(3);
    });

    it('counts every path out, so a run can tell a strict verifier from a silent one', async () => {
      const provider = new ScriptedProvider([
        answer(GOOD),
        'not json',
        answer({ ...GOOD, agree: 'yes' }),
      ]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10, maxPerPullRequest: 10 });
      const { report } = await pass.run(
        [{ ...FINDING }, { ...FINDING }, { ...FINDING }],
        evidenceOf,
      );
      expect(report.rewritten).toBe(1);
      expect(report.kept.unreadable).toBe(1);
      // **Two agreements for one comment, and that is the device working rather than double counting**: the comment
      // names `credentialId` and `findUser`, the first answer says the two sides of one of them agree, and a pass that
      // stopped there would never ask about the other. Counting is per question asked, which is why the tally is here
      // rather than per comment.
      expect(report.kept.agree).toBe(2);
      expect(report.considered).toBe(3);
    });

    it('prices the pass from its calls when the provider is not metered', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10 });
      const { report } = await pass.run([{ ...FINDING }], evidenceOf);
      expect(report.callsPriced).toBe(1);
      expect(report.spendUsd).toBeCloseTo(0.0004, 6);
    });

    it('survives a provider that throws, because a single failed call is not a failed run', async () => {
      const provider: LLMProvider = {
        name: 'throwing',
        model: 'throwing-1',
        complete: () => Promise.reject(new Error('429 from upstream')),
        completeWithTools: () => Promise.reject(new Error('429 from upstream')),
        healthCheck: () => Promise.resolve(false),
      };
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10 });
      const { findings, report } = await pass.run([{ ...FINDING }], evidenceOf);
      expect(findings[0]?.description).toBe(FINDING.description);
      expect(report.failed).toBe(1);
      expect(report.kept.failed).toBe(1);
    });

    it('names its contract in the report, because a figure has to say which rule produced it', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10 });
      const { report } = await pass.run([{ ...FINDING }], evidenceOf);
      expect(report.contract).toBe(CROSSCHECK_CONTRACT);
    });

    it('counts a pull request out when its cap is spent mid-comment, rather than half-asking', async () => {
      const provider = new ScriptedProvider([answer({ ...GOOD, agree: 'yes' })]);
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10, maxPerPullRequest: 1 });
      const { report, findings } = await pass.run([{ ...FINDING }], evidenceOf);
      // **The comment names two symbols and the cap is one**, so the second question is never bought - and the finding
      // comes back unchanged rather than half-verified.
      expect(provider.prompts).toHaveLength(1);
      expect(report.kept['pull-request-cap']).toBe(1);
      expect(findings[0]?.description).toBe(FINDING.description);
    });

    it('reports no price when the provider reports none, because zero is absorbed and unknown is not', async () => {
      const provider: LLMProvider = {
        name: 'unpriced',
        model: 'unpriced-1',
        complete: () =>
          Promise.resolve({
            content: answer(GOOD),
            model: 'unpriced-1',
            createdAt: '2026-11-26T00:00:00.000Z',
            finishReason: 'stop',
          }),
        completeWithTools: () => Promise.reject(new Error('unused')),
        healthCheck: () => Promise.resolve(true),
      };
      const pass = new SymbolCrosscheck(provider, { maxCalls: 10 });
      const { report } = await pass.run([{ ...FINDING }], evidenceOf);
      expect(report.called).toBe(1);
      expect(report.callsPriced).toBe(0);
      expect(report.spendUsd).toBe(0);
    });
  });
});
