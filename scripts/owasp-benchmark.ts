// The OWASP Benchmark, scored by this repository's own taint engine.
//
// **Why this corpus.** It is the one benchmark the competing scanners publish scores for — 2 740 servlet test cases,
// 1 415 of them real vulnerabilities, each labelled `true`/`false` in `expectedresults-1.2.csv`. A category is scored
// the way the benchmark's own scorecard scores it: a case counts as flagged if the engine reports at least one flow
// in that file, and the result is the Youden index, `TPR - FPR`, which charges a tool for the noise it makes rather
// than only rewarding what it finds.
//
// **What it does not measure.** The engine is a taint tracker, and four of the eleven categories are not taint
// problems: `crypto` and `hash` ask whether a weak algorithm was chosen in a constant, `weakrand` whether the
// generator is predictable, and the two cookie categories whether a flag was set. Those are scored here as misses,
// unsolved rather than excluded — excluding them would inflate the score by exactly the categories the engine
// cannot see.
//
// Usage:
//   tsx scripts/owasp-benchmark.ts --corpus <BenchmarkJava checkout> --out benchmarks/owasp-benchmark.json

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';

import { analyzeInterproceduralTaint } from '../packages/intelligence/src/security/interprocedural-entry.js';

import type { ParsedFile } from '@code-analyzer/shared';

interface Expected {
  readonly name: string;
  readonly category: string;
  readonly vulnerable: boolean;
  readonly cwe: string;
}

interface CaseResult {
  readonly name: string;
  readonly category: string;
  readonly vulnerable: boolean;
  readonly flagged: boolean;
  readonly findings: number;
}

interface CategoryScore {
  readonly category: string;
  readonly cases: number;
  readonly vulnerable: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly tpr: number;
  readonly fpr: number;
  readonly score: number;
}

/**
 * The categories a taint tracker can answer, and the four it cannot.
 *
 * `crypto` and `hash` ask which algorithm a constant names, `weakrand` whether the generator is predictable and the
 * two cookie categories whether a flag was set on the object. None of those is a flow from untrusted input to a
 * dangerous call, so the engine has nothing to say about them and they are scored as misses in the overall figure
 * rather than dropped from it. The subset is reported beside the whole so the two questions — "does it find flows"
 * and "does it score on this benchmark" — stay separate.
 */
const TAINT_CATEGORIES = new Set([
  'cmdi',
  'ldapi',
  'pathtraver',
  'sqli',
  'trustbound',
  'xpathi',
  'xss',
]);

interface Report {
  readonly corpus: {
    readonly repository: string;
    readonly expectedResultsSha256: string;
    readonly cases: number;
    readonly vulnerable: number;
  };
  readonly engine: { readonly sources: number; readonly sinks: number };
  readonly overall: CategoryScore;
  /** The seven categories a flow analysis can answer, scored on their own. */
  readonly taintSubset: CategoryScore;
  readonly categories: readonly CategoryScore[];
  /** Present only with `--cases`: 2 740 rows belong to an artifact, not to the repository. */
  readonly cases?: readonly CaseResult[];
  readonly measuredAt: string;
}

/** `# test name, category, real vulnerability, cwe` is a comment; the rows below it are comma-separated triples. */
function readExpected(path: string): Expected[] {
  const out: Expected[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const [name, category, vulnerable, cwe] = trimmed.split(',');
    if (!name || !category) continue;
    out.push({
      name: name.trim(),
      category: category.trim(),
      // Anything that is not an explicit `true` is a safe case, which is how the scorecard reads the file.
      vulnerable: (vulnerable ?? '').trim() === 'true',
      cwe: (cwe ?? '').trim(),
    });
  }
  return out;
}

