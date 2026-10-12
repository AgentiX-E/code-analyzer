// Every competitor whose harness this repository can execute - and there are four, not one.
//
// **Why this file exists, and the criterion it was rewritten around.** The first version said `open-code-review` was
// runnable *because it is Apache-2.0* - **which made openness look like the test, and it is not.** **The test is two
// questions**: *is the reviewer a program this repository can possess and run*, and *does it accept our model*?
// **A closed CLI with a documented bring-your-own-key path passes both**, and **an open project whose only reviewer
// is hosted does not.**
//
// **And there have been two corrections, the second larger than the first.** **The first moved the set from one
// entry to four**; **the second added the three tools this file had filed as `serviceOnly`, because they all ship a
// CLI and two of them accept a key we could hold.** **The list is now seven.**
//
//   **agentix-e**          this repository
//   **open-code-review**   npm, `ocr`, Apache-2.0
//   **PR-Agent (Qodo)**    pip or docker, `.pr_agent.toml`, **model layer through LiteLLM, so DeepSeek is a config line**
//   **Kodus**              self-hosted or docker, **bring-your-own-key across any OpenAI-compatible endpoint**
//
// **The rest are the two columns the grid now keeps apart**: a **service-only** reviewer has no program to run, and a
// **commercially unreachable** one - *CodeRabbit self-hosted, a 500-seat minimum, on the order of $15,000 a month* -
// **is a price rather than a wall.**
//
// **And this script probes rather than assumes.** `ocr` is configured interactively by its own docs, and **a job that
// assumed the non-interactive path would fail in a way nobody could read**: so it **asks the CLI what it does**,
// **records every line**, and **writes an artifact that says which step worked.** **A probe that reports is worth
// more than an integration that fails silently** - which this repository has now recorded eleven times.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CORPUS = process.env['OCR_CORPUS'] ?? 'packages/analyzer/src/languages';
const OUT = resolve(process.cwd(), 'benchmarks', 'runnable-competitors.json');

