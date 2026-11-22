// **The corpus's question, asked the way the corpus asks it.**
//
// `Alibaba-Aone/aacr-bench/docs/metrics.md` replaced per-comment matching with `file-level-semantic-v1`: one judge call
// per generated comment, **every reference comment of that file in a numbered list**, and a verdict of the form *which
// of these does this comment cover*. `lib/file-semantic.mjs` already implements the arithmetic that consumes such a
// verdict - one-to-many coverage, a greedy precision walk, `hit_new_gt` - and the harness has been feeding it verdicts
// from a judge that was asked a different question.
//
// **The questions are not the same question, and the artifact says so in numbers.** Of 254 reference comments whose file
// the reviewer did comment on, 141 sat on the same line as a finding the reviewer had emitted, and the pairwise judge
// called all of them different defects. A judge shown the pair is asked *are these two statements the same defect*; a
// judge shown the file is asked *which of these does this comment cover*, and the second question can be answered when
// the first cannot - because a review comment usually names the symptom and the reference comment names the fix.
//
// **What this module owns and what it does not.** It owns the prompt, the parser, the grouping and the price. It does
// **not** own the arithmetic (`lib/file-semantic.mjs`) and it does **not** decide whether the judge is right: a smoke run
// buys that reading. What it does decide is that the shape is expressible, that a malformed answer is refused rather
// than half-banked, and that a run pays for one call per file rather than one per pair.
//
// **The price is the reason to ask.** A pair-shaped judge costs `findings x goldens` calls per pull request - 14 892 on
// the corpus of 2026-11-10. A file-shaped judge costs one call per file the reviewer commented on that carries at least
// one reference comment. On that artifact the second number is an order of magnitude smaller, so **the protocol the
// corpus measures is also the protocol that is affordable to measure repeatedly.**

import { normaliseFilePath } from './file-semantic.mjs';

/**
 * **The protocol this judge feeds**, and it is imported rather than restated: a figure labelled with the arithmetic and
 * judged under another protocol is the defect §136 recorded.
 */
export const FILE_SEMANTIC_JUDGE_PROTOCOL = 'file-level-semantic-v1';

/** How many reference comments one call is shown before the list is split, which no corpus file has reached. */
export const MAX_REFERENCE_COMMENTS_PER_CALL = 200;

/**
 * **One file's question, with the file in the cached part.**
 *
 * The rubric and the file's reference comments are the system message, because **they are the part that repeats** when a
 * file carries more findings than one call should hold: the split calls then share a prefix larger than a cache block,
 * which is the device `lib/judge-batch.mjs` measured. The findings are the user message, numbered from one.
 *
 * **Line and side are context and are labelled as context.** The protocol shows them and does not filter on them - a
 * comment on line 42 may cover a reference comment on line 88 of the same file - and a prompt that presented them as a
 * constraint would be a different protocol wearing this one's name.
 */
export function buildFileSemanticJudgeMessages({ path, findings, goldens }) {
  const file = normaliseFilePath(path);
  const reference = goldens
    .map((golden, at) => {
      const where =
        golden.line === undefined || golden.line === null ? 'line unknown' : `line ${golden.line}`;
      const side = golden.side === undefined || golden.side === null ? '' : `, ${golden.side} side`;
      return `${at + 1}. [${where}${side}] ${golden.text}`;
    })
    .join('\n');
  const numbered = findings.map((finding, at) => `${at + 1}. ${finding.text}`).join('\n');

  return {
    system: [
      'You match code review comments against the reference comments of one file from one pull request.',
      'A comment matches a reference comment when both describe the same underlying defect, even in different words.',
      'A comment may match several reference comments, and several comments may match one reference comment.',
      'The line and the side are context, not a constraint: a comment may match a reference comment on another line.',
      'Judge each comment on its own: another comment in the same list is not evidence for or against it.',
      'Answer with one JSON object and nothing else.',
      '',
      `File: ${file}`,
      '',
      `Reference comments (${goldens.length}):`,
      reference,
    ].join('\n'),
    user: [
      `Review comments (${findings.length}):`,
      numbered,
      '',
      `Answer with exactly ${findings.length} lists, one per review comment, in this order:`,
      `{"covers":[[${goldens.length > 0 ? '1|2|...' : ''}],[],...]}`,
      'Each list holds the numbers of the reference comments that comment covers, and [] when it covers none.',
    ].join('\n'),
  };
}

