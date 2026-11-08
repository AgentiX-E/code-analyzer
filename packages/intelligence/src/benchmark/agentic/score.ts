/**
 * @fileoverview The arithmetic behind the L4 measurement: intervals, a paired test, and the definition of "correct".
 *
 * **Everything here is pure**, so the numbers a reader sees can be recomputed from the recorded runs without re-running
 * a model, and so the scoring rules can be tested against hand-computed cases instead of against a live API.
 */

import type { AgenticTask, TaskClass } from './tasks.js';

// ---------------------------------------------------------------------------
// What a run recorded
// ---------------------------------------------------------------------------

/** One tool call a model emitted. */
export interface ObservedCall {
  /** The tool it named. */
  readonly name: string;
  /** The arguments as it wrote them, before validation. */
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** What happened in one step of one attempt. */
export interface StepObservation {
  /** The calls the model emitted for this step, in order. Empty means it answered in prose. */
  readonly calls: readonly ObservedCall[];
  /** Its prose for this step, which is the whole answer for a `none` task. */
  readonly text: string;
  /**
   * What the harness saw when it executed the step's first call.
   *
   * `null` means the step was not executed this run — the tool needs a live index the harness did not build, or the
   * assertion is `none`. **`null` is not `false`**: a claim of failure that was never attempted is the same defect as
   * a claim of success that was never attempted.
   */
  readonly executed: { readonly ok: boolean; readonly detail: string } | null;
}

/** One attempt at one task. */
export interface TaskRun {
  readonly taskId: string;
  /** 0-based. The lexical arm has exactly one attempt, because it is deterministic. */
  readonly attempt: number;
  /** One observation per task step; a `none` task records one observation with no calls. */
  readonly steps: readonly StepObservation[];
}

// ---------------------------------------------------------------------------
// Correctness
// ---------------------------------------------------------------------------

/** Whether every argument a call states is one the tool's schema declares, and every required one is present. */
export interface SchemaCheck {
  readonly ok: boolean;
  /** What was wrong, in the tool's own vocabulary, or `null`. */
  readonly why: string | null;
}

/** A tool's input schema, in the subset JSON Schema needs here. */
export interface ToolSchema {
  readonly type?: string;
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/**
 * Validate arguments against a tool's schema.
 *
 * **Deliberately shallow, and deliberately not a validator library.** The question is whether an agent can state a call
 * a server would accept, which turns on four things: required keys present, no undeclared keys, declared types
 * respected, enum values respected. A full JSON Schema implementation would add `$ref` and `allOf` handling that no tool
 * in this cabinet uses, and would make the check harder to read than the thing it checks.
 */
export function checkArguments(args: unknown, schema: ToolSchema | undefined): SchemaCheck {
  if (schema === undefined) return { ok: false, why: 'the tool has no published schema' };
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, why: 'the arguments are not an object' };
  }
  const record = args as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  const missing = required.filter((key) => !(key in record));
  if (missing.length > 0) return { ok: false, why: `missing required ${missing.join(', ')}` };

  if (schema.additionalProperties === false) {
    const extra = Object.keys(record).filter((key) => !(key in properties));
    if (extra.length > 0) return { ok: false, why: `undeclared ${extra.join(', ')}` };
  }

  for (const [key, value] of Object.entries(record)) {
    const declared = properties[key] as
      { type?: string | readonly string[]; enum?: readonly unknown[] } | undefined;
    if (declared === undefined || value === undefined) continue;
    if (Array.isArray(declared.enum) && !declared.enum.includes(value)) {
      return { ok: false, why: `${key} is not one of ${declared.enum.join(', ')}` };
    }
    const type = declared.type;
    if (type !== undefined && !matchesType(value, type)) {
      return { ok: false, why: `${key} is not ${String(type)}` };
    }
  }
  return { ok: true, why: null };
}

function matchesType(value: unknown, type: string | readonly string[]): boolean {
  const options = typeof type === 'string' ? [type] : type;
  return options.some((option) => {
    switch (option) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number' && Number.isFinite(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'null':
        return value === null;
      default:
        return true;
    }
  });
}

