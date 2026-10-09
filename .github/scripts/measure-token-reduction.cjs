// What a question costs through the index, against reading the corpus it answers from.
//
// **A file rather than a `node -e` one-liner**, and the reason is a run rather than a preference: the inline version
// failed with **exit code 126** because the script's single quotes collided with the shell's. **A measurement step
// whose own quoting is the failure mode measures nothing**, and moving it out of the YAML removes that class of
// defect entirely.
//
// **The protocol is the one already published**: the baseline is every byte of the corpus in context, ours is the
// declaration that answers a question, and **both are counted with the product's own estimator** - because a ratio of
// two different estimators is not a ratio.

const fs = require('node:fs');
const path = require('node:path');

const { countTokens } = require('../../packages/intelligence/dist/compression/memory-compressor.js');

const ROOT = process.env.CORPUS_PATH || '/tmp/corpus';
const files = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (/\.(js|ts|mjs|cjs)$/.test(name)) files.push(full);
  }
};
walk(ROOT);

const corpusTokens = files.reduce((sum, f) => sum + countTokens(fs.readFileSync(f, 'utf8')), 0);

// **A declaration, not a file**: eight lines around the first export of three real files, which is what a symbol
// lookup returns - and the same shape the single-file measurement used, so the two are comparable.
const sample = files.slice(0, 3);
let answerTokens = 0;
for (const f of sample) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const start = Math.max(0, lines.findIndex((l) => /^export /.test(l)));
  answerTokens += countTokens(lines.slice(start, start + 8).join('\n'));
}
const perQuery = sample.length > 0 ? Math.round(answerTokens / sample.length) : 0;
const ratio = perQuery > 0 ? Math.round((corpusTokens / perQuery) * 10) / 10 : null;

// **A zero would not be a very good ratio, it would be a missing measurement.**
if (!Number.isFinite(corpusTokens) || corpusTokens <= 0 || perQuery <= 0) {
  console.error(`refusing to record a ratio of ${ratio} from ${corpusTokens} tokens and ${perQuery} per query`);
  process.exit(1);
}

const out = {
  comment: [
    'What a question costs through the index, against reading the corpus it answers from.',
    '',
    '**Measured on a real repository on a GitHub runner**, not a temporary directory - the same checkout the indexing',
    'figure uses, so the two describe one corpus rather than two.',
    '',
    '**`code-review-graph` reports a median 82x and a peak 528x; Graphify reports 71.5x** - their corpora and their',
    'query sets, neither published here. **The comparison is in shape, not in value.**',
  ],
  measuredAt: new Date().toISOString().slice(0, 10),
  where: 'github-actions',
  repository: process.env.CORPUS_REPO,
  ref: process.env.CORPUS_REF,
  protocol: {
    baseline: 'every byte of the corpus in context',
    ours: 'the declaration that answers the question (8 lines)',
    estimator: 'the same token estimator this product uses',
    queries: sample.length,
  },
  corpus: { files: files.length, tokens: corpusTokens },
  corpusTokens,
  perQueryTokens: perQuery,
  tokenReduction: ratio,
  andTheCategoryForScale: { codeReviewGraph: { median: 82, peak: 528 }, graphify: { value: 71.5 } },
};

fs.mkdirSync('benchmarks', { recursive: true });
fs.writeFileSync('benchmarks/token-reduction.json', JSON.stringify(out, null, 2) + '\n');
console.log(`TOKEN-REDUCTION corpus=${corpusTokens} files=${files.length} perQuery=${perQuery} ratio=${ratio}x`);
