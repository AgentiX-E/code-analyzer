#!/usr/bin/env npx tsx
/**
 * @fileoverview L4 — run the tool-selection benchmark, or check the set that defines it.
 *
 * **Two modes, and the difference between them is whether a model is involved at all.**
 *
 * `--check` proves the task set is still a task set: every gold and decoy tool exists in the live registry, every
 * grounding value appears in the fixture files, every gold call is schema-valid, the class floors hold, no id repeats.
 * It needs no key and no network, so it runs on every push. **A benchmark that silently rots is worse than no
 * benchmark**, because its number keeps being quoted after the thing it measured has moved.
 *
 * `--run` indexes the fixture with the product's own pipeline, asks a model to answer each task from the real tool
 * catalog, executes the call it chose, and writes `benchmarks/agentic-tools.json`.
 *
 * ```
 * TSX_TSCONFIG_PATH=tsconfig.tests.json npx tsx scripts/agentic-tools.ts --check
 * TSX_TSCONFIG_PATH=tsconfig.tests.json npx tsx scripts/agentic-tools.ts --run --attempts 3 --write
 * ```
 *
 * Exit codes: 0 success, 1 the check failed or the run could not produce a measurement.
 */

import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InMemoryGraphStore } from '../packages/infra/src/storage/in-memory-graph-store.js';
import {
  AGENTIC_TASKS,
  FIXTURE,
  decoyedTasks,
  taskClassCounts,
} from '../packages/intelligence/src/benchmark/agentic/tasks.js';
import {
  catalogDocuments,
  rankTools,
} from '../packages/intelligence/src/benchmark/agentic/lexical-router.js';
import {
  checkArguments,
  compareArms,
  scoreAttempt,
  summariseArm,
} from '../packages/intelligence/src/benchmark/agentic/score.js';
import { createToolRegistry } from '../packages/mcp/src/tools/index.js';
import { analyzeRepository } from '../packages/mcp/src/tools/indexing-lifecycle.js';
import { ToolContextImpl } from '../packages/mcp/src/tools/tool-context.js';

import type { ToolDefinition } from '../packages/intelligence/src/review/llm/provider.js';
import type {
  AgenticTask,
  TaskClass,
} from '../packages/intelligence/src/benchmark/agentic/tasks.js';
import type {
  AttemptScore,
  StepObservation,
  TaskRun,
  ToolSchema,
} from '../packages/intelligence/src/benchmark/agentic/score.js';

// ---------------------------------------------------------------------------
// Paths and arguments
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'benchmarks', 'agentic-tools.json');

interface Options {
  readonly check: boolean;
  readonly run: boolean;
  readonly selfTest: boolean;
  readonly write: boolean;
  readonly attempts: number;
  readonly limit: number | null;
  readonly tasks: readonly string[] | null;
  /** Which arms to run. `lexical` alone is what a machine with no key can measure, and it is a real figure. */
  readonly arms: readonly ArmName[] | null;
}

function parseArgs(argv: readonly string[]): Options {
  const has = (flag: string): boolean => argv.includes(flag);
  const value = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1]! : fallback;
  };
  const many = (flag: string): string[] | null => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    const values: string[] = [];
    for (
      let cursor = index + 1;
      cursor < argv.length && !argv[cursor]!.startsWith('--');
      cursor += 1
    ) {
      values.push(argv[cursor]!);
    }
    return values.length > 0 ? values : null;
  };
  return {
    check: has('--check'),
    run: has('--run'),
    selfTest: has('--self-test'),
    write: has('--write'),
    attempts: Number(value('--attempts', '3')),
    limit: has('--limit') ? Number(value('--limit', '0')) : null,
    tasks: many('--task'),
    arms: has('--arms')
      ? (value('--arms', 'lexical')
          .split(',')
          .map((name) => name.trim())
          .filter(
            (name) => name === 'full' || name === 'names-only' || name === 'lexical',
          ) as ArmName[])
      : null,
  };
}

// ---------------------------------------------------------------------------
// The catalog, read from the registry rather than written down
// ---------------------------------------------------------------------------

interface Catalog {
  readonly tools: readonly ToolDefinition[];
  readonly schemas: ReadonlyMap<string, ToolSchema>;
}

function buildCatalog(): Catalog {
  const registry = createToolRegistry();
  const tools: ToolDefinition[] = [];
  const schemas = new Map<string, ToolSchema>();
  for (const tool of registry.list()) {
    tools.push({ name: tool.name, description: tool.description, parameters: tool.inputSchema });
    schemas.set(tool.name, tool.inputSchema as unknown as ToolSchema);
  }
  return { tools, schemas };
}

