// An artifact a job downloads by a name nothing uploads fails the job at the download, not at the comparison
//
// **The defect this exists for.** When the benchmark matrix was renamed from `checklist: [with, without]` to
// `profile: [defect, advisory]`, three strings had to move with it: the emission profile the code reads, the upload name,
// and the download name. Two moved. The third became `aacr-bench-defectout` - the old `without` with `defect` substituted
// into the front of it - and nothing noticed, because a download of a name that does not exist is a step that fails in
// the job that runs *after* the money is spent.
//
// **What it cost.** The fifty-pull-request run and the hundred-pull-request confirmation both completed their two arms,
// both uploaded both artifacts, and both ended as `failure` at the step whose output is the only reason the run was
// dispatched. The measurements existed and the verdict did not, twice, at about five dollars a dispatch.
//
// **Why the check is here and not in the workflow.** GitHub cannot validate an artifact name against another job's
// matrix: the name is a string in YAML, and the matrix that produces it is a list in a different job. That is a fact
// about the names, so it is checked by reading the names.
//
// **And iteration 124 added the assertion this file was missing.** The two arms of an experiment must differ in exactly
// one key, and until now that was a property of how somebody wrote the matrix rather than something a test could fail
// on. It is a check now: `arms()` returns the matrix as objects, and the pair is required to differ in one key - because
// **a matrix that varies two things answers neither**, and the comparison job's `variedField` refuses a pair whose
// artifacts differ in more than one key, so the refusal would arrive after both arms had been paid for.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
  'utf8',
);

/** One combination the bench job runs, as the keys the matrix declares. */
type Arm = Record<string, string>;

