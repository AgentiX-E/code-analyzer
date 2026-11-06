#!/usr/bin/env node
// One instance of the Long Code Arena measurement, in its own process.
//
// **This file exists because the measurement has to survive its own analysis.** The Kotlin leg of
// `.github/workflows/lca-bug-localization.yml` died on its first instance - a thousand-file checkout, an analysis past
// what the runner could hold, `exit 143` - and took the whole part with it because the analyser and the record were the
// same process. `benchmark/lca-supervisor.ts` states the reasoning; this is the program it supervises.
//
// **It is a script rather than a test on purpose.** A test's process is shared with vitest, its module graph and every
// file the suite has loaded; a process that is going to be killed at a memory ceiling has to be a process with nothing
// else in it.
//
// Usage:
//   TSX_TSCONFIG_PATH=tsconfig.tests.json npx tsx scripts/lca-instance.ts \
//     --config py --checkout <dir> --row <row.json> --out <row-out.json> [--answer-arm]
//
// **The `tsconfig` is stated because a workspace import is not a relative one.** tsx resolves `@code-analyzer/analyzer`
// through the tsconfig it is pointed at; without this it reads the package's `main`, which points at a `dist/` this
// measurement does not build and does not want - a figure measured against a stale build would be a figure about the
// build. `scripts/lca-merge.ts` reaches the same modules and is run by the same tool.
//
// Exit codes: 0 when a row was written (measured or refused by the analysis), 2 when the arguments are wrong. **An
// analysis that throws is not an exit code** - it is a row whose `skipped` sentence names the defect, because a row is
// what the artifact can publish and an exit code is not.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  CONFIG_EXTENSION,
  DeclarationCeilingExceeded,
  corpusFiles,
  FIXED_MB,
  MB_PER_DECLARATION,
  MODEL_MARGIN_MB,
} from '../packages/intelligence/src/benchmark/lca-instrument.js';
import { measureInstance } from '../packages/intelligence/src/benchmark/lca-measure.js';
import { skippedRow } from '../packages/intelligence/src/benchmark/lca-merge.js';
import { DeepSeekProvider } from '../packages/intelligence/src/review/llm/provider.js';

import type { LcaConfigName } from '../packages/intelligence/src/benchmark/lca-instrument.js';
import type { LcaCorpusRow } from '../packages/intelligence/src/benchmark/lca-measure.js';

/** A flag's value, or `undefined` when it is absent. */
function flagOf(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

const config = flagOf('--config') as LcaConfigName | undefined;
const checkout = flagOf('--checkout');
const rowFile = flagOf('--row');
const out = flagOf('--out');
const fileRanking = flagOf('--file-ranking');
const budgetFlag = flagOf('--declaration-budget');

if (config === undefined || checkout === undefined || rowFile === undefined || out === undefined) {
  console.error(
    'lca-instance: --config, --checkout, --row and --out are all required; ' +
      'a measurement with a missing argument is not a measurement',
  );
  process.exit(2);
}

/**
 * The declaration budget, **or `null` when the parent stated none**.
 *
 * **A malformed budget stops the run rather than being read as zero.** `Number.parseInt('12x')` answers 12 and
 * `Number.parseInt('none')` answers `NaN`, and a child that treated the second as "no guard" would run an unbounded
 * analysis under a parent that believed it had set one. So the flag is parsed strictly here, where the mistake can still
 * be told to the caller, and the exit code says it was a specification error rather than a measurement.
 */
const declarationBudget: number | null = (() => {
  if (budgetFlag === undefined) return null;
  const parsed = Number(budgetFlag);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    console.error(
      `lca-instance: --declaration-budget ${budgetFlag} is not a positive integer; the guard it names cannot be built`,
    );
    process.exit(2);
  }
  return parsed;
})();

if (!existsSync(rowFile)) {
  console.error(`lca-instance: the row file ${rowFile} does not exist`);
  process.exit(2);
}

const row = JSON.parse(readFileSync(rowFile, 'utf8')) as LcaCorpusRow;

/** Write the row and stop. **The write is the contract**: the supervisor reads this file and nothing else. */
function emit(value: unknown): void {
  writeFileSync(out!, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const allFiles = corpusFiles(checkout!, CONFIG_EXTENSION[config!]);
  const provider =
    process.argv.includes('--answer-arm') && process.env['DEEPSEEK_API_KEY']
      ? new DeepSeekProvider({ timeout: 45_000 })
      : null;
  // **The parent's file-level ranking, when it produced one.** Read rather than recomputed: the parent has already read
  // one head per file of this answer space to score the fallback column, and reading them again here would charge the
  // same files to the job twice - which is what the nine instances iteration 76 never reached were spent on.
  const signals =
    fileRanking !== undefined && existsSync(fileRanking)
      ? (JSON.parse(readFileSync(fileRanking, 'utf8')) as string[])
      : undefined;

  try {
    const scored = await measureInstance({
      row,
      checkout: checkout!,
      allFiles,
      provider,
      ...(signals === undefined ? {} : { fileSignals: signals }),
      ...(declarationBudget === null ? {} : { declarationBudget }),
    });
    emit({ row: scored });
    console.log(
      `LCA-INSTANCE ${config!} id=${String(row.id)} measured offered=${String(scored.offered)} ` +
        `map=${scored.map.toFixed(4)} declarations=${(scored.declarationMap ?? 0).toFixed(4)} ` +
        `outside=${String(scored.outside)}`,
    );
  } catch (error) {
    // **The guard's refusal is a measurement of the run, not a defect of the repository**, so it is published as a row
    // with the arithmetic that produced it: the declaration the analysis had reached, the budget it was allowed, and the
    // model those two numbers come from. A reader can then check the ceiling against the row's own count instead of
    // trusting a rate fitted on four checkouts.
    const guarded = error instanceof DeclarationCeilingExceeded ? error : null;
    // **A repository the analyser cannot read is a fact about the repository**, and it is published as a refused row
    // rather than as a missing one: the difference between "this instance scored nothing" and "this instance was never
    // examined" is the difference between a figure and a hole.
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    emit({
      row: skippedRow({
        id: row.id,
        repo: `${row.repo_owner}/${row.repo_name}`,
        corpusFiles: allFiles.length,
        expectedFiles: row.changed_files.length,
        because:
          guarded === null
            ? `the analysis failed: ${String(message)}`
            : `the analysis reached ${String(guarded.declarations)} declarations, above the ` +
              `${String(guarded.budget)} this runner can pay for (${String(FIXED_MB)} MB fixed, ` +
              `${String(MODEL_MARGIN_MB)} MB of model margin and ${String(MB_PER_DECLARATION)} MB per declaration ` +
              'against the instance ceiling), and the graph was stopped there rather than grown until the ceiling ' +
              'killed the process',
      }),
    });
    console.log(
      `LCA-INSTANCE ${config!} id=${String(row.id)} ${guarded === null ? 'analysis failed' : 'declaration ceiling'}: ` +
        `${String(message)}`,
    );
  }
}

// **A `catch` rather than an unhandled rejection**: a process that dies without writing a row is a row lost to a
// reason nobody can read, which is exactly what this file exists to prevent.
main().catch((error: unknown) => {
  console.error(`lca-instance: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
