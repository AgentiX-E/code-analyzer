#!/usr/bin/env node
// @code-analyzer — The index as a judge, replayed over a run that was already paid for
//
// **The question.** §91 measured a field the lane fills (an `anchor`) at −0.029 F1: a claim the model can always
// restate selects nothing. **§91.6's first sentence is the next device's specification** - *a witness has to be a fact
// the lane must establish, and the check has to be cheaper than the lane's compliance.* **The index can establish such
// a fact for free**: it knows which declaration a line stands in, and which names a file declares.
//
// **Why this costs nothing.** Every verdict this script uses was already bought. An artifact of a Martian run carries,
// per finding, the goldens the judge said it matched - so **any filter or re-ordering of those findings can be scored
// exactly, without a model, a judge or a prompt.** The only new input is the file the finding stands in, fetched from
// the API at the pull request's head, and **reading a file is not a call to a model.**
//
// **What it therefore cannot say.** It does not re-judge: a filter that removes a finding the judge called wrong is a
// filter that removed a finding the judge called wrong. **A defect in the judge is invisible here**, and the artifact's
// own protocol is the only thing making the verdicts comparable.
//
//     node scripts/witness-replay.mjs --bench benchmarks/aacr-bench.json --out benchmarks/r41b-witness.json
//
// **`--check`** replays the unfiltered artifact and refuses to write if the reconstructed precision, recall and F1
// disagree with the ones the artifact publishes - **a replay that cannot reproduce the baseline is a replay of a
// different corpus.**

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  INDEXED_CONTEXT_BUDGET,
  buildSymbolIndex,
  selectIndexedContext,
  symbolAt,
} from '../packages/intelligence/dist/review/index/symbols.js';
import {
  collectDiffFacts,
  maximumMatchingCount,
} from '../packages/intelligence/dist/review/actionability.js';

const TOKEN = process.env.GITHUB_TOKEN ?? '';
const CACHE = process.env.WITNESS_CACHE ?? join(tmpdir(), 'witness-replay-cache');
const BASE = 'https://api.github.com';

function argv(tokens) {
  const out = { bench: null, out: null, check: false, limit: Infinity, verbose: false };
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === '--check') out.check = true;
    else if (token === '--verbose') out.verbose = true;
    else if (token === '--bench') out.bench = tokens[(at += 1)] ?? null;
    else if (token === '--out') out.out = tokens[(at += 1)] ?? null;
    else if (token === '--limit') out.limit = Number(tokens[(at += 1)] ?? 'Infinity');
  }
  return out;
}

const options = argv(process.argv.slice(2));
if (!options.bench) {
  console.error('WITNESS-REPLAY needs --bench <artifact.json>');
  process.exit(2);
}

/** The cache is keyed by URL rather than by path, because a path is not unique across the 49 pull requests. */
function cachePath(url) {
  return join(CACHE, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);
}

/** A text GET with the same cache, used for the one endpoint whose answer is a diff rather than a document. */
async function getText(url) {
  const file = `${cachePath(url)}.txt`;
  if (existsSync(file)) return { ok: true, text: readFileSync(file, 'utf8') };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github.v3.diff',
        'user-agent': 'agentix-e-witness-replay',
        ...(TOKEN ? { authorization: `token ${TOKEN}` } : {}),
      },
    });
    if (res.status === 403 || res.status === 429) {
      await new Promise((resolve) =>
        setTimeout(resolve, Number(res.headers.get('retry-after') ?? '5') * 1000),
      );
      continue;
    }
    if (!res.ok) return { ok: false, reason: `${String(res.status)} ${url}` };
    const text = await res.text();
    writeFileSync(file, text);
    return { ok: true, text };
  }
  return { ok: false, reason: `rate limited ${url}` };
}

