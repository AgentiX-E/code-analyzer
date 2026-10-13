// The corpus a direct competitor published, judged by us and by them.
//
// **Why this one, ahead of the others on the audit's list.** `Alibaba-Aone/aacr-bench` is **the one public corpus that
// measures what our distinctive claim claims**: **200 real pull requests across 10 languages, 1,505 expert-confirmed
// issues, three context levels - and the third is `Repo Level`, which is cross-file by construction.** **Their
// dataset card also ships `negative_samples.json`, 640 invalid comments, which means it can compute a noise rate** -
// **and the noise rate is the axis our own competitor-corpus job could only measure as a denominator.**
//
// **And the correction that belongs in this file rather than in a footnote.** **Alibaba built both the tool and the
// benchmark it wins on**, which an independent party stated plainly: *"an instrument that agrees with itself is not
// evidence."* **Their own reported absolute precision is 33.9%** - so **even their winner is wrong two times in
// three**, and **their 33.90% against 7.23% gap and their 9x token claim are their measurements on their corpus.**
// **This job therefore reports our numbers on that corpus and states that the comparison is against a
// self-published figure rather than against a run we performed**, which is **the same distinction the whole stretch
// has been about.**
//
// **And what it cannot do, said before it is run.** **Their README's claim is OCR against Claude Code on the same
// base model** - **two review systems, one model.** **Our engine is a third review system**, so **a row for us is a
// third column and not a re-run of theirs**, and **the artifact says which columns were produced here.**

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BENCH = process.env['AACR_DIR'] ?? '/tmp/aacr-bench';
const TOOL = process.env['MARTIAN_TOOL'] ?? 'agentix-e';
const MODEL = process.env['AACR_JUDGE_MODEL'] ?? process.env['MARTIAN_MODEL'] ?? 'deepseek-chat';
const BASE = process.env['AACR_JUDGE_BASE'] ?? process.env['MARTIAN_BASE_URL'] ?? 'https://api.deepseek.com/v1';
const KEY = process.env['AACR_JUDGE_KEY'] ?? process.env['MARTIAN_API_KEY'] ?? process.env['DEEPSEEK_API_KEY'];
const MAX_PRS = Number(process.env['MAX_PRS'] ?? '5');

function findSamples(name) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === name) hits.push(full);
    }
  };
  walk(BENCH, 0);
  return hits[0] ?? null;
}