/** Every file the fixture contributes, as `{ relativePath, absolutePath }`. */
function fixtureFiles(): Array<{ relativePath: string; absolutePath: string }> {
  const files: Array<{ relativePath: string; absolutePath: string }> = [];
  for (const sourceDir of FIXTURE.sourceDirs) {
    const absoluteDir = join(ROOT, sourceDir);
    for (const entry of readdirSync(absoluteDir)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
      const absolutePath = join(absoluteDir, entry);
      files.push({ relativePath: relative(ROOT, absolutePath), absolutePath });
    }
  }
  for (const glob of FIXTURE.testGlobs) {
    const absolutePath = join(ROOT, glob);
    if (existsSync(absolutePath)) files.push({ relativePath: glob, absolutePath });
  }
  return files;
}

// ---------------------------------------------------------------------------
// --check: the set is still a set
// ---------------------------------------------------------------------------

function check(): number {
  const catalog = buildCatalog();
  const names = new Set(catalog.tools.map((tool) => tool.name));
  const failures: string[] = [];
  const seen = new Set<string>();

  const counts = taskClassCounts();
  const expected = { single: 66, chain: 14, none: 20 } as const;
  for (const [klass, floor] of Object.entries(expected) as Array<[TaskClass, number]>) {
    if (counts[klass] !== floor) {
      failures.push(
        `class ${klass}: ${String(counts[klass])} tasks, and this file's header promises ${String(floor)}`,
      );
    }
  }
  if (AGENTIC_TASKS.length < 60) {
    failures.push(
      `the set has ${String(AGENTIC_TASKS.length)} tasks; a tool-selection rate over fewer than 60 is a guess`,
    );
  }

  // **The fixture text, read once.** Grounding is a claim that a value names a real entity, and the only thing that can
  // settle that claim is the text the pipeline was given.
  const files = fixtureFiles();
  // **The file's own name is an entity in the fixture.** A task that grounds `rerank.ts` is asking whether the file the
  // model named is the file that exists, and a corpus built from contents alone would fail every path for a reason that
  // has nothing to do with the model.
  const corpus = [
    ...files.map((file) => file.relativePath),
    ...files.map((file) => readFileSync(file.absolutePath, 'utf8')),
  ].join('\n');

  const used = new Set<string>();
  let groundedValues = 0;
  let assertedTasks = 0;

  for (const task of AGENTIC_TASKS) {
    if (seen.has(task.id)) failures.push(`${task.id}: duplicate id`);
    seen.add(task.id);

    if (task.class === 'none') {
      if (task.steps.length > 0)
        failures.push(`${task.id}: a none task has ${String(task.steps.length)} steps`);
      continue;
    }
    if (task.steps.length === 0) failures.push(`${task.id}: no steps on a ${task.class} task`);
    if (task.class === 'chain' && task.steps.length !== 2) {
      failures.push(`${task.id}: a chain needs two steps, and it has ${String(task.steps.length)}`);
    }
    if (task.assert.kind !== 'none') assertedTasks += 1;

    for (const [index, step] of task.steps.entries()) {
      for (const name of step.gold) {
        if (!names.has(name))
          failures.push(
            `${task.id} step ${String(index)}: gold tool "${name}" is not in the registry`,
          );
        used.add(name);
      }
      if (step.decoy !== undefined) {
        if (!names.has(step.decoy)) {
          failures.push(
            `${task.id} step ${String(index)}: decoy "${step.decoy}" is not in the registry`,
          );
        }
        if (step.gold.includes(step.decoy)) {
          failures.push(
            `${task.id} step ${String(index)}: the decoy is one of the gold tools, so it decoys nothing`,
          );
        }
      }
      // **A gold call that its own tool would reject is a wrong answer key.** Validated with the same function the
      // scoring uses, so the key and the grade cannot disagree about what a valid call is.
      const verdict = checkArguments(step.call, catalog.schemas.get(step.gold[0]!));
      if (!verdict.ok) {
        failures.push(
          `${task.id} step ${String(index)}: the gold call is invalid — ${String(verdict.why)}`,
        );
      }
      for (const value of step.grounding ?? []) {
        groundedValues += 1;
        if (!corpus.includes(value)) {
          failures.push(
            `${task.id}: "${value}" is not in the fixture, so grounding it proves nothing`,
          );
        }
      }
    }
  }

  if (assertedTasks < 20) {
    failures.push(
      `${String(assertedTasks)} tasks carry an execution assertion; 20 is the floor for claiming execution`,
    );
  }
  if (decoyedTasks().length < 25) {
    failures.push(
      `${String(decoyedTasks().length)} tasks carry a decoy; the headline is computed over that subset`,
    );
  }

  const coverage = [...names].filter((name) => used.has(name)).length;
  console.log(
    `agentic-tools: ${String(AGENTIC_TASKS.length)} tasks ` +
      `(${String(counts.single)} single, ${String(counts.chain)} chain, ${String(counts.none)} none), ` +
      `${String(decoyedTasks().length)} decoyed, ${String(assertedTasks)} with an execution assertion, ` +
      `${String(groundedValues)} grounding values in ${String(files.length)} fixture files, ` +
      `${String(coverage)} of ${String(names.size)} tools exercised`,
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(`agentic-tools: ${String(failures.length)} defect(s) in the task set`);
    return 1;
  }
  console.log('agentic-tools: every gold tool, decoy, argument and grounding value is still true');
  return 0;
}

