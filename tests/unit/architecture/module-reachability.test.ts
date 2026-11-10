// Repository-wide module reachability — every module a package compiles is reachable from an entry the manifest names
//
// Iterations 86–95 built this instrument one package at a time, and it only ever walked `@code-analyzer/analyzer`:
// `src/index.ts`, relative imports, one `UNREACHABLE` table. That walk found ten orphans and iteration 94 deleted
// them. It never saw `@code-analyzer/intelligence`, where the same shape had 1443 lines — and it could not have,
// because the entry it walked was `analyzer`'s.
//
// This suite walks **every** package. Two things it takes from the manifests rather than from a list in this file:
//
//   1. **What an entry is.** `src/index.ts` is a convention, not a declaration. `@code-analyzer/vscode` has no
//      `activate` export by design — VS Code finds the extension through `package.json`'s `main`, which points at
//      `dist/extension/extension.js`, whose source is `src/extension/extension.ts`. A walk that assumed the barrel
//      would report the extension's own entry point as dead. `@code-analyzer/web` is the same story told by
//      `index.html`. So the entries are `main`, `bin`, `exports` and the `index.html` script, mapped back to `src/`.
//   2. **What a module is used for.** A module nothing in the product reaches may still be reached by a test. That is
//      not the same thing as being reachable — it is the exact shape of the defect this file exists to measure, at
//      one remove. It is recorded, per package, in `TEST_ONLY`, and the lists are asserted exactly, so the only way
//      this file goes green is by **removing** an entry from them.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, normalize, join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const PACKAGES = join(ROOT, 'packages');

const posix = (path: string): string => path.split(sep).join('/');
const repoPath = (absolute: string): string => posix(relative(ROOT, absolute));

/** Every `.ts`/`.tsx` file under `root`, as absolute paths. */
function walkTypeScript(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?tsx?$/.test(entry.name)) found.push(path);
    }
  };
  if (existsSync(root)) walk(root);
  return found;
}

/**
 * The relative specifiers a module names, in every form the compiler resolves.
 *
 * `import('…')` counts: `phases/embed.ts` loads the API embedding backend that way, and a graph that ignored the form
 * would report a live backend as dead. A specifier built from a variable is not resolved by the compiler either.
 */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const pattern = /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

/** The file a relative specifier resolves to, when it resolves to a module this repository compiles. */
function resolveSpecifier(
  from: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  const withoutExtension = specifier.replace(/\.jsx?$/, '').replace(/\.mjs$/, '.mjs');
  for (const candidate of [
    `${withoutExtension}.ts`,
    `${withoutExtension}.tsx`,
    `${withoutExtension}/index.ts`,
    `${withoutExtension}/index.tsx`,
  ]) {
    const absolute = posix(normalize(join(dirname(from), candidate)));
    if (known.has(absolute)) return absolute;
  }
  return null;
}

/** Everything reachable from `starts` by following relative imports. */
function reachableFrom(starts: readonly string[], known: ReadonlySet<string>): Set<string> {
  const reached = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reached.has(current)) continue;
    reached.add(current);
    if (!existsSync(current)) continue;
    for (const specifier of specifiersOf(current)) {
      const target = resolveSpecifier(current, specifier, known);
      if (target && !reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

/**
 * The entry points a package's own manifest declares, mapped back to `src/`.
 *
 * `dist/extension/extension.js` is `src/extension/extension.ts` — the build keeps the layout and changes the
 * extension, so the mapping is a rewrite and not a guess. A `.d.ts` target declares types, not an entry.
 */
function declaredEntries(packageDir: string): string[] {
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) return [];
  // Typed with the three fields this reads, so a manifest key is a property rather than an index signature.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    main?: unknown;
    bin?: unknown;
    exports?: unknown;
  };
  const targets: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') targets.push(value);
    else if (value && typeof value === 'object')
      for (const nested of Object.values(value)) collect(nested);
  };
  collect(manifest.main);
  collect(manifest.bin);
  collect(manifest.exports);

  const entries = new Set<string>();
  for (const target of targets) {
    if (target.endsWith('.d.ts')) continue;
    const relativeTarget = posix(target).replace(/^\.\//, '');
    if (!relativeTarget.startsWith('dist/')) continue;
    const source = join(
      packageDir,
      'src',
      `${relativeTarget.slice('dist/'.length).replace(/\.js$/, '.ts')}`,
    );
    if (existsSync(source)) entries.add(repoPath(source));
  }

  // **`index.html` is a manifest too.** `@code-analyzer/web` declares no `main`; Vite is pointed at the HTML, and the
  // HTML names the entry. Without this line the dashboard's own `main.tsx` reads as an orphan.
  const html = join(packageDir, 'index.html');
  if (existsSync(html)) {
    for (const match of readFileSync(html, 'utf8').matchAll(
      /src=["']\.?\/?([^"']+\.[cm]?tsx?)["']/g,
    )) {
      const source = join(packageDir, match[1]!);
      if (existsSync(source)) entries.add(repoPath(source));
    }
  }

  const barrel = join(packageDir, 'src', 'index.ts');
  if (existsSync(barrel)) entries.add(repoPath(barrel));
  return [...entries].sort();
}

