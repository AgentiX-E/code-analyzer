// code-analyzer — the CodeQL triage file is scoped, named, and actually applied
//
// **A suppression is a claim, and a claim that nothing checks is a comment.** `.github/codeql/codeql-config.yml` records
// the `(query, path)` pairs where a query's premise does not hold for this repository - fixtures that exist to contain a
// defect, tests that build source text, harnesses that read a corpus and send it to a model. Three ways that file can
// stop doing its job without anyone noticing, and each has a case here:
//
//   - **The workflow stops passing it.** Nothing else in the repository names the file, so a lost `config-file:` line
//     silently returns 44 alerts and the file becomes decoration.
//   - **A second workflow starts a second analysis.** Two `init` calls under one `category` replace each other's
//     results, and the copy that does not read this file is the one whose alerts survive - which is how the quality
//     findings listed under `TRIAGED` came back after they had already been answered. One call, asserted here, and
//     each of those findings re-checked against the exclusions below.
//   - **A path stops matching.** A renamed directory turns an exclusion into a no-op, and the alert comes back with the
//     same justification still sitting in the YAML.
//   - **An exclusion loses its path.** `- exclude: {id: …}` with no `paths` is a **global** exclusion - the query is off
//     for the whole repository - which is the one thing this file must never contain, because the next real finding of
//     that class would be invisible.
//
// The parse is line-based on purpose: the file is written in one shape, and a parser here would be a second
// implementation of YAML that agrees with GitHub's only by luck. The shape is asserted instead.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONFIG = '.github/codeql/codeql-config.yml';
const WORKFLOW = '.github/workflows/codeql.yml';

// **The findings the triage file was written against, named one by one.** A directory glob is both why this file exists
// and how it can quietly stop covering something, so the pairing that matters is asserted at file granularity:
// `js/call-to-non-callable` fires twice inside one fixture directory and `js/template-syntax-in-string-literal` four
// times across two test files, and a glob that covers `export-chain/` but not the file inside it would go unnoticed.
const TRIAGED: ReadonlyArray<{ readonly id: string; readonly path: string }> = [
  {
    id: 'js/unused-local-variable',
    path: 'packages/analyzer/src/__tests__/fixtures/integration-project/src/index.ts',
  },
  {
    id: 'js/call-to-non-callable',
    path: 'packages/analyzer/src/__tests__/fixtures/export-chain/quiet-consumer.ts',
  },
  {
    id: 'js/call-to-non-callable',
    path: 'packages/analyzer/src/__tests__/fixtures/export-chain/cycle-consumer.ts',
  },
  {
    id: 'js/template-syntax-in-string-literal',
    path: 'packages/mcp/src/__tests__/reports-tools.test.ts',
  },
  {
    id: 'js/template-syntax-in-string-literal',
    path: 'packages/mcp/src/__tests__/pdg-tools.test.ts',
  },
];

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

  it('runs in exactly one workflow, since two analyses under one category overwrite each other', () => {
    const dir = '.github/workflows';
    // **The count is the assertion, not the file name.** A second `init` is invisible in review - it is four lines in a
    // workflow that already exists - and its only symptom is alerts reappearing that nobody changed.
    const initialised = readdirSync(dir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .filter((name) =>
        readFileSync(join(dir, name), 'utf8').includes('github/codeql-action/init@'),
      );

    expect(initialised).toEqual(['codeql.yml']);
  });

  it('still answers every quality finding that was triaged, on the file it was triaged on', () => {
    const blocks = exclusions();
    const covered = (id: string, path: string): boolean =>
      blocks.some(
        (block) =>
          block.id === id &&
          block.paths.some((pattern) =>
            // The two shapes this file is allowed to contain: a directory glob, and one exact file.
            pattern.endsWith('/**')
              ? path.startsWith(`${pattern.slice(0, -3)}/`)
              : path === pattern,
          ),
      );

    for (const finding of TRIAGED) {
      expect(covered(finding.id, finding.path), `${finding.id} on ${finding.path}`).toBe(true);
    }
  });
});
