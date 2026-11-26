// @code-analyzer/scripts — the page refuses to draw a count that moved
//
// **Why a renderer needs its own test.** §166.4's prize is priced at a fixed number of comments, so the one number a page
// must never draw silently is a count that changed: a reader who sees `227 → 227` beside `0.3221 → 0.3896` is looking at a
// device that corrected sentences, and a reader who sees `227 → 224` beside it is looking at a device that deleted three
// comments and a claim that no longer means what the section says. **Refusing the record is the only honest render.**
//
// The other refusals are the same idea one level down: a version the renderer does not know, a verdict list longer than the
// emission it describes, and a bar that was not passed in - because a target written into a renderer is a target that moves
// when the code moves rather than when a section decides.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const REPO = resolve(import.meta.dirname, '../../..');
const work = mkdtempSync(join(tmpdir(), 'crosscheck-page-'));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

const RECORD = {
  version: 'symbol-crosscheck-v1',
  measuredAt: '2026-11-26',
  arm: 'benchmarks/martian-wide-bench.json',
  corpus: 'benchmarks/martian/positive_samples.json',
  profile: 'core',
  budget: 5,
  mode: 'record',
  comments: { armA: 4, armB: 4, unchanged: true },
  verifier: {
    contract: 'two-sides-v1',
    considered: 4,
    called: 4,
    rewritten: 1,
    spendUsd: 0.0012,
    kept: { agree: 2, unquoted: 1, cannot: 0 },
  },
  verdicts: [
    { at: 0, pr: 'o/r/pull/1', path: 'a.ts', startLine: 10, symbol: 'alpha', rewritten: false },
    {
      at: 1,
      pr: 'o/r/pull/1',
      path: 'a.ts',
      startLine: 20,
      symbol: 'credentialId',
      rewritten: true,
    },
    { at: 2, pr: 'o/r/pull/2', path: 'b.ts', startLine: 5, symbol: 'gamma', rewritten: false },
    { at: 3, pr: 'o/r/pull/2', path: 'b.ts', startLine: 9, symbol: 'delta', rewritten: false },
  ],
  judgements: { calls: 12, armA: {}, armB: {} },
  point: {
    armA: { truePositives: 2, precision: 0.5, recall: 0.4, f1: 0.4444 },
    armB: { truePositives: 3, precision: 0.75, recall: 0.6, f1: 0.6667 },
    delta: 0.2223,
  },
  paired: { pairs: 6, fixed: 1, broken: 0, delta: 1, p: 1 },
  prize: {
    planned: 2,
    rewritten: 1,
    credited: 1,
    detail: [
      {
        key: 'o/r/pull/1#1',
        golden: 1,
        findingAt: 1,
        symbol: 'credentialId',
        rewritten: true,
        credited: true,
      },
      {
        key: 'o/r/pull/2#0',
        golden: 0,
        findingAt: 2,
        symbol: 'gamma',
        rewritten: false,
        credited: false,
      },
    ],
  },
  bar: { target: 0.3735, cleared: true, deltaToTarget: 0.2932 },
};

function render(record = RECORD, extra = ['--target', '0.3735']) {
  const path = join(work, `record-${String(Math.random()).slice(2)}.json`);
  const out = join(work, 'page.html');
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(REPO, 'scripts/symbol-crosscheck-page.mjs'), '--record', path, '--out', out, ...extra],
      { cwd: REPO, encoding: 'utf8', stdio: 'pipe' },
    );
    return { stdout, html: readFileSync(out, 'utf8'), status: 0 };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return {
      stdout: '',
      html: '',
      status: failure.status ?? 1,
      stderr: String(failure.stderr ?? ''),
    };
  }
}

describe('the page draws the pair of points and nothing else', () => {
  it('shows both arms, the bar, and the count on both sides of the device', () => {
    const { html } = render();
    expect(html).toContain('4 / 4');
    expect(html).toContain('0.4444 → 0.6667');
    expect(html).toContain('the bar · cleared');
  });

  it('names every refusal the pass made, in the pass own words', () => {
    const { html } = render();
    expect(html).toContain('<code>agree</code>');
    expect(html).toContain('both sides were quoted and they agreed');
    expect(html).toContain('<code>unquoted</code>');
  });

  it('says how many of the plan entries it rewrote and how many the judge then credited', () => {
    const { html } = render();
    expect(html).toContain('1 of 2 rewritten, 1 credited');
  });

  it('refuses a record whose two arms posted different numbers of comments', () => {
    const { status, stderr } = render({
      ...RECORD,
      comments: { armA: 4, armB: 3, unchanged: false },
    });
    expect(status).toBe(1);
    expect(stderr).toMatch(/fixed count/);
  });

  it('refuses a record that says the count is unchanged while its own fields disagree', () => {
    const { status } = render({ ...RECORD, comments: { armA: 4, armB: 3, unchanged: true } });
    expect(status).toBe(1);
  });

  it('refuses a version it does not read, rather than guessing at the shape', () => {
    const { status, stderr } = render({ ...RECORD, version: 'symbol-crosscheck-v0' });
    expect(status).toBe(2);
    expect(stderr).toMatch(/reads symbol-crosscheck-v1/);
  });

  it('refuses more verdicts than the emission they describe', () => {
    const { status, stderr } = render({
      ...RECORD,
      verdicts: [...RECORD.verdicts, ...RECORD.verdicts],
    });
    expect(status).toBe(1);
    expect(stderr).toMatch(/verdicts for/);
  });

  it('refuses to draw without a bar, because a target in a renderer is a target nobody registered', () => {
    const { status, stderr } = render(RECORD, []);
    expect(status).toBe(2);
    expect(stderr).toMatch(/needs --target/);
  });
});