/**
 * **Modules that only a test reaches, per package.**
 *
 * A list here is not permission — it is a measured statement that the module is not part of the product path, and the
 * assertion compares it item for item, so the list can only get shorter. Iteration 96 is where it was first measured;
 * the seventy entries below are the next iteration's subject, one decision each: a caller, an export from the
 * package's declared entry, or a deletion with the tests that describe it.
 *
 * The shape is worth naming, because it is the whole reason this instrument was widened. The `intelligence` package
 * compiles Leiden community detection, a taint engine, a PDG builder, a multi-signal search and a SCIP exporter, and
 * **not one of them is reachable from its declared entry**: each has two to five test files and no caller. Iteration
 * 94 deleted ten modules of exactly this shape in `analyzer` and called them dead. These fifty are not declared dead
 * here — they are declared *unmeasured as product*, which is the thing that has to change next.
 */
const TEST_ONLY: Readonly<Record<string, readonly string[]>> = {
  core: [
    'cache/lru-cache.ts',
    'crash-recovery/checkpoint-store.ts',
    'crash-recovery/quarantine.ts',
    'crash-recovery/recovery-manager.ts',
    'operations/metrics-exporter.ts',
    'security/assurance-case.ts',
    'security/audit-logger.ts',
    'security/rbac.ts',
    'security/secret-scanner.ts',
  ],
  infra: [
    'binary-detector.ts',
    'generated-detector.ts',
    'lsp-manager.ts',
    'resilience/health-check.ts',
    'resilience/retry.ts',
    'workers/crash-supervisor.ts',
  ],
  intelligence: [
    // **The L4 task set is data for an instrument, not part of the product API.** `scripts/agentic-tools.ts` and the
    // three suites beside it are the only callers: the router the model is compared against, the arithmetic that turns
    // its choices into a rate, and the hundred tasks themselves. Exporting either from the package entry would put a
    // benchmark's answer key on the public surface to satisfy a reachability walk - the same judgement `lca-*` was
    // recorded under.
    'benchmark/agentic/lexical-router.ts',
    'benchmark/agentic/permission-score.ts',
    'benchmark/agentic/permissions.ts',
    'benchmark/agentic/prompt.ts',
    'benchmark/agentic/score.ts',
    'benchmark/agentic/tasks.ts',
    'benchmark/benchmark-fixtures.ts',
    'benchmark/code-review-benchmark.ts',
    // **Named by the two artifacts it stamps and by nothing in the product.** A corpus digest exists so a benchmark
    // can say which version of a directory it measured; no runtime path needs it, and exporting it from the package
    // entry would add a benchmark concern to the public API to satisfy a reachability walk.
    'benchmark/corpus-digest.ts',
    'benchmark/lca-baseline.ts',
    'benchmark/lca-fallback.ts',
    'benchmark/lca-fusion.ts',
    'benchmark/lca-measure.ts',
    'benchmark/lca-merge.ts',
    'benchmark/lca-sample.ts',
    'benchmark/lca-supervisor.ts',
    'benchmark/llm-benchmark-runner.ts',
    'benchmark/real-ground-truth-scoring.ts',
    'benchmark/scientific-benchmark.ts',
    'cfg/control-dependence.ts',
    'cfg/pdg-builder.ts',
    'cfg/post-dominators.ts',
    'community/aggregation.ts',
    'community/leiden-detector.ts',
    'community/louvain.ts',
    'cross-repo/contract-validator.ts',
    'cross-repo/impact-graph.ts',
    'cross-repo/pr-review-bridge.ts',
    'cross-service/cross-project.ts',
    'cross-service/graphql-linking.ts',
    'cross-service/grpc-linking.ts',
    'cross-service/http-linking.ts',
    'cross-service/types.ts',
    'embeddings/embedding-cache.ts',
    'embeddings/embedding-worker.ts',
    'impact/risk-scored-changes.ts',
    'impact/unreachable-functions.ts',
    'lsp/ts-resolver.ts',
    'lsp/type-registry.ts',
    'lsp/type-rep.ts',
    'review/comment-reflection.ts',
    'review/comment-relocator.ts',
    'review/compiler-comments.ts',
    'review/grounding-judge.ts',
    'review/lenses/synthesis-lens.ts',
    'review/llm-review-pipeline.ts',
    'review/session-manager.ts',
    'scip/scip-exporter.ts',
    'search/flow-search.ts',
    'search/multi-signal-search.ts',
    'security/cross-repo-taint.ts',
    'security/rule-families.ts',
    'security/taint-engine.ts',
    'security/taint-models.ts',
    'similarity/near-clone-detector.ts',
  ],
  mcp: ['daemon/daemon.ts'],
  server: ['webhook/pr-review-handler.ts', 'webhook/status-check.ts', 'webhook/webhook-handler.ts'],
  web: ['components/Toast.tsx'],
};

