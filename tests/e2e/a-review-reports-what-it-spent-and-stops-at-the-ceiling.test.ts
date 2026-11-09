// @code-analyzer — End-to-end: a review says what it spent, and stops when it reaches the ceiling it was given
//
// **The user story, in one sentence**: *I run the reviewer on a change under a spending limit, it tells me what the
// review cost and which part cost it, and when the limit is reached it refuses the next call instead of quietly
// spending.*
//
// **Why this cannot be a unit test.** The unit suites hold the ledger's arithmetic and the engine's propagation
// separately. What only breaks in the join is the identity between three figures that are produced in three places:
// **the price the provider attached to a completion, the entry the ledger recorded, and the total the engine reports.**
// A bill assembled from any two of those and not the third is a bill with a second opinion in it, and this project has
// already published one of those - a coverage badge, hand-written, forty points below its gate.
//
// **And the ceiling is only a ceiling if the request was not sent.** The assertion is therefore a count of requests the
// server actually received, not of calls that threw.

import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { CostLedger, DeepSeekProvider, LLMReviewEngine } from '@code-analyzer/intelligence';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GitDiff } from '@code-analyzer/shared';

/** 2026-11-10T02:00Z: inside the vendor's peak window, so a price in this test can be checked against the table. */
const PEAK = new Date('2026-11-10T02:00:00Z');

/** The change under review: a retry loop that drops the timeout, which is a defect a reviewer should find. */
const DIFF: GitDiff = {
  filePath: '/src/retry.ts',
  oldHash: 'c0ffee',
  newHash: 'deadbe',
  ranges: [{ oldStart: 10, oldEnd: 14, newStart: 10, newEnd: 18, changeType: 'modified' }],
  changeType: 'modified',
};

/**
 * A server that answers like the provider's chat endpoint, reporting the cache split.
 *
 * **3 000 prompt tokens of which 2 000 hit the cache, and 200 completion tokens** - the size of a lane call over a real
 * diff, and small enough that the arithmetic below can be checked on paper.
 */
function startProvider(): Promise<{ server: Server; url: string; requests: () => number }> {
  let requests = 0;
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      req.on('data', () => {
        // The body is not read for content: this test is about what the client does with the answer.
      });
      req.on('end', () => {
        requests += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    findings: [
                      {
                        startLine: 12,
                        endLine: 14,
                        severity: 'high',
                        category: 'correctness',
                        title: 'The retry drops the request timeout',
                        description:
                          'The new call reads no timeout, so a hung socket is retried forever.',
                        suggestion: 'Pass the timeout through: fetch(url, { timeout }).',
                      },
                    ],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 3_000,
              completion_tokens: 200,
              total_tokens: 3_200,
              prompt_cache_hit_tokens: 2_000,
              prompt_cache_miss_tokens: 1_000,
            },
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, requests: () => requests });
    });
  });
}

/**
 * What one lane call costs at peak, by hand, from the table in `cost.ts`:
 * `2 000 × 0.006 + 1 000 × 0.3 + 200 × 1.2` per million tokens.
 */
const COST_PER_LANE_USD = (2_000 * 0.006 + 1_000 * 0.3 + 200 * 1.2) / 1_000_000;

describe('a review under a spending limit', () => {
  it('reports one figure that the provider, the ledger and the engine all agree on', async () => {
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    const { server, url } = await startProvider();
    try {
      const ledger = new CostLedger();
      const provider = new DeepSeekProvider({
        baseUrl: url,
        timeout: 2_000,
        maxRetries: 0,
        ledger,
        now: () => PEAK,
      });
      const engine = new LLMReviewEngine(provider, { parallel: false });

      const results = await engine.reviewDiff(DIFF);
      const summary = engine.costSummary();
      const totals = ledger.totals();

      // Five lanes, five calls, five prices that agree with the table and with each other.
      expect(results).toHaveLength(5);
      expect(results.every((result) => result.success)).toBe(true);
      expect(summary.calls).toBe(5);
      expect(summary.costUsd).toBeCloseTo(5 * COST_PER_LANE_USD, 10);
      expect(totals.costUsd).toBeCloseTo(summary.costUsd, 10);
      expect(totals.calls).toBe(summary.calls);
      expect(totals.promptTokens).toBe(summary.promptTokens);

      // The per-lane bill the ledger keeps, which is the question an account balance cannot answer.
      expect(
        ledger
          .byTag()
          .map((group) => group.tag)
          .sort(),
      ).toEqual([
        'review:architecture',
        'review:maintainability',
        'review:performance',
        'review:security',
        'review:testing',
      ]);

      // And the artifact is auditable: a total alone cannot be checked against anything.
      const artifact = ledger.toJSON();
      expect(artifact.entries).toHaveLength(5);
      expect(artifact.entries[0]?.usage.cacheHitTokens).toBe(2_000);
      expect(artifact.totals.cacheHitRatio).toBeCloseTo(2_000 / 3_000, 10);
    } finally {
      server.close();
      delete process.env['DEEPSEEK_API_KEY'];
    }
  });

  it('refuses the next call once the ceiling is reached, and the refusal is visible in the requests', async () => {
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    const { server, url, requests } = await startProvider();
    try {
      const ledger = new CostLedger();
      // A ceiling just under two lanes: the third call must not be sent.
      const ceilingUsd = 1.99 * COST_PER_LANE_USD;
      const provider = new DeepSeekProvider({
        baseUrl: url,
        timeout: 2_000,
        maxRetries: 0,
        ledger,
        ceilingUsd,
        now: () => PEAK,
      });
      const engine = new LLMReviewEngine(provider, { parallel: false });

      const results = await engine.reviewDiff(DIFF);
      const refused = results.filter((result) => !result.success);

      expect(requests()).toBe(2);
      expect(refused).toHaveLength(3);
      expect(refused[0]?.error).toMatch(/spend ceiling reached/);
      expect(engine.costSummary().calls).toBe(2);
      expect(engine.costSummary().costUsd).toBeCloseTo(2 * COST_PER_LANE_USD, 10);
      // The lanes that did answer still produced their findings: a ceiling stops spending, not reporting.
      expect(results.filter((result) => result.success).length).toBe(2);
    } finally {
      server.close();
      delete process.env['DEEPSEEK_API_KEY'];
    }
  });
});