/**
 * **The verdicts, or `null` when the answer is not one list per finding.**
 *
 * **Every failure is the whole answer**, for the reason `parseJudgeBatch` refuses the whole batch: a partially read
 * answer is a partially invented one, and a run that banked the readable rows would score its own glitches as misses.
 * The caller falls back to the pair-shaped judge for that file, which is the old instrument rather than a new one.
 *
 * **A coordinate is checked against the list the judge was shown**, so a number the model invented cannot become a
 * matched reference comment. Sorting and deduplicating is the same discipline the arithmetic applies: a verdict is a
 * set, and an order the model chose must not change a figure.
 */
export function parseFileSemanticCovers(text, findingCount, goldenCount) {
  if (!Number.isInteger(findingCount) || findingCount < 1) return null;
  if (!Number.isInteger(goldenCount) || goldenCount < 0) return null;
  let body;
  try {
    body = JSON.parse(
      String(text ?? '')
        .replace(/```json|```/g, '')
        .trim(),
    );
  } catch {
    return null;
  }
  const covers = body?.covers;
  if (!Array.isArray(covers) || covers.length !== findingCount) return null;
  const read = [];
  for (const row of covers) {
    if (!Array.isArray(row)) return null;
    const numbers = new Set();
    for (const value of row) {
      if (!Number.isInteger(value)) return null;
      if (value < 1 || value > goldenCount) return null;
      numbers.add(value);
    }
    read.push([...numbers].sort((left, right) => left - right));
  }
  return read;
}

/**
 * **Which file each call would ask about, and what it would be shown.**
 *
 * The grouping is the arithmetic's own (`groupByPath` through `normaliseFilePath`), because **a plan that grouped
 * differently from the scorer would buy verdicts for lists the scorer never reads.** File order and comment order are
 * the scorer's too: precision is a greedy walk in generation order, so a plan that reordered the comments would change
 * the figure of a run that had not changed.
 *
 * **A file with findings but no reference comment is not asked about.** Precision counts every emission without a
 * question, so there is no verdict such a call could change - it would be a call priced at zero information.
 */
export function planFileSemanticJudgements(pulls) {
  const jobs = [];
  for (const pull of pulls) {
    const groups = new Map();
    const groupFor = (path) => {
      const key = normaliseFilePath(path);
      let group = groups.get(key);
      if (group === undefined) {
        group = { path: key, findings: [], goldens: [], findingIndices: [], goldenIndices: [] };
        groups.set(key, group);
      }
      return group;
    };
    pull.goldens.forEach((golden, index) => {
      const group = groupFor(golden.path);
      group.goldens.push(golden);
      group.goldenIndices.push(index);
    });
    pull.findings.forEach((finding, index) => {
      const group = groupFor(finding.path);
      group.findings.push(finding);
      group.findingIndices.push(index);
    });
    for (const group of groups.values()) {
      if (group.findings.length === 0 || group.goldens.length === 0) continue;
      if (group.path === '') continue;
      jobs.push({ pr: pull.pr, ...group });
    }
  }
  return jobs;
}

/**
 * **One file's verdicts, placed at the coordinates the arithmetic walks.**
 *
 * `covers` is one list per finding of *this file*, `findingIndices` says where those findings sit in the pull request's
 * list, and `goldenIndices` does the same for the reference comments. The result is the `matches` array
 * `scoreFileSemantic` reads, with `[]` for every finding this file did not ask about - so several files of one pull
 * request can be placed one after another without a merge step that could drop a row.
 */
export function toGlobalMatches({ covers, findingIndices, goldenIndices, findingCount }) {
  const length = Number.isInteger(findingCount)
    ? findingCount
    : findingIndices.reduce((max, index) => Math.max(max, index + 1), 0);
  const matches = Array.from({ length }, () => []);
  covers.forEach((row, at) => {
    const finding = findingIndices[at];
    if (!Number.isInteger(finding) || finding < 0 || finding >= length) return;
    matches[finding] = row
      .map((local) => goldenIndices[local - 1])
      .filter((value) => Number.isInteger(value));
  });
  return matches;
}
