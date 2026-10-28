// The OWASP Benchmark, as a user story: "tell me which of these 2 740 servlet test cases are exploitable".
//
// **This is the acceptance criterion for story 9**, and it is written the way the benchmark is scored rather than the
// way the engine is built: a case counts as flagged if the engine reports at least one flow in that file, the answer
// key is the benchmark's own `expectedresults` CSV, and the figure is `TPR - FPR`.
//
// The suite refuses to run on a corpus it cannot verify — 2 740 labelled cases of which 1 415 are real
// vulnerabilities — because a score computed over a different set of files is not this score.
//
// Skipped when `OWASP_CORPUS` is unset, which is how every other corpus-backed suite in this repository behaves: the
// `.github/workflows/owasp-benchmark.yml` job downloads the corpus, sets the variable, and is the place the number is
// produced.

import { JavaProvider, buildCallSites, groupCaptures } from '@code-analyzer/analyzer';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../../packages/intelligence/src/security/interprocedural-entry.js';

import type { ParsedFile } from '@code-analyzer/shared';

/** Where the checkout is: the variable may name either the repository root or the directory holding it. */
function corpusRoot(): string | null {
  const configured = process.env['OWASP_CORPUS'];
  if (!configured) return null;
  const entries = readdirSync(configured);
  const nested = entries.find((entry) => entry.startsWith('BenchmarkJava-'));
  return nested ? join(configured, nested) : configured;
}

interface Label {
  readonly name: string;
  readonly category: string;
  readonly vulnerable: boolean;
}

function labels(root: string): Map<string, Label> {
  const file = readdirSync(root).find((name) => name.startsWith('expectedresults'));
  if (!file) throw new Error(`no expectedresults CSV in ${root}`);
  const out = new Map<string, Label>();
  for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const [name, category, vulnerable] = trimmed.split(',');
    if (!name || !category) continue;
    out.set(name.trim(), {
      name: name.trim(),
      category: category.trim(),
      vulnerable: (vulnerable ?? '').trim() === 'true',
    });
  }
  return out;
}

interface Scored {
  readonly name: string;
  readonly category: string;
  readonly vulnerable: boolean;
  readonly flagged: boolean;
  readonly sinkKinds: readonly string[];
}

/** Run the engine on one test case and answer the benchmark's only question about it. */
function score(root: string, label: Label): Scored {
  const file = `${label.name}.java`;
  const code = readFileSync(join(root, 'src/main/java/org/owasp/benchmark/testcode', file), 'utf8');
  const provider = new JavaProvider();
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

  const extraction = new Map([
    [
      file,
      {
        sources: provider.extractTaintSources(code),
        sinks: provider.extractTaintSinks(code),
        sanitizers: provider.extractSanitizers(code),
      },
    ],
  ]);
  const result = analyzeInterproceduralTaint(
    [parsed],
    buildCallSites([parsed], grouped.references),
    extraction,
  );
  // A flow a sanitizer neutralised is not a vulnerability; the engine reports it with `sanitized: true` so the path
  // can be explained, and the benchmark charges a tool only for the flows it stands behind.
  const live = result.findings.filter((finding) => !finding.sanitized);
  return {
    name: label.name,
    category: label.category,
    vulnerable: label.vulnerable,
    flagged: live.length > 0,
    sinkKinds: [...new Set(live.map((finding) => finding.sink.kind))].sort(),
  };
}

const ROOT = corpusRoot();

describe.skipIf(ROOT === null)('the OWASP Benchmark corpus', () => {
  it('is the labelled set this score is about', () => {
    const all = labels(ROOT!);
    const vulnerable = [...all.values()].filter((label) => label.vulnerable);
    // **The corpus and its labels have to be the pair that was scored.** If the benchmark repository is updated, this
    // fails here rather than reporting a number nobody can compare.
    expect(all.size).toBe(2740);
    expect(vulnerable.length).toBe(1415);
    const categories = new Set([...all.values()].map((label) => label.category));
    expect(categories.size).toBe(11);
  });

  it('names the sink a vulnerable case reaches, and stays quiet on a safe one', () => {
    const all = labels(ROOT!);

    // `BenchmarkTest00008`: the header reaches `prepareCall(sql)` through a concatenation and a `URLDecoder.decode`.
    const sqlInjection = score(ROOT!, all.get('BenchmarkTest00008')!);
    expect(sqlInjection.vulnerable).toBe(true);
    expect(sqlInjection.flagged).toBe(true);
    expect(sqlInjection.sinkKinds).toContain('sql_exec');

    // `BenchmarkTest00013`: the parameter reaches `response.getWriter().print(...)`.
    const crossSite = score(ROOT!, all.get('BenchmarkTest00013')!);
    expect(crossSite.flagged).toBe(true);
    expect(crossSite.sinkKinds).toContain('html');

    // **The other half of the measure.** `BenchmarkTest00052` reads the same header and passes it through ESAPI's
    // encoder before the response, and a scanner that flags it is charging the project for its own escaping.
    const escaped = score(ROOT!, all.get('BenchmarkTest00052')!);
    expect(escaped.vulnerable).toBe(false);
    expect(escaped.flagged).toBe(false);
  });

  it('scores every labelled case, and holds the figures the workflow publishes', () => {
    const all = labels(ROOT!);
    const scored: Scored[] = [];
    for (const label of all.values()) scored.push(score(ROOT!, label));

    const vulnerable = scored.filter((item) => item.vulnerable);
    const safe = scored.filter((item) => !item.vulnerable);
    const truePositives = vulnerable.filter((item) => item.flagged).length;
    const falsePositives = safe.filter((item) => item.flagged).length;
    const tpr = truePositives / vulnerable.length;
    const fpr = falsePositives / safe.length;

    // The floors are the measured baseline, so a regression in the vocabulary, the captures or the propagator fails
    // here rather than in a report nobody re-runs.
    expect(tpr).toBeGreaterThanOrEqual(0.63);
    expect(fpr).toBeLessThanOrEqual(0.47);
    expect(tpr - fpr).toBeGreaterThanOrEqual(0.16);

    // Seven of the eleven categories are flows, and that subset is the one this engine claims.
    const taintCategories = new Set([
      'cmdi',
      'ldapi',
      'pathtraver',
      'sqli',
      'trustbound',
      'xpathi',
      'xss',
    ]);
    const taintVulnerable = vulnerable.filter((item) => taintCategories.has(item.category));
    const taintSafe = safe.filter((item) => taintCategories.has(item.category));
    const taintTpr = taintVulnerable.filter((item) => item.flagged).length / taintVulnerable.length;
    const taintFpr = taintSafe.filter((item) => item.flagged).length / taintSafe.length;
    expect(taintTpr).toBeGreaterThanOrEqual(0.76);
    expect(taintTpr - taintFpr).toBeGreaterThanOrEqual(0.22);
  }, 600_000);

  it('answers the same way twice, so the score is a measurement rather than a run', () => {
    const all = labels(ROOT!);
    const sample = [...all.values()].slice(0, 40);
    const first = sample.map((label) => score(ROOT!, label).flagged);
    const second = sample.map((label) => score(ROOT!, label).flagged);
    expect(second).toEqual(first);
  }, 120_000);
});
