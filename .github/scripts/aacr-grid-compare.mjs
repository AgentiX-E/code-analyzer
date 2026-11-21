// @code-analyzer/scripts — what a factorial arm set bought, read off the artifacts rather than summed by hand
//
// **Why this is a different script from `aacr-ablation-compare.mjs`.** That one answers "did this device move the
// figure", and it answers it by subtraction: two artifacts, one differing key, `with` minus `without`. **A factorial
// cannot be answered by subtraction**, and the reason is structural rather than a matter of taste - with `k` factors at
// two levels there are `2^k` arms and no pair of them differs in only one key, so every pair a subtraction could form is
// a pair `variedField` refuses. The answer a factorial gives is a **difference of two means over disjoint row sets**:
// the four arms that set a factor against the four that do not.
//
// **And it is the only analysis that can find a combination.** Three iterations of single-factor ablations priced three
// devices and found nothing larger than the instrument's own resolution; the question they could not ask is whether two
// of them help each other, which is a question only a factorial asks.
//
// **The factors are read from the artifacts, not listed here.** Hard-coding `codeContext`, `adjudicate` and `remarks`
// would make this script a second declaration of the grid, and the first thing to drift - `aacr-plan-matrix.mjs` would
// buy a fourth factor and this file would silently average it away. Every configuration key that differs between the
// arms is a factor, which is the definition rather than a list.

/**
 * A configuration value as a string a reader can group by.
 *
 * **Objects are unwrapped rather than stringified**, because most of this repository's devices are written as
 * `{enabled, families, ceilingPerFile}` and `JSON.stringify` would make two runs of the same device differ by the
 * whitespace of a field neither of them consulted.
 */
import { pathToFileURL } from 'node:url';

function levelOf(value) {
  if (value === undefined || value === null) return 'absent';
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value;
    if ('enabled' in record) return String(record['enabled']);
    if ('mode' in record) return String(record['mode']);
    if ('name' in record) return String(record['name']);
    return JSON.stringify(record);
  }
  return String(value);
}

const mean = (values) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/** The four figures every arm is compared on, in the order a reader asks for them. */
const METRICS = ['f1', 'precision', 'recall', 'k', 'cacheNeutralUsd'];

/**
 * **The factors of a set of arms**: every configuration key whose value is not the same everywhere.
 *
 * Returned with the levels in the order first seen, so a report reads in the order the arms were dispatched rather than
 * in `Object.keys` order - which would put `adjudicate` before `codeContext` for no reason a reader can see.
 */
export function factorsOf(arms) {
  const keys = new Set();
  for (const arm of arms) for (const key of Object.keys(arm.configuration ?? {})) keys.add(key);

  return [...keys]
    .map((key) => {
      const seen = [];
      for (const arm of arms) {
        const level = levelOf(arm.configuration?.[key]);
        if (!seen.includes(level)) seen.push(level);
      }
      return { key, levels: seen };
    })
    .filter((factor) => factor.levels.length > 1);
}

/** One arm's figures, flattened for the report. */
function figuresOf(arm) {
  const spend = arm.spend ?? {};
  return {
    f1: arm.f1 ?? null,
    precision: arm.precision ?? null,
    recall: arm.recall ?? null,
    k: (arm.truePositives ?? 0) + (arm.falsePositives ?? 0),
    cacheNeutralUsd: spend.totalCacheNeutralUsd ?? tallyUsd(spend) ?? null,
  };
}

/** The spend total, for artifacts written before `totalCacheNeutralUsd` existed. */
function tallyUsd(spend) {
  if (
    typeof spend.judge?.cacheNeutralUsd === 'number' &&
    typeof spend.cacheNeutralUsd === 'number'
  ) {
    return spend.cacheNeutralUsd + spend.judge.cacheNeutralUsd;
  }
  return null;
}

/**
 * **A factor's main effect, as the mean of one level minus the mean of the others.**
 *
 * **Balanced only when the arms are.** A `2^k` grid makes every level half the arms and the two means equal-sized, which
 * is what lets a difference of means be read as the factor's contribution. An unbalanced set - a dispatch that bought
 * three of the eight rows - still produces a number here, and **the number is then confounded with which rows were
 * bought**; `balance` is reported so a reader can see that before trusting the effect.
 */