/** The outcome of one attempt, decomposed so a report can say *how* it was wrong. */
export interface AttemptScore {
  readonly taskId: string;
  readonly attempt: number;
  readonly class: TaskClass;
  /** Whether any step carried a decoy - the subset the headline is computed over. */
  readonly decoyed: boolean;
  /** Chosen the gold tool at every step, in order. */
  readonly selected: boolean;
  /** Every emitted call's arguments were schema-valid. `null` when no call was emitted. */
  readonly schemaOk: boolean | null;
  /** Whether the calls named the entities the task is grounded in. `null` when the task has none. */
  readonly grounded: boolean | null;
  /** Whether every executed assertion held. `null` when nothing was executed. */
  readonly asserted: boolean | null;
  /**
   * The one verdict the headline uses.
   *
   * **It is the conjunction**, and the columns beside it are how a failure is explained rather than how it is excused.
   * A call the tool would reject never ran, and a call that names an entity which does not exist cannot answer the
   * question asked, so neither is a correct answer to the user even though the tool name was right. The first version
   * of this file scored selection alone and published grounding beside it; that version counted "picked `tests_for` and
   * asked about a symbol that does not exist" as a success, which is the sort of credit a benchmark should not give.
   */
  readonly correct: boolean;
  /** How it failed, when it did. */
  readonly failure: FailureKind | null;
}

export type FailureKind =
  | 'wrong-tool'
  | 'no-call-when-expected'
  | 'call-when-none-expected'
  | 'invalid-arguments'
  | 'assertion-failed'
  | 'ungrounded';

/**
 * Score one attempt.
 *
 * `judge` says what the arm is being asked for. A **model** is asked for a whole call, so a right tool with arguments the
 * server would reject is not an answer. A **router** — the lexical arm — is asked only which tool, and judging it on
 * arguments it was never asked to construct would make the null score zero by construction, which is the definition of a
 * straw man. The router is therefore judged on selection alone, **which is generous to it**: the comparison in the report
 * is against a floor that has been given every benefit of the doubt.
 */
export function scoreAttempt(
  task: AgenticTask,
  run: TaskRun,
  context: {
    readonly groundingPool?: ReadonlySet<string>;
    readonly schemas?: ReadonlyMap<string, ToolSchema>;
    readonly judge?: 'call' | 'tool';
  } = {},
): AttemptScore {
  const judge = context.judge ?? 'call';
  const decoyed = task.steps.some((step) => step.decoy !== undefined);

  if (task.class === 'none') {
    const called = run.steps.some((step) => step.calls.length > 0);
    return {
      taskId: task.id,
      attempt: run.attempt,
      class: task.class,
      decoyed,
      selected: !called,
      schemaOk: null,
      grounded: null,
      asserted: null,
      correct: !called,
      failure: called ? 'call-when-none-expected' : null,
    };
  }

  // **Every step, in order.** A chain that gets step one right and step two wrong is not half correct: the second call
  // exists only because the first one returned, so a wrong second call is a wrong answer to the user's sentence.
  let selected = true;
  let invalidArguments = false;
  let assertionFailed = false;
  let noCall = false;
  let ungrounded = false;
  let schemaChecked = false;
  let groundedChecked = false;
  let assertedChecked = false;

  for (let index = 0; index < task.steps.length; index += 1) {
    const step = task.steps[index]!;
    const observed = run.steps[index];
    const first = observed?.calls[0];
    if (first === undefined) {
      noCall = true;
      selected = false;
      break;
    }
    if (!step.gold.includes(first.name)) selected = false;

    if (judge === 'call') {
      schemaChecked = true;
      if (!isSchemaOk(first, context)) invalidArguments = true;

      if (step.grounding !== undefined && step.grounding.length > 0) {
        groundedChecked = true;
        if (!namesGrounding(first, step.grounding, context.groundingPool)) ungrounded = true;
      }
    }

    // **The assertion is about the last step, and only where the task declares one.** Every step is executed so the
    // model can be shown what its first call returned; what is *asserted* is the answer the user asked for, which for
    // a chain is the second call's output. Counting an intermediate call's failure as the answer's failure would score
    // the transcript rather than the result.
    const isLast = index === task.steps.length - 1;
    if (isLast && task.assert.kind !== 'none' && observed?.executed != null) {
      assertedChecked = true;
      if (!observed.executed.ok) assertionFailed = true;
    }
  }

  const schemaOk = schemaChecked ? !invalidArguments : null;
  const grounded = groundedChecked ? !ungrounded : null;
  const asserted = assertedChecked ? !assertionFailed : null;
  const correct =
    selected && invalidArguments === false && ungrounded === false && !assertionFailed;

  return {
    taskId: task.id,
    attempt: run.attempt,
    class: task.class,
    decoyed,
    selected,
    schemaOk,
    grounded,
    asserted,
    correct,
    failure: correct
      ? null
      : noCall
        ? 'no-call-when-expected'
        : !selected
          ? 'wrong-tool'
          : invalidArguments
            ? 'invalid-arguments'
            : ungrounded
              ? 'ungrounded'
              : 'assertion-failed',
  };
}

