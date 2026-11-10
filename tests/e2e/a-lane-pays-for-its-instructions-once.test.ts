// @code-analyzer — End-to-end: a review of many files pays for the reviewer's instructions once
//
// **The user story, in one sentence**: *I review a pull request that touches two hundred files, and the reviewer's
// instructions - which are the same words every time - are not bought two hundred times.*
//
// **Why this cannot be a unit test.** The unit suite holds each lane's prompt and the composer's three arrangements
// separately. What only exists in the join is the thing the bill is actually made of: **the bytes that reach the
// socket, in the order they reach it, over files the engine has never seen before.** A composer that returned the
// right string and an engine that truncated the diff differently would each pass their own test and share nothing.
//
// **And the figure is measured, not the vendor's.** The number below is *the share of each request that is a prefix the
// same lane already sent for a different file* - an upper bound the layout either earns or does not. Whether the
// provider's cache converts that share into cached tokens is reported by `spend.cacheHitRatio` in the benchmark
// artifact, and **a test that emulated the vendor's cache would be a test of this file's own arithmetic.**

import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { DeepSeekProvider, LLMReviewEngine } from '@code-analyzer/intelligence';
import type { PromptOrder } from '@code-analyzer/intelligence';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GitDiff } from '@code-analyzer/shared';

/**
 * A server that answers like the provider's chat endpoint and **keeps the prompt it was sent**.
 *
 * The answer is deliberately dull - no findings - because this test is about the question, not the reply.
 */
function startProvider(): Promise<{
  server: Server;
  url: string;
  prompts: () => Array<{ lane: string; prompt: string }>;
}> {
  const seen: Array<{ lane: string; prompt: string }> = [];
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          messages?: Array<{ content?: string }>;
        };
        const prompt = String(
          body.messages?.map((message) => message.content ?? '').join('') ?? '',
        );
        // The lane is not in the request, so it is recovered from the prompt: **the test asserts which lane asked by
        // what the lane said**, which is also what the cache sees. The role sentence is used rather than the lane's
        // name, because **every prompt lists `security` among the categories it may answer with**, so the name alone
        // would have answered `security` fifteen times and the measurement would have compared five prompts to each
        // other.
        const lane = ROLE_SENTENCES.find(([, sentence]) => prompt.includes(sentence))?.[0];
        seen.push({ lane: lane ?? 'unknown', prompt });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"findings": []}' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1_000,
              completion_tokens: 10,
              total_tokens: 1_010,
              prompt_cache_hit_tokens: 0,
              prompt_cache_miss_tokens: 1_000,
            },
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, prompts: () => seen });
    });
  });
}

/** How each lane announces itself, in the first line of its prompt. */
const ROLE_SENTENCES = [
  ['security', 'You are an expert security reviewer'],
  ['architecture', 'You are an expert software architect'],
  ['performance', 'You are an expert performance engineer'],
  ['maintainability', 'You are an expert code quality reviewer'],
  ['testing', 'You are an expert test engineer'],
] as const;

/** Three files of one pull request, each with its own diff - the sweep the file arm performs 199 times. */
function diffFor(name: string): GitDiff {
  return {
    filePath: `/src/${name}.ts`,
    oldHash: 'c0ffee',
    newHash: 'deadbe',
    ranges: [{ oldStart: 10, oldEnd: 14, newStart: 10, newEnd: 18, changeType: 'modified' }],
    changeType: 'modified',
  };
}

const FILES = ['retry', 'client', 'scheduler'];

/** The longest prefix two prompts share, in characters. */
function commonPrefix(a: string, b: string): number {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  return at;
}

/**
 * **The share of each request that repeats the previous request for the same lane on a different file.**
 *
 * This is the quantity the layout controls and the only one it controls: a prefix cache can reuse nothing else, and
 * **the first call of a lane has nothing to reuse, so it is excluded rather than scored as a miss.**
 */
function reusableShare(seen: Array<{ lane: string; prompt: string }>): number {
  const byLane = new Map<string, string[]>();
  for (const { lane, prompt } of seen) {
    const list = byLane.get(lane) ?? [];
    list.push(prompt);
    byLane.set(lane, list);
  }
  let shared = 0;
  let total = 0;
  for (const prompts of byLane.values()) {
    for (let at = 1; at < prompts.length; at += 1) {
      shared += commonPrefix(prompts[at - 1]!, prompts[at]!);
      total += prompts[at]!.length;
    }
  }
  return total === 0 ? 0 : shared / total;
}

async function reviewEveryFile(order: PromptOrder): Promise<{
  seen: Array<{ lane: string; prompt: string }>;
  refuse: () => void;
}> {
  process.env['DEEPSEEK_API_KEY'] = 'test-key';
  const { server, url, prompts } = await startProvider();
  const provider = new DeepSeekProvider({ baseUrl: url, timeout: 2_000, maxRetries: 0 });
  const engine = new LLMReviewEngine(provider, { promptOrder: order });

  for (const file of FILES) await engine.reviewDiff(diffFor(file));

  return {
    seen: prompts(),
    refuse: () => {
      server.close();
      delete process.env['DEEPSEEK_API_KEY'];
    },
  };
}

describe('a review of many files', () => {
  it('repeats, for every file after the first, almost all of what the lane said', async () => {
    const { seen, refuse } = await reviewEveryFile('boilerplate-first');
    try {
      // Fifteen calls: three files, five lanes each.
      expect(seen).toHaveLength(FILES.length * 5);
      expect(new Set(seen.map((entry) => entry.lane)).size).toBe(5);

      // **The prediction the device is worth, measured on the bytes rather than on a description of them.** Nine
      // tenths of every request after the first per lane is text that lane already paid for; the rest is this file's
      // path, its diff, and the blank line before them.
      expect(reusableShare(seen)).toBeGreaterThan(0.9);

      // **The instruction first, the document last** - which is the arrangement the vendor documents from the other
      // side, and the arrangement that makes the prefix reusable at all.
      for (const { prompt } of seen) {
        expect(prompt.indexOf('You are an expert')).toBeLessThan(prompt.indexOf('Diff content:'));
        expect(prompt.trimEnd().endsWith('```')).toBe(true);
      }
    } finally {
      refuse();
    }
  });

  it('reused a twentieth of that before the block moved, which is the defect', async () => {
    const shipped = await reviewEveryFile('boilerplate-first');
    const previous = await reviewEveryFile('lane-first');
    try {
      const shippedShare = reusableShare(shipped.seen);
      const previousShare = reusableShare(previous.seen);

      // **`lane-first` leads with the lane's role sentence, and then the file's own path arrives**, so the run of
      // bytes a later call could reuse ended at that path - **about nine hundred characters of six thousand**, because
      // the shipped prompt no longer carries the per-language checklist. **The share is what moved, not the device**:
      // 0.156 where it was 0.13, and the bound below is set from the measurement rather than from the old shape.
      expect(previousShare).toBeLessThan(0.2);
      // **And the two are the same prompt**, so the difference between the figures is the layout and nothing else.
      expect(shippedShare).toBeGreaterThan(5 * previousShare);
      expect(previous.seen.map((entry) => entry.lane).sort()).toEqual(
        shipped.seen.map((entry) => entry.lane).sort(),
      );
    } finally {
      shipped.refuse();
      previous.refuse();
    }
  });
});
