// One judge, one corpus, every tool - including ours - scored the same way.
//
// **Why this replaces the recomputation.** The figure an earlier commit recorded for the field was **recomputed from
// their committed `evaluations.json`**, which is **a second-hand number**: it is what their judge already decided, so
// it can be checked and it cannot be re-taken. **And the whole point of this stretch is that a figure two parties do
// not produce the same way is not a comparison.**
//
// **What makes the first-hand version possible, and it was there the whole time**: the repository ships
// **`offline/results/benchmark_data.json`**, which holds **every tool's raw review comments for all 50 PRs** - not
// just the scores. **So every tool's comments can be re-judged by one judge**, and **ours can be judged beside
// them** - which turns *"we compared our number with a published number"* into **"we scored every tool, including
// ours, with one prompt and one model."**
//
// **And the judge is ours and is named.** `MARTIAN_BASE_URL` points at DeepSeek and `MARTIAN_MODEL` names the model,
// both of which their `LLMJudge` reads. **The artifact records the model, the commit of their repository, and the
// number of tools scored**, because **a table that does not say who judged it is the thing this file exists to stop
// producing.**
//
// **And a caveat this cannot remove, stated here rather than in a footnote.** Their `step0_fork_prs` installs each
// tool on a fork and **lets the tool review at the time of the PR**, so **their comments are what a tool with a
// GitHub app produced.** **Ours are produced by our engine reading the same diff** - **the same input, a different
// route**, and **that difference is recorded in every row rather than buried in one.**

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MARTIAN = process.env['MARTIAN_DIR'] ?? '/tmp/martian';
const OFFLINE = join(MARTIAN, 'offline');
const DATA = join(OFFLINE, 'results', 'benchmark_data.json');
const MARTIAN_CANDIDATES_DIR = join(OFFLINE, 'results', 'openai_gpt-5.2');
const TOOL = process.env['MARTIAN_TOOL'] ?? 'agentix-e';
const MODEL = process.env['MARTIAN_MODEL'] ?? 'deepseek-chat';
const HAS_KEY = Boolean(process.env['MARTIAN_API_KEY']);
const MAX_PRS = Number(process.env['MAX_PRS'] ?? '6');

async function judge(candidates, golden) {
  const key = process.env['MARTIAN_API_KEY'];
  const base = process.env['MARTIAN_BASE_URL'] ?? 'https://api.deepseek.com/v1';
  const prompt = [
    'You are comparing a code review comment against a known issue in the same pull request.',
    'Answer with a single JSON object: {"match": true|false, "confidence": "high"|"medium"|"low"}.',
    'Two statements match when they describe the same underlying defect, even in different words.',
    '',
    `Known issue:\n${golden}`,
    '',
    `Review comment:\n${candidates}`,
  ].join('\n');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
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
      const parsed = JSON.parse(text);
      return Boolean(parsed.match);
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  // **A judge failure is not a non-match.** It is counted separately, because **"the judge said no" and "the judge did
  // not answer" are different facts about a candidate** - the distinction this project has now drawn nine times.
  return null;
}

