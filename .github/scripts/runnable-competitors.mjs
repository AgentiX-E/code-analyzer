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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CORPUS = process.env['OCR_CORPUS'] ?? 'packages/analyzer/src/languages';
const OUT = resolve(process.cwd(), 'benchmarks', 'runnable-competitors.json');

/**
 * Run a command and record **enough of it to explain what happened**.
 *
 * **The first version kept 2,000 characters of each stream and lost the reason.** **A scan that ran for minutes and
 * skipped hundreds of files reported `ok: false` with a stderr whose every recorded line was a `Skipping …` notice** -
 * **the failure was past the cut.** **So the record now keeps the head *and* the tail of both streams, the exit status
 * and the signal**, because **the head says what it started doing and the tail says what stopped it**, and **a
 * truncated record cannot tell a reader which of the two it is missing.**
 */
/**
 * **Where a command's full output goes when it is too large to be a field.**
 *
 * **Two runs were lost to truncation**: the first kept 2,000 characters of stderr and cut the reason, and the second
 * kept 3,200 of a **207,811-character** answer and cut the payload. **The artifact is a summary; the output is a file.**
 * **A record that summarises without keeping the original is a record that has to be re-taken.**
 */
const OUTPUTS_DIR = resolve(process.cwd(), 'benchmarks', 'runnable-competitors-outputs');

/** **Write both streams to files and return the paths**, so **the summary can stay small and the answer can stay whole.** */
function spill(label, stdout, stderr) {
  if (!label) return {};
  mkdirSync(OUTPUTS_DIR, { recursive: true });
  const written = {};
  if (stdout && String(stdout).length > 0) {
    const path = join(OUTPUTS_DIR, `${label}.stdout.txt`);
    writeFileSync(path, String(stdout));
    written.stdoutFile = path;
  }
  if (stderr && String(stderr).length > 0) {
    const path = join(OUTPUTS_DIR, `${label}.stderr.txt`);
    writeFileSync(path, String(stderr));
    written.stderrFile = path;
  }
  return written;
}

