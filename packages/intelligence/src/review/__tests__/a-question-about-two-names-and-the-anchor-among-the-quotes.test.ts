// @code-analyzer/intelligence — the question §167 could not ask: two names, and the anchor among the quotes
//
// **What §167 measured.** The two-sided verifier rewrote 28 sentences and moved the prize by nothing: 3 of the 27 entries
// rewritten, 0 credited. The reading was not that the pass failed to predicate - the 28 rewrites are real, quoted, and
// about the code - but that it failed to **select**: it asked about the first backticked name in the comment, which is
// usually the sentence's subject, while a golden's concern is the **correspondence between two names**. 24 of the 27 plan
// entries were never asked about at all.
//
// **What this contract changes, and nothing else.** `two-related-names-v1` asks about a pair the comment already relates -
// `getForLogin` and `organizationId`, not `getForLogin` alone - and requires **one of the two quoted sides to be the
// anchor's own line**, so an answer cannot drift to a different part of the file and still count. The rewrite has to name
// both names, because a sentence that names one of them has not stated a correspondence.
//
// **What does not change.** The device may still only edit: one finding in, one finding out, same path, same line, same
// count. The free action is still `cannot`. And the quote check is still the only evidence there is - a pair whose two
// sides cannot both be quoted verbatim is kept, not rewritten.

import { describe, expect, it } from 'vitest';

import {
  CROSSCHECK_CONTRACT,
  RELATED_NAMES_CONTRACT,
  numberedLine,
  SymbolCrosscheck,
  anchorAmongSides,
  applyRelationVerdict,
  buildCrosscheckPrompt,
  buildRelationPrompt,
  parseRelationVerdict,
  relatedPairs,
  type RelationVerdict,
  type TwoSidedFinding,
} from '../symbol-crosscheck.js';

import type { CompletionOptions, CompletionResult, LLMProvider } from '../llm/provider.js';

/** Two sides of one call, one file, in the shape the prompt numbers them. */
const LINES = [
  '214| export function getForLogin(organizationId: string, realm: string) {',
  '215|   const key = cacheKey(realm, organizationId);',
  '216|   return cache.get(key);',
  '217| }',
];

const COMMENT =
  '`getForLogin` is handed `organizationId` but computes its cache key from `realm` and `organizationId`, ' +
  'so two realms share an entry.';

const FINDING: TwoSidedFinding = {
  path: 'src/auth/login.ts',
  startLine: 215,
  description: COMMENT,
};