export function mainEffect(arms, factor) {
  const byLevel = new Map(factor.levels.map((level) => [level, []]));
  for (const arm of arms) {
    const level = levelOf(arm.configuration?.[factor.key]);
    byLevel.get(level)?.push(arm);
  }

  const summary = {};
  for (const level of factor.levels) {
    const group = byLevel.get(level) ?? [];
    const entry = { arms: group.length };
    for (const metric of METRICS) {
      entry[metric] = mean(group.map((arm) => figuresOf(arm)[metric]).filter((v) => v !== null));
    }
    summary[level] = entry;
  }

  const [first, second] = factor.levels;
  const effect = {};
  for (const metric of METRICS) {
    const a = summary[first]?.[metric];
    const b = summary[second]?.[metric];
    // **`to` minus `from`, which is the same sign convention as `variedField`'s `with` minus `without`.** A negative
    // number here means turning the device on made the figure worse, and reading it the other way round would report a
    // device that helped as one that hurt - the failure that makes two reports of one experiment disagree.
    effect[metric] = a === null || b === null || a === undefined || b === undefined ? null : b - a;
  }

  const sizes = factor.levels.map((level) => summary[level]?.arms ?? 0);
  return {
    key: factor.key,
    levels: factor.levels,
    summary,
    // **`from` to `to`, with the effect being the change from one to the other**, named rather than implied: a sign
    // without the direction it points in is the one thing this repository's registrations refuse.
    effect: { from: first, to: second, ...effect },
    balance: {
      balanced: new Set(sizes).size === 1,
      sizes,
      note:
        new Set(sizes).size === 1
          ? 'every level holds the same number of arms, so the two means are comparable'
          : 'the levels hold different numbers of arms, so an effect here is confounded with which rows were bought',
    },
  };
}

/**
 * **Every arm of a factorial, with the best one named under three different questions.**
 *
 * **Three questions rather than one**, because the last three iterations' failure was choosing a single figure and
 * optimising it: the best F1 is the arm that says the most, the best precision is the arm a reviewer would want shipped,
 * and the best F1 per dollar is the arm that is worth buying again. **An arm that wins all three is the only one that
 * needs no trade-off argument**, and a set where no arm wins all three is the answer "this factor set does not contain a
 * free lunch", which is also worth knowing before the next dispatch.
 *
 * @param {Array<{label: string, configuration?: Record<string, unknown>}>} arms
 */