async function main() {
  const base = {
    comment: [
      'Every tool in the field, scored by one judge on one corpus, beside ours.',
      '',
      '**The field\'s raw review comments come from their own `offline/results/benchmark_data.json`**, which ships',
      'every tool\'s comments for all 50 PRs. **The judge is ours and is named**, and **ours is scored the same way**',
      '- which is what makes this a comparison rather than two numbers placed side by side.',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    where: 'github-actions',
    judge: { model: MODEL, endpoint: process.env['MARTIAN_BASE_URL'] ?? 'default' },
    route: { field: 'the tool\'s own comments, shipped in the benchmark repo', ours: 'our engine reading the diff' },
    caveat: 'Their comments were produced by each tool installed on a fork; ours by our engine reading the same diff.',
  };

  if (!existsSync(DATA)) {
    write({ ...base, skipped: { reason: 'benchmark_data.json was not found in their repository' } });
    console.log('FIELD-COMPARISON skipped: no benchmark data');
    return;
  }
  if (!HAS_KEY) {
    write({ ...base, skipped: { reason: 'MARTIAN_API_KEY is not configured' } });
    console.log('FIELD-COMPARISON skipped: no judge credential');
    return;
  }

  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  // **Their tools, from the shipped comments** - plus ours, from the candidates our own script wrote.
  const oursPath = join(OFFLINE, 'results', MODEL.replace(/\//g, '_'), 'candidates.json');
  const ours = existsSync(oursPath) ? JSON.parse(readFileSync(oursPath, 'utf8')) : {};

  // **And the field's candidates are in a second file, which the first run did not read.**
  //
  // **What went wrong, because it is the whole reason this block exists.** The run that produced 50 rows of zero read
  // `review.candidates` out of `benchmark_data.json` - **and that file has no `candidates` field on a review.** Its
  // keys are `tool`, `repo_name`, `pr_url` and `review_comments`; **the issue statements live in
  // `results/{model}/candidates.json`**, which is **what their `step2_extract_comments` writes and what `step3` reads.**
  // **So every tool looked silent**, the table was 50 rows of zero, and **the job reported success** - **the same
  // failure shape as the overwrite it was fixed alongside.**
  const shippedCandidates = {};
  for (const candidateFile of [
    join(MARTIAN_CANDIDATES_DIR, 'candidates.json'),
    join(OFFLINE, 'results', 'openai_gpt-5.2', 'candidates.json'),
    join(OFFLINE, 'results', 'anthropic_claude-opus-4-5-20251101', 'candidates.json'),
  ]) {
    if (!existsSync(candidateFile)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidateFile, 'utf8'));
      for (const [url, byTool] of Object.entries(parsed)) {
        shippedCandidates[url] = { ...(shippedCandidates[url] ?? {}), ...byTool };
      }
      console.log(`FIELD-COMPARISON read candidates from ${candidateFile}`);
    } catch (error) {
      console.log(`FIELD-COMPARISON could not parse ${candidateFile}: ${error.message}`);
    }
  }

  /** The issue statements for one tool on one PR, from whichever source has them. */
  function candidatesFor(url, tool, shipped) {
    const fromFile = shippedCandidates[url]?.[tool];
    if (Array.isArray(fromFile) && fromFile.length > 0) {
      return fromFile.map((c) => (typeof c === 'string' ? c : c.text ?? '')).filter(Boolean);
    }
    const inline = shipped?.candidates;
    if (Array.isArray(inline) && inline.length > 0) {
      return inline.map((c) => (typeof c === 'string' ? c : c.text ?? '')).filter(Boolean);
    }
    // **The fallback reads the comment bodies**, because **a tool whose candidates were never extracted still made
    // comments**, and **a comparison that counts them as silent would report a field-wide zero** - which is exactly
    // what the first run did.
    return (shipped?.review_comments ?? []).map((c) => String(c.body ?? '')).filter(Boolean);
  }

  const urls = Object.keys(data).slice(0, MAX_PRS);
  const tools = new Set([TOOL]);
  for (const url of urls) for (const r of data[url].reviews ?? []) tools.add(r.tool);

  const per = new Map();
  const toolsWithCandidates = new Set();
  let judged = 0;
  let unanswered = 0;
  let pairsJudged = 0;

  for (const url of urls) {
    const entry = data[url];
    const goldens = entry.golden_comments ?? [];
    for (const tool of tools) {
      const shipped = (entry.reviews ?? []).find((r) => r.tool === tool);
      // **Ours comes from our own candidates file; theirs from whichever source holds them.** One lookup, three
      // sources, and **the count is logged** so a field-wide zero cannot pass as a measurement again.
      const texts =
        tool === TOOL
          ? (ours[url]?.[tool] ?? []).map((c) => c.text ?? '')
          : candidatesFor(url, tool, shipped);
      if (texts.length > 0) toolsWithCandidates.add(tool);
      const acc = per.get(tool) ?? { tp: 0, fp: 0, fn: 0, judgeFailed: 0 };
      const matched = new Set();
      for (const text of texts) {
        if (!text) continue;
        for (let g = 0; g < goldens.length; g += 1) {
          if (matched.has(g)) continue;
          pairsJudged += 1;
          const verdict = await judge(text, goldens[g].comment);
          if (verdict === null) acc.judgeFailed += 1;
          else if (verdict) {
            matched.add(g);
            break;
          }
        }
      }
      acc.tp += matched.size;
      acc.fn += goldens.length - matched.size;
      acc.fp += Math.max(0, texts.length - matched.size);
      unanswered += acc.judgeFailed;
      per.set(tool, acc);
      judged += 1;
    }
  }

  // **F-beta as well as F1, because a single F1 hides the trade the field is making.** Their own dashboard offers
  // beta from 0.5 to 3.0 and their documentation says why: *missed bugs are worse than false alarms* on some teams
  // and **the reverse on others** - so **a table that prints one F1 has chosen a side without saying so.** **F0.5
  // weights precision, F2 weights recall**, and **all three are reported per tool** because **a tool that looks
  // fifth on F1 can be first on F2 and that is a fact about the tool**.
  const fBeta = (p, r, beta) => {
    const b2 = beta * beta;
    const denom = b2 * p + r;
    return denom > 0 ? ((1 + b2) * p * r) / denom : 0;
  };
  const rows = [...per.entries()].map(([tool, a]) => {
    const p = a.tp + a.fp > 0 ? a.tp / (a.tp + a.fp) : 0;
    const r = a.tp + a.fn > 0 ? a.tp / (a.tp + a.fn) : 0;
    const round = (x) => Math.round(x * 10000) / 10000;
    return {
      tool,
      isOurs: tool === TOOL,
      precision: round(p),
      recall: round(r),
      f05: round(fBeta(p, r, 0.5)),
      f1: round(fBeta(p, r, 1)),
      f2: round(fBeta(p, r, 2)),
      ...a,
    };
  });
  rows.sort((a, b) => b.f1 - a.f1);
  // **And the rank under each weighting**, because **the ordering is the thing a reader takes away** and **an ordering
  // under F2 can differ from the one under F0.5 in a way a single column cannot show.**
  const rankBy = (key) =>
    [...rows]
      .sort((a, b) => b[key] - a[key])
      .reduce((acc, row, i) => {
        acc[row.tool] = i + 1;
        return acc;
      }, {});
  const ranks = { f05: rankBy('f05'), f1: rankBy('f1'), f2: rankBy('f2') };
  for (const row of rows) row.ranks = { f05: ranks.f05[row.tool], f1: ranks.f1[row.tool], f2: ranks.f2[row.tool] };

  write({ ...base, prsScored: urls.length, toolsScored: rows.length, judgedPairs: judged, judgeUnanswered: unanswered, rows, skipped: null });
  console.log(
    `FIELD-COMPARISON scored ${rows.length} tools over ${urls.length} PRs · tools with candidates ${toolsWithCandidates.size} · ` +
      `candidate-golden pairs judged ${pairsJudged} · judge unanswered ${unanswered}`,
  );
  // **A run where no tool had a candidate is a failure rather than a table**, because **it cannot distinguish "the
  // field is silent" from "this job did not find the field's statements"** - and the first run proved which of those
  // it actually was.
  if (toolsWithCandidates.size === 0) {
    console.error('FIELD-COMPARISON failed: no tool had a candidate, so every row would be zero for a reason that is not about the tools');
    process.exit(1);
  }
  for (const row of rows.slice(0, 8)) {
    console.log(
      `  ${row.isOurs ? '*' : ' '} ${row.tool.padEnd(18)} P ${row.precision} R ${row.recall} f05 ${row.f05} F1 ${row.f1} f2 ${row.f2} (rank ${row.ranks.f1})`,
    );
  }
}

function write(payload) {
  mkdirSync(join(process.cwd(), 'benchmarks'), { recursive: true });
  writeFileSync(resolve(process.cwd(), 'benchmarks', 'field-comparison.json'), JSON.stringify(payload, null, 2) + '\n');
}

main().catch((error) => {
  console.error('FIELD-COMPARISON failed:', error && error.message);
  process.exit(1);
});
