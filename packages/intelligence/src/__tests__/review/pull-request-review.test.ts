// @code-analyzer/intelligence — One review per pull request, not one per file
//
// **What this file is about, in the measurement's own numbers.**
//
// On the same five AACR-Bench pull requests, judged by the same model against the same 50 goldens:
//
//   - **our per-file arm** emits **183 findings for 21 matches** - precision 0.2019, recall 0.42, F1 0.2727;
//   - **our whole-pull-request arm** emits **15 findings for 6 matches** - precision **0.40**, recall 0.12, F1 0.1846.
//
// **The second arm has twice the precision of the first and a fifth of its recall**, and the two arms differ in
// exactly one thing: **the unit of review**. Five lanes reviewing 199 files answer 995 times and fill three slots per
// file per lane; five lanes reviewing five pull requests answer 25 times and fill three slots **per pull request**.
// **The precision is bought by the competition for a fixed budget, and the recall is lost to the same budget.**
//
// So this file adds the scope, the budget and the validation a pull-request review needs to be measurable on its own
// terms - and it adds them **beside** the per-file path rather than replacing it, because **the per-file arm is the
// control**: two arms of one engine, one judge, one set of goldens, one job.
//
// **The three things a pull-request call cannot inherit from a file call**, each of which is a test below:
//
//   1. **A finding has to say which file it is about.** In a file call the answer is the argument. Across a pull
//      request the model chooses, so it can choose a file the call did not show, or choose none at all - and both are
//      counted rather than defaulted, because **a default here is a comment filed against the wrong file.**
//   2. **A line number is only meaningful inside its own file.** Two files both have a line 10. A filter holding one
//      flat set of hunk ranges answers a question nobody asked.
//   3. **Deduplication must not merge across files.** Two files each with an unfixed null check are two comments a
//      developer has to make, and a merge keyed on overlapping line numbers alone turns them into one.

import { describe, it, expect } from 'vitest';

import { LLMReviewEngine } from '../../review/llm/llm-review-engine.js';

import type { LLMProvider } from '../../review/llm/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * **A provider that records what it was asked and answers from a script.**
 *
 * **A real object rather than a spy**, for the reason this repository states everywhere else: **a test that asserts a
 * call happened is a test of the test double**, and what these cases are about is what the engine did with the answer.
 * Recording the prompts is the cheapest way to assert the contract reached the model, and it holds the same strings a
 * spy would.
 */
interface Recording {
  provider: LLMProvider;
  prompts: string[];
}

function providerReturning(...payloads: string[]): Recording {
  const prompts: string[] = [];
  const provider: LLMProvider = {
    name: 'RecordingProvider',
    model: 'recording-model',
    complete: async (prompt: string) => {
      prompts.push(prompt);
      const content = payloads[Math.min(prompts.length - 1, payloads.length - 1)] ?? '';
      return {
        content,
        model: 'recording-model',
        createdAt: new Date().toISOString(),
        finishReason: 'stop',
      };
    },
    completeWithTools: async () => {
      throw new Error('tools are not used by the review lanes');
    },
    healthCheck: async () => true,
  };
  return { provider, prompts };
}

/** A two-file pull request's diff, as `git diff` writes it: each section carries its own path and hunk. */
const TWO_FILES = [
  'diff --git a/src/limit.ts b/src/limit.ts',
  '+++ b/src/limit.ts',
  '@@ -8,2 +8,4 @@',
  ' const limit = 10;',
  '+const retries = limit;',
  '+const margin = retries - 1;',
  'diff --git a/src/budget.ts b/src/budget.ts',
  '+++ b/src/budget.ts',
  '@@ -40,2 +40,3 @@',
  ' const cap = 0;',
  '+const spend = cap;',
];

const LIMIT = { path: 'src/limit.ts', diffText: TWO_FILES.slice(0, 6).join('\n') };
const BUDGET = { path: 'src/budget.ts', diffText: TWO_FILES.slice(6).join('\n') };

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLine: 9,
    endLine: 9,
    severity: 'high',
    category: 'bug',
    title: 'Retries are derived from the limit',
    description: 'The retry count is a copy of the limit, so a limit of ten becomes ten retries.',
    suggestion: 'Give retries its own constant.',
    ...overrides,
  };
}

function payload(findings: Array<Record<string, unknown>>): string {
  return JSON.stringify({ findings });
}