function score(cases: readonly CaseResult[], category: string): CategoryScore {
  const relevant = category === 'all' ? cases : cases.filter((item) => item.category === category);
  const vulnerable = relevant.filter((item) => item.vulnerable);
  const safe = relevant.filter((item) => !item.vulnerable);
  const truePositives = vulnerable.filter((item) => item.flagged).length;
  const falsePositives = safe.filter((item) => item.flagged).length;
  const tpr = vulnerable.length === 0 ? 0 : truePositives / vulnerable.length;
  const fpr = safe.length === 0 ? 0 : falsePositives / safe.length;
  return {
    category,
    cases: relevant.length,
    vulnerable: vulnerable.length,
    truePositives,
    falsePositives,
    tpr,
    fpr,
    score: tpr - fpr,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const corpusIndex = argv.indexOf('--corpus');
  const outIndex = argv.indexOf('--out');
  const corpus = corpusIndex >= 0 ? argv[corpusIndex + 1] : process.env['OWASP_CORPUS'];
  const out =
    outIndex >= 0
      ? (argv[outIndex + 1] ?? 'benchmarks/owasp-benchmark.json')
      : 'benchmarks/owasp-benchmark.json';
  if (!corpus) {
    throw new Error('--corpus <BenchmarkJava checkout> or OWASP_CORPUS is required');
  }

  const testcode = join(corpus, 'src/main/java/org/owasp/benchmark/testcode');
  const expectedFile = readdirSync(corpus).find((name) => name.startsWith('expectedresults'));
  if (!expectedFile) throw new Error(`no expectedresults CSV in ${corpus}`);
  const expected = new Map(readExpected(join(corpus, expectedFile)).map((e) => [e.name, e]));

  const provider = new JavaProvider();
  const cases: CaseResult[] = [];
  let sources = 0;
  let sinks = 0;

  for (const file of readdirSync(testcode).sort()) {
    if (!file.endsWith('.java')) continue;
    const name = file.replace(/\.java$/, '');
    const label = expected.get(name);
    // A test case the CSV does not label is not scored: guessing its label would be inventing ground truth.
    if (!label) continue;

    const code = readFileSync(join(testcode, file), 'utf8');
    const captures = provider.parse(code, file) as Array<{ tag?: string }>;
    const grouped = groupCaptures(captures as Parameters<typeof groupCaptures>[0], file);
    const parsed = {
      filePath: file,
      language: 'java',
      symbols: grouped.symbols,
      references: grouped.references,
      scopeTree: grouped.scopeTree,
      ast: captures,
    } as unknown as ParsedFile;

    const extractedSources = provider.extractTaintSources(code);
    const extractedSinks = provider.extractTaintSinks(code);
    sources += extractedSources.length;
    sinks += extractedSinks.length;

    const extraction = new Map([
      [
        file,
        {
          sources: extractedSources,
          sinks: extractedSinks,
          sanitizers: provider.extractSanitizers(code),
        },
      ],
    ]);
    const callSites = buildCallSites([parsed], grouped.references);
    const result = analyzeInterproceduralTaint([parsed], callSites, extraction);

    // **A flow a sanitizer neutralised is information, not a vulnerability.** The engine reports it with
    // `sanitized: true` so a reader can see that the path exists and why it is safe; counting it as a finding would
    // make the score charge this engine for the escaping the code actually does.
    const live = result.findings.filter((finding) => !finding.sanitized);
    cases.push({
      name,
      category: label.category,
      vulnerable: label.vulnerable,
      flagged: live.length > 0,
      findings: live.length,
    });
  }

  const categories = [...new Set(cases.map((item) => item.category))].sort();
  const withCases = argv.includes('--cases');
  const report: Report = {
    corpus: {
      repository: 'OWASP-Benchmark/BenchmarkJava',
      expectedResultsSha256: createHash(join(corpus, expectedFile)),
      cases: cases.length,
      vulnerable: cases.filter((item) => item.vulnerable).length,
    },
    engine: { sources, sinks },
    overall: score(cases, 'all'),
    // `score` treats `all` as "every case in the list it was given", so the subset is scored by passing it a
    // filtered list and relabelling the result.
    taintSubset: {
      ...score(
        cases.filter((item) => TAINT_CATEGORIES.has(item.category)),
        'all',
      ),
      category: 'taint-subset',
    },
    categories: categories.map((category) => score(cases, category)),
    ...(withCases ? { cases } : {}),
    measuredAt: new Date().toISOString(),
  };

  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `cases ${report.overall.cases} · vulnerable ${report.overall.vulnerable}\n` +
      `TPR ${report.overall.tpr.toFixed(4)} · FPR ${report.overall.fpr.toFixed(4)} · ` +
      `score ${report.overall.score.toFixed(4)}\n` +
      `taint subset (${report.taintSubset.cases} cases): TPR ${report.taintSubset.tpr.toFixed(4)} · ` +
      `FPR ${report.taintSubset.fpr.toFixed(4)} · score ${report.taintSubset.score.toFixed(4)}\n` +
      `sources ${sources} · sinks ${sinks}\n` +
      report.categories
        .map(
          (category) =>
            `  ${category.category.padEnd(14)} tpr ${category.tpr.toFixed(3)} ` +
            `fpr ${category.fpr.toFixed(3)} score ${category.score.toFixed(3)} ` +
            `(${category.truePositives}/${category.vulnerable})\n`,
        )
        .join(''),
  );
}

function createHash(path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash: digest } = require('node:crypto') as typeof import('node:crypto');
  return digest('sha256').update(readFileSync(path)).digest('hex');
}

main();