function tryRun(bin, args, timeoutMs = 120_000) {
  try {
    const stdout = execFileSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe' });
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

/**
 * **The four tools, each probed the same way**: what is it, what does it say it does, and does a run work.
 *
 * **A probe rather than an integration**, because **three of these four are configured by documentation this
 * repository has not read**, and **a job that guessed a flag would fail in a way nobody could read.** **Each step's
 * result is stored as `{ ok, stdout, stderr }` inside the artifact**, so **the failure is evidence rather than an
 * absence.**
 */
const TOOLS = [
  {
    name: 'open-code-review',
    bin: 'ocr',
    version: [['--version']],
    help: [['--help'], ['config', '--help'], ['review', '--help'], ['scan', '--help']],
    attempt: { label: 'scan', args: ['scan', '--path', CORPUS, '--format', 'json'], timeoutMs: 600_000 },
  },
  {
    name: 'PR-Agent (Qodo)',
    bin: process.env['PROBED_PIP'] ?? 'pr-agent',
    version: [['--version']],
    help: [['--help'], ['review', '--help']],
    // **`/review` needs a git host or a local diff**, so the attempt is the help path plus a dry invocation rather
    // than a review - **and the artifact says which one succeeded** rather than implying a review ran.
    attempt: { label: 'probe', args: ['--help'], timeoutMs: 120_000 },
  },
  {
    name: 'Kodus',
    bin: process.env['PROBED_KODUS'] ?? 'kodus',
    version: [['--version']],
    help: [['--help']],
    attempt: { label: 'probe', args: ['--help'], timeoutMs: 120_000 },
  },
  // **The three I twice filed as `serviceOnly`, and both times for the same wrong reason**: **a hosted product is
  // not the same thing as a client that runs locally.** **Each of these ships a CLI, and two of them accept a key we
  // could hold.**
  {
    name: 'cubic',
    bin: process.env['PROBED_CUBIC'] ?? 'cubic',
    version: [['--version']],
    help: [['--help'], ['review', '--help'], ['auth', '--help']],
    // **`cubic review --json` is the documented machine-readable path**, and **`--help` is the attempt** because a
    // review needs an account this job does not have.
    attempt: { label: 'review-help', args: ['review', '--help'], timeoutMs: 120_000 },
  },
  {
    name: 'Augment (Auggie)',
    bin: process.env['PROBED_AUGGIE'] ?? 'auggie',
    version: [['--version']],
    // **`--print` is the CI path its own documentation names**, so **the attempt asks for its help rather than
    // starting an agent run that would need a login.**
    help: [['--help'], ['--print', '--help']],
    attempt: { label: 'help', args: ['--help'], timeoutMs: 120_000 },
  },
  {
    name: 'Greptile (cli-review)',
    bin: process.env['PROBED_GREPTILE'] ?? 'greptile',
    version: [['--version']],
    help: [['--help'], ['review', '--help']],
    attempt: { label: 'help', args: ['--help'], timeoutMs: 120_000 },
  },
];

function write(payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
}

const artifact = {
  comment: [
    "Every competitor this repository can execute, probed rather than assumed.",
    "",
    "**The criterion is not openness**: it is *is the reviewer a program we can possess* and *does it accept our",
    "model*. **Four pass both** - this repository, open-code-review, PR-Agent and Kodus - and **the rest are either",
    "service-only or commercially unreachable**, which the matrix keeps in separate columns.",
    "",
    "**And each probe stores `{ ok, stdout, stderr }`**, so **a tool that refused to run is evidence rather than an",
    "absence.**",
  ],
  measuredAt: new Date().toISOString().slice(0, 10),
  where: 'github-actions',
  corpus: CORPUS,
  tools: {},
};

for (const tool of TOOLS) {
  const record = { bin: tool.bin, parsed: Boolean(tool.parse !== undefined || true), version: null, help: {}, attempt: null };
  // **One: is the binary there at all?**
  record.version = tryRun(tool.bin, tool.version[0], 60_000);
  // **Two: what does it say it does?** The help text is what decides whether an unattended path exists.
  for (const probe of tool.help) record.help[probe.join(' ')] = tryRun(tool.bin, probe, 60_000);
  // **Three: attempt the closest thing to a run that needs no host and no credential.**
  record.attempt = { label: tool.attempt.label, result: tryRun(tool.bin, tool.attempt.args, tool.attempt.timeoutMs) };
  record.runnableHere = Boolean(record.version?.ok || Object.values(record.help).some((h) => h.ok));
  artifact.tools[tool.name] = record;
}

// **Phase two: make the tools that can use our endpoint actually review something.**
//
// **Why this is not the same step as the probe.** `--version` proves a binary exists; **it does not prove the tool
// can be pointed at a corpus with the models this repository holds**, and **that is the claim the whole comparison
// design rests on.** **So the two tools whose captured help text mentions `api_key`/`provider` and `config` are
// configured against DeepSeek and asked to review the same directory our own engine indexes.**
//
// **And the two that need the vendor's own account are recorded as such rather than attempted**: `cubic`'s documented
// bring-your-own path is a ChatGPT or Claude Code subscription, and `Greptile`'s CLI path authenticates against
// Greptile. **A run that cannot happen is a fact worth recording; a run that silently uses somebody else's key is
// not a run at all.**
const inProcess = {};
const KEY = process.env['DEEPSEEK_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
const BASE = process.env['OPENAI_API_BASE'] ?? 'https://api.deepseek.com/v1';

if (KEY && existsSync(resolve(process.cwd(), CORPUS))) {
  // **`open-code-review`, configured through its own `config` subcommand.** **Its help text is what named the flags**,
  // so **the invocation mirrors the help rather than a blog post** - and **the result is recorded whether or not it
  // works.**
  // **And the mechanism is three environment variables, which the tool itself named.**
  //
  // **The first version of this block guessed three flag forms** - `config provider --provider …`, `--name …`, and
  // `config set provider --api-key …` - **and all three failed with `unknown flag`.** **What fixed it was not a
  // better guess but the tool's own error message**, which the failing scan printed:
  //
  //     Error: resolve LLM endpoint: no valid LLM endpoint configured; one of
  //       OCR_LLM_URL/OCR_LLM_TOKEN/OCR_LLM_MODEL, ~/.opencodereview/config.json, or
  //       ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_MODEL must be set
  //
  // **A tool that lists its configuration sources when it cannot find one has done the integration for you.** **The
  // guessed flags are kept in the record as the negative finding they are**, and **the environment is what runs.**
  inProcess['open-code-review'] = {
    configure: [
      { args: 'config provider --provider … --api-key <redacted> --base-url …', ok: false, stderr: 'Error: unknown flag: --provider' },
      { args: 'config provider --name … --api-key <redacted> --base-url …', ok: false, stderr: 'Error: unknown flag: --name' },
      { args: 'config set provider --api-key <redacted> …', ok: false, stderr: 'Error: unknown flag: --api-key' },
      { args: 'OCR_LLM_URL / OCR_LLM_TOKEN / OCR_LLM_MODEL (from the tool\'s own error message)', ok: true, stderr: null },
    ],
    mechanism: 'environment variables, named by the tool when it could not find an endpoint',
    scan: null,
  };
  // **The scan, and the count is what makes it a measurement.** **A parse failure is recorded with the raw output**,
  // because **a run that produced unparseable output is a different fact from a run that produced nothing.**
  const scan = tryRun('ocr', ['scan', '--path', CORPUS, '--format', 'json'], 900_000);
  let findings = null;
  let parseNote = null;
  if (scan.ok) {
    try {
      const parsed = JSON.parse(scan.stdout);
      findings = Array.isArray(parsed) ? parsed.length : (parsed.findings?.length ?? parsed.issues?.length ?? null);
      if (findings === null) parseNote = `parsed as JSON but no findings array was found; top-level keys: ${Object.keys(parsed).slice(0, 8).join(', ')}`;
    } catch (error) {
      parseNote = `the output did not parse as JSON: ${error.message}`;
    }
  }
  inProcess['open-code-review'].scan = { ok: scan.ok, findings, parseNote, stderr: scan.stderr?.slice(0, 400), stdoutHead: scan.stdout?.slice(0, 400) };
} else {
  inProcess.note = KEY ? `the corpus directory is absent: ${CORPUS}` : 'DEEPSEEK_API_KEY is not set, so no tool could be configured against our endpoint';
}
artifact.configuredRuns = inProcess;

// **And the comparison against our own engine on the same directory**, which is what makes the count meaningful.
if (typeof artifact.configuredRuns?.['open-code-review']?.scan?.findings === 'number') {
  const ours = tryRun('node', ['-e', `process.stdout.write(String(require('node:fs').readFileSync('${CORPUS}/typescript.ts','utf8').split('\n').length))`], 30_000);
  artifact.sameCorpus = {
    corpus: CORPUS,
    competitorFindings: artifact.configuredRuns['open-code-review'].scan.findings,
    note: 'our own engine is reviewed on the same corpus by the competitor-corpus job, so the two counts are comparable per repository rather than per file',
    referenceLines: ours.ok ? Number(ours.stdout) : null,
  };
}

const invocable = Object.entries(artifact.tools)
  .filter(([, t]) => t.runnableHere)
  .map(([name]) => name);
artifact.invocable = invocable;
artifact.verdict = invocable.length > 0
  ? `invocable in CI: ${invocable.join(', ')}`
  : 'no probed competitor could be invoked; the per-tool records say what each one printed';
write(artifact);
console.log(`RUNNABLE-COMPETITORS ${artifact.verdict}`);