// ---------------------------------------------------------------------------
// The unit of review
// ---------------------------------------------------------------------------

describe('reviewPullRequest', () => {
  it('asks each lane once for the whole pull request rather than once per file', async () => {
    const { provider, prompts } = providerReturning(payload([finding({ path: 'src/limit.ts' })]));
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security', 'architecture'],
      parallel: false,
    });

    await engine.reviewPullRequest([LIMIT, BUDGET]);

    // **Two lanes over two files is two calls.** A per-file engine would have made four, and the difference is the
    // whole reason the two arms have different precision.
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain('src/limit.ts');
      expect(prompt).toContain('src/budget.ts');
    }
  });

  it('attributes every finding to the file it names', async () => {
    const { provider } = providerReturning(
      payload([
        finding({ path: 'src/limit.ts' }),
        finding({
          path: 'src/budget.ts',
          startLine: 41,
          endLine: 41,
          title: 'Spend copies the cap',
        }),
      ]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(results[0]!.findings.map((f) => f.path)).toEqual(['src/limit.ts', 'src/budget.ts']);
  });

  it('drops a finding that names a file the request did not show, and counts it', async () => {
    const { provider } = providerReturning(payload([finding({ path: 'src/elsewhere.ts' })]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(results[0]!.findings).toEqual([]);
    expect(engine.lastCounts?.dropped.unknownPath).toBe(1);
  });

  it('counts a finding that names no file separately from one that names the wrong file', async () => {
    const { provider } = providerReturning(payload([finding()]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(results[0]!.findings).toEqual([]);
    expect(engine.lastCounts?.dropped.missingPath).toBe(1);
    // **A default path here would file a real comment against a file the model never chose**, so the two mistakes are
    // different defects and are counted as different ones.
    expect(engine.lastCounts?.dropped.unknownPath).toBe(0);
  });

  it("accepts a line inside its own file's hunk even when the other file's hunk is far shorter", async () => {
    // Line 41 is inside `budget.ts`' hunk (40..42) and outside `limit.ts`' hunk (8..11). A filter holding one flat set
    // of ranges cannot tell those two cases apart, which is the coordinate defect this repository already paid for once.
    const { provider } = providerReturning(
      payload([finding({ path: 'src/budget.ts', startLine: 41, endLine: 41 })]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(results[0]!.findings).toHaveLength(1);
    expect(engine.lastCounts?.dropped.beyondDiffLength).toBe(0);
  });

  it("counts a line outside its own file's hunks, and leaves it where the model put it", async () => {
    const { provider } = providerReturning(
      payload([finding({ path: 'src/limit.ts', startLine: 41, endLine: 41 })]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(results[0]!.findings[0]!.startLine).toBe(41);
    expect(engine.lastCounts?.dropped.beyondDiffLength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Deduplication, in a scope where a line number alone is ambiguous
// ---------------------------------------------------------------------------

describe('deduplication across a pull request', () => {
  it("does not merge two files' findings that share line numbers", async () => {
    const { provider } = providerReturning(
      payload([
        finding({ path: 'src/limit.ts', startLine: 9, endLine: 9 }),
        finding({ path: 'src/budget.ts', startLine: 9, endLine: 9 }),
      ]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);
    const kept = results.flatMap((r) => r.findings);

    expect(kept).toHaveLength(2);
    expect(kept.map((f) => f.path)).toEqual(['src/limit.ts', 'src/budget.ts']);
  });

  it('merges two lanes on the same file and overlapping range, and records the agreement', async () => {
    const seen = payload([finding({ path: 'src/limit.ts', startLine: 9, endLine: 10 })]);
    const { provider } = providerReturning(seen, seen);
    const engine = new LLMReviewEngine(provider, { lanes: ['security', 'architecture'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);
    const kept = results.flatMap((r) => r.findings);

    expect(kept).toHaveLength(1);
    expect(kept[0]!.agreement).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

describe('the pull request budget', () => {
  it('keeps the highest scoring findings and counts the rest as capped', async () => {
    // Three findings in one lane, none of them a duplicate of another. The second is grounded, quotes added code,
    // names a symbol and proposes a change; the third is outside the added lines but still names a symbol and proposes
    // one; the first points at a line the diff never showed and offers no replacement, so it scores lowest of the three
    // on every term except severity.
    const { provider } = providerReturning(
      payload([
        finding({
          path: 'src/limit.ts',
          startLine: 300,
          endLine: 301,
          title: 'Something to check',
          description: 'This region needs a second look.',
          suggestion: null,
        }),
        finding({
          path: 'src/limit.ts',
          startLine: 9,
          endLine: 10,
          title: 'retries copies limit',
          description: 'const retries = limit copies the limit, so retries inherits it.',
          suggestion: 'Give retries its own constant.',
        }),
        finding({
          path: 'src/limit.ts',
          startLine: 11,
          endLine: 11,
          title: 'Margin',
          description: 'The margin is computed by hand.',
        }),
      ]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET], {
      maxFindingsPerPullRequest: 2,
    });

    expect(results[0]!.findings).toHaveLength(2);
    // **The one at line 300 is the one that goes**, because it names a line the pull request never showed and the
    // budget is filled by the order rather than by the model's position in the array.
    expect(results[0]!.findings.map((f) => f.startLine)).toEqual([9, 11]);
    expect(engine.lastCounts?.dropped.capped).toBe(1);
  });

  it('says the budget and every path in the prompt, because a budget the model cannot read is not a budget', async () => {
    const { provider, prompts } = providerReturning(payload([]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    await engine.reviewPullRequest([LIMIT, BUDGET], { maxFindingsPerPullRequest: 7 });

    const [prompt] = prompts;
    expect(prompt).toContain('at most 7 findings');
    expect(prompt).toContain('src/limit.ts');
    expect(prompt).toContain('src/budget.ts');
  });

  it('leaves the per-file path without a budget of its own', async () => {
    const { provider } = providerReturning(payload([finding({ startLine: 1, endLine: 12 })]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewDiff(
      {
        filePath: 'src/limit.ts',
        oldHash: 'a',
        newHash: 'b',
        ranges: [{ oldStart: 1, oldEnd: 12, newStart: 1, newEnd: 12, changeType: 'modified' }],
        changeType: 'modified',
      },
      LIMIT.diffText,
    );

    // **No `path` is required and none is invented**: the file is the argument, so a finding that carries no path is
    // still a finding about that file.
    expect(results[0]!.findings).toHaveLength(1);
    expect(results[0]!.findings[0]!.path).toBeUndefined();
    expect(engine.lastCounts?.dropped.missingPath).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The shapes a caller can hand over that are not the happy path
// ---------------------------------------------------------------------------

describe('a pull request the caller could not split', () => {
  it('reviews nothing without spending a lane, and says so in its counters', async () => {
    const { provider, prompts } = providerReturning(payload([finding({ path: 'src/limit.ts' })]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security', 'architecture'] });

    const results = await engine.reviewPullRequest([]);

    expect(results).toEqual([]);
    expect(prompts).toEqual([]);
    expect(engine.lastCounts).toEqual({
      parsed: 0,
      kept: 0,
      dropped: {
        invalidLine: 0,
        beyondDiffLength: 0,
        missingPath: 0,
        unknownPath: 0,
        capped: 0,
        kept: 0,
        total: 0,
      },
    });
  });

  it('calls a one-file pull request by its own name, in the singular', async () => {
    const { provider, prompts } = providerReturning(payload([finding({ path: 'src/limit.ts' })]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    await engine.reviewPullRequest([LIMIT]);

    // **One file is not a plural**, and a prompt that says "1 files in one diff" is a prompt a model reads as a template
    // it can ignore. The label is also the path itself rather than a summary of a list of one.
    expect(prompts[0]).toContain('Pull request: 1 file in one diff');
    expect(prompts[0]).not.toContain('1 files');
  });

  it('accepts a path the model spellt with the diff prefix or a leading dot, and stores the diff spelling', async () => {
    const { provider } = providerReturning(
      payload([
        finding({ path: 'b/src/limit.ts', startLine: 9, endLine: 9 }),
        finding({ path: './src/budget.ts', startLine: 41, endLine: 41 }),
      ]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    // **Both are the same file the diff showed**, so neither is a mistake worth dropping - and **both are stored the way
    // the repository writes them**, because a comment's path is used to anchor a line.
    expect(results[0]!.findings.map((f) => f.path)).toEqual(['src/limit.ts', 'src/budget.ts']);
    expect(engine.lastCounts?.dropped.unknownPath).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The three answers a path can be that are not a path
// ---------------------------------------------------------------------------

describe('a path field the model filled in badly', () => {
  it('treats an empty string as no path, not as the wrong file', async () => {
    const { provider } = providerReturning(payload([finding({ path: '' })]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(engine.lastCounts?.dropped.missingPath).toBe(1);
    expect(engine.lastCounts?.dropped.unknownPath).toBe(0);
  });

  it('treats a number in the path field as no path, because the parser refuses to carry it', async () => {
    const { provider } = providerReturning(payload([finding({ path: 42 })]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    await engine.reviewPullRequest([LIMIT, BUDGET]);

    // **`parseLLMResponse` passes a path through only when it is a string**, so a number never reaches the engine as a
    // path and is counted as the finding that failed to say which file it meant.
    expect(engine.lastCounts?.dropped.missingPath).toBe(1);
  });
});

describe('a file whose section carries no hunk', () => {
  it('counts nothing, because an unknown extent is not a finding about the finding', async () => {
    // A pure rename or a mode change has a `diff --git` header and no `@@` line, so there is no evidence either way and
    // the honest answer is silence rather than a drop.
    const renamed = {
      path: 'src/renamed.ts',
      diffText: [
        'diff --git a/src/renamed.ts b/src/renamed.ts',
        'similarity index 100%',
        'rename from src/old.ts',
        'rename to src/renamed.ts',
      ].join('\n'),
    };
    const { provider } = providerReturning(
      payload([finding({ path: 'src/renamed.ts', startLine: 900, endLine: 901 })]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([renamed]);

    expect(results[0]!.findings).toHaveLength(1);
    expect(engine.lastCounts?.dropped.beyondDiffLength).toBe(0);
  });

  it('rights an inverted range inside its own file and keeps it', async () => {
    const { provider } = providerReturning(
      payload([finding({ path: 'src/limit.ts', startLine: 11, endLine: 9 })]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(results[0]!.findings[0]!.startLine).toBe(9);
    expect(engine.lastCounts?.dropped.beyondDiffLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The contract, called directly, because a caller can build one too
// ---------------------------------------------------------------------------

describe('the contract a caller can render for itself', () => {
  const base = {
    diffContent: 'diff --git a/src/a.ts b/src/a.ts',
    filePath: 'src/a.ts',
    changeType: 'modified',
  };

  it('defaults a pull-request contract that names neither a budget nor its files', async () => {
    const { describeTarget, selectionContract } = await import('../../review/llm/prompts.js');

    // **A caller that says "pull request" and stops there gets a usable contract rather than a prompt with the word
    // `undefined` in it** - three findings, and an empty file list that reads as "no files", which is wrong but honest.
    const contract = selectionContract({ ...base, scope: 'pull-request' });
    expect(contract).toContain('at most 3 findings');
    expect(contract).not.toContain('undefined');
    expect(describeTarget({ ...base, scope: 'pull-request' })).toContain('0 files');
  });

  it('says "files" for more than one and carries the context a file call was given', async () => {
    const { describeTarget, selectionContract } = await import('../../review/llm/prompts.js');

    expect(describeTarget({ ...base, scope: 'pull-request', paths: ['a.ts', 'b.ts'] })).toContain(
      '2 files',
    );
    const fileContract = describeTarget({ ...base, fileContext: 'import x from "y";' });
    expect(fileContract).toContain('File: src/a.ts');
    expect(fileContract).toContain('File context:\nimport x from "y";');
    expect(selectionContract(base)).toContain('At most 3 findings per file');
  });
});

describe('a hunk header that states a start and no count', () => {
  it('reads one line, as the format says it does', async () => {
    // `@@ -7 +7 @@` is a one-line hunk: git omits the count when it is one. **Reading it as zero lines would make the
    // only line it shows unjudgeable**, and reading it as unbounded would accept everything after it.
    const single = {
      path: 'src/limit.ts',
      diffText: [
        'diff --git a/src/limit.ts b/src/limit.ts',
        '--- a/src/limit.ts',
        '+++ b/src/limit.ts',
        '@@ -7 +7 @@',
        '-const limit = 10;',
        '+const limit = 20;',
      ].join('\n'),
    };
    const { provider } = providerReturning(
      payload([
        finding({ path: 'src/limit.ts', startLine: 7, endLine: 7 }),
        finding({
          path: 'src/limit.ts',
          startLine: 9,
          endLine: 9,
          title: 'Two lines below it',
          description: 'A different claim about a line the hunk does not show.',
        }),
      ]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([single]);

    expect(results[0]!.findings).toHaveLength(2);
    // **The one on line 7 is inside the hunk and the one on line 9 is not**, so exactly one hint is counted as outside.
    expect(engine.lastCounts?.dropped.beyondDiffLength).toBe(1);
  });
});

describe('a path quoted, absolute, or answered by a lane that failed', () => {
  it('strips the quoting git applies and a leading slash, because both name the file the diff showed', async () => {
    const { provider } = providerReturning(
      payload([
        finding({ path: '"src/limit.ts"', startLine: 9, endLine: 9 }),
        finding({ path: '/src/budget.ts', startLine: 41, endLine: 41, title: 'A different claim' }),
      ]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(results[0]!.findings.map((f) => f.path)).toEqual(['src/limit.ts', 'src/budget.ts']);
    expect(engine.lastCounts?.dropped.unknownPath).toBe(0);
  });

  it('fills the budget from the lanes that answered, and says nothing about the one that did not', async () => {
    // **A lane that throws is a lane with no findings, not a pull request with no review**, and the budget is spent
    // across the lanes that did answer.
    const { provider } = providerReturning(
      payload([finding({ path: 'src/limit.ts', startLine: 9 })]),
    );
    let call = 0;
    const flaky = {
      ...provider,
      complete: async (prompt: string) => {
        call += 1;
        if (call === 2) throw new Error('the provider refused the second lane');
        return provider.complete(prompt);
      },
    };
    const engine = new LLMReviewEngine(flaky, {
      lanes: ['security', 'architecture'],
      parallel: false,
    });

    const results = await engine.reviewPullRequest([LIMIT, BUDGET], {
      maxFindingsPerPullRequest: 1,
    });

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.find((r) => !r.success)?.error).toContain('refused');
    expect(engine.lastCounts?.kept).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The diff a pull request is allowed to show
// ---------------------------------------------------------------------------

describe('a pull request larger than the diff budget', () => {
  /** A section of a given path whose text is long enough to be clipped. */
  const long = (path: string, lines: number) => ({
    path,
    diffText: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,1 +1,${lines} @@`,
      ...Array.from({ length: lines }, (_, at) => `+const value${at} = ${at};`),
    ].join('\n'),
  });

  it('shows every file something rather than showing the first one perfectly', async () => {
    const sections = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => long(path, 120));
    const { provider, prompts } = providerReturning(payload([]));
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      maxDiffLengthPerPullRequest: 4000,
    });

    await engine.reviewPullRequest(sections);

    // **The default `maxDiffLength` kept the first four thousand characters and the last four thousand**, which on a
    // pull request of four files is the first one and part of the last. **Each of the four has to be named in the
    // prompt it is reviewed from**, or the review is of one file wearing a pull request's name.
    for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      expect(prompts[0]).toContain(path);
    }
  });

  it('says which file was clipped and by how much, because silence reads as absence', async () => {
    const sections = [long('a.ts', 400), long('b.ts', 10)];
    const { provider, prompts } = providerReturning(payload([]));
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      maxDiffLengthPerPullRequest: 3000,
    });

    await engine.reviewPullRequest(sections);

    expect(prompts[0]).toMatch(/\[\d+ characters of a\.ts not shown\]/);
    // **The small file is shown whole**, because the share the large one did not need went to the one that did.
    expect(prompts[0]).not.toContain('characters of b.ts not shown');
  });

  it('shows a pull request that fits in one piece, with no annotation at all', async () => {
    const { provider, prompts } = providerReturning(payload([]));
    const engine = new LLMReviewEngine(provider, {
      lanes: ['security'],
      maxDiffLengthPerPullRequest: 100_000,
    });

    await engine.reviewPullRequest([long('a.ts', 5), long('b.ts', 5)]);

    expect(prompts[0]).not.toContain('not shown');
  });
});

describe('a renamed file, and the two names a diff gives it', () => {
  const renamedSection = {
    path: 'src/new-name.ts',
    diffText: [
      'diff --git a/src/old-name.ts b/src/new-name.ts',
      'similarity index 90%',
      'rename from src/old-name.ts',
      'rename to src/new-name.ts',
      '--- a/src/old-name.ts',
      '+++ b/src/new-name.ts',
      '@@ -4,2 +4,3 @@',
      ' const kept = 1;',
      '+const added = 2;',
    ].join('\n'),
  };

  it('accepts the left-hand name as the same file and stores the right-hand one', async () => {
    const { provider } = providerReturning(
      payload([finding({ path: 'src/old-name.ts', startLine: 5, endLine: 5 })]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    const results = await engine.reviewPullRequest([renamedSection]);

    // **One file, two names.** A finding that used the name from before the rename is about the file the pull request
    // changed, so it is kept - **and it is stored under the name the file has now**, which is where a comment goes.
    expect(results[0]!.findings).toHaveLength(1);
    expect(results[0]!.findings[0]!.path).toBe('src/new-name.ts');
    expect(engine.lastCounts?.dropped.unknownPath).toBe(0);
  });

  it('keeps a sample of what each rule removed, with the path the model claimed', async () => {
    const { provider } = providerReturning(
      payload([finding({ path: 'src/nowhere.ts' }), finding({ path: '' })]),
    );
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    await engine.reviewPullRequest([renamedSection]);

    // **A count that cannot be explained is a count that gets explained by whoever writes the report**, so the first
    // few findings a rule removed travel with the counts.
    expect(engine.lastCounts?.dropped.samples).toEqual([
      { path: 'src/nowhere.ts', title: 'Retries are derived from the limit', rule: 'unknownPath' },
      { path: '', title: 'Retries are derived from the limit', rule: 'missingPath' },
    ]);
  });
});

describe('two lanes saying the same sentence in the same file', () => {
  /** One file, two hunks far apart, so a claim can be made twice at two distances. */
  const spread = {
    path: 'src/limit.ts',
    diffText: [
      'diff --git a/src/limit.ts b/src/limit.ts',
      '--- a/src/limit.ts',
      '+++ b/src/limit.ts',
      '@@ -8,2 +8,3 @@',
      ' const limit = 10;',
      '+const retries = limit;',
      '@@ -398,2 +399,3 @@',
      ' function later() {',
      '+  return limit;',
    ].join('\n'),
  };

  const claim = (startLine: number) =>
    finding({
      path: 'src/limit.ts',
      startLine,
      endLine: startLine,
      title: 'The limit is not validated',
      description: 'The limit arrives from configuration and nothing checks it before use.',
    });

  it('merges them when they are one construct apart', async () => {
    const { provider } = providerReturning(payload([claim(9)]), payload([claim(12)]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security', 'maintainability'] });

    const results = await engine.reviewPullRequest([spread]);
    const kept = results.flatMap((result) => result.findings);

    // Three lines apart, one sentence: **that is two lanes describing one defect**, and the agreement is worth keeping.
    expect(kept).toHaveLength(1);
    expect(kept[0]!.agreement).toBe(2);
  });

  it('keeps both when the same sentence describes two different places', async () => {
    const { provider } = providerReturning(payload([claim(9)]), payload([claim(400)]));
    const engine = new LLMReviewEngine(provider, { lanes: ['security', 'maintainability'] });

    const results = await engine.reviewPullRequest([spread]);
    const kept = results.flatMap((result) => result.findings);

    // **Four hundred lines apart and the same wording is a shared vocabulary, not a shared defect** - and the first
    // pull-request run merged half its surviving findings this way, leaving 6.6 comments for a pull request whose
    // budget allowed 16.
    expect(kept).toHaveLength(2);
    expect(kept.map((f) => f.startLine).sort((a, b) => a - b)).toEqual([9, 400]);
  });
});

describe('more drops than the sample keeps', () => {
  it('counts every one and keeps the first twenty, because a sample is not a log', async () => {
    const many = Array.from({ length: 25 }, (_, at) =>
      finding({ path: `src/missing-${at}.ts`, title: `Claim ${at}` }),
    );
    const { provider } = providerReturning(payload(many));
    const engine = new LLMReviewEngine(provider, { lanes: ['security'] });

    await engine.reviewPullRequest([LIMIT, BUDGET]);

    expect(engine.lastCounts?.dropped.unknownPath).toBe(25);
    expect(engine.lastCounts?.dropped.samples).toHaveLength(20);
  });
});