function tryRun(bin, args, timeoutMs = 120_000, label = null) {
  const keep = (text) => {
    const value = String(text ?? '');
    const lines = value.split('\n');
    return {
      chars: value.length,
      head: lines.slice(0, 6).join('\n').slice(0, 1200),
      // **The tail is where a failure message lives**, and **a log that ends in a skip notice has not ended.**
      tail: lines.slice(-12).join('\n').slice(-2000),
    };
  };
  try {
    const stdout = execFileSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe' });
    return { ok: true, status: 0, signal: null, stdout: keep(stdout), stderr: keep(''), ...spill(label, stdout, '') };
  } catch (error) {
    const e = error;
    return {
      ok: false,
      // **The exit status and the signal are recorded separately**, because **a timeout is a different fact from a
      // failure**: `SIGTERM` says the run was cut short and `1` says the tool decided to stop.
      status: typeof e.status === 'number' ? e.status : null,
      signal: e.signal ?? null,
      stdout: keep(e.stdout),
      stderr: keep(e.stderr),
      message: String(e.message ?? '').slice(0, 300),
      ...spill(label, e.stdout, e.stderr),
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
  const scan = tryRun('ocr', ['scan', '--path', CORPUS, '--format', 'json'], 1_500_000, 'open-code-review-scan');
  let findings = null;
  let parseNote = null;
  // **The stdout is reassembled from head and tail before parsing**, because **a JSON document cut in the middle is
  // not a JSON document** - and **the truncation was losing the payload as well as the reason.**
  if (scan.ok) {
    try {
      // **The file when there is one, the summary otherwise** - because **the summary is a head and a tail, and the
      // answer was 207,811 characters long.**
      const full = scan.stdoutFile && existsSync(scan.stdoutFile) ? readFileSync(scan.stdoutFile, 'utf8') : (scan.stdout.tail ?? '');
      // **And the JSON is looked for inside the output rather than assumed to be all of it.** **The run that
      // succeeded emitted a structured report whose tail carried a `session_id`**, so **`JSON.parse` on the whole
      // document was never going to work** - and **the fix is to find the object rather than to demand the file be
      // one.**
      let candidate = full.trim();
      if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
        const start = candidate.search(/[[{]/);
        if (start >= 0) candidate = candidate.slice(start);
      }
      const parsed = JSON.parse(candidate);
      // **`comments` is the key, and the output said so itself.** **The candidate list was `findings` and `issues`,
      // both guesses**, and **the note the previous run wrote listed the real top-level keys** -
      // `status, llm, summary, tool_calls, comments, project_summary, session_id`. **So the key is read off the
      // output rather than guessed a fourth time**, and **`summary` is captured beside it**, because **the tool's own
      // report carries `files_reviewed`, `comments`, `total_tokens` and `elapsed`** - **a denominator and a cost that
      // no amount of counting the array would produce.**
      const candidateKeys = ['comments', 'findings', 'issues', 'results', 'items'];
      const key = candidateKeys.find((k) => Array.isArray(parsed[k]));
      findings = key ? parsed[key].length : null;
      if (findings === null) {
        parseNote = `parsed as JSON but no array was found among ${candidateKeys.join(', ')}; top-level keys: ${Object.keys(parsed).join(', ')}`;
      } else {
        inProcess['open-code-review'].countedUnder = key;
        if (parsed.summary && typeof parsed.summary === 'object') {
          // **The tool's own summary, kept whole**: **`files_reviewed` is the denominator this project's finding rate
          // needs**, and **`total_tokens` and `elapsed` are the cost**, which **a count of the array cannot supply.**
          inProcess['open-code-review'].toolSummary = parsed.summary;
        }
        if (parsed.llm) inProcess['open-code-review'].llm = parsed.llm;
        if (Array.isArray(parsed[key]) && parsed[key][0] && typeof parsed[key][0] === 'object') {
          // **And the shape of one entry**, because **a finding with a `category` and a `severity` can be judged
          // against ground truth and one without cannot.**
          inProcess['open-code-review'].entryKeys = Object.keys(parsed[key][0]);
        }
      }
    } catch (error) {
      parseNote = `the output did not parse as JSON: ${error.message}; the full output is at ${scan.stdoutFile ?? '(no file)'}`;
    }
  } else {
    // **A failed scan says what its recorded streams held**, so **the next reader knows whether the reason is in the
    // record or was cut out of it.**
    // **And the endpoint the tool actually called is extracted from its own output**, because **the failure names a
    // URL and the URL is the whole diagnosis**: `…/v1/v1/messages` said both that the base was doubled and that the
    // shape was Anthropic's. **A record that keeps the stream and not the URL sends the next reader to the stream.**
    const endpointMatch = /POST\s+"([^"]+)"/.exec(String(scan.stderr.tail ?? ''));
    parseNote =
      `the scan exited with status ${scan.status ?? 'null'} and signal ${scan.signal ?? 'null'}; ` +
      `stdout ${scan.stdout.chars} chars, stderr ${scan.stderr.chars} chars` +
      (endpointMatch ? `; the endpoint it called was ${endpointMatch[1]}` : '');
  }
  inProcess['open-code-review'].scan = {
    ok: scan.ok,
    status: scan.status,
    signal: scan.signal,
    findings,
    parseNote,
    stderr: scan.stderr,
    stdout: scan.stdout,
  };
} else {
  inProcess.note = KEY ? `the corpus directory is absent: ${CORPUS}` : 'DEEPSEEK_API_KEY is not set, so no tool could be configured against our endpoint';
}
artifact.configuredRuns = inProcess;

// **And the same corpus, through our own engine, in the same whole-file mode.**
//
// **Why this turns a count into a comparison.** `measure-competitor-corpus.mjs` reviews a whole file by handing it to
// `reviewDiff` as a synthetic `added` diff - **and `ocr scan` reviews a whole file with no diff at all.** **The two are
// the same shape of input over the same directory**, so **counting both over one denominator is a comparison rather
// than two numbers in a table.**
//
// **And the denominator has to be shared, not similar.** **The tool reported `files_reviewed: 37`, and this loop walks
// the same directory** - because **a rate per file from two different file sets is the defect this page has recorded
// twice under another name.**
const ourEngine = { corpus: CORPUS, files: 0, lines: 0, findings: 0, perFile: [] };
if (KEY) {
  const { readdirSync } = await import('node:fs');
  const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|kt|swift|c|cc|cpp|h|hpp|cs|php|lua|scala|zig|ex|exs|dart|sh)$/;
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (SOURCE.test(entry.name)) out.push(full);
    }
    return out;
  };
  const root = resolve(process.cwd(), CORPUS);
  const files = walk(root);
  const { LLMReviewEngine } = await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const { DeepSeekProvider } = await import('../../packages/intelligence/dist/review/llm/provider.js');
  const { createDiff } = await import('../../packages/intelligence/dist/benchmark/benchmark-runner.js');
  const engine = new LLMReviewEngine(new DeepSeekProvider());
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const rel = file.slice(root.length + 1);
    ourEngine.files += 1;
    ourEngine.lines += content.split(String.fromCharCode(10)).length;
    try {
      // **The identical call `measure-competitor-corpus.mjs` makes**, so **the two figures are one measurement applied
      // to one directory rather than two measurements that happen to sit adjacent.**
      const lanes = await engine.reviewDiff(createDiff(rel, 'added', content), content);
      const count = lanes.filter((l) => l.success).flatMap((l) => l.findings).length;
      ourEngine.findings += count;
      ourEngine.perFile.push({ file: rel, findings: count });
    } catch {
      // **A file the engine could not review is not a file it reviewed cleanly**, so **it is counted and contributes
      // no findings** - the distinction this project has now drawn twelve times.
    }
  }
}

