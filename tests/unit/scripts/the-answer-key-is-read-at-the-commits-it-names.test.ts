// **A benchmark whose input is a live pull request is a benchmark whose figure expires without saying so.**
//
// `§175` measured it: on the fifty pull requests `§173.2` scored, **93 of 452 goldens stand, against the pull request's
// diff as it is today, on a path the diff does not contain or outside every hunk** - and the competitor's own recorded
// arm has findings on some of those paths, which means the paths were there when that arm was recorded and are not there
// now. The repair is a diff read at the corpus's own `source_commit...target_commit`, and **an instrument that prices
// reach live and pinned**, so the drift is a number rather than a suspicion.
//
// Every case below is about a refusal or an identity rather than about a number: a pin that is claimed but not performed,
// a partition that does not add up to its slice, and a page that would draw rows disagreeing with their own total.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  commitsOf,
  compareDiffUrl,
  fetchPinnedDiff,
  pullParts,
} from '../../../scripts/lib/pinned-diff.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** One patch, shaped like the ones the API serves: a `+++` header, a hunk header, context and one added line. */
const PATCH = [
  'diff --git a/src/a.cpp b/src/a.cpp',
  '--- a/src/a.cpp',
  '+++ b/src/a.cpp',
  '@@ -1,2 +1,3 @@',
  ' int a = 1;',
  '+int b = 2;',
  ' int c = 3;',
  '',
].join('\n');

/** A corpus row in the shape `Alibaba-Aone/aacr-bench` publishes: a URL, two commits, and the goldens. */
function row(
  url: string,
  base: string,
  head: string,
  comments: unknown[],
): Record<string, unknown> {
  return { githubPrUrl: url, source_commit: base, target_commit: head, comments };
}

/** A golden on `src/a.cpp` at `from`..`to`. */
function golden(from: number, to: number, note: string): Record<string, unknown> {
  return { path: 'src/a.cpp', from_line: from, to_line: to, note, category: 'Code Defect' };
}

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'corpus-reach-'));
}