// ---------------------------------------------------------------------------
// The fixture, indexed by the product's own pipeline
// ---------------------------------------------------------------------------

interface Fixture {
  readonly dir: string;
  readonly projectId: string;
  readonly store: InMemoryGraphStore;
  readonly context: ToolContextImpl;
  readonly files: readonly string[];
  readonly dispose: () => void;
}

async function buildFixture(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-fixture-'));
  const files: string[] = [];
  for (const file of fixtureFiles()) {
    const target = join(dir, file.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.absolutePath, target);
    files.push(file.relativePath);
  }

  const store = new InMemoryGraphStore();
  const context = new ToolContextImpl(store, { llm: null });
  const result = await analyzeRepository({ path: dir, projectId: FIXTURE.projectId }, context);
  if (result.isError === true) {
    throw new Error(`the fixture did not index: ${result.content[0]?.text ?? 'no message'}`);
  }
  return {
    dir,
    projectId: FIXTURE.projectId,
    store,
    context,
    files,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are the code-analyzer agent. A developer has typed a request and you must answer it using the tools you are',
  `given. The project you are working in is indexed under the id "${FIXTURE.projectId}"; use that id in every call that`,
  'takes one. Call the single most appropriate tool for the request. If no tool can do what was asked, say so in one',
  'sentence and do not call anything. Never invent a tool name.',
].join(' ');

type ArmName = 'full' | 'names-only' | 'lexical';

interface ArmConfig {
  readonly name: ArmName;
  /** Whether the catalog reaches the model with its description, or only its name. */
  readonly descriptions: boolean;
  readonly model: boolean;
}

const ARMS: readonly ArmConfig[] = [
  { name: 'full', descriptions: true, model: true },
  { name: 'names-only', descriptions: false, model: true },
];

function catalogFor(catalog: Catalog, config: ArmConfig): ToolDefinition[] {
  return catalog.tools.map((tool) =>
    config.descriptions ? tool : { ...tool, description: tool.name.replace(/_/g, ' ') },
  );
}

/** The replies a model gave, in the shape the scorer reads. */
async function runModelArm(
  config: ArmConfig,
  catalog: Catalog,
  fixture: Fixture,
  tasks: readonly AgenticTask[],
  attempts: number,
): Promise<TaskRun[]> {
  const { createLLMProvider } =
    await import('../packages/intelligence/src/review/llm/provider-factory.js');
  const provider = createLLMProvider();
  if (provider === null)
    throw new Error('no LLM provider is configured — DEEPSEEK_API_KEY is absent');

  const tools = catalogFor(catalog, config);
  const runs: TaskRun[] = [];

  for (const task of tasks) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const observations: StepObservation[] = [];
      let transcript = task.prompt;

      for (let step = 0; step < Math.max(1, task.steps.length); step += 1) {
        const completion = await provider.completeWithTools(transcript, tools, {
          temperature: 0.2,
          maxTokens: 700,
        });
        const calls = (completion.toolCalls ?? []).map((call) => ({
          name: call.name,
          arguments: parseArguments(call.arguments),
        }));
        const executed = await execute(fixture, calls[0], task, step);
        observations.push({ calls, text: completion.content, executed });

        if (calls.length === 0) break;
        transcript =
          `${task.prompt}\n\nYou called ${calls[0]!.name} and it returned:\n` +
          `${(executed?.detail ?? '').slice(0, 1200)}\n\nNow continue with the request.`;
      }
      runs.push({ taskId: task.id, attempt, steps: observations });
    }
  }
  return runs;
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Execute one call and assert the task's state property.
 *
 * **`null` when nothing was executed**, and the difference matters: an assertion that was never run is not a pass. A
 * task with `kind: 'none'` is not executed at all; a task whose call named the wrong tool is executed and its
 * assertion fails, because "run what it said and look" is the check a user would do.
 */
