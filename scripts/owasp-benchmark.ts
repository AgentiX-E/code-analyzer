// The OWASP Benchmark, scored by this repository's own taint engine.
//
// **Why this corpus.** It is the one benchmark the competing scanners publish scores for — 2 740 servlet test cases,
// 1 415 of them real vulnerabilities, each labelled `true`/`false` in `expectedresults-1.2.csv`. A category is scored
// the way the benchmark's own scorecard scores it: a case counts as flagged if the engine reports at least one flow
// in that file, and the result is the Youden index, `TPR - FPR`, which charges a tool for the noise it makes rather
// than only rewarding what it finds.
//
// **Four of the eleven categories are not flows, and they are scored too.** `crypto` and `hash` ask whether a weak
// algorithm was chosen, `weakrand` whether the generator is predictable, `securecookie` whether a flag was set. The
// taint engine cannot answer any of them — it found 95 of their 513 vulnerable cases, all by accident — so the case is
// flagged when either the flow analysis or `evaluateSecurityRules` reports it. Two of those rules read the corpus's own
// `benchmark.properties`, because the algorithm the tests select is a property value rather than a literal.
//
// Both halves are reported separately as well as together: a single number cannot say which of the two found a case,
// and a rule family that silently stopped working would show up as a smaller total and nothing else.
//
// Usage:
//   tsx scripts/owasp-benchmark.ts --corpus <BenchmarkJava checkout> --out benchmarks/owasp-benchmark.json

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';

import { analyzeInterproceduralTaint } from '../packages/intelligence/src/security/interprocedural-entry.js';
import {
  evaluateSecurityRules,
  type RuleSourceFile,
} from '../packages/intelligence/src/security/rule-families.js';

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
  /** Rules that fired on this case, which is empty for every case a rule has nothing to say about. */
  readonly rules: readonly string[];
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
  /**
   * The same corpus scored twice, once by each half of the engine.
   *
   * **A single number cannot say which half found a case.** `overall` credits a case to whichever half reported it, so
   * a rule family that stopped working would show up as a smaller total and nothing else; these two say what each half
   * is worth on its own, and their sum is an upper bound on `overall` rather than a decomposition of it.
   */
  readonly byEngine: {
    readonly flows: CategoryScore;
    readonly rules: CategoryScore;
  };
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

function score(
  cases: readonly CaseResult[],
  category: string,
  flagged: (item: CaseResult) => boolean = (item) => item.flagged,
): CategoryScore {
  const relevant = category === 'all' ? cases : cases.filter((item) => item.category === category);
  const vulnerable = relevant.filter((item) => item.vulnerable);
  const safe = relevant.filter((item) => !item.vulnerable);
  const truePositives = vulnerable.filter(flagged).length;
  const falsePositives = safe.filter(flagged).length;
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
  // **The version is in the file name, and reading any `expectedresults` file was a mistake that silently scored a
  // different corpus.** The tarball of v1.2 contains a nested `BenchmarkJava-1.2beta/` checkout - 2 740 of its own
  // cases, its own `expectedresults-1.2beta.csv`, and a `benchmark.properties` whose algorithm differs - and a
  // `find(startsWith('expectedresults'))` cannot tell the two apart. **Measured: the same engine scored 0.3615 FPR on
  // the beta tree and 0.3042 on the released one**, from the same command, and the difference is not the engine.
  const expectedFile = 'expectedresults-1.2.csv';
  if (!existsSync(join(corpus, expectedFile))) {
    const found = readdirSync(corpus).filter((name) => name.startsWith('expectedresults'));
    throw new Error(
      `${corpus} has no ${expectedFile} (found ${found.length > 0 ? found.join(', ') : 'none'}) — this score is ` +
        'about v1.2, and a beta tree carries its own labels and its own configuration',
    );
  }
  const expected = new Map(readExpected(join(corpus, expectedFile)).map((e) => [e.name, e]));

  // Every file the rules may need: the case itself, plus the corpus's configuration. A Java web application selects
  // its algorithm in `benchmark.properties`, so a rule that cannot read it can only see the half of the corpus that
  // spells the algorithm out at the call.
  const configurationFiles: RuleSourceFile[] = [];
  for (const resources of ['src/main/resources', 'src/main/webapp/WEB-INF']) {
    const directory = join(corpus, resources);
    let entries: string[] = [];
    try {
      entries = readdirSync(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.properties')) continue;
      configurationFiles.push({
        path: `${resources}/${entry}`,
        language: 'properties',
        text: readFileSync(join(directory, entry), 'utf8'),
      });
    }
  }

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

    // **What the file's arithmetic decides, asked of the same provider that parsed it.** Without this the analysis has
    // no reachability information and every assignment stays a may-definition - which is what scored 0.5128.
    const extraction = new Map([
      [
        file,
        {
          sources: extractedSources,
          sinks: extractedSinks,
          sanitizers: provider.extractSanitizers(code),
          constants: provider.extractConstantFacts(code),
        },
      ],
    ]);
    const callSites = buildCallSites([parsed], grouped.references);
    const result = analyzeInterproceduralTaint([parsed], callSites, extraction);

    // **A flow a sanitizer neutralised is information, not a vulnerability.** The engine reports it with
    // `sanitized: true` so a reader can see that the path exists and why it is safe; counting it as a finding would
    // make the score charge this engine for the escaping the code actually does.
    const live = result.findings.filter((finding) => !finding.sanitized);
    const caseFile: RuleSourceFile = { path: file, language: 'java', text: code };
    const ruleFindings = evaluateSecurityRules([caseFile, ...configurationFiles]).filter(
      (finding) => finding.filePath === file,
    );
    cases.push({
      name,
      category: label.category,
      vulnerable: label.vulnerable,
      flagged: live.length > 0 || ruleFindings.length > 0,
      findings: live.length,
      rules: [...new Set(ruleFindings.map((finding) => finding.ruleId))].sort(),
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
    byEngine: {
      flows: score(cases, 'all', (item) => item.findings > 0),
      rules: score(cases, 'all', (item) => item.rules.length > 0),
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
      `flows alone: TPR ${report.byEngine.flows.tpr.toFixed(4)} · FPR ${report.byEngine.flows.fpr.toFixed(4)} · ` +
      `score ${report.byEngine.flows.score.toFixed(4)}\n` +
      `rules alone: TPR ${report.byEngine.rules.tpr.toFixed(4)} · FPR ${report.byEngine.rules.fpr.toFixed(4)} · ` +
      `score ${report.byEngine.rules.score.toFixed(4)}\n` +
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