function run(args: string[], cwd = ROOT): { code: number; out: string } {
  try {
    const out = execFileSync('node', [join(ROOT, 'scripts', 'corpus-reach.mjs'), ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('the commit pair a row names', () => {
  it('reads the two commits and refuses a pair that describes no change', () => {
    expect(commitsOf({ source_commit: 'a'.repeat(40), target_commit: 'b'.repeat(40) })).toEqual({
      base: 'a'.repeat(40),
      head: 'b'.repeat(40),
    });
    // **A row that names no pair is a fact, not a failure**: Martian's rows carry no commits at all.
    expect(commitsOf({})).toBeNull();
    // **And two equal commits describe no change**, so a run that pinned to them would report an empty diff as a pinned one.
    expect(commitsOf({ source_commit: 'c'.repeat(40), target_commit: 'c'.repeat(40) })).toBeNull();
    // A `HEAD` or a branch name is not a commit, and the corpus's field is hex or nothing.
    expect(commitsOf({ source_commit: 'main', target_commit: 'b'.repeat(40) })).toBeNull();
  });

  it('builds the comparison URL from the pull request and the pair', () => {
    const parts = pullParts('https://github.com/FreeCAD/FreeCAD/pull/20825');
    expect(parts).toEqual({ owner: 'FreeCAD', repo: 'FreeCAD', number: '20825' });
    expect(compareDiffUrl({ ...parts!, base: 'abc1234', head: 'def5678' })).toBe(
      'https://api.github.com/repos/FreeCAD/FreeCAD/compare/abc1234...def5678',
    );
    expect(pullParts('https://github.com/FreeCAD/FreeCAD')).toBeNull();
  });
});

describe('the pinned fetch', () => {
  it('asks the comparison endpoint for a diff and says it pinned', async () => {
    const asked: string[] = [];
    const result = await fetchPinnedDiff({
      url: 'https://github.com/o/r/pull/1',
      commits: { base: 'a'.repeat(40), head: 'b'.repeat(40) },
      fetchImpl: (async (target: string) => {
        asked.push(String(target));
        return new Response(PATCH, { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true, diff: PATCH, pinned: true });
    expect(asked).toEqual([
      `https://api.github.com/repos/o/r/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`,
    ]);
  });

  it('refuses four hundred and four at once and a transient failure only after the last attempt', async () => {
    let fours = 0;
    const missing = await fetchPinnedDiff({
      url: 'https://github.com/o/r/pull/1',
      commits: { base: 'a'.repeat(40), head: 'b'.repeat(40) },
      fetchImpl: (async () => {
        fours += 1;
        return new Response('gone', { status: 404 });
      }) as unknown as typeof fetch,
    });
    expect(missing).toMatchObject({ ok: false, status: 404 });
    // **A range the remote no longer holds answers the same way four times**, so the request is made once.
    expect(fours).toBe(1);

    let attempts = 0;
    const recovered = await fetchPinnedDiff({
      url: 'https://github.com/o/r/pull/1',
      commits: { base: 'a'.repeat(40), head: 'b'.repeat(40) },
      fetchImpl: (async () => {
        attempts += 1;
        return attempts === 1
          ? new Response('boom', { status: 500 })
          : new Response(PATCH, { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(attempts).toBe(2);
    expect(recovered).toMatchObject({ ok: true, pinned: true });
  });

  it('refuses a row with no pair rather than fetching the live diff behind the caller', async () => {
    const result = await fetchPinnedDiff({
      url: 'https://github.com/o/r/pull/1',
      commits: null,
      fetchImpl: (async () => new Response(PATCH, { status: 200 })) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: false });
    expect(String((result as { reason: string }).reason)).toContain('no commit pair');
  });
});

describe('the reach partition', () => {
  /** The corpus, the artifact and the patches a run needs, on one pull request with four goldens. */
  function fixtures(options: { sliceGoldens?: number } = {}) {
    const directory = workspace();
    const url = 'https://github.com/o/r/pull/1';
    const corpus = [
      row(url, 'a'.repeat(40), 'b'.repeat(40), [
        golden(2, 2, 'the added line is wrong'), // line 2 is added: in a hunk, with an added line
        golden(3, 3, 'the line after it is wrong'), // line 3 is context: in a hunk, no added line
        golden(40, 41, 'nothing changed near here'), // outside every hunk
        { path: 'src/gone.cpp', from_line: 1, to_line: 1, note: 'a file the diff lost' },
      ]),
    ];
    const artifact = {
      coverage: { byPullRequest: [{ pr: url, goldens: options.sliceGoldens ?? 4 }] },
      rankedFindings: [{ pr: url, path: 'src/a.cpp', startLine: 2, matchedGoldens: [0, 2] }],
    };
    const baseline = { pulls: { [url]: { matches: [[0], [2], [], [3]] } } };
    const patches = join(directory, 'patches');
    execFileSync('mkdir', ['-p', patches]);
    writeFileSync(join(patches, 'o__r__1.diff'), PATCH);
    writeFileSync(join(patches, 'o__r__1.pinned.diff'), PATCH);
    for (const [name, value] of [
      ['corpus.json', corpus],
      ['artifact.json', artifact],
      ['baseline.json', baseline],
    ] as const) {
      writeFileSync(join(directory, name), JSON.stringify(value));
    }
    return { directory, patches, url };
  }

  it('places every golden in exactly one bucket, and counts the added line separately', () => {
    const { directory, patches } = fixtures();
    const out = join(directory, 'reach.json');
    const result = run([
      '--corpus',
      join(directory, 'corpus.json'),
      '--artifact',
      join(directory, 'artifact.json'),
      '--baseline',
      join(directory, 'baseline.json'),
      '--patches',
      patches,
      '--json',
      out,
    ]);
    expect(result.code).toBe(0);
    const record = JSON.parse(execFileSync('cat', [out], { encoding: 'utf8' }));
    expect(record.version).toBe('corpus-reach-v1');
    expect(record.reading).toBe('live');
    expect(record.buckets).toEqual([
      { bucket: 'inHunk', goldens: 2, addedInSpan: 1, ours: 1, theirs: 1 },
      { bucket: 'outsideHunks', goldens: 1, addedInSpan: 0, ours: 1, theirs: 1 },
      { bucket: 'absentPath', goldens: 1, addedInSpan: 0, ours: 0, theirs: 1 },
      { bucket: 'unread', goldens: 0, addedInSpan: 0, ours: 0, theirs: 0 },
    ]);
    // **A credit on a path the diff does not contain is the drift this instrument exists for**, and it is counted in the
    // bucket it stands in rather than dropped - the competitor's arm has one, which is a path that existed when that arm
    // was recorded and does not exist now.
    expect(record.credited).toEqual({ ours: 2, theirs: 3 });
    // **The addressable denominator is the slice minus the paths the diff does not hold**, which is the one number this
    // instrument exists to put beside the bar.
    expect(record.addressable.goldens).toBe(3);
    expect(record.rate.oursOnAddressable).toBeCloseTo(2 / 3, 10);
  });

  it('reads the pinned patch under its own name, so one directory holds both readings', () => {
    const { directory, patches } = fixtures();
    const out = join(directory, 'pinned.json');
    const result = run([
      '--corpus',
      join(directory, 'corpus.json'),
      '--artifact',
      join(directory, 'artifact.json'),
      '--patches',
      patches,
      '--pinned',
      '--json',
      out,
    ]);
    expect(result.code).toBe(0);
    const record = JSON.parse(execFileSync('cat', [out], { encoding: 'utf8' }));
    expect(record.reading).toBe('pinned');
    // **A pinned reading is a different document, and the record has to say so** - otherwise two files from one
    // instrument are comparable by accident.
    expect(record.pulls[0].pinned).toBe(true);
    expect(record.credited.theirs).toBeNull();
  });

  it('refuses a slice row the corpus does not hold instead of folding it into a bucket', () => {
    const { directory, patches } = fixtures();
    writeFileSync(
      join(directory, 'artifact.json'),
      JSON.stringify({
        coverage: { byPullRequest: [{ pr: 'https://github.com/o/r/pull/999', goldens: 1 }] },
        rankedFindings: [],
      }),
    );
    const result = run([
      '--corpus',
      join(directory, 'corpus.json'),
      '--artifact',
      join(directory, 'artifact.json'),
      '--patches',
      patches,
    ]);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('is in the slice and not in the corpus');
  });
});

describe('the page', () => {
  const good = {
    version: 'corpus-reach-v1',
    source: 'dispatch 1 · test',
    reading: 'live',
    basis: 'credited by any finding, before any cut',
    corpus: { pullRequests: 1, goldens: 3 },
    buckets: [
      { bucket: 'inHunk', goldens: 2, addedInSpan: 1, ours: 1, theirs: 2 },
      { bucket: 'outsideHunks', goldens: 1, addedInSpan: 0, ours: 1, theirs: 0 },
      { bucket: 'absentPath', goldens: 0, addedInSpan: 0, ours: 0, theirs: 0 },
      { bucket: 'unread', goldens: 0, addedInSpan: 0, ours: 0, theirs: 0 },
    ],
    addressable: { goldens: 3, share: 1 },
    credited: { ours: 2, theirs: 2 },
    rate: {
      oursOnSlice: 2 / 3,
      oursOnAddressable: 2 / 3,
      theirsOnSlice: 2 / 3,
      theirsOnAddressable: 2 / 3,
    },
  };

  it('draws the record it was handed, and no more', async () => {
    const { renderCorpusReach } = await import('../../../scripts/corpus-reach-page.mjs');
    const html = renderCorpusReach(good);
    expect(html).toContain('How much of the answer key the diff can reach');
    expect(html).toContain('on a path the diff does not contain');
    // **No script and no network**: the page is a document, and a figure that loads its own number from somewhere is a
    // figure with a second source.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
  });

  it('refuses a version it does not know and a table that disagrees with its own total', async () => {
    const { renderCorpusReach } = await import('../../../scripts/corpus-reach-page.mjs');
    expect(() => renderCorpusReach({ ...good, version: 'corpus-reach-v0' })).toThrow(
      /not corpus-reach-v1/,
    );
    expect(() => renderCorpusReach({ ...good, corpus: { pullRequests: 1, goldens: 4 } })).toThrow(
      /against 4 in the slice/,
    );
    expect(() => renderCorpusReach({ ...good, credited: { ours: 1, theirs: 2 } })).toThrow(
      /against 1 in the record/,
    );
  });
});
