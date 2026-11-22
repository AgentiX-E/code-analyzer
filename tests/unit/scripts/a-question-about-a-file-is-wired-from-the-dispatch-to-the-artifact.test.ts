/**
 * **A second instrument that reaches the script and not the artifact is a figure nobody can attribute.**
 *
 * `lib/file-semantic.mjs` implements the corpus's own arithmetic - `file-level-semantic-v1`, one call per file with
 * every reference comment of that file in a numbered list - and §137 measured what asking a pairwise judge instead cost:
 * **141 of 254 rejected reference comments sat on the same line as a finding this reviewer had emitted**, and the
 * pairwise judge called all 141 different defects. The device that answers them is a judge shown the file.
 *
 * **Four connections, and the one that is deliberately absent.**
 *
 * 1. a dispatch input, so a run that asks is a decision rather than a default;
 * 2. an environment variable the workflow sets (`AACR_FILE_SEMANTIC_JUDGE`), and only ever `1` or `0`;
 * 3. the configuration key, which is what makes two artifacts that differ here comparable as two protocols;
 * 4. the second reading computed **beside** the first in the same run.
 *
 * **No `matrix` row**, because a second reading is not a second arm: it is asked over the same findings, the same
 * goldens and the same reviewer, so one run produces the pair and the difference between them is the question rather
 * than the day - which is the whole reason §137.1 could register a delta instead of two dispatches.
 *
 * **The refusal is the fifth connection and the one a typo meets first.** `AACR_FILE_SEMANTIC_JUDGE=on` must throw
 * before a call, not fall through to the pairwise arm: a run that publishes the old instrument under the new one's name
 * is the defect §58.1 recorded, one device later.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

describe('the second question is wired from the dispatch to the artifact', () => {
  it('is a dispatch input whose default is the instrument every published figure used', () => {
    const input = WORKFLOW.slice(WORKFLOW.indexOf('      file_semantic_judge:'));
    expect(input.slice(0, 3000)).toContain("options: ['off', 'on']");
    expect(input.slice(0, 3000)).toContain("default: 'off'");
  });

  it('reaches the script through one variable that is only ever 1 or 0', () => {
    expect(WORKFLOW).toContain(
      "AACR_FILE_SEMANTIC_JUDGE: ${{ inputs.file_semantic_judge == 'on' && '1' || '0' }}",
    );
    expect(BENCH).toContain("process.env['AACR_FILE_SEMANTIC_JUDGE']");
  });

  it('refuses an unrecognised value before a single call, rather than defaulting to the measured side', () => {
    expect(BENCH).toContain('is not 0 or 1');
    // **The parser is called at module scope**, so `--dry-run` - which CI runs on every push - meets the typo too.
    expect(BENCH).toMatch(/const FILE_SEMANTIC_JUDGE = \(\(\) => \{/);
  });

  it('is a configuration key, because two artifacts that differ here are two protocols', () => {
    const configuration = BENCH.slice(BENCH.indexOf('configuration: {'));
    expect(
      configuration.slice(0, 8000),
      'the artifact does not carry the question its judge was asked',
    ).toContain('fileSemanticJudge: FILE_SEMANTIC_JUDGE');
  });

  it('buys the second reading beside the first in the same run, and no reading at all when it is off', () => {
    // The switch decides whether the pass runs, and the pass runs over the same pulls the pairwise matrix scored.
    expect(BENCH).toMatch(
      /FILE_SEMANTIC_JUDGE && fileSemanticPulls\.our\.length > 0\s*\?\s*await judgeFileSemanticPulls\(fileSemanticPulls\.our\)\s*:\s*null/,
    );
    // **`null` rather than a zero**, because a figure of zero for an arm that was switched off is a comparison with an
    // instrument nobody used - the same defect as a missing row counted as a miss.
    expect(BENCH).toContain('fileLevelJudge:');
    expect(BENCH).toContain('fileLevelDelta:');
  });

  it('scores both readings with one function, so the two figures differ by the verdicts and nothing else', () => {
    expect(BENCH).toMatch(
      /const fileSemanticOf = \(pulls, matchesOf = \(pull\) => pull\.matches\) =>/,
    );
    const fileLevel = BENCH.slice(BENCH.indexOf('const fileSemanticFileLevel'));
    expect(fileLevel.slice(0, 900)).toContain(
      '(pull, index) => fileLevelMatches[index] ?? pull.matches',
    );
  });
});
