#!/usr/bin/env node
// @code-analyzer — the two-arm picture, drawn from the artifacts rather than from a document
//
// **What this page is for.** Every report this repository publishes says *"the competitor used our model"*, and until
// the artifacts carried the competitor's model on the row itself, that was a claim rather than a field. §151 records the
// competitor's `model` and `endpoint` beside its score, so this figure can print **the pair** - two reviewers, one model,
// one judge, one set of goldens - and let a reader check the claim instead of trusting it.
//
// **And it refuses to draw what it cannot source.** A board whose competitor arm never produced a row is drawn as
// `NOT_MEASURED` with the artifact's own reason, because a card at 0.0000 would read as a competitor that scored nothing,
// which is a different and false statement.
//
//     node scripts/competitor-board.mjs                        # write json + html
//     node scripts/competitor-board.mjs --check                # re-derive and fail if either moved

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACTS = {
  aacr: join(ROOT, 'benchmarks', 'aacr-bench.json'),
  martian: join(ROOT, 'benchmarks', 'martian-bench.json'),
  core: join(ROOT, 'benchmarks', 'martian-profile.json'),
};
const JSON_OUT = join(ROOT, 'benchmarks', 'competitor-board.json');
const HTML_OUT = join(ROOT, 'docs', 'competitor-board.html');

const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const round = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(4)) : null;

/** The denominator a row was divided by, which is part of the row (§147.4). */
const goldensOf = (artifact) =>
  Number(artifact?.['truePositives'] ?? 0) + Number(artifact?.['falseNegatives'] ?? 0) || null;

function armOf(artifact, { competitor }) {
  const figure = competitor ? (artifact?.['secondReviewer'] ?? {}) : artifact;
  if (artifact === null) return null;
  if (competitor && figure['mode'] === 'off') {
    return {
      arm: 'competitor',
      measured: false,
      reason: String(
        figure['notComparableReason'] ?? figure['modeReason'] ?? 'the arm produced no row',
      ),
      tool: String(figure['tool'] ?? 'open-code-review'),
      model: null,
    };
  }
  return {
    arm: competitor ? 'competitor' : 'ours',
    measured: figure['precision'] !== undefined,
    tool: competitor ? String(figure['tool'] ?? 'open-code-review') : 'agentix-e',
    // **The model is read from the row and never inferred from the run's environment**: an artifact that did not record
    // it cannot support the sentence this page exists to draw.
    // **Our arm's model is recorded on the run, not on the row.** `configuration.provider` names the family the lanes
    // ran on; if the artifact predates that field the cell says NOT_RECORDED rather than borrowing the judge's model,
    // because the judge's model and the reviewer's model are two facts and only one of them was ever the same call.
    model: competitor ? (figure['model'] ?? null) : (artifact?.['configuration']?.provider ?? null),
    endpoint: competitor ? (figure['endpoint'] ?? null) : null,
    precision: round(figure['precision']),
    recall: round(figure['recall']),
    f1: round(figure['f1']),
    comments: figure['findings'] ?? null,
    mode: figure['mode'] ?? null,
    // **A figure over a smaller corpus is a figure, and it is not this board's figure.** Hiding it would lose a
    // measurement; printing it beside ours without the sentence would invent a comparison. Both are wrong, so the
    // number travels with its own caveat and the card leads with it.
    caveat:
      competitor && figure['comparable'] === false
        ? String(figure['notComparableReason'] ?? 'the artifact does not call this row comparable')
        : null,
  };
}

function board(name, artifact, { goldens, core = null }) {
  if (artifact === null) return null;
  const ours = armOf(artifact, { competitor: false });
  const competitor = armOf(artifact, { competitor: true });
  const judge = artifact['judge']?.model ?? artifact['judge'] ?? null;
  return {
    board: name,
    corpus: String(artifact['corpus'] ?? ''),
    measuredAt: String(artifact['measuredAt'] ?? ''),
    judge: typeof judge === 'string' ? judge : null,
    route: String(artifact['route'] ?? ''),
    goldens: goldens ?? goldensOf(artifact),
    coreGoldens: core?.readings?.core?.goldens ?? null,
    dedupThreshold: artifact['dedupThreshold'] ?? null,
    arms: [ours, competitor].filter(Boolean),
    core: core?.readings?.core?.shipped
      ? {
          goldens: core.readings.core.goldens,
          precision: round(core.readings.core.shipped.precision),
          recall: round(core.readings.core.shipped.recall),
          f1: round(core.readings.core.shipped.f1),
        }
      : null,
  };
}

