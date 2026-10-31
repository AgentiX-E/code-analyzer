// @code-analyzer — who is right about dead code, measured on somebody else's repository.
//
// Story 10 is the one row of the product's feature table that was **competitor-only**, and the first draft of it here
// was worse than the competitors': "no incoming `CALLS` edge" reports **979 of 1 109 functions** on
// `pallets/flask@3.0.3`. A number that large is not a finding, it is a statement that the question was not asked.
//
// So this script measures the question the way the field measures it — **against the tools the field uses** — and it
// measures both halves of the disagreement, because only one of them is about deadness:
//
//   * `vulture` (Python) and `ts-prune` (TypeScript) are the reference implementations for their languages, both run
//     here on the same checkout, the same package and the same universe the product is asked about.
//   * `scripts/deadcode-oracle.py` is a third reader that shares nothing with either: CPython's `ast`, and one
//     mechanical question — **does this name occur anywhere in the corpus other than where it is defined**.
//
// **The precision/recall table is restricted to private functions on purpose.** For a public name, "nothing here calls
// it" and "it is the API" are both true, so an oracle cannot settle it and a score would be an opinion. A private name
// has no consumers outside the package, so the corpus is the world and the question is decidable. **Every public
// finding is still counted**, in the second table, where the product's answer is not "dead" but the name of the root
// that keeps it alive — which is the argument a reader can check.
//
// Usage:
//   npx tsx scripts/dead-code-quality.ts --repo pallets/flask=<dir> --package src/flask --lang python
//   npx tsx scripts/dead-code-quality.ts --repo colinhacks/zod=<dir> --package src --lang typescript
//   ... --out benchmarks/dead-code.json

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '../packages/analyzer/src/index.js';
import { getDefaultConfig } from '../packages/core/src/index.js';
import { computeReachability } from '../packages/intelligence/src/impact/reachability.js';

import type { PipelineContext } from '../packages/shared/src/index.js';

interface RepoArgument {
  name: string;
  path: string;
  /** The package both tools are asked about, when the repositories disagree about where theirs lives. */
  package: string;
}

type Lang = 'python' | 'typescript';

interface Finding {
  file: string;
  name: string;
  line: number | null;
}

interface Comparison {
  agree: Finding[];
  oursOnly: (Finding & { oracleSays?: 'dead' | 'referenced' | 'not-in-universe' })[];
  competitorOnly: (Finding & { ourVerdict: string })[];
  oursDeadTotal: number;
  competitorTotal: number;
  /** Private functions on which an oracle can decide at all, and each side's score against it. */
  decidable: {
    universe: number;
    oracleDead: number;
    ours: Score;
    competitor: Score;
  };
}

/** One tool's claims, judged against the oracle over the oracle's decidable universe. */
interface Score {
  /** Claims the oracle confirms. */
  correct: number;
  /** Claims inside the universe that the oracle denies. */
  wrong: number;
  /** Claims outside the universe — neither right nor wrong, and reported rather than hidden. */
  outside: number;
  /** Symbols the oracle calls dead that this tool did not report. */
  missed: number;
  precision: number | null;
  recall: number | null;
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((value, index) => {
    if (value === `--${name}`) out.push(process.argv[index + 1] ?? '');
  });
  return out;
}

