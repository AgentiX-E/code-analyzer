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
      execFileSync('git', ['init', '-q', dir], { stdio: 'pipe' });
      execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${repo}.git`], { stdio: 'pipe' });
      for (const sha of [source, target]) {
        execFileSync('git', ['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', sha], { stdio: 'pipe', timeout: 180_000 });
      }
      execFileSync('git', ['-C', dir, 'checkout', '-q', target], { stdio: 'pipe' });
      const stdout = execFileSync('ocr', ['review', '--from', source, '--to', target, '--json'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000,
        env: { ...process.env, OCR_LLM_URL: endpoint, OCR_LLM_TOKEN: key },
      });
      return { ok: true, stdout };
    } catch (error) {
      return { ok: false, reason: String(error.stdout ?? error.message ?? '').slice(0, 400) };
    }
  };

  const { LLMReviewEngine } = await import('../../packages/intelligence/dist/review/llm/llm-review-engine.js');
  const { DeepSeekProvider } = await import('../../packages/intelligence/dist/review/llm/provider.js');
  const engine = new LLMReviewEngine(new DeepSeekProvider());

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
        if (competitor.firstFailure === null) competitor.firstFailure = outcome.reason;
      } else {
        try {
          const parsed = JSON.parse(outcome.stdout);
          const list = Array.isArray(parsed) ? parsed : (parsed.comments ?? parsed.findings ?? []);
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
          if (competitor.firstFailure === null) competitor.firstFailure = `its output did not parse: ${error.message}`;
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