interface Measured {
  modules: string[];
  entries: string[];
  reachable: Set<string>;
  testOnly: string[];
  orphans: string[];
}

function measure(name: string): Measured {
  const packageDir = join(PACKAGES, name);
  const srcDir = join(packageDir, 'src');
  const known = new Set(walkTypeScript(PACKAGES));
  const modules = walkTypeScript(srcDir)
    .filter(
      (path) =>
        !path.endsWith('.d.ts') &&
        !/\.(test|spec)\.tsx?$/.test(path) &&
        !path.includes('__tests__/'),
    )
    .sort();

  const entries = declaredEntries(packageDir);
  const reachable = reachableFrom(
    entries.map((entry) => join(ROOT, entry)),
    known,
  );

  const testFiles = walkTypeScript(srcDir).filter(
    (file) => file.includes(`${sep}__tests__${sep}`) || /\.(test|spec)\.tsx?$/.test(file),
  );
  const fromTests = reachableFrom(testFiles, known);

  const testOnly: string[] = [];
  const orphans: string[] = [];
  for (const module of modules) {
    if (reachable.has(module)) continue;
    if (/(^|\/)(fixtures|__fixtures__)\//.test(module)) continue;
    if (fromTests.has(module)) testOnly.push(module);
    else orphans.push(module);
  }
  return {
    modules: modules.map(repoPath),
    entries,
    reachable: new Set([...reachable].map(repoPath)),
    testOnly: testOnly.map(repoPath),
    orphans: orphans.map(repoPath),
  };
}

/** A module path as the register writes it: relative to the package's `src/`. */
const withinPackage = (name: string, path: string): string =>
  path.slice(`packages/${name}/src/`.length);

const NAMES = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(PACKAGES, entry.name, 'src')))
  .map((entry) => entry.name)
  .sort();

const MEASURED = Object.fromEntries(NAMES.map((name) => [name, measure(name)]));