export function analyseGrid(arms) {
  const rows = arms.map((arm) => ({
    label: arm.label,
    ...figuresOf(arm),
    configurations: Object.fromEntries(
      factorsOf(arms).map((factor) => [factor.key, levelOf(arm.configuration?.[factor.key])]),
    ),
  }));

  const factors = factorsOf(arms).map((factor) => mainEffect(arms, factor));

  const bestBy = (metric) => {
    const ranked = rows.filter((row) => row[metric] !== null).sort((a, b) => b[metric] - a[metric]);
    return ranked[0] ?? null;
  };

  const efficiency = rows
    .filter(
      (row) => row['f1'] !== null && row['cacheNeutralUsd'] !== null && row['cacheNeutralUsd'] > 0,
    )
    .map((row) => ({ label: row.label, f1PerUsd: row['f1'] / row['cacheNeutralUsd'] }))
    .sort((a, b) => b.f1PerUsd - a.f1PerUsd);

  // **A factorial is `2^k` arms over `k` factors, and a set that is not is not a factorial.** Two arms that differ in
  // two keys are two arms, not a `2^2`: their two effects are the same number twice, and reporting it as two factors
  // would read as two independent measurements of one difference. §129's whole argument is that a combination needs a
  // design rather than a pile of arms, so the report says which of the two it is.
  const expected = 2 ** factors.length;
  const complete = rows.length === expected;

  return {
    kind:
      rows.length === 1
        ? 'single'
        : factors.length === 0
          ? 'replicates'
          : complete
            ? 'grid'
            : 'incomplete',
    arms: rows.length,
    /** How many arms a `2^k` design over these factors would need, beside how many were read. */
    design: { factors: factors.length, expectedArms: expected, readArms: rows.length, complete },
    factors,
    rows,
    best: {
      // **`null` rather than a fabricated row**, because an arm set with no figure cannot name a best arm and a report
      // that invented one would be read as a measurement.
      byF1: bestBy('f1'),
      byPrecision: bestBy('precision'),
      byEfficiency: efficiency[0] ?? null,
    },
    // **The one combination that wins all three is the one to dispatch again**, and naming it is the point of the whole
    // exercise. `null` here is a real answer: no arm wins on every question, so the next dispatch is a trade-off.
    consensus:
      [bestBy('f1')?.label, bestBy('precision')?.label, efficiency[0]?.label].filter(Boolean)
        .length === 3 &&
      new Set([bestBy('f1')?.label, bestBy('precision')?.label, efficiency[0]?.label]).size === 1
        ? bestBy('f1')?.label
        : null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * **Every directory given on the command line, read as one arm.**
 *
 * The workflow downloads each artifact into its own directory rather than merging them, because **a merge would put eight
 * `aacr-bench.json` files in one folder under the same name** - the last one written wins silently, and the report would
 * describe one arm eight times. That is the failure this signature exists to make impossible: one path, one arm, and a
 * missing path is a refusal rather than a smaller grid.
 */
async function readArms(directories) {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  return directories.map((directory) => {
    const path = join(directory, 'aacr-bench.json');
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`an arm's artifact could not be read at ${path}: ${String(error)}`);
    }
    return {
      // **The directory name, because it is the artifact name**, which is the only label that survives the download.
      label: directory.replace(/\/+$/u, '').split('/').pop() ?? directory,
      configuration: artifact.configuration ?? {},
      f1: artifact.f1,
      precision: artifact.precision,
      recall: artifact.recall,
      truePositives: artifact.truePositives,
      falsePositives: artifact.falsePositives,
      spend: artifact.spend,
    };
  });
}

/** A markdown table, because the report is read in a run page before it is read in a file. */
function table(report) {
  const header = '| arm | F1 | precision | recall | k | cold USD |';
  const divider = '| --- | ---: | ---: | ---: | ---: | ---: |';
  const cell = (value, digits = 4) =>
    value === null || value === undefined ? '—' : value.toFixed(digits);
  const rows = report.rows
    .slice()
    .sort((a, b) => (b.f1 ?? -1) - (a.f1 ?? -1))
    .map(
      (row) =>
        `| ${row.label} | ${cell(row.f1)} | ${cell(row.precision)} | ${cell(row.recall)} | ${String(row.k)} | ${cell(row.cacheNeutralUsd, 3)} |`,
    );
  return [header, divider, ...rows].join('\n');
}