/** Schema validity of a call, read from the schema the harness recorded for that tool. */
function isSchemaOk(
  call: ObservedCall,
  context: { readonly schemas?: ReadonlyMap<string, ToolSchema> },
): boolean {
  const schema = context.schemas?.get(call.name);
  // **A tool with no recorded schema cannot be judged, and is not a pass.** The harness records every schema it sends,
  // so this is reached only if a call names a tool that does not exist - which is a wrong tool, already counted.
  //
  // **The schema column is about the call, not about the choice.** The first version of this function returned "is the
  // tool the gold one" whenever the schema was missing, and marked every wrong-tool attempt as an invalid argument - so
  // an agent that picked the wrong tool and formatted it perfectly was reported as unable to format, and the column
  // that exists to separate those two failures could not.
  if (schema === undefined) return false;
  return checkArguments(call.arguments, schema).ok;
}

/**
 * Whether the call states the entity the task is about.
 *
 * **The value has to appear as an argument, not in the prose.** A model that writes "I will look at `fuseRankings`" and
 * then calls `search_code({query: "fuse"})` has named the entity and not told the tool about it, which is exactly the
 * failure grounding is meant to catch.
 */
function namesGrounding(
  call: ObservedCall,
  grounding: readonly string[],
  pool: ReadonlySet<string> | undefined,
): boolean {
  const values = JSON.stringify(call.arguments ?? {});
  return grounding.every((value) => {
    if (!values.includes(value)) return false;
    return pool === undefined ? true : pool.has(value);
  });
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

/**
 * The Wilson score interval for a proportion.
 *
 * **Not the normal approximation.** At 64 tasks and an accuracy near the ceiling, `p ± 1.96·sqrt(p(1-p)/n)` produces
 * an interval that can exceed 1 and collapses to a point at 100 %, which is the answer a benchmark most needs to
 * distrust. Wilson is the interval the statistics literature recommends for exactly this case.
 */
export function wilson(
  successes: number,
  total: number,
  z = 1.96,
): { lower: number; upper: number } | null {
  if (total <= 0) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const spread =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return { lower: Math.max(0, centre - spread), upper: Math.min(1, centre + spread) };
}

/** A proportion with its interval and its denominator, which is the only form this file ever returns. */
export interface Proportion {
  readonly successes: number;
  readonly total: number;
  readonly value: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
}

export function proportion(successes: number, total: number): Proportion {
  const interval = wilson(successes, total);
  return {
    successes,
    total,
    value: total === 0 ? null : successes / total,
    lower: interval?.lower ?? null,
    upper: interval?.upper ?? null,
  };
}

/**
 * The exact two-sided McNemar test on paired binary outcomes.
 *
 * **The right test for two arms that ran the same tasks.** Comparing two independent proportions throws away the
 * pairing, and the pairing is most of the information here: the tasks the full catalog gets right and the name-only
 * catalog gets wrong are the claim. Under the null the discordant pairs split evenly, so the statistic is binomial
 * with `n = b + c` at `p = 1/2`, and the exact form is used because `b + c` is small.
 */
export function mcnemarExact(
  onlyA: number,
  onlyB: number,
): { readonly b: number; readonly c: number; readonly pValue: number } {
  const n = onlyA + onlyB;
  if (n === 0) return { b: onlyA, c: onlyB, pValue: 1 };
  const k = Math.min(onlyA, onlyB);
  let tail = 0;
  let term = 1;
  // Sum_{i=0..k} C(n, i) / 2^n, accumulated multiplicatively to avoid factorial overflow at larger n.
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) term = (term * (n - i + 1)) / i;
    tail += term;
  }
  const twoSided = Math.min(1, (2 * tail) / 2 ** n);
  return { b: onlyA, c: onlyB, pValue: twoSided };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Everything one arm produced, scored. */
