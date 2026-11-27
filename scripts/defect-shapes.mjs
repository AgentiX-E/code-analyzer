/**
 * **Reproduce the four-shape table on a pinned artifact, from the corpus's own categories.**
 *
 * ```sh
 * node scripts/defect-shapes.mjs \
 *   --artifact benchmarks/aacr-bench-pinned-50.json \
 *   --corpus /tmp/aacr-bench/dataset/v1/positive_samples.json \
 *   --json benchmarks/defect-shapes-pinned-50.json
 * ```
 *
 * The corpus is a required input: a shape is a property of a golden the corpus has categorised, and a keyword read of
 * a note without that join is what put 243 non-`Code Defect` goldens into §178.3's "209 Code Defect" table. Both
 * inputs are read from disk and the partition is checked before it is printed, so a reader comparing two runs is
 * comparing the same ruler.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyDefectShapes, describeDefectShapes } from './lib/defect-shapes.mjs';

function parseArgs(argv) {
  const options = { artifact: null, corpus: null, json: null, html: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--artifact') options.artifact = argv[(i += 1)];
    else if (arg === '--corpus') options.corpus = argv[(i += 1)];
    else if (arg === '--json') options.json = argv[(i += 1)];
    else if (arg === '--html') options.html = argv[(i += 1)];
  }
  return options;
}

/** A self-contained page - no script, no network - drawn only from the partition just computed. */
function renderHtml(payload, title) {
  const escape = (value) =>
    String(value).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const cd = payload.codeDefect;
  const max = Math.max(1, ...Object.values(cd.shapes).map((c) => c.hit + c.miss));
  const bars = Object.entries(cd.shapes)
    .map(([name, cell]) => {
      const width = Math.round(((cell.hit + cell.miss) / max) * 100);
      const missPct = Math.round(cell.rate * 100);
      return `<tr><td>${escape(name)}</td><td>${cell.hit}</td><td>${cell.miss}</td><td>${missPct}%</td><td><div class="bar"><span class="hit" style="width:${Math.round((cell.hit / (cell.hit + cell.miss || 1)) * width)}%"></span><span class="miss" style="width:${Math.round((cell.miss / (cell.hit + cell.miss || 1)) * width)}%"></span></div></td></tr>`;
    })
    .join('\n');
  const contamPct = Math.round((payload.contamination / (payload.allRecords || 1)) * 100);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font:14px system-ui;margin:2rem;color:#222;max-width:900px}h1{font-size:1.4rem}.sub{color:#666}
table{border-collapse:collapse;width:100%;margin-top:1rem}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}
.bar{background:#eee;height:14px;min-width:120px;display:inline-flex}.hit{background:#4a7}.miss{background:#d55}
.alert{background:#fff4e5;border-left:4px solid #e80;padding:10px 14px;margin:1rem 0}
.legend small{color:#666}</style>
<h1>${escape(title)}</h1><div class="sub">Source: ${escape(payload.artifact)} · ${escape(payload.corpus)}</div>
<div class="alert"><strong>${payload.contamination} of ${payload.allRecords} missed-golden records (${contamPct}%) are not <code>Code Defect</code>.</strong> The §178.3 table counted them as defect shapes because it classified notes before joining the corpus's own category.</div>
<p><strong>${cd.total}</strong> Code Defect goldens · <strong>${cd.rejected}</strong> rejected on a path we commented on · reconciled <strong>${cd.reconciled}</strong></p>
<table><thead><tr><th>shape</th><th>hit</th><th>miss</th><th>miss rate</th><th></th></tr></thead><tbody>${bars}</tbody></table>
<p class="legend"><small>green = hit · red = miss · width = shape size. A note matching more than one shape is counted in each (${cd.multi}); a note matching none (${cd.none}) is left unclassified. Generated from the record; no arithmetic in the renderer.</small></p>
</html>`;
}

const options = parseArgs(process.argv.slice(2));
if (options.artifact === null || options.corpus === null) {
  process.stderr.write(
    'usage: defect-shapes.mjs --artifact <artifact.json> --corpus <positive_samples.json> [--json <out.json>]\n' +
      'both inputs are required: the missed goldens are in the artifact and their categories are in the corpus.\n',
  );
  process.exit(2);
}

const artifact = JSON.parse(readFileSync(options.artifact, 'utf8'));
const corpus = JSON.parse(readFileSync(options.corpus, 'utf8'));
const result = classifyDefectShapes({ artifact, corpus });

if (!result.codeDefect.reconciled) {
  process.stderr.write(
    `defect-shapes: ${String(result.codeDefect.total)} Code Defect goldens did not add up; refusing to publish\n`,
  );
  process.exit(2);
}

const payload = {
  measuredAt: new Date().toISOString(),
  artifact: options.artifact,
  corpus: options.corpus,
  ...result,
  description: describeDefectShapes(result),
};
if (options.json !== null) writeFileSync(options.json, `${JSON.stringify(payload, null, 2)}\n`);
if (options.html !== null) {
  writeFileSync(
    options.html,
    renderHtml(payload, 'Defect shapes: a golden category, not a note guess'),
  );
}
process.stdout.write(`${payload.description}\n`);
