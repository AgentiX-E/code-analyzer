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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeInterproceduralTaint } from '../../packages/intelligence/src/security/interprocedural-entry.js';
import {
  evaluateSecurityRules,
  type RuleSourceFile,
} from '../../packages/intelligence/src/security/rule-families.js';

import type { ParsedFile } from '@code-analyzer/shared';

/**
 * The answer file whose name carries the version this score is about.
 *
 * **`find(startsWith('expectedresults'))` scored the wrong corpus, twice.** The v1.2 tarball contains a nested
 * `BenchmarkJava-1.2beta/` checkout with 2 740 cases of its own, its own `expectedresults-1.2beta.csv` and a
 * `benchmark.properties` whose chosen algorithm differs — so a search that accepted any answer file, plus a root
 * resolver that preferred a nested `BenchmarkJava-*` directory, measured the beta tree while the report said v1.2.
 * **Measured: FPR 0.3615 on the beta tree against 0.3042 on the released one, from the same engine and the same
 * command** (both figures from before the constant-condition model, which moved the released tree to 0.1306, the
 * cross-function summary to 0.1155, the escaping vocabulary to 0.1072, the container model to 0.0302 and the
 * discarded-value shapes to 0.0015 — the comparison is between the two trees, not between two versions of the engine).
 * The version is in the file name, so it is what the suite selects on.
 */
const EXPECTED_RESULTS = 'expectedresults-1.2.csv';

/** A directory that is itself a v1.2 checkout: its own labels, its own testcode. */
function isCorpusRoot(directory: string): boolean {
  return (
    existsSync(join(directory, EXPECTED_RESULTS)) &&
    existsSync(join(directory, 'src/main/java/org/owasp/benchmark/testcode'))
  );
}

/**
 * Where the checkout is: the variable may name the corpus root or a directory holding it.
 *
 * **The root wins when it is one**, and that is the fix rather than the heuristic: the version file decides, and a
 * directory that carries it is the corpus whatever else it contains.
 */
function corpusRoot(): string | null {
  const configured = process.env['OWASP_CORPUS'];
  if (!configured) return null;
  if (isCorpusRoot(configured)) return configured;
  const nested = readdirSync(configured)
    .map((entry) => join(configured, entry))
    .find((candidate) => isCorpusRoot(candidate));
  if (!nested) {
    throw new Error(
      `no ${EXPECTED_RESULTS} under ${configured} — this suite scores v1.2 and refuses to score a tree that is not`,
    );
  }
  return nested;
}

interface Label {
  readonly name: string;
  readonly category: string;
  readonly vulnerable: boolean;
}

function labels(root: string): Map<string, Label> {
  const file = EXPECTED_RESULTS;
  if (!existsSync(join(root, file))) throw new Error(`no ${file} in ${root}`);
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
  /** The rules that fired, which is how a non-flow category is answered at all. */
  readonly rules: readonly string[];
}

/** One row of `benchmarks/owasp-benchmark.json`, as far as this suite compares against it. */
interface ArtifactScore {
  readonly cases: number;
  readonly vulnerable: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly tpr: number;
  readonly fpr: number;
  readonly score: number;
}

/**
 * The corpus's own configuration, read once.
 *
 * Four of the eleven categories are decided by it: the tests read `benchmark.properties` at run time and hand the value
 * to `MessageDigest.getInstance`, so `hashAlg1=MD5` is what makes 129 cases vulnerable and `hashAlg1=SHA-256` would
 * make them safe.
 */