function build() {
  const aacr = read(ARTIFACTS.aacr);
  const martian = read(ARTIFACTS.martian);
  const core = read(ARTIFACTS.core);
  const boards = [
    board('AACR-Bench', aacr, { goldens: goldensOf(aacr) }),
    board('Martian (code-review-benchmark)', martian, {
      goldens: 173,
      core: martian === null ? null : core,
    }),
  ].filter(Boolean);
  if (boards.length === 0) {
    process.stderr.write(
      'competitor-board: no artifact carries two arms, so there is nothing to draw\n',
    );
    process.exit(2);
  }
  return {
    comment: [
      'Two reviewers, one model, one judge, one set of goldens - the comparison each report claims, drawn from the',
      'artifacts that produced it. A row that did not record its model prints as NOT_RECORDED rather than as a gap',
      'in the drawing, and an arm that produced no row prints its own reason rather than a zero.',
    ],
    generatedFrom: Object.entries(ARTIFACTS)
      .filter(([, path]) => existsSync(path))
      .map(([name, path]) => ({ name, path: path.slice(ROOT.length + 1) })),
    boards,
  };
}

const escape = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pct = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(2)} %` : '—';

function bar(arm, width = 320) {
  if (!arm.measured) return '<span class="nope">NOT_MEASURED</span>';
  const f1 = arm.f1 ?? 0;
  const filled = Math.max(2, Math.round(f1 * width));
  return (
    `<span class="bar" style="width:${String(width)}px">` +
    `<span class="fill" style="width:${String(filled)}px"></span>` +
    `<b>${escape(pct(f1))}</b></span>`
  );
}

function armCard(arm) {
  if (!arm.measured) {
    return `<div class="card dead"><h3>competitor · ${escape(arm.tool)}</h3>
      <p class="nope">NOT_MEASURED</p>
      <p class="why">${escape(arm.reason)}</p></div>`;
  }
  const model = arm.model === null ? '<span class="nope">NOT_RECORDED</span>' : escape(arm.model);
  return `<div class="card${arm.arm === 'ours' ? ' ours' : ''}"><h3>${escape(arm.arm)} · ${escape(arm.tool)}</h3>
    ${arm.caveat === null ? '' : `<p class="caveat">not comparable as recorded: ${escape(arm.caveat)}</p>`}
    <dl><dt>model</dt><dd>${model}</dd>
    <dt>precision</dt><dd>${escape(pct(arm.precision))}</dd>
    <dt>recall</dt><dd>${escape(pct(arm.recall))}</dd>
    <dt>comments</dt><dd>${escape(arm.comments ?? '—')}</dd></dl>
    <p class="f1">${bar(arm)}</p></div>`;
}

function render(data) {
  const cards = data.boards
    .map((b) => {
      const core = b.core
        ? `<p class="core">On the board's own <b>core</b> denominator (${String(b.core.goldens)} goldens): ours
           ${escape(pct(b.core.f1))} (P ${escape(pct(b.core.precision))} · R ${escape(pct(b.core.recall))}).</p>`
        : '';
      return `<section class="board"><h2>${escape(b.board)}</h2>
        <p class="meta">${escape(b.corpus)} · judge <b>${escape(b.judge ?? 'not recorded')}</b> ·
        ${String(b.goldens ?? '—')} goldens · dedup ${escape(b.dedupThreshold ?? '—')} ·
        measured ${escape(b.measuredAt)}</p>
        <div class="pair">${b.arms.map(armCard).join('')}</div>${core}
        <p class="route">route: ${escape(b.route || 'not recorded')}</p></section>`;
    })
    .join('');
  const table = data.boards
    .map(
      (b) =>
        `<tr><td>${escape(b.board)}</td>` +
        b.arms
          .map(
            (a) =>
              `<td>${escape(a.arm)}</td><td>${escape(a.tool)}</td>` +
              `<td>${a.measured ? escape(a.model ?? 'NOT_RECORDED') : '—'}</td>` +
              `<td>${escape(pct(a.precision))}</td><td>${escape(pct(a.recall))}</td>` +
              `<td><b>${a.measured ? escape(pct(a.f1)) : 'NOT_MEASURED'}</b></td>`,
          )
          .join('') +
        '</tr>',
    )
    .join('');
  const rowsPerBoard = Math.max(...data.boards.map((b) => b.arms.length));
  const head = (label) =>
    Array.from(
      { length: rowsPerBoard },
      () =>
        `<th>${label} arm</th><th>${label} tool</th><th>${label} model</th><th>P</th><th>R</th><th>F1</th>`,
    ).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Two reviewers, one model — the pair each report claims</title>
<style>
  :root{--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--bad:#b42318;--ours:#0a3069;--fill:#2da44e;--bg:#fff}
  *{box-sizing:border-box}
  body{margin:0;padding:32px 28px 48px;background:var(--bg);color:var(--fg);
       font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
  h1{font-size:22px;margin:0 0 6px} h2{font-size:16px;margin:22px 0 4px}
  .lead{color:var(--muted);max-width:92ch;margin:0 0 18px}
  .board{border-top:1px solid var(--line);padding-top:6px}
  .meta,.route{color:var(--muted);font-size:12px;margin:2px 0 8px}
  .pair{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0}
  .card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:240px;flex:1 1 240px}
  .card.ours{border-color:var(--ours)} .card.dead{background:#fff8f7;border-color:#ffd7d5}
  .card h3{margin:0 0 8px;font-size:13px;letter-spacing:.02em;text-transform:lowercase}
  dl{display:grid;grid-template-columns:88px 1fr;gap:2px 8px;margin:0 0 8px}
  dt{color:var(--muted);font-size:12px} dd{margin:0;font-variant-numeric:tabular-nums}
  .f1{margin:0}
  .bar{position:relative;display:inline-block;height:16px;background:#eef2f5;border-radius:8px;vertical-align:middle}
  .bar .fill{position:absolute;left:0;top:0;bottom:0;background:var(--fill);border-radius:8px}
  .bar b{position:relative;z-index:1;font-size:11px;line-height:16px;padding-left:6px}
  .nope{color:var(--bad);font-weight:700;font-size:12px;letter-spacing:.03em}
  .why{color:var(--muted);font-size:12px;margin:4px 0 0}
  .caveat{color:#7d4e00;background:#fff8c5;border:1px solid #eac54f;border-radius:6px;padding:6px 8px;font-size:12px;margin:0 0 8px}
  .core{margin:6px 0;font-size:13px}
  table{border-collapse:collapse;margin:20px 0 8px;font-size:12px}
  th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;font-variant-numeric:tabular-nums}
  th{background:#f6f8fa;font-weight:600}
  footer{color:var(--muted);font-size:12px;max-width:92ch;border-top:1px solid var(--line);padding-top:12px;margin-top:8px}
  code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
</style></head>
<body>
<h1>Two reviewers, one model — the pair each report claims</h1>
<p class="lead">Each card is one arm of one board. <b>The model column is read from the artifact and never inferred</b>:
a row that did not record its model says <span class="nope">NOT_RECORDED</span>, and an arm that produced no row says
<span class="nope">NOT_MEASURED</span> with its own reason — because a zero would read as a competitor that scored nothing,
which is a different statement.</p>
${cards}
<table><thead><tr><th>board</th>${head('')}</tr></thead><tbody>${table}</tbody></table>
<footer>
<p><b>What the pair can and cannot say.</b> Two arms scored by one judge against one set of goldens is a comparison of two
reviewers. If the two rows do not carry the same model, it is also a comparison of two models and the reader is entitled to
know that before reading the ordering.</p>
<p><b>Resolution.</b> A paired difference on the AACR slice is resolvable at <b>0.0126 F1</b> (4.8 goldens, §147.3); a
difference smaller than that is not claimed, however true it is.</p>
<p>Generated by <code>node scripts/competitor-board.mjs</code> from
${data.generatedFrom.map((f) => `<code>${escape(f.path)}</code>`).join(', ')}. The generator calls no model and no network.</p>
</footer></body></html>
`;
}

