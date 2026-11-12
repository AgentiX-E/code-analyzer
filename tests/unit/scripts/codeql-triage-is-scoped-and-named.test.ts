// code-analyzer — the CodeQL triage file is scoped, named, and actually applied
//
// **A suppression is a claim, and a claim that nothing checks is a comment.** `.github/codeql/codeql-config.yml` records
// the `(query, path)` pairs where a query's premise does not hold for this repository - fixtures that exist to contain a
// defect, tests that build source text, harnesses that read a corpus and send it to a model. Three ways that file can
// stop doing its job without anyone noticing, and each has a case here:
//
//   - **The workflow stops passing it.** Nothing else in the repository names the file, so a lost `config-file:` line
//     silently returns 44 alerts and the file becomes decoration.
//   - **A path stops matching.** A renamed directory turns an exclusion into a no-op, and the alert comes back with the
//     same justification still sitting in the YAML.
//   - **An exclusion loses its path.** `- exclude: {id: …}` with no `paths` is a **global** exclusion - the query is off
//     for the whole repository - which is the one thing this file must never contain, because the next real finding of
//     that class would be invisible.
//
// The parse is line-based on purpose: the file is written in one shape, and a parser here would be a second
// implementation of YAML that agrees with GitHub's only by luck. The shape is asserted instead.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONFIG = '.github/codeql/codeql-config.yml';
const WORKFLOW = '.github/workflows/codeql.yml';

interface Exclusion {
  readonly id: string;
  readonly paths: readonly string[];
}

/** The exclusion blocks, read by shape rather than by parser. */
function exclusions(): Exclusion[] {
  const lines = readFileSync(CONFIG, 'utf8').split('\n');
  const found: Exclusion[] = [];
  let current: { id?: string; paths: string[] } | null = null;

  const flush = (): void => {
    if (current !== null && current.id !== undefined) {
      found.push({ id: current.id, paths: [...current.paths] });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '- exclude:') {
      flush();
      current = { paths: [] };
      continue;
    }
    if (current === null) continue;
    const id = /^id:\s*(\S+)$/.exec(line);
    if (id !== null) {
      current.id = id[1]!;
      continue;
    }
    const path = /^-\s+(\S+)$/.exec(line);
    if (path !== null && current.id !== undefined && !path[1]!.endsWith(':')) {
      current.paths.push(path[1]!);
    }
  }
  flush();
  return found;
}

describe('the CodeQL triage file is applied, and every claim in it still lands somewhere', () => {
  it('is the file the workflow hands to CodeQL', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');

    expect(workflow).toContain('config-file: ./.github/codeql/codeql-config.yml');
    expect(workflow).not.toContain('queries: security-extended,security-and-quality');
    expect(existsSync(CONFIG)).toBe(true);
  });

  it('names both suites, so the file cannot quietly narrow the analysis', () => {
    const config = readFileSync(CONFIG, 'utf8');

    expect(config).toContain('- uses: security-extended');
    expect(config).toContain('- uses: security-and-quality');
  });

  it('has exclusions, each with an id and at least one path', () => {
    const blocks = exclusions();

    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) {
      expect(block.id, `an exclusion without an id`).toMatch(/^js\//);
      // **A path-less exclusion is a repository-wide suppression**, which is the one thing this file may not contain.
      expect(
        block.paths.length,
        `${block.id} has no paths, so it is excluded everywhere`,
      ).toBeGreaterThan(0);
    }
  });

  it('only names directories that exist, because a stale path is a silent no-op', () => {
    for (const block of exclusions()) {
      for (const pattern of block.paths) {
        const base = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
        // Every one of these is either a directory glob or a single file; both are checked against the tree.
        expect(
          existsSync(join(process.cwd(), base)),
          `${block.id}: ${pattern} matches nothing`,
        ).toBe(true);
      }
    }
  });
});
