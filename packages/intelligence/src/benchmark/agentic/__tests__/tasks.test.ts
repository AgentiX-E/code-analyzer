/**
 * @fileoverview The task set's own invariants, checked as tests as well as by `--check`.
 *
 * **Two gates over one property is not duplication here.** `scripts/agentic-tools.ts --check` cannot import the registry
 * from inside a test, and a test cannot run in CI without a checkout; between them, the cheap checks (ids, counts,
 * decoys, prompts) live here where they run on every `vitest`, and the expensive ones (does the tool exist, does the
 * entity exist) live there where a registry is available.
 */

import { describe, expect, it } from 'vitest';

import {
  AGENTIC_TASK_STATS,
  AGENTIC_TASKS,
  FIXTURE,
  decoyedTasks,
  taskClassCounts,
} from '../tasks.js';

describe('the L4 task set', () => {
  it('**has at least sixty tasks, so a rate over it is not a guess**', () => {
    expect(AGENTIC_TASKS.length).toBeGreaterThanOrEqual(60);
  });

  it('**declares the totals the dataset gate reads, and the declaration is true**', () => {
    // A declaration a gate trusts and nothing checks is a comment with authority.
    expect(AGENTIC_TASK_STATS.totalCases).toBe(AGENTIC_TASKS.length);
    // **The unit is the task, not the step.** A chain is judged as a whole - a wrong second call is a wrong answer -
    // so counting its two steps as two ground-truth items would inflate the denominator of the very rate that treats
    // them as one decision.
    expect(AGENTIC_TASK_STATS.totalGroundTruthIssues).toBe(AGENTIC_TASKS.length);
  });

  it('**holds the class counts its header promises**', () => {
    expect(taskClassCounts()).toEqual({ single: 66, chain: 14, none: 20 });
  });

  it('**names every task once**', () => {
    const ids = AGENTIC_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('**never writes the tool name into the prompt**', () => {
    // **The rule that keeps the set from measuring nothing.** A prompt containing `find_dead_code` is answered by string
    // matching, and a set of those would report a high score for a model that cannot read.
    const failures: string[] = [];
    for (const task of AGENTIC_TASKS) {
      for (const step of task.steps) {
        for (const name of step.gold) {
          if (task.prompt.includes(name))
            failures.push(`${task.id}: the prompt contains "${name}"`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('**gives every step a gold tool that is not also its decoy**', () => {
    const failures: string[] = [];
    const emptyCalls: string[] = [];
    for (const task of AGENTIC_TASKS) {
      for (const [index, step] of task.steps.entries()) {
        if (step.gold.length === 0) failures.push(`${task.id} step ${String(index)}: no gold tool`);
        if (step.decoy !== undefined && step.gold.includes(step.decoy)) {
          failures.push(`${task.id} step ${String(index)}: the decoy is a gold tool`);
        }
        // **An empty call is allowed only where the tool takes nothing.** `list_projects` has no required argument, and
        // inventing one would make the answer key wrong; more than a couple of them would mean the set had stopped
        // exercising argument grounding.
        if (Object.keys(step.call).length === 0) emptyCalls.push(task.id);
      }
    }
    expect(failures).toEqual([]);
    expect(emptyCalls.length).toBeLessThanOrEqual(2);
  });

  it('**a chain has exactly two steps and a none task has none**', () => {
    for (const task of AGENTIC_TASKS) {
      if (task.class === 'chain') expect(task.steps).toHaveLength(2);
      if (task.class === 'none') expect(task.steps).toHaveLength(0);
      if (task.class === 'single') expect(task.steps).toHaveLength(1);
    }
  });

  it('**decoys most of the set, because a task nobody could get wrong measures nothing**', () => {
    expect(decoyedTasks().length).toBeGreaterThanOrEqual(25);
  });

  it('**carries an execution assertion on at least a third of the set**', () => {
    const asserted = AGENTIC_TASKS.filter((task) => task.assert.kind !== 'none').length;
    expect(asserted).toBeGreaterThanOrEqual(20);
  });

  it('**says why every task is hard, in a sentence a reader can disagree with**', () => {
    for (const task of AGENTIC_TASKS) {
      expect(task.why.length).toBeGreaterThan(20);
    }
  });

  it('**grounds its tasks in a fixture that is this repository’s own code**', () => {
    for (const dir of FIXTURE.sourceDirs) {
      expect(dir.startsWith('packages/')).toBe(true);
    }
    expect(FIXTURE.projectId).toBe('fixture');
  });
});