async function execute(
  fixture: Fixture,
  call: { name: string; arguments: Record<string, unknown> } | undefined,
  task: AgenticTask,
  step: number,
): Promise<{ ok: boolean; detail: string } | null> {
  if (call === undefined) return null;
  if (task.assert.kind === 'none') return null;
  // **The assertion belongs to the last step**: for a chain, the answer is what the second call produced.
  if (task.class === 'chain' && step !== task.steps.length - 1) return null;

  const registry = createToolRegistry();
  if (registry.get(call.name) === undefined) {
    return { ok: false, detail: `no tool named ${call.name}` };
  }
  try {
    const result = await registry.execute(call.name, call.arguments, fixture.context);
    const text = result.content.map((part) => part.text ?? '').join('\n');
    if (result.isError === true)
      return { ok: false, detail: `the call returned an error: ${text.slice(0, 400)}` };
    if (task.assert.kind === 'resultContains') {
      const ok = text.includes(task.assert.value);
      return { ok, detail: text.slice(0, 400) };
    }
    const ok = text.trim().length > 2 && !/"(count|total)":\s*0\b/.test(text);
    return { ok, detail: text.slice(0, 400) };
  } catch (error) {
    return { ok: false, detail: `the call threw: ${String((error as Error).message)}` };
  }
}