/** Their judge prompt, reconstructed from their paper's description: same defect, different words is a match. */
async function judge(comment, golden) {
  const prompt = [
    'You are comparing a code review comment against an expert-confirmed issue from the same pull request.',
    'Answer with one JSON object: {"match": true|false}.',
    'They match when they describe the same underlying defect, even in different words.',
    '',
    `Expert-confirmed issue:\n${golden}`,
    '',
    `Review comment:\n${comment}`,
  ].join('\n');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          messages: [
            { role: 'system', content: 'You compare code review statements. Reply with JSON only.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = await res.json();
      const text = String(body.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim();
      return Boolean(JSON.parse(text).match);
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  // **A judge that did not answer is not a non-match**, the same distinction as everywhere else in this repository.
  return null;
}

async function main() {
  const base = {
    comment: [
      'Our review engine on AACR-Bench, the corpus a direct competitor published.',
      '',
      '**Why this corpus**: 200 real PRs, 10 languages, 1,505 expert-confirmed issues and **three context levels, the',
      'third of which is Repo Level** - so **it measures cross-file behaviour, which is our distinctive claim**.',
      '',
      '**And the caveat that belongs in the artifact**: **Alibaba built both the tool and the benchmark it wins on**,',
      'and an independent party said so - *"an instrument that agrees with itself is not evidence."* **Their reported',
      'absolute precision is 33.9%**, so **their 33.90-versus-7.23 gap and their 9x token claim are their measurements',
      'on their corpus, not runs reproduced here.**',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    corpus: 'Alibaba-Aone/aacr-bench (Apache-2.0, public on Hugging Face)',
    judge: { model: MODEL, endpoint: BASE },
    route: 'our engine reading each PR diff; no bot account installed',
    comparisonBasis: 'their published figures, not a run we performed',
  };

  const positive = findSamples('positive_samples.json');
  const negative = findSamples('negative_samples.json');
  if (!positive) {
    write({ ...base, skipped: { reason: 'positive_samples.json was not found; clone alibaba/aacr-bench' } });
    console.log('AACR-BENCH skipped: dataset not found');
    return;
  }
  if (!KEY) {
    write({ ...base, skipped: { reason: 'no judge credential configured' } });
    console.log('AACR-BENCH skipped: no judge credential');
    return;
  }

  // **Their real schema, read from `claude-code-demo/utils/model.py` rather than guessed.** `PRDataItem` carries
  // `githubPrUrl`, `source_commit`, `target_commit` and `comments[]`; a `Comment` carries `note` (the text), `path`,
  // `from_line`/`to_line`, `category` and `context`. **And the dataset holds no diff** - so this job fetches each PR
  // from GitHub, which **is what their own demo does** and **why the input is a URL rather than a patch.**
  const positives = JSON.parse(readFileSync(positive, 'utf8'));
  const negatives = negative && existsSync(negative) ? JSON.parse(readFileSync(negative, 'utf8')) : [];
  const rows = (Array.isArray(positives) ? positives : Object.values(positives)).slice(0, MAX_PRS);

  // **And a second reviewer, on the same ground truth, with the same judge.**
  //
  // **Why this is the step that turns a volume figure into a correctness one.** Everything measured so far in this
  // comparison has been a **count** - findings per file, comments per commit - and **a count cannot rank a reviewer**,
  // because **a tool that says everything and a tool that says only true things produce the same kind of number.**
  // **AACR-Bench supplies ground truth**, so **running a competitor on it produces an F1 that can be placed beside this
  // repository's 0.0377 on the same 1,505 annotated issues.**
  //
  // **And the mechanics are its own documented ones**: the dataset names `githubPrUrl`, `source_commit` and
  // `target_commit`, so **a checkout at those two commits is what its `review --from --to` needs** - **the same
  // three fields this repository already reads to fetch the diff.**
  const YOU_FILES = { enabled: false };
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  /**
   * `owner/repo` from a pull request URL.
   *
   * **Split rather than matched.** The first version used a regular expression, and **the `/` inside `[^/]` ended the
   * literal early** - `SyntaxError: Unexpected token '^'` - which is **the twelfth time in this stretch that a quoted
   * pattern met text it was not written for.** **A URL has a fixed shape and `split` states that shape without an
   * escape**: `https://github.com/owner/repo/pull/123` is **five `/`-separated pieces from the scheme onward**.
   */
  const shortRepo = (url) => {
    const parts = String(url ?? '').split('/');
    const at = parts.indexOf('github.com');
    return at >= 0 && parts.length > at + 2 ? `${parts[at + 1]}/${parts[at + 2]}` : null;
  };

  const { createDiff } = await import('../../packages/intelligence/dist/benchmark/benchmark-runner.js');
  /**
   * Run a competitor over one labelled pull request, and return its findings as text.
   *
   * **This function was deleted by the edit that replaced `shortRepo`**, because **it sat between that edit's two
   * markers** - **the thirteenth time in this stretch that a bulk edit matched text it was not written for, and the
   * first time it removed a definition rather than changing one.** **The job said so in one line** -
   * `AACR-BENCH failed: reviewWithOcr is not defined` - **which is what a missing binding reports.**
   *
   * **A checkout of two commits and `review --from --to`**, because **that is the interface its own documentation names
   * for a local review of a range** - and **the checkout is shallow and temporary**, because **the corpus is 200 pull
   * requests** and **a full clone per pull request is a cost this job would pay 200 times for history it never reads.**
   */
  const reviewWithOcr = (endpoint, key, url, source, target) => {
    const repo = shortRepo(url);
    if (!repo) return { ok: false, reason: 'the pull request URL did not name a repository' };
    const dir = mkdtempSync(`${tmpdir()}/ocr-`);
    try {
      // **The two commits have to share a history, and the first version made sure they did not.**
      //
      // **What the tool said, once `firstFailure` was carrying a sentence rather than nothing**:
      //
      //     [ocr] Summary: 0 file(s) reviewed, 0 comment(s), ~0 token(s) used, 0s elapsed
      //     Review failed (input): 0 finding(s); 0 of 0 selected item(s) failed.
      //
      // **`0 file(s) reviewed` and `0 of 0 selected item(s)` is a range it could not resolve** - because **two
      // independent `--depth 1` fetches produce a repository with two root commits and no merge base**, so
      // **`--from A --to B` had nothing between them.**
      //
      // **So the history is fetched without its blobs**, which is **the one shape that gives a merge base cheaply**:
      // **`--filter=blob:none` downloads every commit and no file contents**, and **the checkout then fetches only the
      // blobs that commit needs.** **A shallow fetch was cheaper and wrong; this is cheap and right.**
      execFileSync('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', `https://github.com/${repo}.git`, dir], {
        stdio: 'pipe',
        timeout: 600_000,
      });
      execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin', source, target], { stdio: 'pipe', timeout: 300_000 });
      execFileSync('git', ['-C', dir, 'checkout', '-q', target], { stdio: 'pipe', timeout: 300_000 });
      // **`--json` is for `scan` and not for `review`, and the field said so.**
      //
      // **`firstFailure` reported `Error: unknown flag: --json` on the first run after it was fixed** - **which is what
      // a repaired reason field buys**: **the next iteration gets a sentence instead of a guess.** **`scan --json`
      // works, because that is where this project already succeeded**; **`review` does not take it.**
      //
      // **And the default output is kept rather than parsed blind**, because **the shape of `review`'s output has not
      // been seen yet** - **so the raw text travels in the artifact, and the next iteration reads the shape instead of
      // assuming one**, which is **the fifth time in this stretch that a shape was learned rather than guessed.**
      const stdout = execFileSync('ocr', ['review', '--from', source, '--to', target], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000,
        env: { ...process.env, OCR_LLM_URL: endpoint, OCR_LLM_TOKEN: key },
      });
      return { ok: true, stdout };
    } catch (error) {
      // **Both streams, because the reason can be in either.** **A tool that fails silently on stdout and explains
      // itself on stderr is the common case**, and **the first version read only the first of the two.**
      const out = String(error.stdout ?? '').trim();
      const err = String(error.stderr ?? '').trim();
      const message = String(error.message ?? '').trim();
      const reason = out || err || message || '';
      return {
        ok: false,
        reason: reason.slice(0, 600),
        status: typeof error.status === 'number' ? error.status : null,
        signal: error.signal ?? null,
      };
    }
  };

  const { LLMReviewEngine } = await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const { DeepSeekProvider } = await import('../../packages/intelligence/dist/review/llm/provider.js');
  const engine = new LLMReviewEngine(new DeepSeekProvider());

  /**
   * **The second parameter of every draw this job takes.**
   *
   * **Why a credit reading belongs in the artifact.** **Five runs of this script on one corpus produced F1 values of
   * 0.0377, 0, 0.1724, 0.037 and 0**, and **the run that got furthest reported `402 Payment Required` with
   * `Insufficient Balance`** - so **the engine, the judge and the competitor all spend from one key**, and **a balance
   * that runs out mid-run lowers recall in a way indistinguishable from a worse reviewer.**
   *
   * **`GET /user/balance` is the provider's own reading of that**, so **it is taken before the loop and after it**,
   * and **both are stored** - because **a figure that moved while the account moved is a figure with a second
   * parameter, and the parameter belongs in the same file as the figure.**
   */
  const creditPosition = async () => {
    const key = process.env['DEEPSEEK_API_KEY'] ?? process.env['MARTIAN_API_KEY'] ?? '';
    if (!key) return { probed: false, reason: 'no key in the environment' };
    try {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // **A balance endpoint that refuses is itself the reading** - `402` here means the same thing it means on a
        // completion call, and **it arrives before any work is done**.
        return { probed: true, ok: false, status: response.status, body: body.slice(0, 240) };
      }
      const payload = await response.json();
      const info = Array.isArray(payload?.balance_infos) ? payload.balance_infos[0] : null;
      return {
        probed: true,
        ok: true,
        isAvailable: payload?.is_available ?? null,
        currency: info?.currency ?? null,
        totalBalance: info?.total_balance ?? null,
        grantedBalance: info?.granted_balance ?? null,
        toppedUpBalance: info?.topped_up_balance ?? null,
      };
    } catch (error) {
      return { probed: true, ok: false, reason: String(error.message ?? '').slice(0, 240) };
    }
  };

  const creditBefore = await creditPosition();
  console.log(`AACR-BENCH credit before: ${JSON.stringify(creditBefore).slice(0, 200)}`);

  const ocrKey = process.env['OCR_LLM_TOKEN'] ?? process.env['DEEPSEEK_API_KEY'] ?? '';
  const competitor = {
    tool: 'open-code-review',
    prsAttempted: 0,
    prsFailed: 0,
    firstFailure: null,
    findings: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    judgeUnanswered: 0,
    // **The shape and size of its output, and the head of it when it will not parse** - because **a reviewer that
    // spoke and was not understood is a fact worth keeping**, the same distinction as `prsFailed`.
    outputKeys: null,
    outputChars: null,
    firstOutputHead: null,
    // **A provider that refused for want of credit is a fact about the account, not about the reviewer** - and **it is
    // the one failure class that also explains a variance in this repository's own numbers.**
    creditExhausted: false,
  };
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let unanswered = 0;
  let reviewed = 0;
  let unfetched = 0;
  const categories = {};
  const contextLevels = {};

  /** The pull request's unified diff, through the API, because **the corpus stores a URL and not a patch.** */
  async function fetchPrDiff(url) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(url ?? ''));
    if (!m) return null;
    const [, owner, repo, num] = m;
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? '';
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
        headers: {
          accept: 'application/vnd.github.v3.diff',
          'user-agent': 'agentix-e-aacr-bench',
          ...(token ? { authorization: `token ${token}` } : {}),
        },
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  for (const pr of rows) {
    // **Their field names, and the diff fetched rather than read from the corpus.** **A PR whose diff cannot be
    // fetched is counted separately and not skipped quietly**, because **"the corpus had no data for it" and "we could
    // not read it" are different facts** - the distinction this repository keeps drawing.
    const comments = pr.comments ?? [];
    const issueTexts = comments.map((c) => String(c.note ?? '')).filter(Boolean);
    const diff = await fetchPrDiff(pr.githubPrUrl);
    if (diff === null) {
      unfetched += 1;
      continue;
    }
    // **The competitor, on this pull request, judged by the same judge against the same goldens.**
    //
    // **And its findings are extracted the way its own output shapes them** - a `comments` array carrying `content` and
    // `path` - because **the key was learned from a previous run rather than assumed**, and **an extractor that guesses
    // returns an empty list that reads as a silent reviewer.**
    if (ocrKey) {
      const outcome = reviewWithOcr(
        process.env['OCR_LLM_URL'] ?? '',
        ocrKey,
        pr.githubPrUrl,
        pr.source_commit,
        pr.target_commit,
      );
      competitor.prsAttempted += 1;
      if (!outcome.ok) {
        competitor.prsFailed += 1;
        // **A failure with an empty reason is a failure this file has already seen.**
        //
        // **The first version recorded the reason only when it was the first failure AND the field was `null`**, and
        // **the run that installed the tool reported `firstFailure: ""`** - **an empty string, not a null** - so
        // **the reason was lost at the one moment it mattered.** **An empty reason reads exactly like no reason**, and
        // **the difference between "it did not run" and "it did not run and here is why" is the whole value of the
        // field.**
        //
        // **So the guard is on the content rather than on the sentinel**, and **the raw stderr is the fallback**,
        // because **`spawnSync ocr ENOENT` arrived in a field named `reason` and a lower-case message arrived in
        // neither.**
        const raw = typeof outcome.reason === 'string' ? outcome.reason.trim() : '';
        // **And one class of failure is not about the tool at all.**
        //
        // **What the run that got furthest reported**:
        //
        //     [ocr] 35 file(s) changed, reviewing 35
        //     [ocr] LLM grouping failed (POST "https://api.deepseek.com/anthropic/v1/messages":
        //           402 Payment Required {"error":{"message":"Insufficient Balance"}})
        //
        // **The range resolved, the endpoint was accepted, and the provider refused the call for want of credit.**
        // **That is a fact about the account rather than about the reviewer**, and **it is also the likeliest
        // explanation for this repository's own AACR figure moving between 0 and 0.1724 across four runs on one corpus
        // and one script** - because **our engine and the judge spend from the same key.**
        //
        // **So it is named rather than folded into a generic sentence**, because **a run that had credit and a run
        // that did not produce the same zero and mean different things** - **the same distinction `prsFailed` draws one
        // level up.**
        const creditFailure = /402|Insufficient Balance|Payment Required/i.test(raw);
        const reason = creditFailure
          ? `the provider refused the call for want of credit: ${raw.slice(0, 300)}`
          : raw !== ''
            ? raw
            : '(the tool reported a failure with no message)';
        if (creditFailure) competitor.creditExhausted = true;
        if (!competitor.firstFailure || competitor.firstFailure === '(the tool reported a failure with no message)') {
          competitor.firstFailure = reason;
        }
      } else {
        try {
          // **The output is looked at before it is parsed**, because **its shape has not been seen** - **the same
          // lesson `scan` taught when the array turned out to be `comments` rather than `findings`.**
          const text = String(outcome.stdout).trim();
          // **Its logging and its JSON share one stream, and the first character of a log line is `[`.**
          //
          // **What the previous run printed**: `its output did not parse: Unexpected token 'o', "[ocr] 35 fi"` -
          // **the locator found the `[` of `[ocr]` and started parsing a log line.** **`35 file(s) changed, reviewing
          // 35` is in the same string**, which is **how the range was known to have resolved** - **so the evidence and
          // the bug were one line apart.**
          //
          // **So the log lines are removed before the JSON is located**, and **only lines that do not start with the
          // tool's own prefix are considered** - **a filter on the writer rather than a search for a bracket.**
          // **And a second prefix, because the tool has two - and the first attempt at this condition was wrong.**
          //
          // **The run with credit reported**: `its output did not parse: Unexpected token 'b', "[bug · high"` -
          // **a review's findings begin with `[bug`, severity-tagged** - while **the first filter removed only
          // `[ocr]` lines.**
          //
          // **And the second attempt was wrong in a way that reading it once would have caught.** It measured
          // "where does a brace appear" with `search(/[{[]/)`, which **on `[ocr]` matches the `[` at position zero** -
          // **the same bracket being tested** - so the comparison came out false and **every heading was kept.**
          //
          // **So the rule is stated as what a heading is rather than as where a bracket is**: **a line is a heading
          // when it opens a bracket, the closing bracket arrives within eighty characters, and there is no `{` before
          // it.** **That last clause is what keeps a JSON document** - `[{"path": …}]` **has a `{` inside its first
          // bracket and therefore survives.**
          const isHeading = (line) => {
            const match = /^\s*\[([^\]]{0,80})\]/.exec(line);
            return match !== null && !match[1].includes('{');
          };
          const body = text
            .split(String.fromCharCode(10))
            .filter((line) => !isHeading(line))
            .join(String.fromCharCode(10))
            .trim();
          const start = body.search(/[[{]/);
          const parsed = JSON.parse(start >= 0 ? body.slice(start) : body);
          const list = Array.isArray(parsed)
            ? parsed
            : (parsed.comments ?? parsed.findings ?? parsed.issues ?? parsed.results ?? []);
          competitor.outputKeys = Array.isArray(parsed) ? ['(array)'] : Object.keys(parsed).slice(0, 12);
          competitor.outputChars = text.length;
          // **And how many lines the tool wrote outside its JSON**, because **a stream that mixes two formats is a fact
          // about the tool** and **a parse that succeeds does not say how close it came to failing.**
          competitor.logLines = text.split(String.fromCharCode(10)).length - body.split(String.fromCharCode(10)).length;
          competitor.findings += list.length;
          // **Each competitor comment is judged once against the goldens**, with the same judge and the same prompt our
          // own findings get - so **the two F1 values below are one measurement applied to two reviewers.**
          const matchedByCompetitor = new Set();
          for (const entry of list) {
            const text = typeof entry === 'string' ? entry : String(entry.content ?? entry.body ?? '');
            if (!text) continue;
            for (let g = 0; g < issueTexts.length; g += 1) {
              if (matchedByCompetitor.has(g)) continue;
              const verdict = await judge(text, issueTexts[g]);
              if (verdict === null) competitor.judgeUnanswered += 1;
              else if (verdict) {
                matchedByCompetitor.add(g);
                break;
              }
            }
          }
          competitor.truePositives += matchedByCompetitor.size;
          competitor.falseNegatives += issueTexts.length - matchedByCompetitor.size;
          competitor.falsePositives += Math.max(0, list.length - matchedByCompetitor.size);
        } catch (error) {
          competitor.prsFailed += 1;
          // **The head of the output is kept when it cannot be parsed**, because **the shape is what the next
          // iteration needs and the message alone does not carry it.**
          competitor.firstOutputHead = String(outcome.stdout ?? '').slice(0, 600);
          const reason = `its output did not parse: ${error.message}`;
          if (!competitor.firstFailure) competitor.firstFailure = reason;
        }
      }
    }

    const firstPath = String(comments[0]?.path ?? 'unknown');
    // **`createDiff` and not a hand-made object.** The first version passed `{ filePath, changeType, content }`, and
    // the engine read `diff.ranges` - which a plain object does not have - so **the job failed with
    // `diff.ranges is not iterable`** and **the failure named the engine rather than the caller.** **Every other
    // script in this directory builds its input through `createDiff`**, which is what made the difference visible:
    // **`createDiff(path, changeType, content)` is the contract, and a shape that looks like it is not it.**
    const lanes = await engine.reviewDiff(createDiff(firstPath, 'added', diff), diff);
    const findings = lanes.filter((l) => l.success).flatMap((l) => l.findings);
    reviewed += 1;
    // **Their two context dimensions are recorded per PR**, because **a `Repo Level` issue needs the repository and a
    // `Diff Level` one does not** - and **that is the axis this corpus was chosen for.**
    for (const c of comments) {
      const ctx = String(c.context ?? 'unknown');
      contextLevels[ctx] = (contextLevels[ctx] ?? 0) + 1;
      const cat = String(c.category ?? 'unknown');
      categories[cat] = (categories[cat] ?? 0) + 1;
    }

    const matched = new Set();
    for (const f of findings) {
      let hit = false;
      for (let i = 0; i < issueTexts.length; i += 1) {
        if (matched.has(i)) continue;
        const verdict = await judge(String(f.title ?? '') + ' :: ' + String(f.description ?? ''), issueTexts[i]);
        if (verdict === null) unanswered += 1;
        else if (verdict) {
          matched.add(i);
          hit = true;
          break;
        }
      }
      if (!hit) fp += 1;
    }
    tp += matched.size;
    fn += issueTexts.length - matched.size;
  }

  const p = tp + fp > 0 ? tp / (tp + fp) : 0;
  const r = tp + fn > 0 ? tp / (tp + fn) : 0;
  const round = (x) => Math.round(x * 10000) / 10000;
  write({
    ...base,
    prsInDataset: rows.length,
    prsReviewed: reviewed,
    prsWithoutDiff: unfetched,
    positiveSamples: positives.length ?? rows.length,
    negativeSamples: Array.isArray(negatives) ? negatives.length : null,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    judgeUnanswered: unanswered,
    precision: round(p),
    recall: round(r),
    f1: round(p + r > 0 ? (2 * p * r) / (p + r) : 0),
    reviewCategories: categories,
    // **The context split, which is the reason this corpus was chosen**: `Repo Level` is cross-file by construction.
    groundTruthContextLevels: contextLevels,
    // **The competitor's F1, computed with the same formula over the same goldens** - so **the two numbers are
    // comparable because they were produced by one measurement, not because they were printed side by side.**
    secondReviewer: {
      ...competitor,
      precision: round(competitor.truePositives + competitor.falsePositives > 0 ? competitor.truePositives / (competitor.truePositives + competitor.falsePositives) : 0),
      recall: round(competitor.truePositives + competitor.falseNegatives > 0 ? competitor.truePositives / (competitor.truePositives + competitor.falseNegatives) : 0),
      f1: round(
        competitor.truePositives + competitor.falsePositives + competitor.falseNegatives > 0
          ? (2 * competitor.truePositives) /
            (2 * competitor.truePositives + competitor.falsePositives + competitor.falseNegatives)
          : 0,
      ),
    },
    // **And the reading after the loop**, so **what the run spent is derivable** and **a draw taken on an empty
    // account is labelled rather than reported as a reviewer's result.**
    credit: { before: creditBefore, after: await creditPosition() },
    skipped: null,
  });
  console.log(`AACR-BENCH reviewed ${reviewed} PRs · tp ${tp} fp ${fp} fn ${fn} · P ${round(p)} R ${round(r)}`);
  console.log(`AACR-BENCH competitor ${competitor.tool} · findings ${competitor.findings} · tp ${competitor.truePositives} fp ${competitor.falsePositives} fn ${competitor.falseNegatives}`);
}

function write(payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(resolve(process.cwd(), 'benchmarks', 'aacr-bench.json'), JSON.stringify(payload, null, 2) + '\n');
}

main().catch((error) => {
  console.error('AACR-BENCH failed:', error && error.message);
  process.exit(1);
});
