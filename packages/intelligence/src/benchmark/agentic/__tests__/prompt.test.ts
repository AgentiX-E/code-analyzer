/**
 * @fileoverview What the model is told — asserted, because the first two runs were of a model that was told nothing.
 *
 * **The failure these tests exist for is not a wrong answer.** The runner built an instruction, never sent it, and
 * published a rate. A prompt is therefore data this repository checks: it must name the project the fixture was indexed
 * under, it must carry the request verbatim, and — the anti-triviality rule that the task set already lives by — it must
 * not name the tool it is supposed to be choosing.
 */

import { describe, expect, it } from 'vitest';

import { AGENT_INSTRUCTION, firstTurn, nextTurn } from '../prompt.js';
import { AGENTIC_TASKS, FIXTURE } from '../tasks.js';

const task = AGENTIC_TASKS.find((candidate) => candidate.class === 'chain')!;

describe('the system instruction', () => {
  it('**names the project the fixture is indexed under**', () => {
    expect(AGENT_INSTRUCTION).toContain(FIXTURE.projectId);
  });

  it('**says what to do when nothing fits, because that is a scored behaviour**', () => {
    // Twenty of the hundred tasks have no correct tool. An instruction that only says "call a tool" would make the
    // negative class a test of whether the model disobeys.
    expect(AGENT_INSTRUCTION).toMatch(/call nothing|no tool can do/i);
  });

  it('**does not name any tool**', () => {
    for (const candidate of AGENTIC_TASKS) {
      for (const step of candidate.steps) {
        for (const name of step.gold) expect(AGENT_INSTRUCTION).not.toContain(name);
      }
    }
  });
});

describe('the first turn', () => {
  const turn = firstTurn(task);

  it('**carries the instruction and the request the user typed**', () => {
    expect(turn.startsWith(AGENT_INSTRUCTION)).toBe(true);
    expect(turn).toContain(task.prompt);
  });

  it('**does not name the gold tool of the task it carries**', () => {
    for (const step of task.steps) {
      for (const name of step.gold) expect(turn).not.toContain(name);
    }
  });
});

describe('a later turn', () => {
  it('**shows what was called and what came back**', () => {
    const turn = nextTurn(task, { tool: 'tests_for', detail: '{"found": 2}' });
    expect(turn).toContain('tests_for');
    expect(turn).toContain('{"found": 2}');
    expect(turn).toContain(task.prompt);
  });

  it('**announces a truncation instead of dropping the tail in silence**', () => {
    const turn = nextTurn(task, { tool: 'search_code', detail: 'x'.repeat(5000), limit: 100 });
    expect(turn).toContain('… (truncated)');
    expect(turn.length).toBeLessThan(1000);
  });

  it('**leaves a short result whole**', () => {
    const turn = nextTurn(task, { tool: 'search_code', detail: 'short' });
    expect(turn).not.toContain('truncated');
  });
});