/** A provider that answers from a table and is a real provider while it does it: only the network is replaced. */
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
      createdAt: '2026-11-27T00:00:00.000Z',
      finishReason: 'stop',
      costUsd: 0.0004,
    };
  }

  async completeWithTools(prompt: string): Promise<CompletionResult> {
    return this.complete(prompt);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

const answer = (verdict: unknown): string => JSON.stringify(verdict);

/** A verdict that satisfies every condition, so a test can break exactly one of them. */
const GOOD: RelationVerdict = {
  symbol: 'getForLogin',
  anchor: 'getForLogin',
  other: 'organizationId',
  left: {
    line: 214,
    quote: 'export function getForLogin(organizationId: string, realm: string) {',
  },
  right: { line: 215, quote: 'const key = cacheKey(realm, organizationId);' },
  agree: 'no',
  rewrite:
    '`getForLogin` takes `organizationId` and builds its cache key from `realm` and `organizationId`: two realms share an entry.',
};

describe('a question about two names, with the anchor among the quotes', () => {
  it('is a contract with its own name, because the artifact has to say which rule produced the sentence', () => {
    expect(RELATED_NAMES_CONTRACT).toBe('two-related-names-v1');
    // **And the previous contract keeps its name**, so the committed record stays a record of the rule that made it.
    expect(CROSSCHECK_CONTRACT).toBe('two-sides-v1');
  });

  describe('the pair a comment already relates', () => {
    it('pairs the name a relation word joins to the first backticked name', () => {
      expect(relatedPairs(COMMENT, LINES)).toEqual([
        { anchor: 'getForLogin', other: 'organizationId' },
      ]);
    });

    it('takes the caller’s anchor when the comment names it', () => {
      // The plan chose `organizationId` for this entry, and a device that ignored the plan would be asking a question the
      // prize was not computed on.
      expect(relatedPairs(COMMENT, LINES, { anchor: 'organizationId' })).toEqual([
        { anchor: 'organizationId', other: 'getForLogin' },
      ]);
    });

    it('falls back rather than inventing an anchor the comment does not name', () => {
      expect(relatedPairs(COMMENT, LINES, { anchor: 'credentialId' })).toEqual([
        { anchor: 'getForLogin', other: 'organizationId' },
      ]);
    });

    it('falls back to the next name when no relation word joins the two', () => {
      const flat = '`getForLogin` reads `organizationId`, then `realm`.';
      expect(relatedPairs(flat, LINES)).toEqual([
        { anchor: 'getForLogin', other: 'organizationId' },
      ]);
    });

    it('will not pair a name with itself when the comment repeats it', () => {
      const repeated = '`organizationId` is read twice: `organizationId` is also cached.';
      const pairs = relatedPairs(repeated, LINES);
      expect(pairs.every((pair) => pair.anchor !== pair.other)).toBe(true);
    });

    it('takes a partner whose only occurrence is its declaration, because a declaration is a side', () => {
      const declaredOnly = [
        '300| const sessionStore = new Map();',
        '301| const cacheKey = build(realm);',
      ];
      // "set here and never read" is precisely a two-sided disagreement, so the declaration filter that `symbolsInComment`
      // applies does not apply to a partner. What the partner cannot be is a reserved word or a name from another clause.
      expect(relatedPairs('`sessionStore` holds `cacheKey`.', declaredOnly)).toEqual([
        { anchor: 'sessionStore', other: 'cacheKey' },
      ]);
    });

    it('accepts an anchor that occurs only where it is declared, because a pair supplies its other side', () => {
      const declaredOnly = [
        '214| export function getForLogin(organizationId: string) {',
        '215|   return cache.get(organizationId);',
      ];
      // §167 refused to ask about `getForLogin` at all - it had no second occurrence - which is how 24 of the 27 plan
      // entries were never asked about. The partner is the other side here, not a second occurrence of the anchor.
      expect(relatedPairs('`getForLogin` caches by `organizationId`.', declaredOnly)).toEqual([
        { anchor: 'getForLogin', other: 'organizationId' },
      ]);
    });

    it('refuses a partner in another sentence, because two sentences are two claims', () => {
      const twoSentences =
        '`getForLogin` is the entry point. Nothing else reads `organizationId` here.';
      expect(relatedPairs(twoSentences, LINES)).toEqual([]);
    });

    it('ignores a reserved word even when the comment backticks it', () => {
      expect(
        relatedPairs('`await` is applied to `getForLogin` and `organizationId`.', LINES),
      ).toEqual([{ anchor: 'getForLogin', other: 'organizationId' }]);
    });

    it('returns no pair when the comment names nothing the evidence contains', () => {
      expect(relatedPairs('`databaseUrl` is wrong.', LINES)).toEqual([]);
    });

    it('returns no pair when only one usable name exists, because a pair needs two', () => {
      expect(relatedPairs('`getForLogin` is wrong.', LINES)).toEqual([]);
    });

    it('is deterministic on the same input', () => {
      expect(relatedPairs(COMMENT, LINES)).toEqual(relatedPairs(COMMENT, LINES));
    });

    it('respects the bound the caller sets', () => {
      expect(relatedPairs(COMMENT, LINES, { max: 0 })).toEqual([]);
    });
  });

  describe('the shapes a real diff has, which the numbered-line rule has to survive', () => {
    it('skips a line the lexer did not number rather than reading its first token as a name', () => {
      // A unified diff contains context that is not numbered - an `@@` header, a `\ No newline` marker - and a device that
      // read them would attach a pair to a line number that does not exist.
      const mixed = ['@@ -1,3 +1,3 @@', ...LINES, '\\ No newline at end of file'];
      expect(relatedPairs(COMMENT, mixed)).toEqual([
        { anchor: 'getForLogin', other: 'organizationId' },
      ]);
    });

    it('reads a numbered line with no text, and a name shorter than the floor is not a name', () => {
      const blank = ['214| export function getForLogin(organizationId: string) {', '215|'];
      expect(numberedLine('215|')).toEqual({ line: 215, text: '' });
      // `` `id` `` is backticked and real, and it is below the length floor - so it is not offered as a partner.
      const pairs = relatedPairs('`getForLogin` is handed `id` on every call.', blank);
      expect(pairs).toEqual([]);
    });

    it('finds a pair in a comment that uses no backticks at all', () => {
      // Most comments in this corpus are prose without code formatting, so the pair cannot depend on a backtick.
      expect(
        relatedPairs('getForLogin is handed organizationId but caches by realm.', LINES),
      ).toEqual([{ anchor: 'getForLogin', other: 'organizationId' }]);
    });
  });

  describe('the anchor has to be one of the two quoted sides', () => {
    it('accepts an answer whose left side is the anchor’s line', () => {
      expect(anchorAmongSides(GOOD, 'getForLogin', LINES)).toBe(true);
    });

    it('accepts an answer whose right side is the anchor’s line', () => {
      const mirrored: RelationVerdict = { ...GOOD, left: GOOD.right, right: GOOD.left };
      expect(anchorAmongSides(mirrored, 'getForLogin', LINES)).toBe(true);
    });

    it('refuses two sides that both stand away from the anchor', () => {
      const adrift: RelationVerdict = {
        ...GOOD,
        left: { line: 216, quote: 'return cache.get(key);' },
        right: { line: 216, quote: 'return cache.get(key);' },
      };
      expect(anchorAmongSides(adrift, 'getForLogin', LINES)).toBe(false);
    });

    it('reports no anchor when the quoted line is not one the lexer numbered', () => {
      const adrift: RelationVerdict = {
        ...GOOD,
        left: {
          line: 999,
          quote: 'export function getForLogin(organizationId: string, realm: string) {',
        },
      };
      expect(anchorAmongSides(adrift, 'getForLogin', LINES)).toBe(false);
    });

    it('compares the anchor on word boundaries, so `id` is not found inside `organizationId`', () => {
      const sides: RelationVerdict = {
        ...GOOD,
        left: { line: 215, quote: 'const key = cacheKey(realm, organizationId);' },
        right: { line: 216, quote: 'return cache.get(key);' },
      };
      expect(anchorAmongSides(sides, 'id', LINES)).toBe(false);
    });
  });

  describe('the reader and the prompt agree, which is the defect run 4 paid for', () => {
    /** The field names a prompt's example prints, which is what a model imitates and therefore what the reader must read. */
    const fieldsOf = (system: string): Set<string> => {
      const example = system.split('\n').find((line) => line.trim().startsWith('{"'));
      expect(example).toBeDefined();
      return new Set([...String(example).matchAll(/"(\w+)":/g)].map((match) => match[1] as string));
    };

    it('accepts an answer built from exactly the fields the relation prompt asks for', () => {
      const prompt = buildRelationPrompt({
        comment: COMMENT,
        anchor: 'getForLogin',
        other: 'organizationId',
        lines: LINES,
      });
      const fields = fieldsOf(prompt.system);
      // **The exact failure of run 4**: 184 of 184 answers were `unreadable` because this reader demanded a `symbol` the
      // prompt never asked for. The set of fields is taken from the prompt, so a reader stricter than its own prompt fails
      // here in a second rather than in a paid run.
      expect(fields.has('symbol')).toBe(false);
      const composed = answer({
        left: GOOD.left,
        right: GOOD.right,
        agree: 'no',
        rewrite: GOOD.rewrite,
      });
      const verdict = parseRelationVerdict(composed, {
        anchor: 'getForLogin',
        other: 'organizationId',
      });
      expect(verdict).not.toBeNull();
      expect(verdict?.anchor).toBe('getForLogin');
    });

    it('still requires the symbol the first prompt does ask for', () => {
      const prompt = buildCrosscheckPrompt({
        comment: COMMENT,
        symbol: 'getForLogin',
        lines: LINES,
      });
      expect(fieldsOf(prompt.system).has('symbol')).toBe(true);
    });

    it('ignores a symbol or pair the model volunteers, because the question owns the pair', () => {
      const volunteered = answer({ ...GOOD, symbol: 'realm', anchor: 'realm', other: 'mode' });
      const verdict = parseRelationVerdict(volunteered, {
        anchor: 'getForLogin',
        other: 'organizationId',
      });
      expect(verdict?.anchor).toBe('getForLogin');
      expect(verdict?.other).toBe('organizationId');
    });

    it('refuses an answer that is not text at all', () => {
      // **A provider that returns nothing is not a provider that returned JSON.** `undefined` and `null` arrive here from
      // a completion the caller could not read, and both are refusals rather than crashes.
      expect(
        parseRelationVerdict(undefined as unknown as string, { anchor: 'a', other: 'b' }),
      ).toBeNull();
      expect(parseRelationVerdict('' as string, { anchor: 'a', other: 'b' })).toBeNull();
    });

    it('refuses an answer with no sides at all', () => {
      expect(
        parseRelationVerdict(answer({ agree: 'yes', rewrite: null }), { anchor: 'a', other: 'b' }),
      ).toBeNull();
    });
  });

  describe('the question itself', () => {
    it('names both names, in the order the comment relates them', () => {
      const prompt = buildRelationPrompt({
        comment: COMMENT,
        anchor: 'getForLogin',
        other: 'organizationId',
        lines: LINES,
      });
      expect(prompt.user).toContain('Relates: getForLogin and organizationId');
      expect(prompt.user.indexOf('getForLogin')).toBeLessThan(
        prompt.user.indexOf('organizationId'),
      );
    });

    it('asks for two verbatim quotes and keeps `cannot` as an answer', () => {
      const prompt = buildRelationPrompt({
        comment: COMMENT,
        anchor: 'getForLogin',
        other: 'organizationId',
        lines: LINES,
      });
      expect(prompt.system).toContain('copied verbatim');
      expect(prompt.system).toContain('"cannot"');
      // **The anchor rule is stated to the model as well as checked after it**, because a rule only the checker knows is a
      // rule that turns into a refusal after the money is spent.
      expect(prompt.system).toContain(
        'one of the two quotes must be the line where the first name stands',
      );
    });

    it('carries the rewrite bound the caller set', () => {
      const prompt = buildRelationPrompt({
        comment: COMMENT,
        anchor: 'getForLogin',
        other: 'organizationId',
        lines: LINES,
        maxRewriteChars: 120,
      });
      expect(prompt.system).toContain('120 characters');
    });
  });

  describe('what the verdict does to the sentence', () => {
    it('keeps the sentence when the model answers `cannot`', () => {
      const kept = applyRelationVerdict(
        FINDING,
        { ...GOOD, agree: 'cannot', rewrite: null },
        LINES,
      );
      expect(kept.action).toBe('kept');
      expect(kept.reason).toBe('cannot');
    });

    it('keeps the sentence when a side cannot be found in the line it is attributed to', () => {
      const kept = applyRelationVerdict(
        FINDING,
        { ...GOOD, right: { line: 215, quote: 'const key = cacheKey(realm, userId);' } },
        LINES,
      );
      expect(kept.reason).toBe('unquoted');
    });

    it('keeps the sentence when the two quotes are the same text', () => {
      const kept = applyRelationVerdict(
        FINDING,
        {
          ...GOOD,
          right: {
            line: 214,
            quote: 'export function getForLogin(organizationId: string, realm: string) {',
          },
        },
        LINES,
      );
      expect(kept.reason).toBe('same-side');
    });

    it('refuses an answer whose sides both stand away from the anchor', () => {
      const kept = applyRelationVerdict(
        FINDING,
        {
          ...GOOD,
          left: { line: 215, quote: 'const key = cacheKey(realm, organizationId);' },
          right: { line: 216, quote: 'return cache.get(key);' },
        },
        LINES,
      );
      expect(kept.action).toBe('kept');
      expect(kept.reason).toBe('off-anchor');
    });

    it('keeps the sentence when the two sides agree', () => {
      expect(applyRelationVerdict(FINDING, { ...GOOD, agree: 'yes' }, LINES).reason).toBe('agree');
    });

    it('keeps the sentence when a disagreement carries no rewrite', () => {
      expect(applyRelationVerdict(FINDING, { ...GOOD, rewrite: null }, LINES).reason).toBe(
        'no-rewrite',
      );
    });

    it('refuses a rewrite that names only one of the two names', () => {
      const kept = applyRelationVerdict(
        FINDING,
        { ...GOOD, rewrite: '`getForLogin` builds a cache key from a value it does not use.' },
        LINES,
      );
      expect(kept.reason).toBe('unnamed');
    });

    it('applies a rewrite that names both, and marks it with the contract', () => {
      const applied = applyRelationVerdict(FINDING, GOOD, LINES);
      expect(applied.action).toBe('rewritten');
      expect(applied.finding.description).toBe(GOOD.rewrite);
      expect(applied.finding.crosschecked).toBe(RELATED_NAMES_CONTRACT);
      // **The anchor and the line are untouched**, which is the count invariant seen from the other side.
      expect(applied.finding.path).toBe(FINDING.path);
      expect(applied.finding.startLine).toBe(FINDING.startLine);
    });

    it('refuses a rewrite that is the sentence it already had', () => {
      expect(applyRelationVerdict(FINDING, { ...GOOD, rewrite: COMMENT }, LINES).reason).toBe(
        'identical',
      );
    });

    it('refuses a rewrite over the bound', () => {
      const kept = applyRelationVerdict(FINDING, GOOD, LINES, { maxRewriteChars: 20 });
      expect(kept.reason).toBe('toolong');
    });
  });

  describe('the pass', () => {
    const linesOf = (): string[] => LINES;

    it('asks one question per comment and reports its own contract', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { contract: RELATED_NAMES_CONTRACT });
      const { findings, report } = await pass.run([FINDING], linesOf);
      expect(provider.prompts).toHaveLength(1);
      expect(report.contract).toBe(RELATED_NAMES_CONTRACT);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.description).toBe(GOOD.rewrite);
    });

    it('tallies the pair, because "which correspondence does this device work on" is the next round’s input', async () => {
      const provider = new ScriptedProvider([answer(GOOD)]);
      const pass = new SymbolCrosscheck(provider, { contract: RELATED_NAMES_CONTRACT });
      const { report } = await pass.run([FINDING], linesOf);
      expect(report.bySymbol).toEqual([
        { symbol: 'getForLogin→organizationId', called: 1, rewritten: 1 },
      ]);
    });

    it('uses the anchor the caller supplies on the finding', async () => {
      const provider = new ScriptedProvider([
        answer({ ...GOOD, anchor: 'organizationId', other: 'getForLogin' }),
      ]);
      const pass = new SymbolCrosscheck(provider, { contract: RELATED_NAMES_CONTRACT });
      const { report } = await pass.run([{ ...FINDING, anchor: 'organizationId' }], linesOf);
      expect(provider.prompts[0]).toContain('Relates: organizationId and getForLogin');
      expect(report.bySymbol[0]?.symbol).toBe('organizationId→getForLogin');
    });

    it('reads the relation answer with the relation reader, so a missing echo is not an unreadable answer', async () => {
      // **The regression for run 4.** The scripted answer here is in the shape the prompt asks for: four fields, no
      // `symbol`. A pass that reaches for the single-name reader reports `unreadable` and rewrites nothing, which is what
      // 184 calls bought before this test existed.
      const provider = new ScriptedProvider([
        answer({ left: GOOD.left, right: GOOD.right, agree: 'no', rewrite: GOOD.rewrite }),
      ]);
      const pass = new SymbolCrosscheck(provider, { contract: RELATED_NAMES_CONTRACT });
      const { report, findings } = await pass.run([FINDING], linesOf);
      expect(report.kept['unreadable']).toBe(0);
      expect(findings[0]?.description).toBe(GOOD.rewrite);
      expect(report.rewritten).toBe(1);
    });

    it('keeps the previous contract available, because the committed record was produced under it', async () => {
      const provider = new ScriptedProvider([
        answer({ ...GOOD, other: undefined, anchor: undefined }),
      ]);
      const pass = new SymbolCrosscheck(provider, { contract: CROSSCHECK_CONTRACT });
      const { report } = await pass.run([FINDING], linesOf);
      expect(report.contract).toBe(CROSSCHECK_CONTRACT);
      // The old question names one symbol, so the prompt says `Symbol:` rather than `Relates:` - and the name it picks is
      // `organizationId`, because §167's rule excludes a name that occurs only where it is declared. **That exclusion is
      // the defect this contract exists to remove**, and the assertion states it rather than hiding it.
      expect(provider.prompts[0]).toContain('Symbol: organizationId');
    });
  });
});
