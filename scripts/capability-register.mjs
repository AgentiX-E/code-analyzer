#!/usr/bin/env node
/**
 * Render `docs/CAPABILITY-REGISTER.md` as one self-contained page.
 *
 * **Why the register needs a page and not only a table.** The register is forty rows with four axes each - who ships it,
 * what proves it, whether it is done - and a Markdown table can be read but not interrogated: *which capabilities have no
 * end-to-end case* is the question that decides what the next iteration builds, and it is a click rather than a scan.
 *
 * **Self-contained by rule, not by convenience.** No `script src`, no `link href`, no `fetch`: the page is an artefact
 * that survives being emailed, opened from a file system, or attached to a review. `docs/UNIFIED-INDEX-DESIGN.md` states
 * the same rule for the report the product produces, and a documentation page that broke it would be the first
 * counter-example in the repository.
 *
 * **Deterministic.** No clock, no run id, no ordering that depends on a `Map`: the same register produces byte-identical
 * output, so a diff of two builds shows what changed in the register and nothing else.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'docs', 'CAPABILITY-REGISTER.md');
const TARGET = join(ROOT, 'docs', 'capability-register.html');

/** One row of the register, with the columns it actually has. */
export function parseRows(markdown) {
  const rows = [];
  let section = '';
  for (const raw of markdown.split('\n')) {
    const heading = /^## (?:\d+\. )?(.+)$/.exec(raw);
    if (heading !== null) {
      section = heading[1].replace(/^As an? /, '').trim();
      continue;
    }
    // **Padded by the formatter, so the separator is `\s*` rather than a single space**: prettier aligns the
    // columns, and a renderer that only understood its own spacing would emit an empty page after one `format` run.
    if (!/^\|\s*\d+\s*\|/.test(raw)) continue;
    const cells = raw
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length !== 7) continue;
    const [id, capability, surface, who, unit, e2e, status] = cells;
    rows.push({ id, capability, surface, who, unit, e2e, status, section });
  }
  return rows;
}