export interface ArmSummary {
  readonly name: string;
  readonly attempts: readonly AttemptScore[];
  /** Per-task correctness, keyed by task id: `every` attempt correct is what reliability means. */
  readonly perTask: readonly {
    readonly taskId: string;
    readonly correctEvery: boolean;
    readonly correctAny: boolean;
  }[];
  readonly overall: Proportion;
  readonly decoyed: Proportion;
  readonly byClass: Readonly<Record<TaskClass, Proportion>>;
  readonly schema: Proportion;
  readonly grounding: Proportion;
  readonly asserted: Proportion;
  readonly failures: Readonly<Record<FailureKind, number>>;
  /**
   * `pass^k` — the share of tasks every attempt got right.
   *
   * **The number a single run cannot give you.** `pass^1` averages attempts and hides that a model can be right on
   * average and wrong twice in a row on the same task; `pass^k` is what a user experiences, which is the same task
   * asked again tomorrow.
   */
  readonly passEvery: Proportion;
}

/** Summarise one arm. */
export function summariseArm(
  name: string,
  attempts: readonly AttemptScore[],
  tasks: readonly AgenticTask[],
): ArmSummary {
  const byTask = new Map<string, { every: boolean; any: boolean; seen: number }>();
  for (const task of tasks) byTask.set(task.id, { every: true, any: false, seen: 0 });
  for (const attempt of attempts) {
    const entry = byTask.get(attempt.taskId);
    if (entry === undefined) continue;
    entry.seen += 1;
    entry.every = entry.every && attempt.correct;
    entry.any = entry.any || attempt.correct;
  }

  const failures: Record<FailureKind, number> = {
    'wrong-tool': 0,
    'no-call-when-expected': 0,
    'call-when-none-expected': 0,
    'invalid-arguments': 0,
    'assertion-failed': 0,
    ungrounded: 0,
  };
  for (const attempt of attempts) {
    if (attempt.failure !== null) failures[attempt.failure] += 1;
  }

  const decoyed = attempts.filter((attempt) => attempt.decoyed);
  const classes: TaskClass[] = ['single', 'chain', 'none'];
  const byClass = Object.fromEntries(
    classes.map((klass) => {
      const subset = attempts.filter((attempt) => attempt.class === klass);
      return [klass, proportion(subset.filter((a) => a.correct).length, subset.length)];
    }),
  ) as Record<TaskClass, Proportion>;

  const perTask = tasks
    .map((task) => {
      const entry = byTask.get(task.id)!;
      return {
        taskId: task.id,
        correctEvery: entry.seen > 0 && entry.every,
        correctAny: entry.any,
      };
    })
    .filter((row) => byTask.get(row.taskId)!.seen > 0);

  return {
    name,
    attempts,
    perTask,
    overall: proportion(attempts.filter((a) => a.correct).length, attempts.length),
    decoyed: proportion(decoyed.filter((a) => a.correct).length, decoyed.length),
    byClass,
    schema: proportion(
      attempts.filter((a) => a.schemaOk === true).length,
      attempts.filter((a) => a.schemaOk !== null).length,
    ),
    grounding: proportion(
      attempts.filter((a) => a.grounded === true).length,
      attempts.filter((a) => a.grounded !== null).length,
    ),
    asserted: proportion(
      attempts.filter((a) => a.asserted === true).length,
      attempts.filter((a) => a.asserted !== null).length,
    ),
    failures,
    passEvery: proportion(perTask.filter((row) => row.correctEvery).length, perTask.length),
  };
}

/**
 * Compare two arms task by task.
 *
 * **Only tasks both arms attempted count**, and a task counts as correct for an arm only if every attempt was correct.
 * Pairing on `pass^k` rather than on individual attempts is deliberate: the alternative lets an arm win by being
 * inconsistent, which is the thing the arms are being compared about.
 */
export function compareArms(
  a: ArmSummary,
  b: ArmSummary,
): {
  readonly onlyA: number;
  readonly onlyB: number;
  readonly both: number;
  readonly neither: number;
  readonly pValue: number;
} {
  const byId = new Map(b.perTask.map((row) => [row.taskId, row.correctEvery]));
  let onlyA = 0;
  let onlyB = 0;
  let both = 0;
  let neither = 0;
  for (const row of a.perTask) {
    const other = byId.get(row.taskId);
    if (other === undefined) continue;
    if (row.correctEvery && other) both += 1;
    else if (row.correctEvery) onlyA += 1;
    else if (other) onlyB += 1;
    else neither += 1;
  }
  return { onlyA, onlyB, both, neither, ...mcnemarExact(onlyA, onlyB) };
}