/** A JSON GET with the cache in front of it, and **a refusal that says what refused** rather than returning `null`. */
async function getJson(url) {
  const file = cachePath(url);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'agentix-e-witness-replay',
        ...(TOKEN ? { authorization: `token ${TOKEN}` } : {}),
      },
    });
    if (res.status === 403 || res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? '5') * 1000;
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    if (!res.ok) return { error: `${String(res.status)} ${url}` };
    const body = await res.json();
    writeFileSync(file, JSON.stringify(body));
    return body;
  }
  return { error: `rate limited ${url}` };
}

function prCoordinates(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  return m === null ? null : { owner: m[1], repo: m[2], number: Number(m[3]) };
}

/**
 * **The file a finding stands in, at the commit the pull request was reviewed at.**
 *
 * A finding's line numbers are new-side numbers, so the only text they index is the head's. **A base-side fetch would
 * read a file the comment was not written about** and would silently answer `inDeclaration: false` for every finding
 * in a file whose declarations moved - a measurement of the wrong commit that looks like a measurement of the index.
 */
async function fetchFile(owner, repo, path, ref) {
  const body = await getJson(
    `${BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/gu, '/')}?ref=${ref}`,
  );
  if (body.error) return { ok: false, reason: body.error };
  if (body.type !== 'file') return { ok: false, reason: `not a file: ${String(body.type)}` };
  if (body.encoding !== 'base64') return { ok: false, reason: `encoding ${String(body.encoding)}` };
  if (Number(body.size) > 2_000_000)
    return { ok: false, reason: `too large: ${String(body.size)}` };
  return { ok: true, text: Buffer.from(body.content, 'base64').toString('utf8') };
}

const round4 = (x) => Math.round(x * 10_000) / 10_000;
const ratio = (num, den) => (den === 0 ? 0 : num / den);

/** The path a `diff --git` header writes, in the form a finding's `path` carries. */
function normalisePath(raw) {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  if (path.startsWith('a/') || path.startsWith('b/')) path = path.slice(2);
  return path;
}

/** The names a sentence writes, which is what a witness check resolves against the file's declarations. */
function narrativeNames(text) {
  return new Set(String(text ?? '').match(/[A-Za-z_$][\w$]*/gu) ?? []);
}

/** Precision / recall / F1 for one kept subset, with the goldens matched by maximum matching per pull request. */
function score(groups, keep) {
  let tp = 0;
  let k = 0;
  let goldens = 0;
  for (const group of groups) {
    const kept = group.findings.filter((finding) => keep(finding));
    const matches = kept.map((finding) => finding.matchedGoldens);
    tp += maximumMatchingCount(matches, group.goldens);
    k += kept.length;
    goldens += group.goldens;
  }
  const precision = ratio(tp, k);
  const recall = ratio(tp, goldens);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    k,
    truePositives: tp,
    falsePositives: k - tp,
    falseNegatives: goldens - tp,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
  };
}

/** The largest score a finding can carry, so a witness weight is expressed as a share of the scale rather than as a number. */
function topPerPullRequest(groups, budget, rank) {
  const chosen = new Set();
  for (const group of groups) {
    const ordered = [...group.findings].sort((left, right) => rank(right) - rank(left));
    for (const finding of ordered.slice(0, budget)) chosen.add(finding);
  }
  return chosen;
}