/** Strip the Markdown emphasis the register uses for emphasis, so a cell renders as text rather than as asterisks. */
export const plain = (text) => text.replace(/\*\*/g, '').replace(/`/g, '');

/** Which of `O`, `C`, `P` a row is, read the way the register's own rule reads it. */
export function provenance(who) {
  if (/\bO\b/.test(who)) return 'O';
  if (/\bC\b/.test(who)) return 'C';
  return 'P';
}

/** `DONE`, `PART` or `NONE`, from the status cell's first word. */
export function state(status) {
  const match = /\b(DONE|PART|NONE)\b/.exec(status);
  return match === null ? 'PART' : match[1];
}

const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function count(rows) {
  const tally = {
    total: rows.length,
    DONE: 0,
    PART: 0,
    NONE: 0,
    O: 0,
    C: 0,
    P: 0,
    e2e: 0,
    unit: 0,
  };
  for (const row of rows) {
    tally[state(row.status)] += 1;
    tally[provenance(row.who)] += 1;
    if (row.e2e !== '—') tally.e2e += 1;
    if (row.unit !== '—') tally.unit += 1;
  }
  return tally;
}

const LABEL = { O: 'ours only', C: 'competitor only', P: 'public' };

export function page(rows) {
  const tally = count(rows);
  const sections = [...new Set(rows.map((row) => row.section))];
  const filters = [
    ['all', 'All', rows.length],
    ['NONE', 'Not built', tally.NONE],
    ['PART', 'Partial', tally.PART],
    ['DONE', 'Done', tally.DONE],
    ['C', 'Competitor only', tally.C],
    ['no-e2e', 'No end-to-end case', tally.total - tally.e2e],
  ];
  const body = sections
    .map((section) => {
      const own = rows.filter((row) => row.section === section);
      const lines = own.map(
        (
          row,
        ) => `      <tr data-state="${state(row.status)}" data-who="${provenance(row.who)}" data-e2e="${row.e2e !== '—'}">
        <td class="id">${escape(row.id)}</td>
        <td class="cap">${escape(plain(row.capability))}<span class="surface">${escape(plain(row.surface))}</span></td>
        <td><span class="tag ${provenance(row.who)}">${LABEL[provenance(row.who)]}</span></td>
        <td class="proof">${row.unit === '—' ? '<span class="none">no unit case</span>' : `<code>${escape(plain(row.unit))}</code>`}</td>
        <td class="proof">${row.e2e === '—' ? '<span class="none">no end-to-end case</span>' : `<code>${escape(plain(row.e2e))}</code>`}</td>
        <td><span class="state ${state(row.status)}">${state(row.status)}</span></td>
        <td class="why">${escape(plain(row.status))}</td>
      </tr>`,
      );
      return `  <section>
    <h2>${escape(section)}<span class="count">${own.length}</span></h2>
    <table>
      <thead><tr><th>#</th><th>Capability</th><th>Ships at</th><th>Unit</th><th>End-to-end</th><th>State</th><th>What the state means</th></tr></thead>
      <tbody>
${lines.join('\n')}
      </tbody>
    </table>
  </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Capability register — code-analyzer</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --line: #262b36; --ink: #e7ecf3; --dim: #98a2b3;
    --ours: #4ade80; --public: #60a5fa; --comp: #f59e0b; --done: #4ade80; --part: #f59e0b; --none: #f87171;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
         font: 14px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
  header { padding: 28px 32px 18px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: .2px; }
  .lede { color: var(--dim); max-width: 78ch; margin: 0; }
  .tiles { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 0; padding: 0; list-style: none; }
  .tiles li { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; min-width: 118px; }
  .tiles b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
  .tiles span { color: var(--dim); font-size: 12px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 32px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 2; }
  nav button { background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 999px;
                padding: 6px 13px; font: inherit; cursor: pointer; }
  nav button[aria-pressed="true"] { border-color: var(--ink); background: #222835; }
  nav input { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; color: var(--ink);
              padding: 6px 13px; font: inherit; min-width: 220px; }
  main { padding: 8px 32px 56px; }
  h2 { font-size: 15px; margin: 30px 0 10px; display: flex; align-items: center; gap: 10px; }
  h2 .count { color: var(--dim); font-weight: 400; font-size: 12px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--dim); font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  td.id { color: var(--dim); font-variant-numeric: tabular-nums; width: 44px; }
  td.cap { max-width: 46ch; }
  .surface { display: block; color: var(--dim); font-size: 11.5px; margin-top: 2px; }
  .tag, .state { font-size: 11px; border-radius: 999px; padding: 2px 9px; border: 1px solid; white-space: nowrap; }
  .tag.O { color: var(--ours); border-color: color-mix(in srgb, var(--ours) 45%, transparent); }
  .tag.P { color: var(--public); border-color: color-mix(in srgb, var(--public) 45%, transparent); }
  .tag.C { color: var(--comp); border-color: color-mix(in srgb, var(--comp) 45%, transparent); }
  .state.DONE { color: var(--done); border-color: color-mix(in srgb, var(--done) 45%, transparent); }
  .state.PART { color: var(--part); border-color: color-mix(in srgb, var(--part) 45%, transparent); }
  .state.NONE { color: var(--none); border-color: color-mix(in srgb, var(--none) 45%, transparent); }
  code { font: 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; }
  .none { color: var(--none); font-size: 11.5px; }
  td.why { color: var(--dim); font-size: 12.5px; max-width: 40ch; }
  tr[hidden] { display: none; }
  footer { color: var(--dim); font-size: 12px; padding: 0 32px 40px; }
</style>
</head>
<body>
<header>
  <h1>Capability register</h1>
  <p class="lede">Every capability, grouped by the person who needs it. <b>Ships at</b> says whether a named competitor
  has it, this repository has it alone, or everyone does. <b>End-to-end</b> names the case that drives the public entry
  point — a row without one is not accepted, whatever its unit coverage, because the last three defects here were joins
  between components that each passed their own tests.</p>
  <ul class="tiles">
    <li><b>${tally.total}</b><span>capabilities</span></li>
    <li><b>${tally.DONE}</b><span>done</span></li>
    <li><b>${tally.PART}</b><span>partial</span></li>
    <li><b>${tally.NONE}</b><span>not built</span></li>
    <li><b>${tally.e2e}</b><span>with an end-to-end case</span></li>
    <li><b>${tally.O}</b><span>ours only</span></li>
    <li><b>${tally.C}</b><span>competitor only</span></li>
  </ul>
</header>
<nav>
  ${filters
    .map(
      ([key, label, n]) =>
        `<button data-filter="${key}" aria-pressed="${key === 'all'}">${label} <span style="opacity:.6">${n}</span></button>`,
    )
    .join('\n  ')}
  <input id="q" type="search" placeholder="filter by capability, file or surface" aria-label="filter">
</nav>
<main>
${body}
</main>
<footer>Rendered from <code>docs/CAPABILITY-REGISTER.md</code> by <code>scripts/capability-register.mjs</code>. No external
resource is referenced, so the page opens from a file system with no network.</footer>
<script>
  const rows = () => [...document.querySelectorAll('tbody tr')];
  const buttons = [...document.querySelectorAll('nav button')];
  let active = 'all';
  let query = '';
  function apply() {
    for (const row of rows()) {
      const stateOk =
        active === 'all' ||
        (active === 'no-e2e' ? row.dataset.e2e === 'false' : row.dataset.state === active || row.dataset.who === active);
      const textOk = query === '' || row.textContent.toLowerCase().includes(query);
      row.hidden = !(stateOk && textOk);
    }
    for (const section of document.querySelectorAll('section')) {
      const visible = [...section.querySelectorAll('tbody tr')].filter((row) => !row.hidden).length;
      section.hidden = visible === 0;
      section.querySelector('.count').textContent = String(visible);
    }
  }
  for (const button of buttons) {
    button.addEventListener('click', () => {
      active = button.dataset.filter;
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      apply();
    });
  }
  document.getElementById('q').addEventListener('input', (event) => {
    query = event.target.value.trim().toLowerCase();
    apply();
  });
</script>
</body>
</html>
`;
}

/** Read the register, render it, write it - and **refuse to write a page with no rows**, because an empty page looks
 * exactly like a register with nothing in it rather than like a renderer that stopped understanding its input. */
export function render(source = SOURCE, target = TARGET) {
  const rows = parseRows(readFileSync(source, 'utf8'));
  if (rows.length === 0) {
    throw new Error(
      'no register rows parsed; the table format changed and this renderer would emit an empty page',
    );
  }
  const html = page(rows);
  writeFileSync(target, html);
  return { rows: rows.length, bytes: html.length };
}

/**
 * **The command, as a function of its arguments**, so the success path and the failure path are both reachable by a test
 * rather than only by a person typing.
 *
 * `renderPage` is a parameter because **the interesting failure is the one this file cannot produce itself**: a renderer
 * that throws a string instead of an `Error` used to reach the console as `[object Object]`, and a branch that only runs
 * after a bug is a branch that never runs.
 */
export function main(argv, renderPage = render, log = console) {
  try {
    const { rows, bytes } = renderPage(argv[2], argv[3]);
    const written = (argv[3] ?? TARGET).replace(`${ROOT}/`, '');
    log.log(`wrote ${written} (${rows} capabilities, ${bytes} bytes)`);
    return 0;
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// **Guarded**, so importing this module to measure its functions does not also write a file. `String` rather than a
// null check: `pathToFileURL` needs a string, and `String(undefined)` is a path that matches nothing - which is the
// right answer for a process that was not started here, and one branch instead of two.
if (pathToFileURL(String(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv);
}