const payload = build();
const html = render(payload);

if (process.argv.includes('--check')) {
  const previous = read(JSON_OUT);
  if (previous === null) {
    process.stderr.write('competitor-board --check: no committed figure to compare against\n');
    process.exit(1);
  }
  const a = JSON.stringify(previous.boards);
  const b = JSON.stringify(payload.boards);
  if (a !== b) {
    process.stderr.write(
      'competitor-board --check: the committed figure is not this recomputation\n',
    );
    process.exit(1);
  }
  process.stdout.write(`competitor-board --check ok · ${String(payload.boards.length)} boards\n`);
  process.exit(0);
}

mkdirSync(join(ROOT, 'benchmarks'), { recursive: true });
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(JSON_OUT, `${JSON.stringify(payload, null, 2)}\n`);
writeFileSync(HTML_OUT, html);
process.stdout.write(
  `competitor-board: ${String(payload.boards.length)} boards · ` +
    payload.boards
      .map(
        (b) =>
          `${b.board} ours ${pct(b.arms.find((a) => a.arm === 'ours')?.f1 ?? null)} vs ` +
          (b.arms.find((a) => a.arm === 'competitor')?.measured
            ? `theirs ${pct(b.arms.find((a) => a.arm === 'competitor')?.f1 ?? null)}`
            : 'NOT_MEASURED'),
      )
      .join(' · ') +
    '\n',
);
