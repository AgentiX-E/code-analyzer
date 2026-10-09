// What the compiler says about a real repository, measured in CI.
//
// **The step that turns the compiler-evidence capability from a local test into a figure.** The capability landed in
// `packages/analyzer` and its end-to-end test runs a real `tsc` on a project the test writes - **but a project the
// test writes is a project this repository controls**, and **the user story is about somebody else's branch.**
//
// **And most of the matrix is not TypeScript.** The corpora are express, flask, gin and ripgrep; **only one of the
// four has a compiler this can run**, so **the other three must report a skip rather than a zero** - **which is what
// the `skipped` field exists for, and the fifth time in this sequence that the distinction is load-bearing.**

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { collectCompileEvidence } = require('../../packages/analyzer/dist/index.js');

const ROOT = process.env.CORPUS_PATH || '/tmp/corpus';
const runner = {
  run: async (command, args, cwd) => {
    try {
      const stdout = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { stdout, exitCode: 0 };
    } catch (error) {
      return { stdout: (error && error.stdout) || '', exitCode: (error && error.status) || 1 };
    }
  },
};

(async () => {
  let packageJson = null;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch {
    // **A repository with no manifest is a repository this cannot check**, and that is a skip rather than an error.
  }

  const started = Date.now();
  const evidence = await collectCompileEvidence(ROOT, runner, packageJson, 300_000);
  const out = {
    comment: [
      'What the compiler says about a real repository, measured on a GitHub runner.',
      '',
      '**A repository with no compiler is not a repository with no errors**, so `skipped` carries a reason rather than',
      'being an empty result - and **only one of the four corpora in this matrix is even TypeScript**.',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    repository: process.env.CORPUS_REPO,
    ref: process.env.CORPUS_REF,
    language: process.env.CORPUS_LANGUAGE,
    seconds: Math.round((Date.now() - started) / 1000),
    // **The distinction the whole step turns on.**
    diagnosticCount: evidence.findings.length,
    skipped: evidence.skipped,
    byCode: evidence.findings.reduce((acc, f) => {
      acc[f.code] = (acc[f.code] || 0) + 1;
      return acc;
    }, {}),
  };
  fs.mkdirSync('benchmarks', { recursive: true });
  fs.writeFileSync('benchmarks/compile-evidence.json', JSON.stringify(out, null, 2) + '\n');
  console.log(
    `COMPILE-EVIDENCE repo=${out.repository} lang=${out.language} seconds=${out.seconds} diagnostics=${out.diagnosticCount} skipped=${out.skipped ? 'yes' : 'no'}`,
  );
})().catch((error) => {
  console.error('FAILED', error && error.message);
  process.exit(1);
});