function arg(name: string, fallback?: string): string {
  const value = args(name)[0];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required`);
  }
  return value;
}

function parsePair(raw: string, fallback: string): RepoArgument {
  const split = raw.lastIndexOf('=');
  if (split <= 0) throw new Error(`expected owner/name=path[@package], got "${raw}"`);
  const target = raw.slice(split + 1);
  const at = target.lastIndexOf('@');
  // **`owner/name=path@package`**, because two checkouts of the same language do not agree on where the package is —
  // flask keeps it at `src/flask` and werkzeug at `src/werkzeug`, and a flag that names one for both asks the second
  // repository about a directory it does not have.
  return at > 0
    ? {
        name: raw.slice(0, split),
        path: resolve(target.slice(0, at)),
        package: target.slice(at + 1),
      }
    : { name: raw.slice(0, split), path: resolve(target), package: fallback };
}

/** The path a symbol is filed under, in the coordinates the corpus is walked in. */
function repoPath(root: string, filePath: string): string {
  const rel = relative(root, filePath);
  return (rel.startsWith('..') ? filePath : rel).split(sep).join('/');
}

function run(command: string, commandArgs: string[], cwd: string): string {
  try {
    return execFileSync(command, commandArgs, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    // **A competitor that crashes is not a competitor that found nothing**, so the trace is carried into the artifact
    // rather than the run quietly scoring zero.
    return `${failure.stdout ?? ''}\n${failure.stderr ?? ''}\n<exit ${String(failure.status)}>`;
  }
}

/** `path:line: unused function 'name' (60% confidence)` — vulture's own output format, at line granularity. */
function parseVulture(output: string): Finding[] {
  const findings: Finding[] = [];
  for (const line of output.split('\n')) {
    const match = /^(.+?):(\d+): unused [a-z]+ '([^']+)'/.exec(line.trim());
    if (match === null) continue;
    findings.push({ file: match[1] as string, line: Number(match[2]), name: match[3] as string });
  }
  return findings;
}

/** `src/foo.ts:12 - name` or `src/foo.ts:12 - name (used in module)` — ts-prune's format. */
function parseTsPrune(output: string, root: string): Finding[] {
  const findings: Finding[] = [];
  for (const line of output.split('\n')) {
    const match = /^(.+?):(\d+) - ([A-Za-z_$][\w$]*)\s*(\(.*\))?\s*$/.exec(line.trim());
    if (match === null) continue;
    const file = (match[1] as string).split(sep).join('/');
    findings.push({
      file: repoPath(root, resolve(root, file)),
      line: Number(match[2]),
      name: match[3] as string,
    });
  }
  return findings;
}

/**
 * The rule this product's analysis answers a competitor's finding with, when the finding names a symbol the report does
 * not carry.
 *
 * **The two coordinate systems do not agree, and the disagreement is where most TypeScript findings live.** `ts-prune`
 * reports a re-export site — `lib/index.ts: Redis` — and this product files the symbol where it is *declared*
 * (`lib/Redis.ts`), so an exact key match finds nothing and the finding would read as "neither tool places it". It is
 * placed: it is the package's entry module re-exporting its own API, which is the single largest false-positive class in
 * TypeScript dead-code tooling — a library that nothing imports internally is a library working correctly.
 *
 * Everything here is one of the rules the analysis already applies, stated in the coordinates the competitor printed.
 */
function ruleFor(finding: Finding, pkg: string): string {
  const file = finding.file;
  if (file === `${pkg}/index.ts` || file === `${pkg}/index.tsx` || file === 'index.ts') {
    return 'published: the package entry re-exports it, so it is the API';
  }
  if (/\.d\.ts$/.test(file)) {
    return 'declared: a stub describes code that lives elsewhere';
  }
  if (/(^|\/)(__tests__|tests?|specs?)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) {
    return 'test: the runner collects this file, so nothing calls it';
  }
  if (/(^|\/)(benchmarks?|scripts?|bin|tools)\//.test(file)) {
    return 'entry: the file is executed rather than imported';
  }
  return 'not considered live by either surface';
}

function version(command: string, commandArgs: string[], cwd: string): string {
  const out = run(command, commandArgs, cwd).split('\n')[0] ?? '';
  return out.trim();
}

async function measure(repo: RepoArgument, language: Lang): Promise<Record<string, unknown>> {
  const pkg = repo.package;
  const packageRoot = resolve(repo.path, pkg);
  const ctx = {
    projectId: `dead-code:${repo.name}`,
    rootPath: repo.path,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;

  const started = Date.now();
  const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  const indexedMs = Date.now() - started;
  const failures = pipeline.errors.filter((error) => error.phaseId !== 'tools');
  if (failures.length > 0) {
    throw new Error(
      `${repo.name}: ${failures.length} phases failed, the first being ${failures[0]?.phaseId}`,
    );
  }

  const graph = pipeline.graph;
  const report = computeReachability(graph);

  // **The universe both tools are asked about**: symbols whose file is inside the package directory. The graph covers
  // the whole checkout, because entry points and tests live outside it — but nothing outside it can be compared.
  // **The same universe the competitor is given.** vulture reads `.py` and nothing else, so a JavaScript file shipped
  // inside a Python package — `werkzeug/debug/shared/debugger.js` is one — is a symbol set it cannot have an opinion
  // about. Counting those against it would be measuring the file filter rather than the detector.
  const ownLanguage = language === 'python' ? /\.py$/ : /\.[cm]?[jt]sx?$/;
  const inUniverse = (filePath: string): boolean =>
    (filePath.startsWith(`${packageRoot}${sep}`) || filePath === packageRoot) &&
    ownLanguage.test(filePath);
  const ours: Finding[] = report.dead
    .filter((symbol) => inUniverse(symbol.filePath))
    .map((symbol) => ({
      file: repoPath(repo.path, symbol.filePath),
      name: symbol.name,
      line: symbol.startLine,
    }));

  const verdicts = new Map<string, string>();
  for (const symbol of [...report.published, ...report.dead]) {
    if (!inUniverse(symbol.filePath)) continue;
    verdicts.set(
      `${repoPath(repo.path, symbol.filePath)}::${symbol.name}`,
      `dead: ${symbol.because}`,
    );
  }
  for (const root of report.roots) {
    const node = graph.nodes.get(root.nodeId);
    if (node === undefined || node.filePath === null || !inUniverse(node.filePath)) continue;
    verdicts.set(
      `${repoPath(repo.path, node.filePath)}::${node.name}`,
      `${root.kind === 'published' ? 'published' : root.kind}: ${root.because}`,
    );
  }

  let competitor: Finding[];
  let competitorName: string;
  let competitorVersion: string;
  let oracleDead: Set<string>;
  let oracleUniverse: Set<string>;

  if (language === 'python') {
    competitorName = 'vulture';
    competitorVersion = version('vulture', ['--version'], process.cwd());
    const raw = run('vulture', [packageRoot, '--min-confidence', '60'], process.cwd());
    competitor = parseVulture(raw)
      .map((finding) => ({
        ...finding,
        // **Both sides in the repository's coordinates.** The product is handed the checkout root and files under it;
        // vulture is handed the package and prints the path it was given. The first run compared the two as they were
        // and reported **zero agreement with every finding on both sides present** — the same defect the
        // bug-localisation instrument had in iteration 39, and the reason `toCorpusPath` exists there.
        file: repoPath(repo.path, resolve(finding.file)),
      }))
      .filter((finding) => /\.py$/.test(finding.file));
    const oracleRaw = run(
      'python3',
      [resolve('scripts', 'deadcode-oracle.py'), '--root', packageRoot],
      process.cwd(),
    );
    const parsed = JSON.parse(oracleRaw.slice(oracleRaw.indexOf('{'))) as {
      privateFunctions: number;
      oracleDead: { file: string; line: number; name: string }[];
      universe: { file: string; line: number; name: string }[];
    };
    // **In the repository's coordinates, like everything else in this comparison.** The oracle files its symbols
    // relative to the package it was handed, so a key that is not prefixed lands in a different namespace and every
    // claim scores as wrong on both sides — which is exactly what the first run reported.
    oracleDead = new Set(parsed.oracleDead.map((item) => `${pkg}/${item.file}::${item.name}`));
    oracleUniverse = new Set(parsed.universe.map((item) => `${pkg}/${item.file}::${item.name}`));
  } else {
    competitorName = 'ts-prune';
    competitorVersion =
      version('npx', ['--yes', 'ts-prune@0.10.3', '--version'], process.cwd()) || '0.10.3';
    const raw = run('npx', ['--yes', 'ts-prune@0.10.3', '-p', 'tsconfig.json'], repo.path);
    competitor = parseTsPrune(raw, repo.path).filter(
      (finding) => finding.file.startsWith(`${pkg}/`) || finding.file === pkg,
    );
    // **TypeScript needs a reader of its own**, because `ts-prune` is the side being measured and an oracle that
    // agrees with a side by construction scores nothing. `vulture` covers both questions for Python; nothing covers
    // either for TypeScript, so `scripts/deadcode-oracle-ts.mjs` asks the question `ts-prune` asks — exported, and
    // reachable from no import and no entry re-export — and answers it from syntax alone.
    const oracleRaw = run(
      'node',
      [resolve('scripts', 'deadcode-oracle-ts.mjs'), '--root', packageRoot, '--package', pkg],
      process.cwd(),
    );
    const parsed = JSON.parse(oracleRaw.slice(oracleRaw.indexOf('{'))) as {
      declarations: number;
      oracleDead: { file: string; line: number; name: string; exported: boolean }[];
      universe: { file: string; line: number; name: string; exported: boolean }[];
    };
    oracleDead = new Set(parsed.oracleDead.map((item) => `${pkg}/${item.file}::${item.name}`));
    oracleUniverse = new Set(parsed.universe.map((item) => `${pkg}/${item.file}::${item.name}`));
  }

  const key = (finding: Finding): string => `${finding.file}::${finding.name}`;
  const oursByKey = new Map(ours.map((finding) => [key(finding), finding]));
  const competitorByKey = new Map(competitor.map((finding) => [key(finding), finding]));

  const agree: Finding[] = [];
  const oursOnly: (Finding & { oracleSays?: 'dead' | 'referenced' | 'not-in-universe' })[] = [];
  const competitorOnly: (Finding & { ourVerdict: string })[] = [];

  for (const [id, finding] of oursByKey) {
    if (competitorByKey.has(id)) {
      agree.push(finding);
      continue;
    }
    oursOnly.push({
      ...finding,
      oracleSays: oracleDead.has(id)
        ? 'dead'
        : oracleUniverse.has(id)
          ? 'referenced'
          : 'not-in-universe',
    });
  }
  for (const [id, finding] of competitorByKey) {
    if (oursByKey.has(id)) continue;
    competitorOnly.push({
      ...finding,
      ourVerdict: verdicts.get(id) ?? ruleFor(finding, pkg),
    });
  }

  // **The scored half.** Both sides are scored over **the oracle's decidable universe and nothing else**, and by the
  // identical rule, so that neither is measured by a standard the other is not held to.
  //
  // The previous version of this block scored the claims whose *name* began with an underscore, which was a proxy for
  // the universe rather than the universe: a claim about a name outside it scored as wrong even when the symbol was
  // outside the question, and a claim inside it on a symbol the oracle had never enumerated scored as right by
  // accident. **A claim outside the universe is neither right nor wrong** — it is `outside`, and it is reported, not
  // silently folded into a column that makes a tool look worse for having answered a question it was not asked.
  let overall: Record<string, Score> = {};
  const decidable: Comparison['decidable'] = (() => {
    const universe = oracleUniverse;
    const oracle = oracleDead;
    const score = (claims: Set<string>): Score => {
      let correct = 0;
      let wrong = 0;
      let outside = 0;
      for (const claim of claims) {
        if (!universe.has(claim)) outside++;
        else if (oracle.has(claim)) correct++;
        else wrong++;
      }
      const judged = correct + wrong;
      const missed = [...oracle].filter((item) => !claims.has(item)).length;
      return {
        correct,
        wrong,
        outside,
        missed,
        precision: judged === 0 ? null : correct / judged,
        recall: oracle.size === 0 ? null : correct / oracle.size,
      };
    };
    // **The same score over every claim either tool made**, which is the figure a reader can compare without agreeing
    // to a slice first: how much of what this tool asserts is confirmed by an independent reader.
    overall = {
      ours: score(new Set(ours.map((finding) => key(finding)))),
      competitor: score(new Set(competitor.map((finding) => key(finding)))),
    };
    return {
      universe: universe.size,
      oracleDead: oracle.size,
      ours: score(new Set(ours.map((finding) => key(finding)))),
      competitor: score(new Set(competitor.map((finding) => key(finding)))),
    };
  })();

  return {
    repo: repo.name,
    package: pkg,
    language,
    indexedMs,
    nodes: graph.nodes.size,
    edges: graph.edges.size,
    roots: report.roots.length,
    rootsByKind: report.roots.reduce<Record<string, number>>((accumulator, root) => {
      accumulator[root.kind] = (accumulator[root.kind] ?? 0) + 1;
      return accumulator;
    }, {}),
    considered: report.considered,
    callEdges: report.callEdges,
    oursDead: ours.length,
    publishedRescued: report.published.filter((symbol) => inUniverse(symbol.filePath)).length,
    competitor: competitorName,
    competitorVersion,
    competitorTotal: competitor.length,
    comparison: {
      agree: agree.length,
      oursOnly: oursOnly.length,
      competitorOnly: competitorOnly.length,
      agreement:
        oursOnly.length + agree.length === 0
          ? null
          : agree.length / (oursOnly.length + agree.length),
    },
    rows: { agree, oursOnly, competitorOnly },
    decidable,
    overall,
  };
}

async function main(): Promise<void> {
  const language = arg('lang') as Lang;
  if (language !== 'python' && language !== 'typescript')
    throw new Error(`--lang must be python or typescript`);
  // **Optional, because each repository may name its own package** with `path@package`.
  const pkg = args('package')[0] ?? '';
  const out = arg('out', 'benchmarks/dead-code.json');
  const repositories = args('repo').map((raw) => parsePair(raw, pkg));
  if (repositories.length === 0) throw new Error('at least one --repo is required');

  const measured: Record<string, unknown>[] = [];
  for (const repo of repositories) {
    const result = await measure(repo, language);
    measured.push(result);
    const comparison = result['comparison'] as Record<string, number | null>;
    console.log(
      `${repo.name} ${String(result['package'])}: ours ${String(result['oursDead'])} dead, ` +
        `${String(result['publishedRescued'])} published, ${String(result['competitor'])} ` +
        `${String(result['competitorTotal'])} findings; agree ${String(comparison['agree'])}, ` +
        `ours-only ${String(comparison['oursOnly'])}, theirs-only ${String(comparison['competitorOnly'])}`,
    );
    const decidable = result['decidable'] as Comparison['decidable'];
    console.log(
      `  decidable: ${String(decidable.universe)} private functions, ${String(decidable.oracleDead)} dead by oracle; ` +
        `ours precision ${String(decidable.ours.precision)} recall ${String(decidable.ours.recall)}; ` +
        `${String(result['competitor'])} precision ${String(decidable.competitor.precision)} recall ${String(decidable.competitor.recall)}; ` +
        `outside ${String(decidable.ours.outside)} / ${String(decidable.competitor.outside)}`,
    );
  }

  // **One artifact, two languages.** `--merge` reads what is already there and replaces the rows for the repositories
  // this run measured, so the Python half and the TypeScript half land in the same file without either one being
  // written by hand — a figure transcribed by hand is a figure that drifts from the run that produced it.
  const target = resolve(out);
  let rows = measured;
  if (args('merge').length > 0 && existsSync(target)) {
    const existing = JSON.parse(readFileSync(target, 'utf8')) as {
      rows?: Record<string, unknown>[];
    };
    const replaced = new Set(measured.map((row) => String(row['repo'])));
    rows = [
      ...(existing.rows ?? []).filter((row) => !replaced.has(String(row['repo']))),
      ...measured,
    ];
  }
  rows.sort((left, right) => String(left['repo']).localeCompare(String(right['repo'])));

  // **The figures a consumer reads by name, not by index.** `rows` is an array ordered by repository, which is a
  // presentation choice; a matrix cell that reads `rows[1].decidable.ours.precision` breaks the day a corpus is added.
  const byRepo = Object.fromEntries(
    rows.map((row) => {
      const decidable = (row['decidable'] ?? {}) as Comparison['decidable'];
      return [
        String(row['repo']),
        {
          language: String(row['language']),
          package: String(row['package']),
          findings: Number(row['oursDead']),
          published: Number(row['publishedRescued']),
          oracleUniverse: Number(decidable.universe ?? 0),
          oracleDead: Number(decidable.oracleDead ?? 0),
          precision: decidable.ours?.precision ?? null,
          recall: decidable.ours?.recall ?? null,
          competitor: String(row['competitor']),
          competitorFindings: Number(row['competitorTotal']),
          competitorPrecision: decidable.competitor?.precision ?? null,
          competitorRecall: decidable.competitor?.recall ?? null,
        },
      ];
    }),
  );

  // **The claim, as one number.** Two tools can share a recall and differ completely in how much they assert to get
  // there; the ratio of claims is what separates a report from a pile of candidates, so it is written down where a gate
  // and a matrix cell can read it rather than being computed in prose.
  const oursTotal = rows.reduce((sum, row) => sum + Number(row['oursDead'] ?? 0), 0);
  const competitorTotal = rows.reduce((sum, row) => sum + Number(row['competitorTotal'] ?? 0), 0);
  const assertionLoad = {
    ours: oursTotal,
    competitor: competitorTotal,
    ratio: competitorTotal === 0 ? null : oursTotal / competitorTotal,
  };

  const artifact = {
    measuredAt: new Date().toISOString(),
    languages: [...new Set(rows.map((row) => String(row['language'])))].sort(),
    corpora: rows.map((row) => ({
      repo: String(row['repo']),
      package: String(row['package']),
      language: String(row['language']),
    })),
    comment:
      'Story 10 measured against the reference dead-code tool of each language — vulture for Python, ts-prune for ' +
      'TypeScript — on the same checkouts, the same package and the same universe. Both sides are scored over the ' +
      "oracle's decidable universe and nothing else: private functions for Python, module-scope declarations for " +
      'TypeScript, with a re-export from the package entry counting as publication. Claims outside that universe are ' +
      'neither right nor wrong and are reported as `outside`. The public half is reported as the disagreement it is, ' +
      'with the root that keeps each symbol alive.',
    rows,
    byRepo,
    assertionLoad,
  };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`-> ${relative(process.cwd(), target)} (${String(rows.length)} corpora)`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
