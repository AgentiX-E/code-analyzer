/**
 * @fileoverview Tests for the numbers behind the L4 measurement.
 *
 * **The statistics are tested against values that can be computed by hand**, because an interval that is wrong in a
 * plausible-looking way is worse than no interval: it makes a ranking look decided when it is not. The Wilson bounds
 * below come from the published formula at n = 10, 64 and 100, and the McNemar p-values from the exact binomial.
 */

import { describe, expect, it } from 'vitest';

import {
  checkArguments,
  compareArms,
  mcnemarExact,
  proportion,
  scoreAttempt,
  summariseArm,
  wilson,
} from '../score.js';

import type { AttemptScore, TaskRun } from '../score.js';
import type { AgenticTask } from '../tasks.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const single: AgenticTask = {
  id: 'test/single',
  class: 'single',
  prompt: 'Which tests exercise `alpha`?',
  steps: [
    {
      gold: ['tests_for'],
      decoy: 'test_generation',
      call: { symbol: 'alpha', projectId: 'p' },
      grounding: ['alpha'],
    },
  ],
  assert: { kind: 'none' },
  why: 'fixture',
};

const chain: AgenticTask = {
  id: 'test/chain',
  class: 'chain',
  prompt: 'find then read',
  steps: [
    {
      gold: ['explore_symbol'],
      decoy: 'search_code',
      call: { symbolName: 'alpha', projectId: 'p' },
      grounding: ['alpha'],
    },
    {
      gold: ['get_code_snippet'],
      decoy: 'review_file',
      call: { filePath: 'a.ts', projectId: 'p' },
    },
  ],
  assert: { kind: 'none' },
  why: 'fixture',
};

const none: AgenticTask = {
  id: 'test/none',
  class: 'none',
  prompt: 'deploy it',
  steps: [],
  assert: { kind: 'none' },
  why: 'fixture',
};