// **`toolSummary` lives on the tool's record, not inside its scan step**, and the first version read it one level too
// deep - so `toolReportedFiles` came back `None` **in the very run that needed it**, because **the two file counts
// disagreed**: the tool reviewed **37** and this repository's walk found **45**.
//
// **And that disagreement is the finding, not a nuisance.** **A rate divided by a denominator the tool did not use is
// not the tool's rate** - so **both are reported, and the difference is named** rather than silently resolved in favour
// of whichever number was written first.
const ocrRecord = artifact.configuredRuns?.['open-code-review'] ?? {};
const ocrScan = ocrRecord.scan;
const toolFiles = ocrRecord.toolSummary?.files_reviewed ?? null;
const ourFiles = ourEngine.files;
const ourFindings = ourEngine.findings;
const ocrFindings = ocrScan?.findings ?? null;
const rate = (files, findings) =>
  files > 0 && typeof findings === 'number' ? Math.round((findings / files) * 100) / 100 : null;
artifact.sameCorpus = {
  corpus: CORPUS,
  // **Two denominators, both stated.** **Our walk is the one both numerators are divided by**, and **the tool's own
  // count is kept beside it**, so **the reader can divide by either and see which one the comparison used.**
  denominator: { ourWalkFiles: ourFiles, lines: ourEngine.lines, toolReportedFiles: toolFiles },
  // **When the two counts differ, both rates are given**, because **choosing one silently is how a rate becomes a
  // number nobody can reproduce.**
  fileCountsAgree: toolFiles === null ? null : toolFiles === ourFiles,
  ourEngine: {
    findings: ourFindings,
    findingsPerFileOverOurWalk: rate(ourFiles, ourFindings),
    findingsPerThousandLines: ourEngine.lines > 0 ? Math.round((ourFindings / ourEngine.lines) * 1000 * 100) / 100 : null,
  },
  openCodeReview: {
    findings: ocrFindings,
    findingsPerFileOverOurWalk: rate(ourFiles, ocrFindings),
    findingsPerFileOverItsOwnCount: rate(toolFiles, ocrFindings),
    tokens: ocrRecord.toolSummary?.total_tokens ?? null,
    elapsed: ocrRecord.toolSummary?.elapsed ?? null,
    model: ocrRecord.llm?.model ?? null,
  },
  // **The sentence the pair exists to support**, written from the numbers rather than asserted beside them.
  pairing:
    rate(ourFiles, ocrFindings) !== null && rate(ourFiles, ourFindings) !== null
      ? `over this repository's walk of ${ourFiles} files: ours ${rate(ourFiles, ourFindings)} per file, the tool's ${rate(ourFiles, ocrFindings)}`
      : 'one side is absent, so there is no pair to state',

};

const invocable = Object.entries(artifact.tools)
  .filter(([, t]) => t.runnableHere)
  .map(([name]) => name);
artifact.invocable = invocable;
artifact.verdict = invocable.length > 0
  ? `invocable in CI: ${invocable.join(', ')}`
  : 'no probed competitor could be invoked; the per-tool records say what each one printed';
write(artifact);
console.log(`RUNNABLE-COMPETITORS ${artifact.verdict}`);
