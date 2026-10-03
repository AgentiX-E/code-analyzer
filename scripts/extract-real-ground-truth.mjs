#!/usr/bin/env node
// Real ground truth for the PR-review benchmark, taken from public bug-fix commits.
//
// **The problem this solves.** The benchmark's citation reads:
//
//   groundTruthIssues: 49        minimumGroundTruth: 100
//   independentValidation: false
//
// Forty-nine hand-written fixtures, below the declared minimum, and not independent — because this project wrote
// them. The flagship figure (F1 0.761 against a target of 0.68 and a competitor's 0.55) is therefore unpublishable.
//
// **The rule that makes a real dataset independent.** A human, and not this project, decided which lines were
// wrong: they are the lines that human's fix changed. The hunk headers in the commit's own patch say which they
// were — `@@ -oldStart,oldCount +newStart,newCount @@` — so the ranges are **authored**, read out of the diff
// rather than inferred by comparing files.
//
//   authored  - the line ranges, which come from the human's patch
//   inferred  - the category and severity, which come from the commit message by the manifest's rules
//
// Every emitted issue carries both labels and its provenance (repo, sha, path, message), so a reader can check any
// single entry against GitHub without trusting this repository.
//
//   node scripts/extract-real-ground-truth.mjs --limit 20 --out benchmarks/real-ground-truth/issues.json
//
// It needs `GITHUB_TOKEN` (or the credential helper) and network access to api.github.com.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const API = 'https://api.github.com';

