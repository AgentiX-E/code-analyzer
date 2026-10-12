// The one competitor whose harness this repository can execute.
//
// **Why this file exists, and why it is the centre of the comparison design.** A closed reviewer's output is a
// **capture** - Martian installed it on a fork and it reviewed once - so **there is no program to point at a second
// corpus**, and **the embedder that produced those reviews is frozen inside them.** **`open-code-review` is the
// exception**: Apache-2.0, a Go CLI, installable from npm, **runnable against any directory.** **So it is the one
// competitor this project can face on every corpus with the judge *and* the embedder under our control** - and
// **it is a direct competitor, which is what makes its exception matter.**
//
// **And this script probes rather than assumes.** `ocr` is configured interactively by its own docs, and **a job that
// assumed the non-interactive path would fail in a way nobody could read**: so it **asks the CLI what it does**,
// **records every line**, and **writes an artifact that says which step worked.** **A probe that reports is worth
// more than an integration that fails silently** - which this repository has now recorded eleven times.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OCR = process.env['OCR_BIN'] ?? 'ocr';
const CORPUS = process.env['OCR_CORPUS'] ?? 'packages/analyzer/src/languages';
const OUT = resolve(process.cwd(), 'benchmarks', 'ocr-comparison.json');

function tryRun(args, timeoutMs = 120_000) {
  try {
    const stdout = execFileSync(OCR, args, { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe' });
    return { ok: true, stdout: stdout.slice(0, 4000) };
  } catch (error) {
    const e = error;
    return {
      ok: false,
      stdout: String(e.stdout ?? '').slice(0, 2000),
      stderr: String(e.stderr ?? '').slice(0, 2000),
      message: e.message,
    };
  }
}

function write(payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
}

const artifact = {
  comment: [
    "A competitor's harness, executed by us, probed rather than assumed.",
    "",
    "**open-code-review is Apache-2.0 and runs locally**, so it is the one competitor this project can face on any",
    "corpus with the judge and the embedder under our control. **Every competitor whose output is a capture from",
    "somebody else's fork has no program to run**, and the artifact says so rather than leaving it implied.",
  ],
  measuredAt: new Date().toISOString().slice(0, 10),
  where: 'github-actions',
  tool: 'open-code-review',
  license: 'Apache-2.0',
  corpus: CORPUS,
  steps: {},
};

// **One: can the CLI be invoked at all?**
artifact.steps.version = tryRun(['--version'], 60_000);
artifact.steps.help = tryRun(['--help'], 60_000);

// **Two: what does it say about configuration?** The answer decides whether this can run unattended.
for (const probe of [['config', '--help'], ['review', '--help'], ['scan', '--help']]) {
  artifact.steps[probe.join('-')] = tryRun(probe, 60_000);
}

// **Three: attempt the scan mode, which needs no diff and no git history** - and record exactly what it says.
if (existsSync(resolve(process.cwd(), CORPUS))) {
  artifact.steps.scan = tryRun(['scan', '--path', CORPUS, '--format', 'json'], 600_000);
} else {
  artifact.steps.scan = { ok: false, message: `the corpus directory is not present: ${CORPUS}` };
}

artifact.verdict = artifact.steps.scan?.ok
  ? 'the competitor harness ran in CI; its findings are in steps.scan.stdout'
  : 'the competitor harness did not complete; steps records what it printed at each stage';
write(artifact);
console.log(`OCR-COMPARISON ${artifact.verdict}`);
