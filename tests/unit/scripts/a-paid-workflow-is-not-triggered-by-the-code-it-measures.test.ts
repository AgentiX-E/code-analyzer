// A workflow that can call a model is not triggered by the code it measures.
//
// **The defect this holds shut, in one number.** Ten workflows name a provider key. **Six of them were triggered by a
// `push` to `packages/**`, `scripts/**` or `tests/**`** — 38 product paths in all, the largest single being the Long Code
// Arena job with fifteen. So **a commit that changed one line of one prompt started five corpus jobs at once**, each
// paying for a reviewer, a judge and, in one case, a competitor run through the same key. On 2026-11-09 that arithmetic
// produced **fourteen hours of paid jobs and a balance that fell from 195.98 CNY to 62.71 CNY before a top-up**, and
// nothing in the repository connected the commits to the bill.
//
// **The rule is narrow and checkable**: a workflow that names a provider credential may be triggered by a **corpus**, by
// a **harness**, by a **schedule** or by a **dispatch** — never by the source it is measuring, and never by its own file,
// because **a workflow's own edit re-running the thing it triggers is a bill that pays for its own paperwork.**
//
// **Why this is a test and not a policy.** The triggers were written by hand in ten files and each looked reasonable on
// the day it was written. What was missing is the one place that reads all ten and asks the question they share.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** The credentials that turn a workflow into a bill. */
const CREDENTIALS = ['DEEPSEEK_API_KEY', 'ZHIPU_API_KEY', 'MARTIAN_API_KEY', 'OCR_LLM_TOKEN'];

/** Paths whose changes must not dispatch a paid run: the code, the scripts and the tests the workflow measures. */
const PRODUCT_PREFIXES = ['packages/', 'scripts/', 'tests/'];

/**
 * The `paths:` entries of a workflow's `push` trigger, or `null` when the workflow has no push trigger.
 *
 * **Read line by line rather than by regular expression**, because a single pattern over the whole file has to encode
 * three levels of indentation and the end of a block at once, and the version of this that shipped first silently
 * answered `null` for a fixture it was written to reject. **A parser whose failure mode is "no trigger here" is a
 * parser that certifies every file it cannot read.**
 */
function pushPathsOf(source: string): string[] | null {
  const lines = source.split('\n');
  const onIndex = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (onIndex === -1) return null;

  // The `on:` block runs until the first line that starts in column zero.
  const block: string[] = [];
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length > 0 && !line.startsWith(' ')) break;
    block.push(line);
  }

  const pushIndex = block.findIndex((line) => /^ {2}push:\s*$/.test(line));
  if (pushIndex === -1) return null;

  const paths: string[] = [];
  let insidePaths = false;
  for (let index = pushIndex + 1; index < block.length; index += 1) {
    const line = block[index]!;
    if (/^ {2}[a-z]/.test(line)) break; // a sibling trigger such as `workflow_dispatch`
    if (/^ {4}paths:\s*$/.test(line)) {
      insidePaths = true;
      continue;
    }
    if (/^ {4}[a-z]/.test(line)) {
      insidePaths = false; // another key of the same trigger, after `paths`
      continue;
    }
    if (!insidePaths) continue;
    const entry = /^ {6}- ['"]?(.+?)['"]?\s*$/.exec(line);
    if (entry) paths.push(entry[1]!);
  }
  return paths;
}

function paidWorkflows(): Array<{ name: string; source: string }> {
  return readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith('.yml'))
    .map((file) => ({ name: file, source: readFileSync(join(WORKFLOWS, file), 'utf8') }))
    .filter(({ source }) => CREDENTIALS.some((credential) => source.includes(credential)));
}

describe('a workflow that can call a model is not dispatched by the code it measures', () => {
  const paid = paidWorkflows();

  it('finds the paid workflows, so a broken reader cannot pass this file', () => {
    // Six when the rule was written; the check is "at least most of them", because a workflow that stops naming a
    // credential has stopped being paid and must not be counted by this file either.
    expect(paid.length).toBeGreaterThanOrEqual(6);
    expect(paid.some(({ name }) => name === 'aacr-bench.yml')).toBe(true);
  });

  it('names no product path in any push trigger', () => {
    const offenders: string[] = [];
    for (const { name, source } of paid) {
      for (const path of pushPathsOf(source) ?? []) {
        if (PRODUCT_PREFIXES.some((prefix) => path.startsWith(prefix)))
          offenders.push(`${name}: ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not trigger itself, because a trigger fix must not cost a run of the thing it triggers', () => {
    const offenders = paid
      .filter(({ name, source }) =>
        (pushPathsOf(source) ?? []).includes(`.github/workflows/${name}`),
      )
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it('does not declare an empty paths list, which is a trigger that fires on everything', () => {
    // **The shape that shipped while narrowing these triggers**: removing the only entry of a `paths:` list left the
    // key behind with nothing under it. **An empty `paths:` is not "no trigger"** — it is a push trigger on every file,
    // which is the opposite of the change intended, and GitHub refuses the workflow outright in the same commit.
    const offenders: string[] = [];
    for (const { name, source } of paid) {
      const onBlock = /^on:\n([\s\S]*?)(?=^\S)/m.exec(source)?.[1] ?? '';
      for (const match of onBlock.matchAll(/^ {4}paths:\n/gm)) {
        const firstLine = onBlock.slice(match.index + match[0].length).split('\n')[0] ?? '';
        if (!firstLine.trim().startsWith('- ')) offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares at most one schedule, because two weekly runs are two weekly bills', () => {
    const offenders: string[] = [];
    for (const { name, source } of paid) {
      const onBlock = /^on:\n([\s\S]*?)(?=^\S)/m.exec(source)?.[1] ?? '';
      if ((onBlock.match(/^ {2}schedule:/gm) ?? []).length > 1) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('reads a push trigger when one exists, so the assertions above are not passing on nothing', () => {
    // The control: a workflow that does have a push path under `packages/` must be seen by the same reader. This is
    // the fixture the reader has to reject — and it is inline, because a fixture file in `.github/workflows` would run.
    const fixture = [
      'name: fixture',
      'on:',
      '  push:',
      '    branches: [master]',
      '    paths:',
      "      - 'packages/intelligence/src/review/llm/**'",
      '',
      'permissions:',
      '  contents: read',
      '',
    ].join('\n');

    expect(pushPathsOf(fixture)).toEqual(['packages/intelligence/src/review/llm/**']);
    expect(basename('fixture.yml')).toBe('fixture.yml');
  });
});
