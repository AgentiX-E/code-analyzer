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

/** The matrix keys an experiment is allowed to vary. */
type ArmKey =
  | 'adjudicate'
  | 'idioms'
  | 'agent'
  | 'code_context'
  | 'remarks'
  | 'ensemble'
  | 'second_concern'
  | 'lane_set';

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
 *
 * **`value` is the side that carries the device**, and it is required rather than inferred: `adjudicate` now has two
 * pairs, and a helper that took "the matrix that varies adjudicate" would hand one experiment's assertions the other
 * experiment's rows.
 */
function pair(varied: ArmKey, value: string): Arm[] {
  const pairs = alternatives().filter((matrix) => {
    if (matrix.length !== 2 || matrix[0]![varied] === matrix[1]![varied]) return false;
    // **Which side carries the device, named rather than assumed.** `adjudicate` has two pairs now - the retired
    // per-finding adjudicator (`off`/`on`) and R-36's keep-by-default gate (`off`/`falsifier`) - so "the matrix that
    // varies adjudicate" is ambiguous, and a helper that picked the first would hand the gate's assertions the retired
    // device's rows and report a sign that belongs to a different experiment.
    if (!matrix.some((arm) => arm[varied] === value)) return false;
    // **The only difference, not merely a difference.** The merge's pair moves `agent` and `code_context` as well - both
    // entailed by `ensemble` in `aacr-ablation-compare.mjs` - so a helper that matched on "differs in this key" would
    // hand that pair to the reading agent's assertions and report a device that was never varied.
    const keys = new Set([...Object.keys(matrix[0]!), ...Object.keys(matrix[1]!)]);
    return [...keys].filter((key) => matrix[0]![key] !== matrix[1]![key]).length === 1;
  });
  expect(
    pairs,
    `the workflow declares no two-arm matrix varying ${varied} to ${value}, so nothing is being compared`,
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
      agent: 'off',
      ensemble: 'off',
      remarks: 'off',
      second_concern: 'off',
      lane_set: 'shipped',
      change_shape: 'off',
    };
    const expected = new Set([
      expand(uploaded[0]!, baseline),
      expand(
        uploaded[0]!,
        pair('adjudicate', 'on').find((arm) => arm['adjudicate'] === 'on')!,
      ),
      expand(
        uploaded[0]!,
        pair('idioms', 'on').find((arm) => arm['idioms'] === 'on')!,
      ),
      // **And the reading agent's own arm**, because `agent: pair` buys it inside one dispatch and the comparison job
      // downloads it by this name. A dispatch that paid for the arm and then downloaded a name nobody uploaded is the
      // failure this whole file exists for, and it has already happened once.
      expand(
        uploaded[0]!,
        pair('agent', 'on').find((arm) => arm['agent'] === 'on')!,
      ),
      // **And the code-window control's arm.** §49.5: R-22's +0.0412 arrives with the window switched on inside the
      // reader, so the lanes are run with the window in a dispatch of their own and the difference is subtracted. A
      // control that is not downloaded is a control that was paid for and never read.
      expand(
        uploaded[0]!,
        pair('code_context', 'on').find((arm) => arm['code_context'] === 'on')!,
      ),
      // **And the remark pass's own arm**, because R-25 buys it inside one dispatch and a control or a device that is
      // paid for and then never downloaded is the failure this file exists for.
      expand(
        uploaded[0]!,
        pair('remarks', 'on').find((arm) => arm['remarks'] === 'on')!,
      ),
      // **And the merge's arm**, because §56's device is dispatched by `ensemble: pair` and the comparison job is the
      // only thing that reads it: an arm that is paid for and never downloaded is the failure this file exists for.
      expand(
        uploaded[0]!,
        alternatives()
          .filter((matrix) => matrix.length === 2)
          .find((matrix) => matrix.some((arm) => arm['ensemble'] === 'on'))!
          .find((arm) => arm['ensemble'] === 'on')!,
      ),
      // **And the one-sided merge's arm**, which is a different name for a different device (§58): `pair-reader` buys
      // the lanes and the reader-only selection pass in one dispatch, and the comparison downloads the second by name.
      expand(
        uploaded[0]!,
        alternatives()
          .filter((matrix) => matrix.length === 2)
          .find((matrix) => matrix.some((arm) => arm['ensemble'] === 'reader'))!
          .find((arm) => arm['ensemble'] === 'reader')!,
      ),
      // **And the second concern's arm**, which is §59's device side: `second_concern: pair` buys the lanes as they
      // ship and the lanes with the range rule's cross-category overlap kept, and the comparison downloads the second
      // by name. An arm paid for and never downloaded is the failure this file exists for, one device later.
      expand(
        uploaded[0]!,
        pair('second_concern', 'on').find((arm) => arm['second_concern'] === 'on')!,
      ),
      // **And the behaviour lane's arm**, which is R-35's device side and the first arm in this file whose two sides ask
      // a different *question* of the same diff rather than a different switch of one reviewer. The comparison job
      // downloads it by name; an arm paid for and never downloaded is the failure this file exists for, one device later.
      expand(
        uploaded[0]!,
        pair('lane_set', 'behaviour').find((arm) => arm['lane_set'] === 'behaviour')!,
      ),
      // **And the keep-by-default gate's arm**, which is R-36's device side: `pair: falsifier` buys the lanes as they
      // ship and the same lanes behind a gate that can only remove what it can quote a line for. It is a second pair
      // over the same key as §44's adjudicator, and the two are told apart by the value rather than by the key - which is
      // why `pair` takes the value it is looking for.
      expand(
        uploaded[0]!,
        pair('adjudicate', 'falsifier').find((arm) => arm['adjudicate'] === 'falsifier')!,
      ),
      // **And the second contract's arm**, which is §74's answer to §73 rather than a new device: the same gate with the
      // claim's own range removed from its evidence. It is a separate input value because §73's figure has to stay
      // reproducible from the switch that produced it - **a run that redefined `falsifier` would make the falsification
      // unfalsifiable**, which is the one outcome this repository's registrations exist to prevent.
      expand(
        uploaded[0]!,
        pair('adjudicate', 'falsifier-v2').find((arm) => arm['adjudicate'] === 'falsifier-v2')!,
      ),
      // **And the third contract's arm**, which is §78's answer to the shortfall rather than a new device: `v2` removed
      // 169 claims and left 148 behind because the only quotable line lay inside the claim, so `v3` adds the file's
      // untouched lines around each claim to the evidence. A run that paid for it and downloaded nothing would be the
      // failure this file exists for, one contract later.
      expand(
        uploaded[0]!,
        pair('adjudicate', 'falsifier-v3').find((arm) => arm['adjudicate'] === 'falsifier-v3')!,
      ),
      // **And the union's arm**, which is R-37's device side: `lane_set: pair-wide` buys the five lanes as they ship and
      // the same five plus `behaviour`. R-35 measured the substitution and it lost; **this is the same two lanes with the
      // choice removed**, so the comparison's sign answers whether width was the constraint rather than which of the two
      // questions is better.
      expand(
        uploaded[0]!,
        pair('lane_set', 'wide').find((arm) => arm['lane_set'] === 'wide')!,
      ),
      // **And the arm whose gate is told what the change wrote** (§79). `pair: change-shape` buys the second contract
      // twice - once as it ships, once with the classifier switched on - so the comparison can say whether the findings
      // it drops were findings at all. **It varies neither a reader nor a gate but a fact about the diff**, and it is
      // downloaded by name for the reason every other arm is: an arm paid for and never read is the failure this file
      // exists for.
      expand(
        uploaded[0]!,
        pair('change_shape', 'on').find((arm) => arm['change_shape'] === 'on')!,
      ),
      // **And the contract whose second block is an index** (§80). `pair: falsifier-v4` keeps §78's evidence rule and
      // replaces its 6 000-character window with a 600-character extract of the file's structure. It is a fourth value
      // on `adjudicate` rather than a change to the third, so §78's figure stays reproducible.
      expand(
        uploaded[0]!,
        pair('adjudicate', 'falsifier-v4').find((arm) => arm['adjudicate'] === 'falsifier-v4')!,
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

describe('the job name distinguishes the arms it runs', () => {
  it('reads every matrix key from the matrix rather than from the dispatch input', () => {
    // **A run page that shows two identical titles for two different arms is a run page that cannot be read.** The name
    // already carried four matrix keys and read the fifth from the input that collapsed the matrix, so the first
    // `agent: pair` dispatch produced two jobs both titled `agent pair` - which is the same defect, in the place the
    // workflow's own comment says it must not happen.
    const name = /\n    name: Our reviews on a direct competitor's corpus \((.+)\)\n/.exec(
      WORKFLOW,
    );
    expect(name, 'the bench job no longer declares a name').not.toBeNull();
    const keys = new Set(arms().flatMap((arm) => Object.keys(arm)));
    const referenced = new Set(
      [...name![1]!.matchAll(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g)].map((m) => m[1]!),
    );
    expect([...referenced].sort()).toEqual([...keys].sort());
    // **And nothing in the name is read from an input**, because an input is one value chosen once and given to both
    // arms - the arrangement that makes two arms indistinguishable in the only place a reader looks.
    expect(name![1]).not.toContain('inputs.');
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
    // **Six alternatives now, and the sixth is a control rather than a device**: `window: pair` runs the five lanes
    // twice, once shown the block each hunk sits in. It exists because the reading agent cannot be switched on without
    // being shown that block, so **R-22's +0.0412 contains an unmeasured component** and the cheapest way to measure it
    // is the arm that was deleted when the window stopped being an input (§49.5).
    // **And a single row for the merge**, because §56's device is both reviewers under one arm: `ensemble: on` implies
    // `agent: on` - the script refuses the combination where it does not - so a second row would buy the same merge
    // twice. Five singles and four pairs, enumerated rather than bounded for the reason above.
    //
    // **Six singles and seven pairs now, and the two new entries are one device counted twice by accident.** R-29's
    // dispatch emptied the lanes, so the arm it measured was a selection pass over the reader's candidates alone -
    // 0.2504 against 0.2148 on the confirmation slice. `ensemble: reader` is that device with a name: a single row when
    // it is the only arm asked for, and a pair when it is compared with the lanes. **Every entry here is a dispatch
    // somebody pays for**, so the shape is enumerated rather than bounded - an alternative that appeared by accident
    // would be a dispatch nobody chose, which is exactly what the arm itself was.
    expect(
      alternatives()
        .map((matrix) => matrix.length)
        .sort(),
      // **And a sixth pair for the merge**, dispatched by `ensemble: pair` on §57.5's registration: it is the pair whose
      // two arms are the claim's own two arms rather than a proxy, and R-29 could not be dispatched as one.
      // **And one pair and one single for the lane set**, which is R-35's device: `lane_set: pair` buys both questions
      // over the same rows, and `lane_set: on` is the diagnostic dispatch that prices one question without a comparison.
      // **And a seventh pair for the gate's second contract**, which is §74's discovery: the first contract's removals
      // were 24.9 % true positives against a pool rate of 21.3 %, and every sampled removal quoted the claim it attacked.
      // **And one single and one pair for the union**, which is R-37's device: `lane_set: wide` is the diagnostic dispatch
      // that prices the union without a comparison, and `pair-wide` is the comparison itself.
    ).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it('varies exactly one key, so that a difference between the arms is the device', () => {
    // **This is the assertion the file was missing.** `aacr-ablation-compare.mjs` refuses a pair whose artifacts differ
    // in more than one configuration key, and that refusal happens in the job that runs *after* both arms have been
    // paid for - so the only place this can be caught for free is here, before the dispatch. **Every pair**, because
    // the workflow now declares two experiments and a second pair that moved two keys would be refused after the bill.
    const experiments: [ArmKey, string][] = [
      ['adjudicate', 'on'],
      ['adjudicate', 'falsifier'],
      ['adjudicate', 'falsifier-v2'],
      ['adjudicate', 'falsifier-v3'],
      ['idioms', 'on'],
      ['agent', 'on'],
      ['second_concern', 'on'],
      ['lane_set', 'behaviour'],
      ['lane_set', 'wide'],
    ];
    for (const [varied, value] of experiments) {
      const [withArm, withoutArm] = pair(varied, value);
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
    const all = pair('adjudicate', 'on');
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
    const all = pair('idioms', 'on');
    expect(all.map((arm) => arm['idioms']).sort()).toEqual(['off', 'on']);
    for (const arm of all) {
      expect(arm['adjudicate']).toBe('off');
      expect(arm['code_context']).toBe('off');
    }
  });

  it('varies the reading agent, which is the arm R-22 registered', () => {
    // **The device is named here for the same reason the other two are**: a matrix that varies something nobody
    // registered produces a number no sentence in `EVAL-CONTRACT.md` predicted.
    //
    // **And the three retired devices are held still.** The claim check was falsified twice (§46.1), the code window
    // once (§20) and the idiom lane once (§47.7), so a pair that also moved any of them would be measuring two things -
    // and `aacr-ablation-compare.mjs` refuses that pair *after* both arms have been paid for.
    //
    // **Why this pair exists at all.** The reading agent has been dispatchable since §23 and every figure it produced
    // was compared against a lane arm from a different day; this repository's own artifact reports the same
    // configuration at 0.1691 and 0.2405 across two dispatches, which is larger than every registered effect. A device
    // measurable only across runs is not measurable by this instrument, and this arm is the fix.
    const all = pair('agent', 'on');
    expect(all.map((arm) => arm['agent']).sort()).toEqual(['off', 'on']);
    for (const arm of all) {
      expect(arm['code_context']).toBe('off');
      expect(arm['adjudicate']).toBe('off');
      expect(arm['idioms']).toBe('off');
      expect(arm['profile']).toBe('advisory');
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
    expect(compare![0]).toMatch(/\(inputs\.agent \|\| 'off'\) != 'on'/);
  });
});

describe('a download guard that the next device forgets to extend', () => {
  /**
   * **The comparison job's download steps, each with the condition that lets it run.**
   *
   * `null` is a step with no condition, which runs on every dispatch - the baseline arm is the only one that may.
   * A step's guard is read rather than re-derived, because the property under test is what the runner will evaluate and
   * the only way to know that is to read the expression it was given.
   */
  function downloadSteps(): { title: string; guard: string | null; artifact: string }[] {
    const job = WORKFLOW.slice(WORKFLOW.indexOf('\n  compare:'));
    return job
      .split(/\n {6}- name: /)
      .slice(1)
      .flatMap((chunk) => {
        const title = chunk.split('\n')[0]!.trim();
        if (!title.startsWith('Download')) return [];
        const guard = /\n {8}if: (.+)/.exec(chunk)?.[1]?.trim() ?? null;
        const artifact = /\n {10}name: (aacr-[\w-]+)/.exec(chunk)?.[1];
        expect(artifact, `${title} names no artifact`).toBeDefined();
        return [{ title, guard, artifact: artifact! }];
      });
  }

  /** **A guard evaluated, not pattern-matched**: one clause per `&&`, each a comparison of an input against a literal. */
  function guardFires(guard: string | null, inputs: Record<string, string>): boolean {
    if (guard === null) return true;
    return guard.split('&&').every((clause) => {
      const m = /\(inputs\.(\w+) \|\| '([^']*)'\)\s*(==|!=)\s*'([^']*)'/.exec(clause.trim());
      expect(m, `a guard clause is not an input comparison: ${clause.trim()}`).toBeTruthy();
      const value = inputs[m![1]!] ?? m![2]!;
      return m![3] === '==' ? value === m![4] : value !== m![4];
    });
  }

  /**
   * The one arm a pair dispatch buys, selected by the key the matrix *varies* - which is not the key the assertion cares
   * about. **The merge's arm carries `agent: on` as an entailment of `ensemble`**, so selecting "a matrix that has
   * `agent` on" finds three of them and none of the three is the reading agent's arm.
   */
  function deviceArm(varied: string, value: string): Arm {
    if (varied === 'ensemble') {
      const candidates = alternatives().filter(
        (matrix) => matrix.length === 2 && matrix.some((arm) => arm['ensemble'] === value),
      );
      expect(candidates, `no two-arm matrix buys ensemble=${value}`).toHaveLength(1);
      return candidates[0]!.find((arm) => arm['ensemble'] === value)!;
    }
    const rows = pair(varied as ArmKey, value);
    const arm = rows.find((row) => row[varied] === value);
    expect(arm, `the ${varied} pair has no arm with ${varied}=${value}`).toBeDefined();
    return arm!;
  }

  it('fires, on every pair dispatch, only the downloads that dispatch uploaded', () => {
    // **The defect this exists for, in its third costume.** Each new pair branch adds a download step and must add a
    // clause to the fallback step's guard; the fallback step is the one that downloads the *default* arm, and its guard
    // had been extended one device at a time until every previous device was named in it and the newest was not. R-35's
    // comparison job then ran on a `lane_set: pair` dispatch, downloaded `…off-on-off-off-off-off-off-shipped` - an arm
    // that matrix never produced - and failed **after both 146-pull-request arms had been paid for**, which is the same
    // failure the fifty- and hundred-row runs died of, after the same amount of money.
    // **Evaluating the guards rather than reading them** is what makes the next device fail here instead: the assertion
    // is about which steps run under which dispatch, so a guard that forgets its own input fails without anybody having
    // to remember the shape of the expression.
    const uploaded = artifactNames('upload').filter((name) => !isStatic(name));
    expect(uploaded).toHaveLength(1);
    const baseline: Arm = {
      profile: 'advisory',
      code_context: 'off',
      adjudicate: 'off',
      idioms: 'off',
      agent: 'off',
      ensemble: 'off',
      remarks: 'off',
      second_concern: 'off',
      lane_set: 'shipped',
      change_shape: 'off',
    };

    // **The input, the value a dispatch gives it, and the value the matrix then writes into the row** - three columns
    // because `pair` is a word the *dispatch* uses and the *arm* never carries: a guard reads the first and the artifact
    // name is built from the third.
    const dispatches: { input: string; value: string; varied: string; armValue: string }[] = [
      { input: 'window', value: 'pair', varied: 'code_context', armValue: 'on' },
      { input: 'agent', value: 'pair', varied: 'agent', armValue: 'on' },
      { input: 'idioms', value: 'pair', varied: 'idioms', armValue: 'on' },
      { input: 'remarks', value: 'pair', varied: 'remarks', armValue: 'on' },
      { input: 'second_concern', value: 'pair', varied: 'second_concern', armValue: 'on' },
      { input: 'ensemble', value: 'pair', varied: 'ensemble', armValue: 'on' },
      { input: 'ensemble', value: 'pair-reader', varied: 'ensemble', armValue: 'reader' },
      { input: 'lane_set', value: 'pair', varied: 'lane_set', armValue: 'behaviour' },
      // §56's device is bought by `pair: on`, whose row is the claim check switched on - so the fallback step's guard
      // has to exclude this input too, and this is the row that says so.
      { input: 'pair', value: 'on', varied: 'adjudicate', armValue: 'on' },
      // **And R-36's gate, which is the same input with the third value.** The fallback step's guard excludes
      // `falsifier` explicitly, because that dispatch's device arm is not the one it downloads.
      { input: 'pair', value: 'falsifier', varied: 'adjudicate', armValue: 'falsifier' },
      { input: 'pair', value: 'falsifier-v2', varied: 'adjudicate', armValue: 'falsifier-v2' },
      { input: 'pair', value: 'falsifier-v3', varied: 'adjudicate', armValue: 'falsifier-v3' },
      { input: 'lane_set', value: 'pair-wide', varied: 'lane_set', armValue: 'wide' },
    ];

    for (const { input, value, varied, armValue } of dispatches) {
      const inputs: Record<string, string> = {
        idioms: 'off',
        agent: 'off',
        window: 'off',
        remarks: 'off',
        second_concern: 'off',
        ensemble: 'off',
        lane_set: 'off',
        pair: 'off',
      };
      inputs[input] = value;
      const produced = new Set([
        expand(uploaded[0]!, baseline),
        expand(uploaded[0]!, deviceArm(varied, armValue)),
      ]);
      const fired = downloadSteps().filter((step) => guardFires(step.guard, inputs));
      // Two downloads: the device arm and the baseline. **A third is an arm nobody bought**, and the baseline exactly
      // once is what §56's duplicate-name failure was.
      expect(
        fired.map((step) => step.artifact).sort(),
        `on a ${input}=${value} dispatch the comparison downloads ${fired.map((step) => step.title).join(', ')}`,
      ).toEqual([...produced].sort());
    }
  });
});