function token() {
  if (process.env['GITHUB_TOKEN']) return process.env['GITHUB_TOKEN'];
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

const TOKEN = token();

/** One API call, with the headers GitHub asks for and a retry that respects `retry-after`. */
function api(path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const out = execFileSync(
      'curl',
      ['-sS', '--http1.1', '-H', `Authorization: token ${TOKEN}`, '-H', 'User-Agent: code-analyzer', `${API}${path}`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new Error(`not JSON from ${path}: ${out.slice(0, 120)}`);
    }
    if (parsed.message && /rate limit|secondary/i.test(parsed.message)) {
      const wait = 20_000 * (attempt + 1);
      process.stderr.write(`  rate limited, waiting ${wait / 1000}s\n`);
      execFileSync('sleep', [String(wait / 1000)]);
      continue;
    }
    return parsed;
  }
  throw new Error(`gave up on ${path}`);
}

/** The raw file at a ref, or null when it is not there. */
function fileAt(repo, path, ref) {
  try {
    const out = execFileSync(
      'curl',
      [
        '-sS',
        '--http1.1',
        '-H',
        `Authorization: token ${TOKEN}`,
        '-H',
        'User-Agent: code-analyzer',
        '-H',
        'Accept: application/vnd.github.raw',
        `${API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    // A 404 arrives as JSON even with the raw accept header.
    return out.trimStart().startsWith('{') && out.includes('"message"') ? null : out;
  } catch {
    return null;
  }
}

/**
 * The old-side line ranges of a patch, read from its hunk headers.
 *
 * `@@ -12,7 +12,9 @@` means seven lines of the old file starting at twelve are the region this hunk
 * rewrites - and those seven are the lines the author decided were wrong.
 */
function oldSideRanges(patch) {
  const ranges = [];
  for (const line of patch.split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    // **A hunk that spans a rewrite is not one reviewable issue.** The first run emitted a 69-line range from a
    // compiler baseline; a bound on the span keeps the dataset to line-level findings a reviewer could name.
    if (count > 0 && count <= (MAX_HUNK_LINES ?? Infinity)) ranges.push({ startLine: start, endLine: start + count - 1 });
  }
  return ranges;
}

let MAX_HUNK_LINES = Infinity;
let windowLines = 0;

function classify(message, rules) {
  const lower = message.toLowerCase();
  for (const rule of rules) {
    if (new RegExp(rule.pattern, 'i').test(lower)) {
      return { category: rule.category, severity: rule.severity, rule: rule.pattern };
    }
  }
  return null;
}

function main() {
  // **A flag that is absent gives `indexOf` -1, and `argv[-1 + 1]` is `argv[0]`** - so `--out` missing meant the
  // output path was whatever the first argument happened to be. Read the flags as pairs instead of by index.
  const argv = process.argv.slice(2);
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--') && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      flags.set(argv[i], argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith('--')) {
      flags.set(argv[i], 'true');
    }
  }
  const limit = Number(flags.get('--limit') ?? 100);
  const outPath = resolve(ROOT, flags.get('--out') ?? 'benchmarks/real-ground-truth/issues.json');

  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'benchmarks/real-ground-truth/manifest.json'), 'utf8'));
  // **Read after the manifest, not before it** - the first edit put this line above the `const` it reads.
  MAX_HUNK_LINES = Number(manifest.maxLinesPerHunk ?? Infinity);
  windowLines = Number(manifest.windowLines ?? 0);

  const sourceRe = new RegExp(manifest.sourceFilePattern);
  const excludedRe = new RegExp(manifest.excludedPathPattern);

  const seenCommits = new Set();
  const issues = [];
  const rejected = { paths: 0, size: 0, notAFix: 0, noRanges: 0 };

  outer: for (const repo of manifest.repos) {
    for (const template of manifest.queries) {
      if (issues.length >= limit) break outer;
      const query = template.replace('{repo}', repo.repo);
      let found;
      try {
        found = api(`/search/commits?q=${query}&per_page=20&sort=committer-date&order=desc`);
      } catch (e) {
        process.stderr.write(`  search failed for ${query}: ${String(e).slice(0, 80)}\n`);
        continue;
      }
      for (const item of found.items ?? []) {
        if (issues.length >= limit) break outer;
        if (seenCommits.has(item.sha)) continue;
        seenCommits.add(item.sha);
        const message = item.commit?.message ?? '';
        if (!/\b(fix|bug|repair|correct|regress)/i.test(message)) {
          rejected.notAFix += 1;
          continue;
        }
        const verdict = classify(message, manifest.categoryRules);
        if (!verdict) {
          rejected.notAFix += 1;
          continue;
        }

        let detail;
        try {
          detail = api(`/repos/${repo.repo}/commits/${item.sha}`);
        } catch {
          continue;
        }
        const files = (detail.files ?? []).filter(
          (f) => sourceRe.test(f.filename) && !excludedRe.test(f.filename) && f.patch,
        );
        if (files.length === 0 || files.length > manifest.maxFilesPerCommit) {
          rejected.paths += 1;
          continue;
        }
        const changed = files.reduce((n, f) => n + (f.changes ?? 0), 0);
        if (changed === 0 || changed > manifest.maxChangedLinesPerCommit) {
          rejected.size += 1;
          continue;
        }

        const caseFiles = [];
        const groundTruth = [];
        let kept = true;
        for (const f of files) {
          const ranges = oldSideRanges(f.patch);
          if (ranges.length === 0) continue;
          const before = fileAt(repo.repo, f.filename, `${item.sha}^`);
          const after = fileAt(repo.repo, f.filename, item.sha);
          if (before === null || after === null) {
            kept = false;
            break;
          }
          const filePath = `/${f.filename}`;
          const beforeLines = before.split('\n');
          const afterLines = after.split('\n');
          const usable = ranges
            .filter((r) => r.endLine <= beforeLines.length)
            .sort((x, y) => x.startLine - y.startLine);
          if (usable.length === 0) continue;

          // **One issue per region of the diff, not one per file.** Carrying one window around every hunk of
          // `checker.ts` produced a 6,899-line window, because that file's hunks are thousands of lines apart - and
          // a reviewer reads a hunk, not a file. Hunks closer than two windows are one region; further apart, they
          // are separate issues.
          const groups = [];
          for (const r of usable) {
            const last = groups[groups.length - 1];
            if (last && r.startLine - last[last.length - 1].endLine <= windowLines * 2) last.push(r);
            else groups.push([r]);
          }

          for (const [region, group] of groups.entries()) {
            const lo = Math.max(1, Math.min(...group.map((r) => r.startLine)) - windowLines);
            const hi = Math.min(beforeLines.length, Math.max(...group.map((r) => r.endLine)) + windowLines);
            const shift = lo - 1;
            const slice = (lines) => lines.slice(shift, hi).join('\n');

            caseFiles.push({
              filePath,
              // **A file can appear more than once**, once per region of the diff, so an index pairs a
              // ground-truth entry with the exact content its ranges point into. Without it the two regions
              // collapse onto one path and a range is read against the wrong window.
              region,
              beforeContent: slice(beforeLines),
              afterContent: slice(afterLines),
              window: { startLine: lo, endLine: hi, sourceLines: beforeLines.length },
            });
            for (const r of group) {
              groundTruth.push({
                filePath,
                region,
                // Window-relative, which is what the benchmark reads...
                startLine: r.startLine - shift,
                endLine: r.endLine - shift,
                // ...and the same range in the source file, so a reader can find it on GitHub.
                sourceStartLine: r.startLine,
                sourceEndLine: r.endLine,
              category: verdict.category,
              severity: verdict.severity,
              description: message.split('\n')[0].slice(0, 200),
              // Which half of this record a human decided, and which half a rule did.
              rangesProvenance: 'authored',
              categoryProvenance: 'inferred',
              categoryRule: verdict.rule,
              });
            }
          }
        }
        if (!kept || caseFiles.length === 0 || groundTruth.length === 0) {
          rejected.noRanges += 1;
          continue;
        }

        issues.push({
          id: `real-${repo.repo.replace('/', '-')}-${item.sha.slice(0, 10)}`,
          language: repo.language,
          description: message.split('\n')[0].slice(0, 200),
          files: caseFiles,
          groundTruth: groundTruth.map(({ rangesProvenance, categoryProvenance, categoryRule, ...g }) => g),
          expectedFalsePositives: [],
          provenance: {
            repo: repo.repo,
            license: repo.license,
            commit: item.sha,
            commitUrl: item.html_url,
            authoredBy: item.commit?.author?.name ?? 'unknown',
            committedAt: item.commit?.committer?.date ?? 'unknown',
            ranges: 'authored - read from the patch hunk headers',
            category: 'inferred - from the commit message by benchmarks/real-ground-truth/manifest.json',
          },
        });
      }
      // The search endpoint allows 30 requests a minute; one every two seconds stays under it.
      execFileSync('sleep', ['2']);
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        comment: [
          'Real ground truth extracted from public bug-fix commits. Generated by',
          'scripts/extract-real-ground-truth.mjs from benchmarks/real-ground-truth/manifest.json.',
          '',
          '**Every entry is checkable against GitHub**: `provenance.commit` and `provenance.commitUrl` name the',
          'human fix, and the line ranges are that fix\'s own hunk headers - `authored`, not inferred. The',
          'category and severity are inferred from the commit message and say so in the same field.',
          '',
          'This dataset exists because a benchmark of our own fixtures cannot be independent validation, and',
          'the flagship figure is not publishable without one.',
        ],
        schemaVersion: manifest.schemaVersion,
        generatedFrom: 'scripts/extract-real-ground-truth.mjs',
        count: issues.length,
        issues,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  process.stdout.write(
    `\nextracted ${issues.length} real issues -> ${outPath.replace(ROOT + '/', '')}\n` +
      `  rejected: ${JSON.stringify(rejected)}\n` +
      `  repos: ${[...new Set(issues.map((i) => i.provenance.repo))].join(', ')}\n`,
  );
}

if (!TOKEN) {
  process.stderr.write('no GitHub token: set GITHUB_TOKEN or configure the git credential helper\n');
  process.exit(1);
}
main();
