/**
 * @fileoverview What the model is told, in one place, so that "the agent was given no instructions" is a testable claim.
 *
 * **This module exists because the first two L4 runs measured a model that had been told nothing.** The runner built a
 * system prompt — role, project id, "call the most appropriate tool" — and then passed only the user's sentence to
 * `completeWithTools`, which sends a single `user` message. The constant was defined and never read, which is the same
 * defect as an index that is computed and never stored: the measurement ran, produced a number, and the number was
 * about a question nobody asked. The histogram is what said so — 205 of 360 steps chose `list_projects`, which is what
 * a model does with fifty-one tools and no instruction.
 *
 * Moving the text here makes it reachable from a test, and the tests below assert the three things a prompt has to
 * carry: what the model is, which project it is in, and what it was asked.
 */

import { FIXTURE } from './tasks.js';

import type { AgenticTask } from './tasks.js';

/**
 * The instruction that precedes every request.
 *
 * **Not a persona.** It states the contract — use the tools, use this project id, say so when nothing fits — and stops.
 * A prompt that described the product would be a prompt that did part of the task, and the thing being measured is
 * whether the *catalog* is legible, not whether a paragraph of marketing is.
 */
export const AGENT_INSTRUCTION = [
  'You are a code-analysis agent. A developer has typed a request and you answer it by calling one of the tools you',
  `have been given. The project is indexed under the id "${FIXTURE.projectId}"; use that id wherever a call takes one.`,
  'Call the single most appropriate tool. If no tool can do what was asked, say so in one sentence and call nothing.',
  'Never invent a tool name, and never answer from memory about code you have not read.',
].join(' ');

/** The first turn: the instruction, then the sentence a developer typed. */
export function firstTurn(task: AgenticTask): string {
  return `${AGENT_INSTRUCTION}\n\nRequest: ${task.prompt}`;
}

/**
 * A later turn in a chain: the request, what was called, and what came back.
 *
 * **The result is truncated at a stated width rather than in silence.** A tool's output can be tens of kilobytes, and a
 * prompt that silently dropped the tail would make the model's second answer a function of the truncation as well as of
 * the request. The cut is announced in the text the model reads.
 */
export function nextTurn(
  task: AgenticTask,
  previous: { tool: string; detail: string; limit?: number },
): string {
  const limit = previous.limit ?? 1200;
  const detail =
    previous.detail.length > limit
      ? `${previous.detail.slice(0, limit)}\n… (truncated)`
      : previous.detail;
  return [
    AGENT_INSTRUCTION,
    '',
    `Request: ${task.prompt}`,
    '',
    `You already called \`${previous.tool}\` and it returned:`,
    '```',
    detail,
    '```',
    'Continue with the request. Call the next tool it needs, or answer in one sentence if it is complete.',
  ].join('\n');
}