function configuration(root: string): readonly RuleSourceFile[] {
  const directory = join(root, 'src/main/resources');
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.properties'))
    .map((entry) => ({
      path: `src/main/resources/${entry}`,
      language: 'properties',
      text: readFileSync(join(directory, entry), 'utf8'),
    }));
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

  // **Every fact the providers can produce, because the workflow produces all of them.**
  //
  // This suite is the acceptance criterion for story 9, so it has to score the engine the workflow scores. It did not:
  // `constants` and `returnLines` were added to `scripts/owasp-benchmark.ts` in two iterations and never to this file,
  // and both are *optional and neutral when absent* — so the suite kept passing while measuring an engine two models
  // behind the one whose figures are published, with floors loose enough (FPR ≤ 0.31) that the gap could not show. A
  // scoring harness that quietly runs a weaker configuration is worse than no harness, which is why the figure is
  // compared against the artifact below rather than against a hand-written bound.
  const extraction = new Map([
    [
      file,
      {
        sources: provider.extractTaintSources(code),
        sinks: provider.extractTaintSinks(code),
        sanitizers: provider.extractSanitizers(code),
        constants: provider.extractConstantFacts(code),
        returnLines: provider.extractReturnLines(code),
        // **Which statements may be skipped, and what goes into a collection and comes back out.** Without the
        // first every definition is a maybe and the last write to a name never wins; without the second every value
        // put into a map is "lost" and the summary has to decline the question.
        conditionalRegions: provider.extractConditionalRegions(code),
        discardedValueRegions: provider.extractDiscardedValueRegions(code),
        scopeRegions: provider.extractScopeRegions(code),
        containerCalls: provider.extractContainerCalls(code),
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
  // **The case is flagged when either half of the engine reports it.** A taint engine cannot answer "this program
  // chose MD5", and a rule cannot answer "this request parameter reached a query"; the benchmark asks one question per
  // case and both halves are part of the answer.
  const ruleFindings = evaluateSecurityRules([
    { path: file, language: 'java', text: code },
    ...configuration(root),
  ]).filter((finding) => finding.filePath === file);
  return {
    name: label.name,
    category: label.category,
    vulnerable: label.vulnerable,
    flagged: live.length > 0 || ruleFindings.length > 0,
    sinkKinds: [...new Set(live.map((finding) => finding.sink.kind))].sort(),
    rules: [...new Set(ruleFindings.map((finding) => finding.ruleId))].sort(),
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

    // **One label per file, and one file per label.** The beta tree beside the root has the same 2 740 labels and a
    // different formatting and configuration, so labels alone cannot tell the trees apart — the file count can, and a
    // label with no file would score as a miss for a reason that is not about the engine.
    const testcode = join(ROOT!, 'src/main/java/org/owasp/benchmark/testcode');
    const caseFiles = readdirSync(testcode).filter((entry) => entry.endsWith('.java'));
    expect(caseFiles.length).toBe(2740);
    expect([...all.keys()].every((name) => caseFiles.includes(`${name}.java`))).toBe(true);
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

  it('reproduces the published figures exactly, rather than staying under a bound', () => {
    const all = labels(ROOT!);
    const scored: Scored[] = [];
    for (const label of all.values()) scored.push(score(ROOT!, label));

    const vulnerable = scored.filter((item) => item.vulnerable);
    const safe = scored.filter((item) => !item.vulnerable);
    const truePositives = vulnerable.filter((item) => item.flagged).length;
    const falsePositives = safe.filter((item) => item.flagged).length;

    // **The published artifact, not a hand-written bound.** Every previous version of this test asserted a floor —
    // TPR ≥ 0.81, FPR ≤ 0.31 — and a floor is a promise about a number *below* the truth, so it held while this suite
    // measured an engine two models behind the one the workflow publishes. Comparing against
    // `benchmarks/owasp-benchmark.json` makes the two wirings one wiring: a fact that reaches the workflow and not this
    // suite changes the count here, and the only way to make this pass is to regenerate the artifact.
    const artifact = JSON.parse(
      readFileSync(join(process.cwd(), 'benchmarks/owasp-benchmark.json'), 'utf8'),
    ) as { overall: ArtifactScore; taintSubset: ArtifactScore };
    expect(artifact.overall.cases).toBe(scored.length);
    expect(artifact.overall.vulnerable).toBe(vulnerable.length);
    expect(truePositives).toBe(artifact.overall.truePositives);
    expect(falsePositives).toBe(artifact.overall.falsePositives);

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
    expect(taintVulnerable.filter((item) => item.flagged).length).toBe(
      artifact.taintSubset.truePositives,
    );
    expect(taintSafe.filter((item) => item.flagged).length).toBe(
      artifact.taintSubset.falsePositives,
    );
  }, 600_000);

  it('answers the four categories a flow cannot, by reading the configuration beside the code', () => {
    // **The half of the score that has nothing to do with flows.** `BenchmarkTest00005` chooses
    // `Cipher.getInstance("DES/CBC/PKCS5Padding")`; `BenchmarkTest00087` marks its cookie `setSecure(false)`;
    // `BenchmarkTest00023` seeds from `java.util.Random`. Each is a rule, and the rule has to fire on the case rather
    // than on the file's neighbours.
    const all = labels(ROOT!);

    const weakCipher = score(ROOT!, all.get('BenchmarkTest00005')!);
    expect(weakCipher.vulnerable).toBe(true);
    expect(weakCipher.rules).toContain('weak-cipher');

    const insecureCookie = score(ROOT!, all.get('BenchmarkTest00087')!);
    expect(insecureCookie.rules).toContain('insecure-cookie');

    const weakRandom = score(ROOT!, all.get('BenchmarkTest00023')!);
    expect(weakRandom.rules).toContain('weak-random');

    // `BenchmarkTest00009` hashes with `sha-384`, and a rule that reports it is charging the project for a choice it
    // got right. The same is true of `BenchmarkTest00016`, whose cookie sets the flag.
    expect(score(ROOT!, all.get('BenchmarkTest00009')!).rules).toEqual([]);
    expect(score(ROOT!, all.get('BenchmarkTest00016')!).rules).toEqual([]);
  }, 120_000);

  it('finds every vulnerable case in the four categories a rule answers', () => {
    const all = labels(ROOT!);
    const ruleCategories = new Set(['crypto', 'hash', 'securecookie', 'weakrand']);
    const scored = [...all.values()]
      .filter((label) => ruleCategories.has(label.category))
      .map((label) => score(ROOT!, label));

    const vulnerable = scored.filter((item) => item.vulnerable);
    const safe = scored.filter((item) => !item.vulnerable);
    const tpr = vulnerable.filter((item) => item.rules.length > 0).length / vulnerable.length;
    const fpr = safe.filter((item) => item.rules.length > 0).length / safe.length;

    // 513 vulnerable cases, 529 safe ones. Both bounds are the measured figures, and the false-positive one is 0
    // because every rule here names a construct rather than a pattern.
    expect(vulnerable.length).toBe(513);
    expect(tpr).toBeGreaterThanOrEqual(1);
    expect(fpr).toBeLessThanOrEqual(0.01);
  }, 300_000);

  // **The destination decides what a `write` is.** `BenchmarkTest00054` encrypts a request value and appends the
  // ciphertext to a file whose path was fixed when the writer was constructed. Its label is `crypto`, it is safe, and
  // a scanner that calls that write cross-site scripting charges the project for writing its own output down. All 85
  // safe `Crypto` cases that scored as false positives did so through this sink, which is why the filter exists.
  it('does not call a write to a file cross-site scripting', () => {
    const all = labels(ROOT!);
    const toFile = score(ROOT!, all.get('BenchmarkTest00054')!);
    expect(toFile.vulnerable).toBe(false);
    expect(toFile.sinkKinds).not.toContain('html');
    expect(toFile.flagged).toBe(false);

    // **And the same method name on the response is still a sink**, or the filter would be a way to lose the category
    // it sits in: `BenchmarkTest00013` writes the parameter to the response body and is vulnerable.
    const toResponse = score(ROOT!, all.get('BenchmarkTest00013')!);
    expect(toResponse.sinkKinds).toContain('html');
  }, 120_000);

  it('answers the same way twice, so the score is a measurement rather than a run', () => {
    const all = labels(ROOT!);
    const sample = [...all.values()].slice(0, 40);
    const first = sample.map((label) => score(ROOT!, label).flagged);
    const second = sample.map((label) => score(ROOT!, label).flagged);
    expect(second).toEqual(first);
  }, 120_000);
});
