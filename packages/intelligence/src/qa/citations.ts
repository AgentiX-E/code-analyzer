// @code-analyzer/intelligence — the answer's footnotes, and whether they exist
//
// **A grounded answer is a claim plus a pointer, and a pointer that resolves to nothing is the failure mode the whole
// surface exists to make visible.** Every codebase-QA product asks a model to cite; almost none of them check. This
// file is the check, and it is deliberately mechanical: the prompt numbers the blocks, the answer writes `[3]`, and
// this module turns that text into ids and compares the ids against the list it handed out.
//
// **Why a mechanical check is worth more than a second model.** A judge model asked "is this answer supported by the
// context" scores its own fluency; a set comparison cannot. It also runs in microseconds and gives the same answer on
// every machine, which is the property a gate needs. The judgement that remains - whether the cited block *really*
// supports the sentence - is what the retrieval and the reader are for, and a measurement on a labelled corpus is how
// it gets scored.
//
// **What this module does not do.** It does not decide whether an uncited sentence is wrong. A correct answer often
// says "no test covers this" with no pointer at all, and a rule that demanded a citation for every sentence would
// reward padding over honesty.

import type { Citation, ContextBlock, GroundingReport } from './types.js';

/**
 * Every citation id an answer names, in the order it names them, deduplicated.
 *
 * **The shapes a model actually produces are all accepted**, because the alternative is a parser that fails on a
 * correct answer: `[3]`, `[3, 4]`, `[3,4,5]`, `[3-5]`, and `【3】`. **A bare number is not a citation** - `line 42` and
 * `issue #7` are numbers in prose, and treating them as pointers would make every answer cite something.
 */
export function parseCitationIds(answer: string): number[] {
  if (!answer) return [];

  const ids: number[] = [];
  const seen = new Set<number>();
  const push = (value: number): void => {
    if (!Number.isInteger(value) || value < 1) return;
    if (seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };

  const bracketPattern = /[[【]\s*([0-9][0-9,\s\-–—]*?)\s*[\]】]/g;
  let match: RegExpExecArray | null;
  while ((match = bracketPattern.exec(answer)) !== null) {
    const inner = match[1]!;
    // **A range is expanded**, because `[3-5]` is how a person cites two adjacent blocks and dropping it would lose a
    // citation the model did make.
    const rangePattern = /(\d+)\s*[-–—]\s*(\d+)/;
    const range = rangePattern.exec(inner);
    if (range) {
      const from = Number.parseInt(range[1]!, 10);
      const to = Number.parseInt(range[2]!, 10);
      // **A capped expansion**, because `[1-1000000]` is a model failure rather than a thousand citations, and an
      // unbounded loop over it is a denial of service with an explanation.
      if (to >= from && to - from <= 64) {
        for (let id = from; id <= to; id++) push(id);
      }
      continue;
    }
    // **No empty-part check, because `split(/[,\s]+/)` cannot produce one**: it splits on runs of separators, so
    // `[3,,4]` yields `['3', '4']`. A guard there would be an arm no input reaches, which is how a file's coverage
    // report starts asking for a test of something that does not happen.
    for (const part of inner.split(/[,\s]+/)) {
      push(Number.parseInt(part, 10));
    }
  }
  return ids;
}

/** Split prose into sentences, **keeping the citation brackets with the sentence that named them**. */
export function sentences(answer: string): string[] {
  if (!answer.trim()) return [];
  return answer
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Compare the citations an answer made against the blocks it was shown.
 *
 * **`unknownIds` is the hallucination count and it is the number a page should lead with**, because a citation to block
 * 40 of a twelve-block context is not a rounding error: it is the model citing something it invented.
 */
export function verifyCitations(answer: string, blocks: ContextBlock[]): GroundingReport {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const used = parseCitationIds(answer);

  const cited: Citation[] = [];
  const unknownIds: number[] = [];
  for (const id of used) {
    const block = byId.get(id);
    if (!block) {
      unknownIds.push(id);
      continue;
    }
    cited.push({
      id: block.id,
      filePath: block.filePath,
      startLine: block.startLine,
      endLine: block.endLine,
      name: block.name,
    });
  }

  const citedIds = new Set(cited.map((citation) => citation.id));
  const uncited = blocks.filter((block) => !citedIds.has(block.id)).map((block) => block.id);

  return {
    unknownIds,
    cited,
    uncited,
    allCitationsResolve: unknownIds.length === 0,
  };
}

/**
 * Whether the answer makes at least one claim that points at real code.
 *
 * **This is the abstention test, and it is deliberately weak**: one resolving citation is enough, because an answer
 * that cites one block and reasons about it is grounded, and an answer that cites nothing is a summary the reader
 * cannot check. **An answer with no citation is not called a hallucination** - `no-grounded-claim` says what was
 * observed rather than what it implies.
 */
export function hasGroundedClaim(report: GroundingReport): boolean {
  return report.cited.length > 0;
}
