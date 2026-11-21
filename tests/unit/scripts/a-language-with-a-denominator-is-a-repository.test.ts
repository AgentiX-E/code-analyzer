// @code-analyzer/code-analyzer — a per-language figure is only a figure if its denominator is a repository
//
// **The measurement this file was written after.** Until §115 the artifact behind every per-language claim in
// `docs/EVAL-CONTRACT.md` carried **15 JavaScript files and 1 TypeScript file** across ten checkouts - the two languages
// this engine is written in, and the two a review meets most often, were the rows with no denominator. **A capability
// figure for a language with one file in the corpus is a figure about that file**, and the document said so while the
// table went on being read as a capability table.
//
// **Two ways to get a denominator wrong, and this file guards both.** The first is a subtree published as a repository:
// §114 measured `axios/lib` (73 files) and `zod/packages/zod/src` (334 files), and a row named `zod-src` would have said
// the repository holds 334 files when it holds 580. The second is a row whose language counts do not add up to its own
// totals, which turns a column into a claim nobody can check. **Both are shape facts about the artifact**, so they are
// tested here rather than read by eye once.
//
// **What this file cannot say.** That the corpus is a sample. Two JavaScript-heavy checkouts supply 262 of the 277
// JavaScript files, so the published rate is those two repositories' opinion and §115.4 prints that beside the number
// instead of calling it the field.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface LanguageRow {
  files: number;
  symbols: number;
  imports: number;
  resolved: number;
  packages: number;
  external: number;
  missing: number;
  ambiguous: number;
  edges: number;
}

interface RepoRow {
  repo: string;
  commit: string | null;
  files: number;
  stats: {
    files: number;
    symbols: number;
    imports: number;
    resolvedImports: number;
    externalImports: number;
    missingImports: number;
    ambiguousImports: number;
    edges: number;
  };
  byLanguage: Record<string, LanguageRow>;
  reach: { filesWithSymbols: number; filesWithReach: number; chars: number };
}

interface Artifact {
  generatedBy: string;
  measuredAt: string;
  repos: RepoRow[];
}

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ARTIFACT: Artifact = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks', 'polyglot-index.json'), 'utf8'),
) as Artifact;

/** One language over every checkout that holds it, which is the only form the table in §115.3 has. */
function totalsOf(language: string): {
  files: number;
  imports: number;
  resolved: number;
  edges: number;
  repos: number;
} {
  let files = 0;
  let imports = 0;
  let resolved = 0;
  let edges = 0;
  let repos = 0;
  for (const row of ARTIFACT.repos) {
    const bucket = row.byLanguage[language];
    if (bucket === undefined) continue;
    files += bucket.files;
    imports += bucket.imports;
    resolved += bucket.resolved;
    edges += bucket.edges;
    if (bucket.files > 0) repos += 1;
  }
  return { files, imports, resolved, edges, repos };
}