/** One inline mapping's body - `profile: advisory, code_context: off` - read as an arm. */
function armOf(body: string, source: string): Arm {
  const arm: Arm = {};
  for (const pair of body.split(',')) {
    const kv = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(pair);
    expect(kv, `a matrix arm has a field that is not key: value: (${source}) ${pair}`).toBeTruthy();
    arm[kv![1]!] = kv![2]!.replace(/^['"]|['"]$/g, '');
  }
  return arm;
}

/**
 * **Every matrix the workflow can produce, as the `include` entries it declares - not as a cross product.**
 *
 * The workflow writes the rows it intends explicitly, so that a difference between two of them is a variable somebody
 * chose; reading the matrix as a cross product would be reading the shape it deliberately does not have, and would
 * silently accept a matrix that acquired a second key and quadrupled the bill.
 *
 * **It can write them two ways, and both are read here.** A literal list of `- {profile: …}` entries is the plain form.
 * The computed form is a `fromJSON(...)` expression holding the same rows as JSON string literals, and **it exists
 * because a *job-level* `if` cannot see `matrix`**: the dispatch that tried it was refused with *"Unrecognized
 * named-value: 'matrix'"* and the workflow did not load, so collapsing the run to a single row when the arm under test
 * reads the code for itself had to happen inside the matrix. **A computed matrix is a list of alternatives rather than
 * one list**, which is why this returns a list of them - the assertions below are about a matrix, and there is now more
 * than one a dispatch can run.
 */
function alternatives(): Arm[][] {
  const includeLine = /matrix:[^\n]*\n\s*include:\s*([^\n]+)/.exec(WORKFLOW);
  expect(includeLine, 'the workflow no longer declares a matrix `include`').not.toBeNull();
  const declared = includeLine![1]!;

  // The computed form: the rows are JSON literals inside the expression, escaped for YAML's single-quoted scalar, so
  // each one arrives as `''[{…}]''`. **Parsed rather than pattern-matched**, because the property under test is what the
  // runner will actually expand, and only a parser knows that.
  const jsonLiterals = [...declared.matchAll(/''(\[[^']*\])''/g)].map((match) => match[1]!);
  if (jsonLiterals.length > 0) {
    return jsonLiterals.map((text) => JSON.parse(text) as Arm[]);
  }

  // The literal form: one `- {…}` line per row, under `include:`.
  const block = /matrix:\s*\n\s*include:\s*\n((?:\s*-[^\n]*\n)+)/.exec(WORKFLOW);
  expect(
    block,
    'the matrix declares neither JSON alternatives nor an inline mapping list',
  ).not.toBeNull();
  const rows = block![1]!
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- {'))
    .map((line) => {
      const body = /^-\s*\{(.*)\}$/.exec(line)?.[1];
      expect(body, `a matrix arm is not an inline mapping: ${line}`).toBeTruthy();
      return armOf(body!, line);
    });
  return [rows];
}

/** Every arm of every alternative, for the assertions that hold of the workflow as a whole. */
function arms(): Arm[] {
  return alternatives().flat();
}

/**
 * **The alternative that runs a pair**, and the reason the assertions about a device are made against it rather than
 * against `arms()`: a single-row matrix has no second arm to differ from, and reading one row as a pair would compare an
 * arm with itself and call the difference zero. Exactly one alternative is expected to be a pair - the default run.
 */
function pair(varied: 'adjudicate' | 'idioms'): Arm[] {
  const pairs = alternatives().filter(
    (matrix) => matrix.length === 2 && matrix[0]![varied] !== matrix[1]![varied],
  );
  expect(
    pairs,
    `the workflow declares no two-arm matrix varying ${varied}, so nothing is being compared`,
  ).toHaveLength(1);
  return pairs[0]!;
}

/**
 * **Every `name:` that follows an `upload-` or `download-artifact` action**, with the matrix expression expanded.
 *
 * Read as text because that is what GitHub does with it: the name is a YAML string, and the only way for it to be wrong
 * is for the string to disagree with the list - which is the disagreement this checks.
 */
function artifactNames(action: 'upload' | 'download'): string[] {
  const names: string[] = [];
  const lines = WORKFLOW.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.includes(`actions/${action}-artifact@`)) continue;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      // The value may contain spaces inside `${{ }}`, so it is not `\S+`.
      const m = /^\s*name:\s*(.+?)\s*$/.exec(lines[j]!);
      if (m) {
        names.push(m[1]!);
        break;
      }
      // A second action starts before a name was found, so this one has none.
      if (lines[j]!.includes('uses:')) break;
    }
  }
  return names;
}

/** The `options` a `choice` dispatch input declares, in the order it declares them. */
function choiceOptions(name: string): string[] {
  const block = new RegExp(
    `\\n      ${name}:\\n(?:(?!\\n      [a-z_]+:)[\\s\\S])*?\\n        options: \\[([^\\]]*)\\]`,
  ).exec(WORKFLOW);
  expect(block, `the ${name} input declares no \`options\``).not.toBeNull();
  return block![1]!.split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
}

/** A name with every `${{ matrix.key }}` replaced by that arm's value. */
function expand(name: string, arm: Arm): string {
  return name.replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_whole, key: string) => {
    expect(
      arm[key],
      `the name ${name} uses matrix.${key}, which the matrix does not declare`,
    ).toBeDefined();
    return arm[key]!;
  });
}

/** Whether a name still carries an uninterpolated expression after expansion. */
function isStatic(name: string): boolean {
  return !/\$\{\{/.test(name);
}

describe('the artifact names of the benchmark workflow', () => {
  it('downloads only names that some job uploads', () => {
    const expanded = new Set<string>();
    for (const name of artifactNames('upload')) {
      if (isStatic(name)) {
        expanded.add(name);
        continue;
      }
      for (const arm of arms()) expanded.add(expand(name, arm));
    }

    const downloads = artifactNames('download');
    expect(downloads.length).toBeGreaterThanOrEqual(2);
    for (const name of downloads) {
      expect(expanded, `${name} is downloaded but no job uploads it`).toContain(name);
    }
  });

  it('downloads every arm of every pair, and the baseline exactly once', () => {
    // **Two experiments can reach the comparison job** - `adjudicate`, the retired device kept as an ablation
    // reference, and `idioms`, the arm R-21 registered - and each has its own arm to collect. **What must not happen is
    // a dispatch that pays for an arm and then downloads a name nobody uploaded**, which is the failure this file
    // exists for: the artifact set is exactly the three arms that can be the `with` side of one of the two experiments,
    // plus the baseline they are both compared against, and the baseline is one download rather than two.
    const downloads = artifactNames('download');
    expect(new Set(downloads).size).toBe(downloads.length);
    const uploaded = artifactNames('upload').filter((name) => !isStatic(name));
    expect(uploaded.length).toBe(1);
    const baseline: Arm = {
      profile: 'advisory',
      code_context: 'off',
      adjudicate: 'off',
      idioms: 'off',
    };
    const expected = new Set([
      expand(uploaded[0]!, baseline),
      expand(
        uploaded[0]!,
        pair('adjudicate').find((arm) => arm['adjudicate'] === 'on')!,
      ),
      expand(
        uploaded[0]!,
        pair('idioms').find((arm) => arm['idioms'] === 'on')!,
      ),
    ]);
    expect(new Set(downloads)).toEqual(expected);
  });
});

describe('the comparison runs only when there is a pair to compare', () => {
  it('gates the paired job on the input that buys the second arm', () => {
    // **The job that reports a comparison is not the job that should discover there is nothing to compare.** A
    // single-row matrix has no counterpart, and `compare` reading its `if` from the same input that chose the matrix is
    // the only arrangement in which the two cannot disagree: a job-level `if` cannot see `matrix`, which is why the
    // rows are computed inside the matrix expression and the gate is computed from the input beside it.
    const gate = /\n  compare:\n(?:.*\n)*?    if: (.+)\n/.exec(WORKFLOW);
    expect(gate, 'the comparison job no longer declares a condition').not.toBeNull();
    expect(gate![1]).toContain("(inputs.pair || 'off') == 'on'");
    // **And the second experiment's own gate**, because `idioms: pair` buys an arm too and a comparison job that only
    // ran for the other one would spend a hundred pull requests and then report nothing.
    expect(gate![1]).toContain("(inputs.idioms || 'off') == 'pair'");
    // **And the pairing is checked against the same input the matrix reads**, so an input renamed in one place and not
    // the other fails here rather than leaving a dispatch that pays for two arms and compares none.
    expect(WORKFLOW).toContain("(inputs.pair || ''off'') == ''on''");
  });
});

describe('the matrix is one experiment', () => {
  it('runs a pair by default and one row when the reviewer reads the code for itself', () => {
    // **Every arm is paid for**, so the count is a budget and not a style. A third entry is a dispatch that costs half
    // again as much for a comparison the paired test was not registered to make.
    //
    // **And the single row is not a saving, it is a different question.** When the agent is the reviewer it reads the
    // file it needs, so `code_context` is not a variable it consults: two rows would buy the same measurement twice and
    // write two artifacts whose difference is a switch neither of them read. The assertion is the shape of that
    // decision - one pair, one single, and nothing else.
    // **Two single-row alternatives now, and the reason is the retired device rather than a tidy-up.** §45's
    // registration carried its own stopping rule and R-20 falsified it, so the default dispatch buys one arm; a pair is
    // still declared behind `pair: on`, because the code stays in the tree as an ablation reference and re-pricing it is
    // a decision with a price. **The assertion is a budget**: every alternative is a run somebody pays for, so the shape
    // is enumerated rather than bounded - an alternative that appeared by accident would be a dispatch nobody chose.
    // **Five alternatives now**: the agent's single row, the idiom lane's pair, the idiom lane alone (a diagnostic
    // dispatch that prices the lane without a comparison), the claim check's pair, and the default single row.
    expect(
      alternatives()
        .map((matrix) => matrix.length)
        .sort(),
    ).toEqual([1, 1, 1, 2, 2]);
  });

  it('varies exactly one key, so that a difference between the arms is the device', () => {
    // **This is the assertion the file was missing.** `aacr-ablation-compare.mjs` refuses a pair whose artifacts differ
    // in more than one configuration key, and that refusal happens in the job that runs *after* both arms have been
    // paid for - so the only place this can be caught for free is here, before the dispatch. **Every pair**, because
    // the workflow now declares two experiments and a second pair that moved two keys would be refused after the bill.
    for (const varied of ['adjudicate', 'idioms'] as const) {
      const [withArm, withoutArm] = pair(varied);
      const keys = new Set([...Object.keys(withArm!), ...Object.keys(withoutArm!)]);
      const differ = [...keys].filter((key) => withArm![key] !== withoutArm![key]);
      expect(differ, `the ${varied} arms differ in ${differ.join(' and ')}`).toHaveLength(1);
    }
  });

  it('varies the claim check, which is the device iteration 141 registered', () => {
    // Named rather than derived: **a matrix that varies something nobody registered is a dispatch that produces a
    // number no sentence in `EVAL-CONTRACT.md` predicted**, and this line is what makes the arm's identity reviewable
    // in a diff instead of only in a run page.
    // **Located by value rather than by position**, because the order of `include` entries is a fact about the YAML and
    // not about the experiment: reading the first entry as "the arm with the device" would invert every sign in the
    // comparison the moment somebody sorted the list.
    //
    // **The previous device is still pinned, and that is the part worth stating.** §20/R-18 measured the code window at
    // −0.0065 against a registered +0.02 and left it falsified, so both arms read the diff without one: **the pin is
    // what makes the pair a comparison of the claim check rather than of two devices at once.**
    const all = pair('adjudicate');
    const keys = [...new Set(all.flatMap((arm) => Object.keys(arm)))];
    const varied = keys.find((key) => all[0]![key] !== all[1]![key]);
    expect(varied).toBe('adjudicate');
    const withDevice = all.find((arm) => arm['adjudicate'] === 'on');
    const withoutDevice = all.find((arm) => arm['adjudicate'] === 'off');
    expect(withoutDevice, 'the matrix declares no `off` arm to compare against').toBeDefined();
    expect(withDevice, 'the matrix declares no `on` arm, which is the device').toBeDefined();
    expect(all.map((arm) => arm['adjudicate']).sort()).toEqual(['off', 'on']);
    // **And the retired device is held still**, because a pair that also moved it would be measuring two things.
    for (const arm of all) expect(arm['code_context']).toBe('off');
  });

  it('varies the idiom lane, which is the arm R-21 registered', () => {
    // **The device under test is named here for the same reason the claim check is**: a matrix that varies something
    // nobody registered produces a number no sentence in `EVAL-CONTRACT.md` predicted, and this line is what makes the
    // arm's identity reviewable in a diff rather than only in a run page.
    //
    // **And the two retired devices are held still**, because a pair that also moved either of them would be measuring
    // two things: the claim check was falsified twice (§46.1) and the code window once (§20), and neither is a variable
    // an experiment about maintainability remarks may smuggle in.
    const all = pair('idioms');
    expect(all.map((arm) => arm['idioms']).sort()).toEqual(['off', 'on']);
    for (const arm of all) {
      expect(arm['adjudicate']).toBe('off');
      expect(arm['code_context']).toBe('off');
    }
  });

  it('pins the profile to the one R-17 did not falsify', () => {
    // **§19.3 falsified the 0.22 floor at +0.0079 against a registered +0.02**, so `advisory` is the default and
    // `defect` is a measured but retired configuration. A cross product with it would double this dispatch's bill to
    // answer a question that already has an answer. **Every arm of every matrix**, because the single row is still an
    // arm somebody pays for.
    for (const arm of arms()) expect(arm['profile']).toBe('advisory');
  });

  it('takes the code window from the matrix rather than from a dispatch input', () => {
    // **The input is what made R-18 two dispatches.** One value per dispatch cannot produce two arms, and two
    // dispatches of this job have reported the same configuration at 0.1691 and 0.2405. Deleting the input is the fix;
    // this assertion is what stops it coming back.
    expect(WORKFLOW).toContain('AACR_CODE_CONTEXT: ${{ matrix.code_context }}');
    expect(WORKFLOW).not.toMatch(/inputs\.code_context/);
  });

  it('takes the claim check from the matrix for the same reason', () => {
    // **The same defect would arrive the same way**: an `AACR_ADJUDICATE` read from a dispatch input is one value given
    // to both arms, which produces two artifacts whose only difference is a switch neither of them was given.
    expect(WORKFLOW).toContain('AACR_ADJUDICATE: ${{ matrix.adjudicate }}');
    expect(WORKFLOW).not.toMatch(/inputs\.adjudicate/);
  });

  it('lets the dispatch choose every value the matrix reads', () => {
    // **A matrix branch a dispatch cannot reach is a branch nobody runs**, and a choice input is where that happens: the
    // `idioms` input was written with `['off', 'on']` and the matrix then gained a `pair` branch, so the first dispatch
    // of R-21 was refused with *"Provided value 'pair' for input 'idioms' not in the list of allowed values"* - a
    // refusal that cost nothing only because it arrived before the run existed.
    const declared = choiceOptions('idioms');
    expect(declared).toContain('pair');
    // **And every value the matrix expression tests is one of them**, read out of the expression rather than listed
    // again here: a fourth branch added without a fourth option would fail this line instead of a dispatch.
    const tested = [...WORKFLOW.matchAll(/inputs\.idioms \|\| 'off'\) == '([a-z]+)'/g)].map(
      (match) => match[1]!,
    );
    expect(tested.length).toBeGreaterThan(1);
    for (const value of tested) expect(declared, `the matrix reads ${value}`).toContain(value);
  });

  it('takes the idiom lane from the matrix, not from the dispatch input', () => {
    // **A device read from a dispatch input is one value given to both arms**, which produces two artifacts whose only
    // difference is a switch neither of them was given - the defect that made R-18 two dispatches. The input chooses
    // which matrix to expand; the switch itself can only come from the row.
    expect(WORKFLOW).toContain('AACR_IDIOMS: ${{ matrix.idioms }}');
  });

  it('does not go looking for a counterpart when the matrix has one row', () => {
    // **The first agent dispatch failed here**, at `Download the run without it`, looking for an artifact the
    // single-row matrix never produces - after the money was spent, in the job whose purpose was to report a figure
    // the arm had already computed. The comparison job is gated on the input that collapses the matrix, because a
    // difference between one arm and nothing is not a comparison.
    const compare = /  compare:[\s\S]*?\n    steps:/.exec(WORKFLOW);
    expect(compare, 'the workflow no longer declares a `compare` job').not.toBeNull();
    expect(compare![0]).toMatch(/if: \(inputs\.agent \|\| 'off'\) != 'on'/);
  });
});