describe('every module a package compiles is reachable from an entry its manifest declares', () => {
  it('walks every package, and each one resolves at least one entry', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(10);
    for (const name of NAMES) {
      expect(MEASURED[name]!.entries.length, `${name} declares no entry`).toBeGreaterThan(0);
      expect(MEASURED[name]!.modules.length, `${name} compiles no modules`).toBeGreaterThan(0);
    }
  });

  /**
   * **The entry is a declaration, not a convention.** If a package's `main` stopped resolving to a source file, every
   * module behind it would read as an orphan, and the fix would look like deleting a subsystem. This asserts the
   * mapping once per package so that failure says what it is.
   */
  it('maps each declared entry back to a source file that exists', () => {
    const missing = NAMES.flatMap((name) =>
      MEASURED[name]!.entries.filter((entry) => !existsSync(join(ROOT, entry))),
    );
    expect(missing, 'declared entries with no source').toEqual([]);
  });

  /**
   * **No orphans.** A module nothing reaches — not the product, not a test — is a file with no consumer at all. The
   * ten that used to be listed here were deleted in iteration 94; the eleven a first cross-package run found were
   * barrels nothing imported and two startup files no manifest named, and iteration 96 gave each of them a caller, a
   * `bin` declaration, or a `git rm`.
   */
  it('no package has a module that neither the product nor a test reaches', () => {
    const orphans = NAMES.flatMap((name) => MEASURED[name]!.orphans);
    expect(orphans, 'modules with no consumer at all').toEqual([]);
  });

  /**
   * **The measurement, package by package.** These numbers are asserted so that the walk cannot quietly stop finding
   * files — a broken `walkTypeScript` would report zero orphans and pass every assertion above.
   */
  it('measures the same number of modules in each package as it did when the register was written', () => {
    const counts = Object.fromEntries(NAMES.map((name) => [name, MEASURED[name]!.modules.length]));
    expect(counts).toEqual({
      analyzer: 90,
      // **14 since iteration 112**, which added `commands/config.ts`: the command that prints the configuration and
      // where every value in it came from. The register is why it is written down here rather than inferred: a command
      // surface that grows is a decision, and this is where it is recorded. (13 was iteration 111, which added the three
      // commands five documents already called — `change-set.ts`, `pr-review.ts`, `standards-check.ts` — and the
      // severity bridge they share.)
      cli: 14,
      core: 45,
      // **30 since iteration 119**, which added `git/assert-git-argument.ts`: the check that a ref reaching git cannot be
      // read as an option. It is a module rather than three inline `if`s because `git-operations.ts` and
      // `github/repo-sync.ts` in another package both need it, and a rule copied into a second place is a rule that will
      // diverge from the first. (29 was iteration 113.)
      infra: 30,
      // **159 since iteration 119**, which added `review/category-prior.ts`: **the measured acceptance of each category,
      // and the profile that emits the ones a corpus with an answer key accepted** - data with a provenance rather than
      // a weight in `actionability.ts`, because the table is a measurement and a measurement that lives inside a score
      // cannot be checked against the artifact it came from. (158 was iteration 113, which added `review/llm/cost.ts`:
      // the price table, the ledger and the ceiling are one module because they are one question - what did this run
      // spend - and **a ledger that lived beside the provider it accounts for would have been a second place to look
      // for a bill.** 157 was iteration 110, which added `review/llm/language-rules.ts`: the per-language checklist is
      // content rather than plumbing, and this register is what makes that a decision somebody took rather than a file
      // that appeared.)
      intelligence: 159,
      mcp: 39,
      server: 24,
      shared: 10,
      vscode: 16,
      web: 18,
    });
  });

  /**
   * **What only a test reaches, exactly.** Not "at most": a module that stops having a test caller has become an
   * orphan and must fail above, and a module that gains a product caller must leave this list. Both directions are
   * edits to this file, which is the moment someone decides.
   */
  it('the modules only a test reaches are exactly the ones named here', () => {
    const measured = Object.fromEntries(
      NAMES.filter((name) => MEASURED[name]!.testOnly.length > 0).map((name) => [
        name,
        MEASURED[name]!.testOnly.map((path) => withinPackage(name, path)),
      ]),
    );
    expect(measured).toEqual(TEST_ONLY as Record<string, readonly string[]>);
  });

  it('the register total is the measurement', () => {
    // **Seventy was the number until iteration 97 moved the Leiden algorithm and its PRNG from `intelligence` to
    // `core`.** They left this register by becoming reachable — `analyzer`'s communities phase calls `leiden`, and
    // `core`'s entry exports it — which is the only way an entry should ever leave.
    // **Sixty-nine since iteration 100 added `benchmark/corpus-digest.ts`** — the digest a benchmark artifact uses to
    // name the corpus version it measured. It is a measurement concern with no runtime caller, which is what this
    // register is for; the number moves when a module of that kind is added, and that is the point of asserting it.
    // **Seventy-two since iteration 104 added the three modules of the L4 instrument** - the task set, the arithmetic
    // and the lexical null. Same judgement as the digest: measurement code with no runtime caller, recorded rather than
    // exported.
    const total = Object.values(TEST_ONLY).reduce((sum, modules) => sum + modules.length, 0);
    expect(total).toBe(75);
  });

  it('nothing is listed as test-only while the product reaches it', () => {
    const stale = Object.entries(TEST_ONLY).flatMap(([name, modules]) =>
      modules
        .filter((module) => MEASURED[name]!.reachable.has(`packages/${name}/src/${module}`))
        .map((module) => `${name}:${module}`),
    );
    expect(stale, 'modules listed as test-only that an entry reaches').toEqual([]);
  });
});