describe('the per-language table the corpus report writes', () => {
  it('names an owner and a repository, so a subtree cannot be published as a checkout', () => {
    // **The rule is the shape of the name**, because the artifact records no path: a row measured over `lib/` and a row
    // measured over the whole checkout are indistinguishable once the path is gone, and the figure that hides it is
    // `files`. An owner and a repository, one underscore, no separator - a subtree checkout has no owner to name.
    for (const row of ARTIFACT.repos) {
      expect(row.repo, `${row.repo} is not <owner>_<repository>`).toMatch(/^[^_/]+_[^_/]+$/u);
    }
    expect(ARTIFACT.repos.length).toBeGreaterThanOrEqual(12);
  });

  it('records the commit each checkout was measured at', () => {
    // A row that names no commit is a number about a branch, and a branch moves: `--sha` is what makes the figure
    // reproducible, and a regeneration that forgets it produces a table nobody can re-run.
    for (const row of ARTIFACT.repos) {
      expect(row.commit, `${row.repo} has no commit`).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  it('counts every language up to the row its language sits in', () => {
    for (const row of ARTIFACT.repos) {
      const buckets = Object.values(row.byLanguage);
      const sum = (pick: (bucket: LanguageRow) => number): number =>
        buckets.reduce((total, bucket) => total + pick(bucket), 0);
      expect(
        sum((bucket) => bucket.files),
        row.repo,
      ).toBe(row.stats.files);
      expect(
        sum((bucket) => bucket.symbols),
        row.repo,
      ).toBe(row.stats.symbols);
      expect(
        sum((bucket) => bucket.imports),
        row.repo,
      ).toBe(row.stats.imports);
      expect(
        sum((bucket) => bucket.external),
        row.repo,
      ).toBe(row.stats.externalImports);
      expect(
        sum((bucket) => bucket.missing),
        row.repo,
      ).toBe(row.stats.missingImports);
      expect(
        sum((bucket) => bucket.ambiguous),
        row.repo,
      ).toBe(row.stats.ambiguousImports);
      expect(
        sum((bucket) => bucket.edges),
        row.repo,
      ).toBe(row.stats.edges);
      // **`resolvedImports` is `resolved` plus `package`**, which is the split §104 drew: a wildcard naming a package
      // the repository declares resolves and crosses no file, so it is neither resolved nor missing. A row whose two
      // columns do not add up to the total is a row where one of the three answers was counted twice.
      expect(
        sum((bucket) => bucket.resolved + bucket.packages),
        row.repo,
      ).toBe(row.stats.resolvedImports);
    }
  });

  it('gives the two languages this engine is written in a denominator and more than one repository', () => {
    // **The numbers this replaced were 15 and 1** - and both figures were true of a corpus that held one JavaScript
    // file from `jq` and one TypeScript file from the JSON-Schema suite. A floor rather than the exact count: what the
    // test is for is that a regeneration which drops the JavaScript-heavy checkouts cannot pass.
    const javascript = totalsOf('javascript');
    const typescript = totalsOf('typescript');
    expect(javascript.files).toBeGreaterThanOrEqual(200);
    expect(javascript.repos).toBeGreaterThanOrEqual(2);
    expect(typescript.files).toBeGreaterThanOrEqual(400);
    expect(typescript.repos).toBeGreaterThanOrEqual(2);
    // And a rate is only printable where statements were written: the two languages resolve the majority of them, which
    // is the fact §115.4 publishes and the reason the row is no longer empty.
    expect(javascript.resolved / javascript.imports).toBeGreaterThan(0.4);
    expect(typescript.resolved / typescript.imports).toBeGreaterThan(0.5);
  });

  it('gives Groovy a denominator, because its row was empty for the whole of §115', () => {
    // **The row read `0 files` and the table said why**: the reader had a Groovy branch and the corpus had no Groovy
    // checkout, so the capability was a code path nobody had measured. **Two** checkouts now: `spockframework/spock`,
    // Groovy's own test framework across a dozen modules, and `jenkinsci/pipeline-model-definition-plugin`, an
    // application written against a platform. **They read 56.1 % and 22.1 %**, which is why the floor is on the pair and
    // not on one row - a single checkout's rate is that checkout's opinion, and the first one of these was published as
    // if it were Groovy's.
    const groovy = totalsOf('groovy');
    expect(groovy.files).toBeGreaterThanOrEqual(900);
    // **Two repositories rather than one**, because the two differ by 34 points and a register of one would publish
    // whichever arrived first.
    expect(groovy.repos).toBeGreaterThanOrEqual(2);
    // And the pair places half its statements, which is what makes the row printable at all: 49.4 % between 56.1 % and
    // 22.1 %. A floor, not the figure - the figure belongs in the document that reads the two halves.
    expect(groovy.resolved / groovy.imports).toBeGreaterThan(0.4);
  });

  it('was written by the script it names, on a date it names', () => {
    expect(ARTIFACT.generatedBy).toBe('scripts/corpus-index-report.mjs');
    expect(ARTIFACT.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
});