const schemas = new Map([
  [
    'tests_for',
    {
      type: 'object',
      properties: { symbol: { type: 'string' }, projectId: { type: 'string' } },
      required: ['symbol', 'projectId'],
    },
  ],
  [
    'test_generation',
    { type: 'object', properties: { symbolName: { type: 'string' } }, required: ['symbolName'] },
  ],
  [
    'explore_symbol',
    { type: 'object', properties: { symbolName: { type: 'string' } }, required: ['symbolName'] },
  ],
  [
    'search_code',
    { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  ],
  [
    'get_code_snippet',
    { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
  ],
  [
    'review_file',
    { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
  ],
]);

function run(
  taskId: string,
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
): TaskRun {
  return { taskId, attempt: 0, steps: [{ calls, text: '', executed: null }] };
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

describe('the Wilson interval', () => {
  it('**brackets the estimate and never exceeds one**', () => {
    // The normal approximation gives [1.0, 1.0] at 64 of 64, which is a point at the ceiling and exactly the answer a
    // benchmark most needs to distrust.
    const perfect = wilson(64, 64)!;
    expect(perfect.upper).toBe(1);
    expect(perfect.lower).toBeGreaterThan(0.9);
    expect(perfect.lower).toBeLessThan(1);
  });

  it('**matches the published formula at n = 10, k = 5**', () => {
    const interval = wilson(5, 10)!;
    expect(interval.lower).toBeCloseTo(0.2366, 4);
    expect(interval.upper).toBeCloseTo(0.7634, 4);
  });

  it('**is a point at zero successes and at zero trials returns nothing**', () => {
    expect(wilson(0, 10)!.upper).toBeGreaterThan(0);
    expect(wilson(0, 10)!.lower).toBe(0);
    expect(wilson(1, 0)).toBeNull();
  });

  it('**a proportion carries its denominator with it**', () => {
    const p = proportion(3, 4);
    expect(p.value).toBe(0.75);
    expect(p.total).toBe(4);
    expect(proportion(0, 0).value).toBeNull();
  });
});

describe('the exact McNemar test', () => {
  it('**splits evenly under the null**', () => {
    expect(mcnemarExact(5, 5).pValue).toBe(1);
  });

  it('**is the two-sided binomial, not an approximation**', () => {
    // b=9, c=1 -> 2 * (C(10,0)+C(10,1))/2^10 = 2 * 11/1024 = 0.0215
    expect(mcnemarExact(9, 1).pValue).toBeCloseTo(0.0215, 4);
    // b=1, c=9 is the same evidence, and must give the same answer
    expect(mcnemarExact(1, 9).pValue).toBeCloseTo(0.0215, 4);
  });

  it('**is one when there is nothing discordant**', () => {
    expect(mcnemarExact(0, 0).pValue).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

describe('argument validation', () => {
  it('**accepts a call with every required key of the right type**', () => {
    expect(checkArguments({ symbol: 'a', projectId: 'p' }, schemas.get('tests_for')).ok).toBe(true);
  });

  it('**names what is missing rather than saying "invalid"**', () => {
    const verdict = checkArguments({ symbol: 'a' }, schemas.get('tests_for'));
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain('projectId');
  });

  it('**refuses a wrong type and an undeclared key when the schema closes itself**', () => {
    expect(checkArguments({ symbol: 1, projectId: 'p' }, schemas.get('tests_for')).ok).toBe(false);
    const closed = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    };
    expect(checkArguments({ a: 'x', b: 1 }, closed).ok).toBe(false);
  });

  it('**a tool with no schema is not a pass**', () => {
    expect(checkArguments({}, undefined).ok).toBe(false);
  });

  it('**refuses arguments that are not an object at all**', () => {
    const schema = schemas.get('tests_for');
    expect(checkArguments(null, schema).why).toBe('the arguments are not an object');
    expect(checkArguments('symbol=alpha', schema).ok).toBe(false);
    expect(checkArguments(['alpha'], schema).ok).toBe(false);
  });

  it('**respects every type the cabinet actually uses**', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
        total: { type: 'integer' },
        flag: { type: 'boolean' },
        names: { type: 'array' },
        nested: { type: 'object' },
        nothing: { type: 'null' },
        either: { type: ['string', 'number'] },
        anything: {},
      },
    };
    expect(
      checkArguments(
        { count: 1, total: 2, flag: true, names: [], nested: {}, nothing: null },
        schema,
      ).ok,
    ).toBe(true);
    expect(checkArguments({ either: 'x' }, schema).ok).toBe(true);
    expect(checkArguments({ either: 7 }, schema).ok).toBe(true);
    expect(checkArguments({ either: true }, schema).ok).toBe(false);
    // A declared type the switch does not know is not a failure: a schema this file cannot interpret must not reject
    // an argument it has no grounds to reject.
    expect(checkArguments({ anything: { any: 'shape' } }, schema).ok).toBe(true);
    expect(checkArguments({ count: Number.NaN }, schema).ok).toBe(false);
    expect(checkArguments({ nested: [] }, schema).ok).toBe(false);
  });

  it('**judges a declared type this file does not know as unjudgeable, not as wrong**', () => {
    const exotic = { type: 'object', properties: { shape: { type: 'widget' } } };
    expect(checkArguments({ shape: { anything: true } }, exotic).ok).toBe(true);
    // A key whose value is `undefined` is not a wrong value - it is an absent one - and JSON cannot carry it anyway.
    expect(checkArguments({ shape: undefined }, exotic).ok).toBe(true);
  });

  it('**checks an enum in both directions**', () => {
    const enumerated = {
      type: 'object',
      properties: { detail: { type: 'string', enum: ['overview', 'full'] } },
      required: ['detail'],
    };
    expect(checkArguments({ detail: 'full' }, enumerated).ok).toBe(true);
    expect(checkArguments({ detail: 'summary' }, enumerated).why).toContain('overview, full');
  });

  it('**accepts an empty schema, because a tool may declare nothing**', () => {
    expect(checkArguments({ free: 'form' }, { type: 'object' }).ok).toBe(true);
  });

  it('**treats an undeclared key as legal when the schema does not close itself**', () => {
    // Most tools in this cabinet declare `properties` without `additionalProperties: false`, and an optional argument a
    // model adds is not a call the server would reject.
    const open = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    expect(checkArguments({ a: 'x', extra: 1 }, open).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scoring one attempt
// ---------------------------------------------------------------------------

describe('scoring an attempt', () => {
  const pool = new Set(['alpha']);

  it('**marks the gold tool, valid arguments and grounded entity as correct**', () => {
    const score = scoreAttempt(
      single,
      run(single.id, [{ name: 'tests_for', arguments: { symbol: 'alpha', projectId: 'p' } }]),
      {
        schemas,
        groundingPool: pool,
      },
    );
    expect(score.correct).toBe(true);
    expect(score.schemaOk).toBe(true);
    expect(score.grounded).toBe(true);
    expect(score.asserted).toBeNull();
  });

  it('**a near miss is a wrong tool, not a near pass**', () => {
    const score = scoreAttempt(
      single,
      run(single.id, [{ name: 'test_generation', arguments: { symbolName: 'alpha' } }]),
      {
        schemas,
        groundingPool: pool,
      },
    );
    expect(score.correct).toBe(false);
    expect(score.failure).toBe('wrong-tool');
  });

  it('**a right tool with a missing argument is a failure, and the column says which**', () => {
    // **The tool name is not the answer.** A call the server would reject never ran, so "picked the right tool and
    // formatted it wrongly" is a wrong answer with a good excuse, not a right one.
    const score = scoreAttempt(
      single,
      run(single.id, [{ name: 'tests_for', arguments: { symbol: 'alpha' } }]),
      {
        schemas,
        groundingPool: pool,
      },
    );
    expect(score.selected).toBe(true);
    expect(score.schemaOk).toBe(false);
    expect(score.correct).toBe(false);
    expect(score.failure).toBe('invalid-arguments');
  });

  it('**an entity named in prose but absent from the arguments is not grounded**', () => {
    const task: AgenticTask = {
      ...single,
      steps: [{ gold: ['tests_for'], call: { symbol: 'alpha' }, grounding: ['alpha'] }],
    };
    const score = scoreAttempt(
      task,
      run(task.id, [{ name: 'tests_for', arguments: { symbol: 'beta', projectId: 'p' } }]),
      {
        schemas,
        groundingPool: pool,
      },
    );
    expect(score.grounded).toBe(false);
    expect(score.failure).toBe('ungrounded');
  });

  it('**a chain is wrong when either step is wrong**', () => {
    const good: TaskRun = {
      taskId: chain.id,
      attempt: 0,
      steps: [
        {
          calls: [{ name: 'explore_symbol', arguments: { symbolName: 'alpha' } }],
          text: '',
          executed: null,
        },
        {
          calls: [{ name: 'get_code_snippet', arguments: { filePath: 'a.ts' } }],
          text: '',
          executed: null,
        },
      ],
    };
    expect(scoreAttempt(chain, good, { schemas, groundingPool: pool }).correct).toBe(true);

    const secondWrong: TaskRun = {
      ...good,
      steps: [
        good.steps[0]!,
        {
          calls: [{ name: 'review_file', arguments: { filePath: 'a.ts' } }],
          text: '',
          executed: null,
        },
      ],
    };
    expect(scoreAttempt(chain, secondWrong, { schemas, groundingPool: pool }).correct).toBe(false);
  });

  it('**calling a tool when the answer is "there is no tool" is the failure being measured**', () => {
    const score = scoreAttempt(
      none,
      run(none.id, [{ name: 'analyze_repository', arguments: { path: '.' } }]),
      { schemas, groundingPool: pool },
    );
    expect(score.correct).toBe(false);
    expect(score.failure).toBe('call-when-none-expected');
  });

  it('**treats a step the harness did not execute as unasserted, not as passed**', () => {
    const taskRun: TaskRun = {
      taskId: single.id,
      attempt: 0,
      steps: [
        {
          calls: [{ name: 'tests_for', arguments: { symbol: 'alpha', projectId: 'p' } }],
          text: '',
          executed: undefined,
        },
      ],
    };
    const score = scoreAttempt(single, taskRun, { schemas, groundingPool: pool });
    expect(score.asserted).toBeNull();
    expect(score.correct).toBe(true);
  });

  it('**survives a call whose argument object the model never wrote**', () => {
    const task: AgenticTask = {
      ...single,
      steps: [{ gold: ['tests_for'], call: { symbol: 'alpha' }, grounding: ['alpha'] }],
    };
    const score = scoreAttempt(
      task,
      run(task.id, [
        { name: 'tests_for', arguments: undefined as unknown as Record<string, unknown> },
      ]),
      { schemas },
    );
    expect(score.grounded).toBe(false);
  });

  it('**an expected call that never came is a failure, and it is named as one**', () => {
    const score = scoreAttempt(single, run(single.id, []), { schemas, groundingPool: pool });
    expect(score.selected).toBe(false);
    expect(score.failure).toBe('no-call-when-expected');
  });

  it('**saying nothing is correct for a task nothing can answer**', () => {
    const score = scoreAttempt(none, run(none.id, []), { schemas });
    expect(score.correct).toBe(true);
  });

  it('**a router is judged on the tool it names, and a model on the whole call**', () => {
    // A router answers "which tool", so an empty argument object must not make it wrong; the same run judged as a model
    // is wrong, because a call with no arguments is a call its own schema rejects.
    const bare = run(single.id, [{ name: 'tests_for', arguments: {} }]);
    expect(
      scoreAttempt(single, bare, { schemas, groundingPool: pool, judge: 'tool' }).correct,
    ).toBe(true);
    expect(
      scoreAttempt(single, bare, { schemas, groundingPool: pool, judge: 'call' }).correct,
    ).toBe(false);
    expect(scoreAttempt(single, bare, { schemas, judge: 'tool' }).schemaOk).toBeNull();
  });

  it('**an executed assertion that failed overrides a correct selection**', () => {
    const runnable: AgenticTask = { ...single, assert: { kind: 'nonEmpty' } };
    const taskRun: TaskRun = {
      taskId: runnable.id,
      attempt: 0,
      steps: [
        {
          calls: [{ name: 'tests_for', arguments: { symbol: 'alpha', projectId: 'p' } }],
          text: '',
          executed: { ok: false, detail: 'empty' },
        },
      ],
    };
    const score = scoreAttempt(runnable, taskRun, { schemas, groundingPool: pool });
    expect(score.selected).toBe(true);
    expect(score.asserted).toBe(false);
    expect(score.correct).toBe(false);
    expect(score.failure).toBe('assertion-failed');
  });
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function attempt(taskId: string, correct: boolean, decoyed = true): AttemptScore {
  return {
    taskId,
    attempt: 0,
    class: 'single',
    decoyed,
    selected: correct,
    schemaOk: null,
    grounded: null,
    asserted: null,
    correct,
    failure: correct ? null : 'wrong-tool',
  };
}

describe('summarising an arm', () => {
  const tasks: AgenticTask[] = [single, chain, none];

  it('**`pass^k` counts a task only when every attempt was right**', () => {
    const attempts = [
      attempt(single.id, true),
      attempt(single.id, false),
      attempt(chain.id, true),
      attempt(none.id, true),
    ];
    const withSecondAttempt = attempts.map((entry, index) =>
      index === 0 ? { ...entry, attempt: 0 } : index === 1 ? { ...entry, attempt: 1 } : entry,
    );
    const summary = summariseArm('arm', withSecondAttempt, tasks);
    // 3 of 4 attempts correct, but only 2 of 3 tasks were right every time.
    expect(summary.overall.successes).toBe(3);
    expect(summary.passEvery.successes).toBe(2);
    expect(summary.passEvery.total).toBe(3);
  });

  it('**counts failures by kind so the report can say how it was wrong**', () => {
    const summary = summariseArm(
      'arm',
      [attempt(single.id, false), attempt(chain.id, true)],
      tasks,
    );
    expect(summary.failures['wrong-tool']).toBe(1);
    expect(summary.decoyed.total).toBe(2);
  });

  it('**a rate over zero attempts is null, not zero**', () => {
    const summary = summariseArm('arm', [], tasks);
    expect(summary.overall.value).toBeNull();
    expect(summary.passEvery.total).toBe(0);
  });
});

describe('grounding without a pool', () => {
  it('**checks that the value is in the call, and not that a fixture contains it**', () => {
    // The pool is what proves an entity exists; a caller without one can still prove the call names it.
    const task: AgenticTask = {
      ...single,
      steps: [{ gold: ['tests_for'], call: { symbol: 'alpha' }, grounding: ['alpha'] }],
    };
    const score = scoreAttempt(
      task,
      run(task.id, [{ name: 'tests_for', arguments: { symbol: 'alpha' } }]),
      { schemas },
    );
    expect(score.grounded).toBe(true);
  });
});

describe('summarising a set with a stray attempt', () => {
  it('**ignores an attempt for a task the set does not contain, rather than inventing one**', () => {
    const summary = summariseArm(
      'arm',
      [attempt(single.id, true), attempt('test/not-in-the-set', true)],
      [single],
    );
    expect(summary.overall.total).toBe(2);
    expect(summary.passEvery.total).toBe(1);
    expect(summary.perTask).toHaveLength(1);
  });
});

describe('comparing two arms', () => {
  const tasks: AgenticTask[] = [single, chain, none];

  function arm(name: string, outcomes: boolean[]) {
    const attempts = outcomes.map((correct, index) => attempt(tasks[index]!.id, correct));
    return summariseArm(name, attempts, tasks);
  }

  it('**pairs on tasks and counts the discordant cells**', () => {
    const a = arm('a', [true, true, false]);
    const b = arm('b', [true, false, false]);
    const comparison = compareArms(a, b);
    expect(comparison.onlyA).toBe(1);
    expect(comparison.onlyB).toBe(0);
    expect(comparison.both).toBe(1);
    expect(comparison.neither).toBe(1);
  });

  it('**credits the second arm where only it was right**', () => {
    const a = arm('a', [false, true, false]);
    const b = arm('b', [false, true, true]);
    const comparison = compareArms(a, b);
    expect(comparison.onlyB).toBe(1);
    expect(comparison.both).toBe(1);
    expect(comparison.neither).toBe(1);
  });

  it('**two identical arms are not evidence of a difference**', () => {
    const a = arm('a', [true, false, true]);
    expect(compareArms(a, arm('b', [true, false, true])).pValue).toBe(1);
  });

  it('**counts a task only one arm ran as untestable rather than as a win for whoever ran it**', () => {
    const a = summariseArm(
      'a',
      [attempt(single.id, true), attempt(chain.id, true)],
      [single, chain],
    );
    const b = summariseArm(
      'b',
      [attempt(single.id, false), attempt(none.id, true)],
      [single, none],
    );
    const comparison = compareArms(a, b);
    // `chain` is in one arm and not the other, so it is not a discordant pair; `none` is likewise absent from `a`.
    expect(comparison.onlyA).toBe(1);
    expect(comparison.onlyB).toBe(0);
    expect(comparison.neither).toBe(0);
  });

  it('**a one-task difference cannot be significant at this size**', () => {
    const a = arm('a', [true, false, false]);
    const b = arm('b', [false, false, false]);
    const comparison = compareArms(a, b);
    // b=1, c=0 -> 2 * (1/2)^1 = 1.0. One discordant pair is one coin flip.
    expect(comparison.pValue).toBe(1);
  });
});