function effectsTable(report) {
  if (report.factors.length === 0) return '_One arm: there is no factor to price._';
  const header =
    '| factor | from → to | ΔF1 (to − from) | Δprecision | Δrecall | Δcold USD | balanced |';
  const divider = '| --- | --- | ---: | ---: | ---: | ---: | :---: |';
  const cell = (value) =>
    value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(4)}`;
  const rows = report.factors.map(
    (factor) =>
      `| ${factor.key} | ${factor.effect.from} → ${factor.effect.to} | ${cell(factor.effect.f1)} | ${cell(factor.effect.precision)} | ${cell(factor.effect.recall)} | ${cell(factor.effect.cacheNeutralUsd)} | ${factor.balance.balanced ? 'yes' : '**no**'} |`,
  );
  return [header, divider, ...rows].join('\n');
}

/**
 * **The arithmetic, on a grid whose answer was written down before the numbers were.**
 *
 * This job's null branch is the branch a device that does nothing would take, and a report whose null branch is wrong
 * prints "no effect" as a finding. The fixture is a `2^2` with `codeContext` worth exactly +0.10 and `remarks` exactly
 * +0.04, no interaction, so **a main effect that returns anything else is measuring the arm order rather than a
 * factor** - and the fourth assertion is the one that makes the first three mean something: two arms are refused as a
 * factorial, which is the shape three iterations actually ran.
 */
export function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`grid readback self-test failed: ${message}`);
  };
  const fixture = (label, codeContext, remarks, f1) => ({
    label,
    configuration: { codeContext, remarks },
    f1,
    precision: f1 / 2,
    recall: f1,
    truePositives: 0,
    falsePositives: 0,
    spend: { totalCacheNeutralUsd: 1 },
  });
  const arms = [
    fixture('off/off', false, false, 0.2),
    fixture('off/on', false, true, 0.24),
    fixture('on/off', true, false, 0.3),
    fixture('on/on', true, true, 0.34),
  ];

  const report = analyseGrid(arms);
  assert(report.kind === 'grid', `a 2^2 was read as ${report.kind}`);
  assert(report.design.complete, 'a complete 2^2 was reported as incomplete');

  const codeContext = report.factors.find((factor) => factor.key === 'codeContext');
  assert(codeContext !== undefined, 'the codeContext factor was not found');
  assert(
    Math.abs(codeContext.effect['f1'] - 0.1) < 1e-9,
    `codeContext was worth ${String(codeContext.effect['f1'])}, not 0.1`,
  );

  const remarks = report.factors.find((factor) => factor.key === 'remarks');
  assert(remarks !== undefined, 'the remarks factor was not found');
  assert(
    Math.abs(remarks.effect['f1'] - 0.04) < 1e-9,
    `remarks was worth ${String(remarks.effect['f1'])}, not 0.04`,
  );

  // **And the refusal, which is the assertion the other three depend on.** Two arms over two keys is what three
  // iterations ran; reading it as a grid would print one effect twice and call it two findings.
  const pile = analyseGrid([fixture('a', false, false, 0.2), fixture('b', true, true, 0.34)]);
  assert(pile.kind === 'incomplete', `two arms over two keys was read as ${pile.kind}`);
  assert(
    pile.factors[0]?.effect['f1'] === pile.factors[1]?.effect['f1'],
    'two arms over two keys produced two different effects, which is impossible',
  );

  return 'grid readback: 6 assertions hold';
}

async function main() {
  const directories = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  if (directories.length === 0) {
    throw new Error('no arm directories were given: pass one download directory per artifact');
  }
  const arms = await readArms(directories);
  const report = analyseGrid(arms);

  const outFlag = process.argv.indexOf('--out');
  const outPath = outFlag === -1 ? null : process.argv[outFlag + 1];

  const lines = [
    `# Factorial readback: ${String(report.arms)} arms, ${String(report.factors.length)} factor(s)`,
    '',
    report.design.complete
      ? `A complete \`2^${String(report.design.factors)}\` design: every factor is set in exactly half the arms, so an effect is a difference of two equal-sized means.`
      : `**Not a factorial.** ${String(report.design.factors)} factor(s) over ${String(report.arms)} arm(s) needs ${String(
          report.design.expectedArms,
        )} arms; **each effect below is confounded with the others**, and no interaction can be read.`,
    '',
    '## Every arm',
    '',
    table(report),
    '',
    '## Main effects (mean of one level minus the mean of the others)',
    '',
    effectsTable(report),
    '',
    '## Best under each question',
    '',
    `- by F1: ${report.best.byF1?.label ?? '—'}`,
    `- by precision: ${report.best.byPrecision?.label ?? '—'}`,
    `- by F1 per cold USD: ${report.best.byEfficiency?.label ?? '—'}`,
    `- wins all three: ${report.consensus ?? '**none — the next dispatch is a trade-off**'}`,
  ];

  const markdown = `${lines.join('\n')}\n`;
  process.stdout.write(markdown);

  if (outPath !== null) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }
}

// **Called only when run directly**, so a test can import the arithmetic without a file system.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) {
    try {
      process.stdout.write(`${selfTest()}\n`);
    } catch (error) {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    }
  } else {
    main().catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
