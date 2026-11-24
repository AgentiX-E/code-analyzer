// @code-analyzer — the grounding replay as one page a reader can interrogate
//
// **Why a page and not a printed table.** The replay produces two points and fifty pull requests, and the only question a
// reader can act on is *where* the gate acted: a delta of four hundredths of F1 is either one pull request losing two
// goldens or forty losing a false positive each, and those two are different products. A table of totals cannot say
// which, so the per-pull-request rows are the content and the totals are the header.
//
// **Self-contained by rule, not by convenience**, for the reason `scripts/capability-register.mjs` gives: no `script src`,
// no `link href`, no `fetch`. The page is an artefact that survives being attached to a review, opened from a file system
// or emailed, and a page that needed a CDN to show a figure would be the first counter-example in this repository.
//
// **Deterministic.** No clock and no map iteration that a build could reorder: the same replay renders byte-identically,
// so a diff of two pages is a diff of the reading rather than of its formatting.

/** Escapes the five characters that would otherwise let a finding's own prose change the page. */
function escape(text) {
  return String(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const fixed4 = (value) => Number(value).toFixed(4);

/**
 * **The page, or a refusal.**
 *
 * `report.gate.perPullRequest` is required rather than derived: **a replay that carries totals and no rows is a figure
 * with nothing behind it**, and a renderer that drew an empty table would present that absence as a page. The throw is the
 * same rule `capability-register.mjs` applies to a register with no rows.
 */
export function renderGateReplayPage(report, { title = 'Grounding gate replay' } = {}) {
  const rows = report?.gate?.perPullRequest;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('the replay carries no per-pull-request rows, so there is nothing to render');
  }
  const baseline = report.baseline;
  const gated = report.gated;
  const pool = report.removals;
  const delta = report.delta;

  const tiles = [
    [
      'published F1',
      fixed4(baseline.f1),
      `${String(baseline.emitted)} posted · ${String(baseline.truePositives)} true`,
    ],
    [
      'with the gate',
      fixed4(gated.f1),
      `${String(gated.emitted)} posted · ${String(gated.truePositives)} true`,
    ],
    [
      'delta F1',
      `${delta.f1 >= 0 ? '+' : ''}${fixed4(delta.f1)}`,
      `resolution 0.0126 on this slice`,
    ],
    [
      'removals',
      String(pool.posted),
      pool.share === null ? 'no pool' : `${percent(pool.share)} true`,
    ],
    [
      'goldens lost',
      String(report.goldens.lost.length),
      `${String(report.goldens.gained.length)} gained`,
    ],
    [
      'withheld',
      String(report.gate.withheldPullRequests),
      `of ${String(rows.length)} pull requests`,
    ],
  ];

  const rowHtml = rows.map((row) => {
    const width = Math.max(row.postedBefore, row.postedAfter, 1);
    const lost = report.goldens.lost.filter((key) => key.startsWith(`${row.pr}\u0000`)).length;
    const state = row.applied ? 'applied' : 'withheld';
    const changed = row.postedBefore !== row.postedAfter || row.dropped > 0;
    return `      <tr data-state="${state}" data-changed="${String(changed)}">
        <td class="pr"><a href="${escape(row.pr)}">${escape(row.pr.replace('https://github.com/', ''))}</a></td>
        <td class="num">${String(row.findings)}</td>
        <td class="num">${String(row.readable)}</td>
        <td class="num">${String(row.dropped)}</td>
        <td class="bar"><span style="width:${String((row.postedBefore / width) * 100)}%"></span><b>${String(row.postedBefore)}</b></td>
        <td class="bar after"><span style="width:${String((row.postedAfter / width) * 100)}%"></span><b>${String(row.postedAfter)}</b></td>
        <td class="num">${String(row.goldensBefore)} → ${String(row.goldensAfter)}</td>
        <td class="${lost > 0 ? 'lost' : 'dim'}">${lost === 0 ? '—' : `−${String(lost)}`}</td>
        <td><span class="state ${state}">${state}</span>${row.withheld === null ? '' : ` <code>${escape(row.withheld)}</code>`}</td>
      </tr>`;
  });

  const reasons = report.gate.byReason.map(
    (bucket) =>
      `      <tr><td class="num">${String(bucket.count)}</td><td>${escape(bucket.reason)}</td></tr>`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — code-analyzer</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --ink:#e7ecf3; --dim:#98a2b3;
          --good:#4ade80; --warn:#f59e0b; --bad:#f87171; --accent:#60a5fa; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif; }
  header { padding:28px 32px 18px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 6px; font-size:20px; letter-spacing:.2px; }
  .lede { color:var(--dim); max-width:82ch; margin:0; }
  .tiles { display:flex; flex-wrap:wrap; gap:10px; margin:18px 0 0; padding:0; list-style:none; }
  .tiles li { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 14px; min-width:132px; }
  .tiles b { display:block; font-size:20px; font-variant-numeric:tabular-nums; }
  .tiles span { color:var(--dim); font-size:12px; }
  .tiles i { display:block; color:var(--dim); font-size:11.5px; font-style:normal; margin-top:2px; }
  nav { display:flex; flex-wrap:wrap; gap:8px; padding:14px 32px; border-bottom:1px solid var(--line);
        position:sticky; top:0; background:var(--bg); z-index:2; }
  nav button { background:var(--panel); color:var(--ink); border:1px solid var(--line); border-radius:999px;
               padding:6px 13px; font:inherit; cursor:pointer; }
  nav button[aria-pressed="true"] { border-color:var(--ink); background:#222835; }
  main { padding:8px 32px 56px; }
  h2 { font-size:15px; margin:28px 0 10px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line);
          border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:8px 11px; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:var(--dim); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  td.num { font-variant-numeric:tabular-nums; width:64px; }
  td.pr a { color:var(--accent); text-decoration:none; }
  td.pr a:hover { text-decoration:underline; }
  td.bar { position:relative; width:120px; font-variant-numeric:tabular-nums; font-size:12px; }
  td.bar span { position:absolute; left:0; top:4px; bottom:4px; background:#2b3444; border-radius:4px; z-index:0; }
  td.bar.after span { background:color-mix(in srgb, var(--accent) 32%, transparent); }
  /* **The number sits on top of the bar rather than after it**, because a full-width bar pushes an outside label into the
     next column and the row then reads as one value too many. */
  td.bar b { position:relative; z-index:1; padding-left:7px; font-weight:500; }
  td.lost { color:var(--bad); font-variant-numeric:tabular-nums; }
  td.dim { color:var(--dim); }
  .state { font-size:11px; border-radius:999px; padding:2px 9px; border:1px solid; }
  .state.applied { color:var(--good); border-color:color-mix(in srgb, var(--good) 45%, transparent); }
  .state.withheld { color:var(--warn); border-color:color-mix(in srgb, var(--warn) 45%, transparent); }
  code { font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; color:#cbd5e1; }
  tr[hidden] { display:none; }
  footer { color:var(--dim); font-size:12px; padding:0 32px 40px; }
</style>
</head>
<body>
<header>
  <h1>${escape(title)}</h1>
  <p class="lede">The grounding gate priced on a run that was already paid for: the artifact's own verdict matrix, the files
  at the head commit it named, and the shipped cut applied before and after the gate. <b>Posted</b> is what a reader would
  have seen; <b>goldens</b> is what the corpus paid for. A pull request whose gate was <b>withheld</b> is one the replay
  could not read in full — <code>decideGrounding</code> keeps every finding it could not check, so nothing was deleted
  there.</p>
  <ul class="tiles">
${tiles.map(([label, value, note]) => `    <li><b>${escape(value)}</b><span>${escape(label)}</span><i>${escape(note)}</i></li>`).join('\n')}
  </ul>
</header>
<nav>
  <button data-filter="all" aria-pressed="true">All ${String(rows.length)}</button>
  <button data-filter="changed" aria-pressed="false">Moved</button>
  <button data-filter="applied" aria-pressed="false">Applied</button>
  <button data-filter="withheld" aria-pressed="false">Withheld</button>
  <button data-filter="lost" aria-pressed="false">Lost a golden</button>
</nav>
<main>
  <h2>The two points, under the cut <code>${escape(report.cut.label)}</code></h2>
  <table>
    <thead><tr><th>rule</th><th>posted</th><th>true</th><th>precision</th><th>recall</th><th>F1</th><th>reproduced</th></tr></thead>
    <tbody>
      <tr><td>as published</td><td class="num">${String(baseline.emitted)}</td><td class="num">${String(baseline.truePositives)}</td>
          <td class="num">${fixed4(baseline.precision)}</td><td class="num">${fixed4(baseline.recall)}</td>
          <td class="num">${fixed4(baseline.f1)}</td><td class="dim">${report.reproduced === null ? 'not asked' : String(report.reproduced)}</td></tr>
      <tr><td>+ grounding gate</td><td class="num">${String(gated.emitted)}</td><td class="num">${String(gated.truePositives)}</td>
          <td class="num">${fixed4(gated.precision)}</td><td class="num">${fixed4(gated.recall)}</td>
          <td class="num">${fixed4(gated.f1)}</td><td class="dim">—</td></tr>
    </tbody>
  </table>

  <h2>Why findings were dropped</h2>
  <table>
    <thead><tr><th>count</th><th>reason the judge gave</th></tr></thead>
    <tbody>
${reasons.join('\n')}
${reasons.length === 0 ? '      <tr><td class="num">0</td><td class="dim">nothing was dropped</td></tr>' : ''}
    </tbody>
  </table>

  <h2>Where the gate acted, pull request by pull request</h2>
  <table>
    <thead><tr><th>pull request</th><th>findings</th><th>readable</th><th>dropped</th><th>posted before</th>
      <th>posted after</th><th>goldens</th><th>lost</th><th>decision</th></tr></thead>
    <tbody>
${rowHtml.join('\n')}
    </tbody>
  </table>
</main>
<footer>Rendered by <code>scripts/gate-replay.mjs --html</code>. Every figure is recomputed from the artifact and the
pinned revisions recorded beside it; no model was called to produce this page.</footer>
<script>
  const rows = [...document.querySelectorAll('tbody tr[data-state]')];
  const buttons = [...document.querySelectorAll('nav button')];
  const show = (filter) => {
    for (const row of rows) {
      const lost = row.querySelector('td.lost') !== null;
      const keep =
        filter === 'all' ||
        (filter === 'changed' && row.dataset.changed === 'true') ||
        (filter === 'applied' && row.dataset.state === 'applied') ||
        (filter === 'withheld' && row.dataset.state === 'withheld') ||
        (filter === 'lost' && lost);
      row.hidden = !keep;
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  };
  for (const button of buttons) button.addEventListener('click', () => show(button.dataset.filter));
</script>
</body>
</html>
`;
}
