/**
 * **The judge's bill is a product, so its batch arithmetic is exact before it is measured.**
 *
 * `judgeMatrix` calls the judge once per `(finding, golden)` pair. `buildJudgeMessages` is a pure function of the pair,
 * so **the length of every request the judge would receive is computable from an artifact and a corpus file, with no
 * model involved** - and the ratio between the per-pair prompt and the batched one is therefore a number rather than a
 * hope. §118 registers R-56 on that number: *four pairs per call costs at most 60 % of the per-pair prompt tokens*, and
 * this module says what the prompt ratio would be before one yuan is spent.
 *
 * **What it cannot compute, and says so.** The vendor counts tokens with its own vocabulary, and the cache decides what
 * a token costs. This module reports **characters**, which is proportional to tokens for one vocabulary over one corpus
 * and is not tokens; and it reports the **shared prefix's length against the vendor's cache block**, which is a
 * necessary condition for a prefix to be cached and not a sufficient one - §117 measured the judge at 13.5 % cache hits
 * on a prefix of about 178 tokens, which is the counter-example that keeps the block figure from being read as a
 * saving.
 */
import { buildJudgeMessages } from '../../.github/scripts/lib/judge-batch.mjs';

/** The vendor's prefix-cache block, in tokens, from `judge-batch.mjs`'s own comment and §110's reading. */
export const CACHE_BLOCK_TOKENS = 64;

/** The goldens of each pull request, note-filtered, in the order the artifact indexes them. */
function goldensByPullRequest(corpus) {
  const byPull = new Map();
  for (const pull of corpus) {
    const url = String(pull?.githubPrUrl ?? '');
    if (url.length === 0) continue;
    const comments = Array.isArray(pull?.comments) ? pull.comments : [];
    byPull.set(
      url,
      comments
        .filter((comment) => String(comment?.note ?? '') !== '')
        .map((comment) => String(comment?.note ?? '')),
    );
  }
  return byPull;
}

/** `count` items split into consecutive chunks of at most `size` - `chunkIndices`'s shape, without its import. */
function chunks(count, size) {
  const out = [];
  for (let at = 0; at < count; at += size) {
    const chunk = [];
    for (let index = at; index < Math.min(at + size, count); index += 1) chunk.push(index);
    out.push(chunk);
  }
  return out;
}

/**
 * **Every batch size's request count and characters, over the pairs the judge is actually asked.**
 *
 * The pairs are every `(finding, golden)` of each pull request - the same product `judgeMatrix` builds - because a
 * filter over them is a different device and is priced by `judge-pair-anatomy.mjs`.
 */
export function batchArithmetic(bench, corpus, sizes = [1, 2, 4, 8]) {
  const findings = Array.isArray(bench?.rankedFindings) ? bench.rankedFindings : [];
  const goldens = goldensByPullRequest(corpus);
  const textsByPull = new Map();
  for (const finding of findings) {
    const url = String(finding?.pr ?? '');
    const list = textsByPull.get(url) ?? [];
    list.push(String(finding?.text ?? ''));
    textsByPull.set(url, list);
  }

  let pairs = 0;
  let goldensSeen = 0;
  let systemCharacters = 0;
  const rows = sizes.map((size) => ({ size, calls: 0, characters: 0 }));

  for (const [url, texts] of textsByPull) {
    for (const golden of goldens.get(url) ?? []) {
      pairs += texts.length;
      goldensSeen += 1;
      // **Once per golden, not once per pair**: the prefix is what a golden contributes and it does not grow with the
      // number of comments behind it.
      systemCharacters += buildJudgeMessages(golden, ['']).system.length;
      for (const row of rows) {
        for (const chunk of chunks(texts.length, row.size)) {
          // **One construction per request**, so the two halves of the length cannot come from two opinions about what
          // a request contains.
          const { system, user } = buildJudgeMessages(
            golden,
            chunk.map((at) => texts[at]),
          );
          row.calls += 1;
          row.characters += system.length + user.length;
        }
      }
    }
  }

  const perPair = rows.find((row) => row.size === 1);
  return {
    findings: findings.length,
    pairs,
    goldens: goldensSeen,
    meanSystemCharacters: goldensSeen === 0 ? 0 : systemCharacters / goldensSeen,
    rows: rows.map((row) => ({
      ...row,
      charactersPerCall: row.calls === 0 ? 0 : row.characters / row.calls,
      callsRatio: perPair === undefined || perPair.calls === 0 ? null : row.calls / perPair.calls,
      charactersRatio:
        perPair === undefined || perPair.characters === 0
          ? null
          : row.characters / perPair.characters,
    })),
  };
}