async function main() {
  const artifact = JSON.parse(readFileSync(options.bench, 'utf8'));
  const rows = artifact.rankedFindings ?? [];
  if (rows.length === 0) {
    console.error('WITNESS-REPLAY: the artifact carries no rankedFindings');
    process.exit(2);
  }
  mkdirSync(CACHE, { recursive: true });

  /**
   * **The corpus's own golden count per pull request**, because the denominator is not derivable from the findings.
   * The first version of this script took `max(matched index) + 1`, which counts only the goldens *something matched* -
   * so recall came out at 0.2951 against the artifact's 0.2279 and the replay failed its own baseline check. **A
   * denominator reconstructed from the numerator is a recall that flatters every arm equally**, which is exactly the
   * kind of error that looks like a consistent measurement.
   */
  const goldensByPullRequest = new Map(
    (artifact.coverage?.byPullRequest ?? []).map((row) => [row.pr, row.goldens]),
  );

  // **Grouped by pull request, because the metric is**, and because a golden index is only meaningful inside one.
  const groups = new Map();
  for (const row of rows) {
    const key = row.pr ?? `pr-${groups.size}`;
    if (!groups.has(key)) groups.set(key, { key, findings: [], goldens: 0 });
    const group = groups.get(key);
    group.findings.push({ ...row, matchedGoldens: row.matchedGoldens ?? [] });
    for (const index of row.matchedGoldens ?? [])
      group.goldens = Math.max(group.goldens, index + 1);
    const known = goldensByPullRequest.get(key);
    if (typeof known === 'number') group.goldens = Math.max(group.goldens, known);
  }

  // **The head commit of each pull request**, because a new-side line number indexes the head and nothing else.
  const heads = new Map();
  const prList = [...groups.keys()].slice(0, options.limit);
  for (const key of prList) {
    const coordinates = prCoordinates(key);
    if (coordinates === null) continue;
    const body = await getJson(
      `${BASE}/repos/${coordinates.owner}/${coordinates.repo}/pulls/${String(coordinates.number)}`,
    );
    if (body.error) continue;
    heads.set(key, body.head?.sha ?? null);
  }

  /**
   * **The diff of each pull request, because the second family of witness facts is about the change and not the file.**
   *
   * The first family (§93.2) asked *is this line inside a declaration* and answered **no discrimination at all** - a
   * fact about the file that is equally true of a comment that found a defect and a comment that found nothing. **The
   * fact a review can act on is about the change**: the declaration the comment stands in is a declaration *this diff
   * touched*, and the call it names is a call *this diff added*.
   */
  const diffs = new Map();
  const diffFiles = { requested: 0, read: 0, failed: 0, reasons: [] };
  for (const key of prList) {
    const coordinates = prCoordinates(key);
    if (coordinates === null) continue;
    diffFiles.requested += 1;
    const diff = await getText(
      `${BASE}/repos/${coordinates.owner}/${coordinates.repo}/pulls/${String(coordinates.number)}`,
    );
    if (!diff.ok) {
      diffFiles.failed += 1;
      if (diffFiles.reasons.length < 8) diffFiles.reasons.push(`${key}: ${diff.reason}`);
      continue;
    }
    diffFiles.read += 1;
    diffs.set(key, collectDiffFacts(diff.text));
  }

  const indices = new Map();
  const files = { requested: 0, read: 0, failed: 0, reasons: [] };
  const witnessOf = new Map();

  for (const key of prList) {
    const group = groups.get(key);
    const coordinates = prCoordinates(key);
    const ref = heads.get(key);
    if (coordinates === null || !ref) {
      for (const finding of group.findings)
        witnessOf.set(finding, { readable: false, reason: 'no head' });
      continue;
    }
    for (const path of new Set(group.findings.map((finding) => finding.path))) {
      files.requested += 1;
      const file = await fetchFile(coordinates.owner, coordinates.repo, path, ref);
      if (!file.ok) {
        files.failed += 1;
        if (files.reasons.length < 8) files.reasons.push(`${path}: ${file.reason}`);
        continue;
      }
      files.read += 1;
      const index = buildSymbolIndex(path, file.text);
      indices.set(`${key}\u0000${path}`, index);
      if (options.verbose) console.log(`read ${path} ${String(index.symbols.length)} symbols`);
    }
  }

  // **The three questions the index can answer about a claim**, each computed here rather than asked of the lane.
  for (const [key, group] of groups) {
    for (const finding of group.findings) {
      const index = indices.get(`${key}\u0000${finding.path}`);
      if (index === undefined) {
        witnessOf.set(finding, { readable: false, reason: 'file not read' });
        continue;
      }
      const symbol = symbolAt(index, finding.startLine ?? 0);
      const declared = new Set();
      let members = 0;
      for (const entry of index.symbols) {
        declared.add(entry.name);
        for (const member of entry.members ?? []) {
          declared.add(member.name);
          members += 1;
        }
      }
      // **The change-side facts**, computed from the diff rather than from the file: a comment about code the change
      // did not touch is the shape of a false positive, and the index is what turns "the change" into a declaration.
      const addedHere = diffs.get(key)?.added.get(normalisePath(finding.path)) ?? null;
      const addedLines = addedHere === null ? [] : [...addedHere.keys()];
      const enclosingTouched =
        symbol !== null &&
        addedLines.some((line) => line >= symbol.startLine && line <= symbol.endLine);
      const declarationAdded =
        symbol !== null && addedHere !== null && addedHere.has(symbol.startLine);
      const addedNames = new Set();
      for (const line of addedLines)
        for (const token of narrativeNames(addedHere.get(line))) addedNames.add(token);
      const named = narrativeNames(finding.text);
      const namesDeclared = [...named].some((token) => declared.has(token));
      // **A call witness is narrower than a name witness**: the sentence has to name a declaration *and* call it, which
      // is what a path witness is made of. A comment that mentions `buffer` is naming a variable; one that says
      // `readFile(` is naming something the file declares and the code reaches.
      const calls = new Set();
      for (const match of String(finding.text ?? '').matchAll(/([A-Za-z_$][\w$]*)\s*\(/gu))
        calls.add(match[1]);
      const callsDeclared = [...calls].some((token) => declared.has(token));
      witnessOf.set(finding, {
        readable: true,
        enclosingTouched,
        declarationAdded,
        // **Whether the index has an opinion about this file at all.** `unknown` is a language nobody here reads, so a
        // line in it is not "outside every declaration" - it is a question this device cannot answer, and a device that
        // answered it would delete every finding filed against a `.c` file while reporting a precision gain.
        opined: index.language !== 'unknown',
        language: index.language,
        symbols: index.symbols.length,
        members,
        declaration:
          symbol === null
            ? null
            : {
                name: symbol.name,
                kind: symbol.kind,
                startLine: symbol.startLine,
                endLine: symbol.endLine,
              },
        inDeclaration: symbol !== null,
        namesDeclared,
        callsDeclared,
        // **A call the change added**: the callee the sentence names is called on a line this diff added, which is the
        // Semgrep-shaped witness - a path from the change to the declaration, checkable without a model.
        calleeOnAdded:
          callsDeclared && [...calls].some((token) => declared.has(token) && addedNames.has(token)),
      });
    }
  }

  const groupList = prList.map((key) => groups.get(key));
  // **The rows the witness was recorded against, not the artifact's own objects.** The grouping copies each row so that
  // `matchedGoldens` is never undefined; a second reader of `artifact.rankedFindings` would key a Map by objects nothing
  // wrote to, and every rate below would come back zero - which is what the first run of this script printed.
  const visited = groupList.flatMap((group) => group.findings);
  const baseline = score(groupList, () => true);
  const published = artifact.fullEmission ?? {};
  const reproduced =
    baseline.truePositives === published.truePositives &&
    Math.abs(baseline.precision - (published.precision ?? 0)) < 0.002 &&
    Math.abs(baseline.f1 - (published.f1 ?? 0)) < 0.002;

  const armed = (predicate) => (finding) => {
    const w = witnessOf.get(finding);
    // **A file that could not be read, and a language nobody here reads, are both abstentions** - the finding is kept,
    // because a device is allowed to refute what it has read and not what it has not.
    if (w?.readable !== true || w.opined !== true) return true;
    return predicate(w);
  };

  const variants = {
    baseline: () => true,
    inDeclaration: armed((w) => w.inDeclaration),
    namesDeclared: armed((w) => w.namesDeclared),
    inDeclarationAndNamesDeclared: armed((w) => w.inDeclaration && w.namesDeclared),
    callWitness: armed((w) => w.callsDeclared),
    inDeclarationAndCallWitness: armed((w) => w.inDeclaration && w.callsDeclared),
    enclosingTouched: armed((w) => w.enclosingTouched),
    declarationAdded: armed((w) => w.declarationAdded),
    calleeOnAdded: armed((w) => w.calleeOnAdded),
    touchedOrCallee: armed((w) => w.enclosingTouched || w.calleeOnAdded),
  };

  const curves = {};
  for (const [name, keep] of Object.entries(variants)) curves[name] = score(groupList, keep);

  /** The witness at the 12-per-pull-request budget the shipped rule uses, as an ordering and not as a filter. */
  const budgetCurves = {};
  for (const budget of [4, 8, 12, 16]) {
    const base = topPerPullRequest(groupList, budget, (finding) => finding.score ?? 0);
    budgetCurves[`score@${String(budget)}`] = score(groupList, (finding) => base.has(finding));
    for (const [name, predicate] of [
      ['inDeclaration', (w) => w.inDeclaration],
      ['namesDeclared', (w) => w.namesDeclared],
      ['callWitness', (w) => w.callsDeclared],
    ]) {
      const boosted = topPerPullRequest(
        groupList,
        budget,
        (finding) =>
          (finding.score ?? 0) +
          (witnessOf.get(finding)?.readable === true && predicate(witnessOf.get(finding))
            ? 0.2
            : 0),
      );
      budgetCurves[`${name}@${String(budget)}`] = score(groupList, (finding) =>
        boosted.has(finding),
      );
    }
  }

  /** Whether the witness separates a golden-hitting comment from a comment that hit nothing. */
  const separation = {};
  for (const name of [
    'inDeclaration',
    'namesDeclared',
    'callsDeclared',
    'enclosingTouched',
    'declarationAdded',
    'calleeOnAdded',
  ]) {
    let hit = 0;
    let hitTotal = 0;
    let miss = 0;
    let missTotal = 0;
    for (const finding of visited) {
      const w = witnessOf.get(finding);
      if (w?.readable !== true || w.opined !== true) continue;
      const positive = (finding.matchedGoldens ?? []).length > 0;
      if (positive) {
        hitTotal += 1;
        if (w[name]) hit += 1;
      } else {
        missTotal += 1;
        if (w[name]) miss += 1;
      }
    }
    separation[name] = {
      amongMatched: round4(ratio(hit, hitTotal)),
      amongUnmatched: round4(ratio(miss, missTotal)),
      matched: hitTotal,
      unmatched: missTotal,
      lift: round4(ratio(hit, hitTotal) - ratio(miss, missTotal)),
    };
  }

  /** Coverage of the index over the paths a review actually filed comments on, one language at a time. */
  const byLanguage = {};
  for (const finding of visited) {
    const w = witnessOf.get(finding);
    const language = w?.readable === true ? w.language : 'unread';
    // **`unknown` is its own row rather than folded into `unread`**: the first is a language this index does not read,
    // the second is a file the run could not fetch, and only one of them is a decision.
    const row = (byLanguage[language] ??= {
      findings: 0,
      inDeclaration: 0,
      namesDeclared: 0,
      callsDeclared: 0,
      symbols: 0,
      members: 0,
    });
    row.findings += 1;
    if (w?.readable !== true) continue;
    row.symbols += w.symbols;
    row.members += w.members;
    if (w.inDeclaration) row.inDeclaration += 1;
    if (w.namesDeclared) row.namesDeclared += 1;
    if (w.callsDeclared) row.callsDeclared += 1;
  }
  for (const row of Object.values(byLanguage)) {
    row.meanSymbols = round4(ratio(row.symbols, row.findings));
    row.meanMembers = round4(ratio(row.members, row.findings));
    row.inDeclaration = round4(ratio(row.inDeclaration, row.findings));
    row.namesDeclared = round4(ratio(row.namesDeclared, row.findings));
    row.callsDeclared = round4(ratio(row.callsDeclared, row.findings));
  }

  /**
   * **What the index costs to say the same thing a character window says.**
   *
   * §78 measured `codeContext` at **−0.0022 F1** for 6 000 characters per file, and SWE-PRBench measured eight frontier
   * models *falling* as context grew - so the question is not whether context helps but **what the smallest block that
   * answers a claim costs**. The index's answer is a declaration's signature, its enclosing member, the guards inside
   * it and the claim's own line, inside `INDEXED_CONTEXT_BUDGET`; the window's is six thousand characters and a guess
   * about where in them the comment is about.
   *
   * **Coverage is counted rather than assumed**: a claim is covered when the block carries its own line, which is read
   * back out of the rendered text rather than remembered by the renderer.
   */
  const context = {
    files: 0,
    budget: INDEXED_CONTEXT_BUDGET,
    window: 6000,
    claims: 0,
    covered: 0,
    blank: 0,
    chars: 0,
    windowChars: 0,
  };
  for (const [key, group] of groups) {
    const byPath = new Map();
    for (const finding of group.findings) {
      if (!byPath.has(finding.path)) byPath.set(finding.path, []);
      byPath.get(finding.path).push(finding);
    }
    for (const [path, claims] of byPath) {
      const index = indices.get(`${key}\u0000${path}`);
      if (index === undefined) continue;
      const block = selectIndexedContext({
        index,
        lines: claims.map((claim) => claim.startLine ?? 1),
      });
      context.files += 1;
      context.chars += block.text.length;
      context.windowChars += context.window;
      const shown = new Set(block.shown.map((row) => row.line));
      if (options.verbose) {
        for (const claim of claims) {
          const line = claim.startLine ?? 1;
          if (shown.has(line)) continue;
          if ((index.lines[line - 1] ?? '').trim().length === 0) continue;
          console.log(
            `MISS ${path}:${String(line)} symbols=${String(index.symbols.length)}:: ${JSON.stringify((index.lines[line - 1] ?? '').slice(0, 60))} block=${JSON.stringify(block.text.slice(0, 120))}`,
          );
        }
      }
      context.claims += claims.length;
      context.covered += claims.filter((claim) => shown.has(claim.startLine ?? 1)).length;
      // **A claim filed on a blank line has no line of its own to show**, and counting it as a miss would make the
      // coverage figure a statement about where findings land rather than about what the block carries.
      context.blank += claims.filter(
        (claim) => (index.lines[(claim.startLine ?? 1) - 1] ?? '').trim().length === 0,
      ).length;
    }
  }
  context.meanCharsPerFile = round4(ratio(context.chars, context.files));
  context.shareOfWindow = round4(ratio(context.chars, context.windowChars));
  context.coverage = round4(ratio(context.covered, context.claims));
  context.coverageOfNonBlank = round4(ratio(context.covered, context.claims - context.blank));

  const report = {
    comment: [
      'The index as a judge, replayed over a run whose verdicts were already paid for.',
      '',
      '**No model, no judge, no corpus**: the goldens each finding matched are the ones the artifact recorded, so every',
      'figure here is arithmetic over verdicts that were bought in the run the artifact names. The one new input is the',
      'file each finding stands in, read at the pull request head.',
    ],
    measuredAt: new Date().toISOString().slice(0, 10),
    source: options.bench,
    protocol:
      'per pull request, a maximum bipartite matching between kept findings and the goldens the judge matched them to; ' +
      'precision = matched / kept, recall = matched / goldens, F1 harmonic',
    reproducedBaseline: reproduced,
    publishedBaseline: published,
    baseline,
    files,
    diffFiles,
    headsRead: heads.size,
    pullRequests: prList.length,
    findings: rows.length,
    curves,
    budgetCurves,
    separation,
    byLanguage,
    context,
    // **One row per finding, because a filter a reader cannot re-run is a filter a reader has to trust.**
    rows: visited.slice(0, 4000).map((finding) => ({
      pr: finding.pr ?? null,
      path: finding.path,
      startLine: finding.startLine,
      score: finding.score,
      matched: (finding.matchedGoldens ?? []).length,
      witness: witnessOf.get(finding) ?? { readable: false, reason: 'not visited' },
    })),
  };

  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(
    JSON.stringify(
      {
        reproduced,
        baseline,
        curves,
        separation,
        files,
        byLanguage: Object.keys(byLanguage).length,
      },
      null,
      1,
    ),
  );
  if (options.check && !reproduced) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