/** The lexical arm: a BM25 router over the catalog, which is the null this measurement is against. */
function runLexicalArm(catalog: Catalog, tasks: readonly AgenticTask[]): TaskRun[] {
  const documents = catalogDocuments(catalog.tools);
  return tasks.map((task) => {
    const ranked = rankTools(task.prompt, documents);
    const top = ranked[0]?.name;
    return {
      taskId: task.id,
      attempt: 0,
      steps: [
        {
          calls: top === undefined ? [] : [{ name: top, arguments: {} }],
          text: '',
          executed: null,
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// --self-test: the answer key, handed to the harness as if it were a model
// ---------------------------------------------------------------------------

/**
 * Run the gold calls through the same execution and scoring path a model's calls take.
 *
 * **This is the only check that can fail for a reason other than the model.** If the answer key does not score 1.0, then
 * a correct answer would not have scored 1.0 either, and every figure this harness produces is capped below its
 * ceiling for a reason that belongs to the benchmark. It needs no key and no network beyond the fixture, so it runs on
 * every push — and it is what makes the LLM numbers, which cannot run without a secret, checkable in advance.
 */
async function selfTest(): Promise<number> {
  const catalog = buildCatalog();
  const fixture = await buildFixture();
  const pool = new Set<string>();
  for (const task of AGENTIC_TASKS)
    for (const step of task.steps) for (const value of step.grounding ?? []) pool.add(value);

  const defects: string[] = [];
  const runs: TaskRun[] = [];
  try {
    for (const task of AGENTIC_TASKS) {
      const steps: StepObservation[] = [];
      for (const [index, step] of task.steps.entries()) {
        const call = { name: step.gold[0]!, arguments: { ...step.call } };
        const executed = await execute(fixture, call, task, index);
        steps.push({ calls: [call], text: '', executed });
      }
      const taskRun: TaskRun = {
        taskId: task.id,
        attempt: 0,
        steps:
          task.class === 'none' ? [{ calls: [], text: 'no tool for this', executed: null }] : steps,
      };
      runs.push(taskRun);
      const score = scoreAttempt(task, taskRun, { schemas: catalog.schemas, groundingPool: pool });
      if (!score.correct) defects.push(`${task.id}: the gold call is ${String(score.failure)}`);
      const failed = taskRun.steps.find((observed) => observed.executed?.ok === false);
      if (failed !== undefined)
        defects.push(`${task.id}: execution failed — ${failed.executed?.detail ?? ''}`);
    }
  } finally {
    fixture.dispose();
  }

  const scores = runs.map((taskRun) => {
    const task = AGENTIC_TASKS.find((candidate) => candidate.id === taskRun.taskId)!;
    return scoreAttempt(task, taskRun, { schemas: catalog.schemas, groundingPool: pool });
  });
  const summary = summariseArm('oracle', scores, AGENTIC_TASKS);
  const executed = scores.filter((score) => score.asserted !== null).length;
  console.log(
    `agentic-tools: oracle ${String(summary.overall.successes)}/${String(summary.overall.total)} correct, ` +
      `${String(executed)} executed, ${String(scores.filter((s) => s.asserted === true).length)} held, ` +
      `${String(summary.schema.successes)}/${String(summary.schema.total)} schema-valid, ` +
      `${String(summary.grounding.successes)}/${String(summary.grounding.total)} grounded`,
  );
  if (defects.length > 0) {
    for (const defect of defects) console.error(`  ✗ ${defect}`);
    return 1;
  }
  console.log('agentic-tools: the answer key scores 1.0 through the path a model is scored by');
  return 0;
}

// ---------------------------------------------------------------------------
// --run
// ---------------------------------------------------------------------------

async function run(options: Options): Promise<number> {
  const catalog = buildCatalog();
  const all =
    options.tasks === null
      ? AGENTIC_TASKS
      : AGENTIC_TASKS.filter((t) => options.tasks!.includes(t.id));
  const tasks = options.limit === null ? all : all.slice(0, options.limit);
  const startedAt = new Date().toISOString();
  const head = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();

  console.log(
    `agentic-tools: indexing ${FIXTURE.sourceDirs.join(' + ')} with the product pipeline`,
  );
  const fixture = await buildFixture();
  const indexedNodes = fixture.store.getAllNodes().length;
  console.log(
    `agentic-tools: ${String(indexedNodes)} nodes from ${String(fixture.files.length)} files`,
  );

  const pool = new Set<string>();
  for (const task of tasks)
    for (const step of task.steps) for (const value of step.grounding ?? []) pool.add(value);

  const arms: Array<{
    config: ArmConfig;
    scores: AttemptScore[];
    summary: ReturnType<typeof summariseArm>;
  }> = [];
  const rawRuns: Record<string, TaskRun[]> = {};

  try {
    for (const config of [
      ...ARMS,
      { name: 'lexical' as const, descriptions: true, model: false },
    ].filter((candidate) => options.arms === null || options.arms.includes(candidate.name))) {
      const runs = config.model
        ? await runModelArm(config, catalog, fixture, tasks, options.attempts)
        : runLexicalArm(catalog, tasks);
      rawRuns[config.name] = runs;
      const scores = runs.map((taskRun) => {
        const task = tasks.find((candidate) => candidate.id === taskRun.taskId)!;
        // **A router states a tool and no arguments.** Judging it on the arguments it was never asked to write would
        // make the null score zero by construction, so it is judged on selection alone — which is generous to it, and
        // the report says so beside the comparison.
        return scoreAttempt(task, taskRun, {
          schemas: catalog.schemas,
          groundingPool: pool,
          judge: config.model ? 'call' : 'tool',
        });
      });
      arms.push({ config, scores, summary: summariseArm(config.name, scores, tasks) });
      const summary = arms[arms.length - 1]!.summary;
      console.log(
        `agentic-tools: ${config.name.padEnd(11)} correct ${String(summary.overall.successes)}/${String(summary.overall.total)}` +
          ` = ${(summary.overall.value ?? 0).toFixed(4)} on decoyed ${String(summary.decoyed.successes)}/${String(summary.decoyed.total)}` +
          ` pass^k ${String(summary.passEvery.successes)}/${String(summary.passEvery.total)}`,
      );
    }
  } finally {
    fixture.dispose();
  }

  const find = (name: ArmName) => arms.find((arm) => arm.config.name === name);
  const full = find('full');
  const namesOnly = find('names-only');
  const lexical = find('lexical');
  // **A comparison needs both arms**, and a run that asked for one of them must not invent the other. The keys are
  // absent rather than null, so a reader of the artifact can tell "not run" from "run and equal".
  const comparison: Record<string, ReturnType<typeof compareArms>> = {};
  if (full !== undefined && namesOnly !== undefined)
    comparison['full_vs_names_only'] = compareArms(full.summary, namesOnly.summary);
  if (full !== undefined && lexical !== undefined)
    comparison['full_vs_lexical'] = compareArms(full.summary, lexical.summary);

  const artifact = {
    comment: [
      'L4 — tool selection. A model is given the live tool catalog and one sentence a developer would type, and must',
      'choose the tool and state the call. The figure is checked by executing the call against a fixture indexed by',
      "this repository's own pipeline, wherever the tool can run without a corpus.",
      '',
      '**The headline is the decoyed subset.** A task whose gold tool is the only plausible one measures nothing, so',
      'most tasks name a decoy: a real tool with a similar name that a keyword router picks and that is wrong for the',
      'stated intent. Accuracy on that subset is the only number where being right is distinguishable from being lucky.',
      '',
      '**The lexical arm is the null.** BM25 over the catalog, one deterministic attempt per task, no model. It stands',
      'in for a description-index router, which is what a product without an agent loop ships.',
    ],
    measuredAt: startedAt,
    commit: head,
    model: full === undefined ? 'none' : (process.env['AGENTIC_MODEL'] ?? 'deepseek-chat'),
    attempts: options.attempts,
    catalog: {
      tools: catalog.tools.length,
      fixture: FIXTURE.sourceDirs,
      indexedNodes,
      fixtureFiles: fixture.files.length,
    },
    tasks: tasks.length,
    taskClasses: taskClassCounts(),
    decoyedTasks: decoyedTasks().length,
    arms: Object.fromEntries(arms.map((arm) => [arm.config.name, summarise(arm.summary)])),
    comparison,
    perTask: arms.map((arm) => ({
      arm: arm.config.name,
      tasks: arm.summary.perTask,
    })),
    failures: Object.fromEntries(
      arms.map((arm) => [
        arm.config.name,
        arm.scores
          .filter((score) => score.failure !== null)
          .map((score) => ({
            taskId: score.taskId,
            attempt: score.attempt,
            failure: score.failure,
          })),
      ]),
    ),
  };

  if (options.write) {
    writeFileSync(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`agentic-tools: wrote ${relative(ROOT, ARTIFACT)}`);
  }

  const rate = (arm: typeof full): string =>
    arm === undefined || arm.summary.decoyed.value === null
      ? '—'
      : `${arm.summary.decoyed.value.toFixed(4)} [${(arm.summary.decoyed.lower ?? 0).toFixed(4)},${(arm.summary.decoyed.upper ?? 0).toFixed(4)}] ` +
        `(${String(arm.summary.decoyed.successes)}/${String(arm.summary.decoyed.total)})`;
  console.log(
    `AGENTIC-DECOYED full=${rate(full)} namesOnly=${rate(namesOnly)} lexical=${rate(lexical)} ` +
      `p(lexical)=${comparison['full_vs_lexical']?.pValue.toFixed(4) ?? '—'} ` +
      `p(namesOnly)=${comparison['full_vs_names_only']?.pValue.toFixed(4) ?? '—'}`,
  );
  return 0;
}

/** A summary in the shape the artifact stores: proportions as `{ n, of, value, lower, upper }`, never a bare number. */
function summarise(summary: ReturnType<typeof summariseArm>): Record<string, unknown> {
  const p = (value: {
    successes: number;
    total: number;
    value: number | null;
    lower: number | null;
    upper: number | null;
  }) => ({
    n: value.successes,
    of: value.total,
    value: value.value === null ? null : round(value.value),
    lower: value.lower === null ? null : round(value.lower),
    upper: value.upper === null ? null : round(value.upper),
  });
  return {
    overall: p(summary.overall),
    decoyed: p(summary.decoyed),
    passEvery: p(summary.passEvery),
    byClass: Object.fromEntries(
      Object.entries(summary.byClass).map(([klass, value]) => [klass, p(value)]),
    ),
    schema: p(summary.schema),
    grounding: p(summary.grounding),
    asserted: p(summary.asserted),
    failures: summary.failures,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.check) {
    process.exitCode = check();
    return;
  }
  if (options.selfTest) {
    process.exitCode = await selfTest();
    return;
  }
  if (options.run) {
    process.exitCode = await run(options);
    return;
  }
  console.error(
    'usage: agentic-tools.ts --check | --self-test | --run [--attempts N] [--limit N] [--task id ...] [--write]',
  );
  process.exitCode = 1;
}

// **Not a top-level `await`**: this file is loaded as CommonJS by `tsx`, where a bare `await` at module scope does not
// parse. The `.then` keeps the exit code and the stack trace, which is what a CI log needs.
main().catch((error: unknown) => {
  console.error(`agentic-tools: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
