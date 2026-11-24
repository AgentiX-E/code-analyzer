// @code-analyzer — The evidence a published row carries, and the field name it may not guess
//
// **The defect this exists for was found by opening an artifact rather than by failing a test.** Every one of the 591
// rows of the 2026-11-22 run published `existingCode: ""`, and the comment beside that line said the field was *"the code
// the finding says it is about … the only way the offline replay of a paid run can price the grounding gate"*. It was
// not: the harness read `entry.finding.existingCode`, and `LLMFinding` has no such field — the quotation lives on
// `snippet`, and that field is declared and, at this commit, never populated by any lane. So the artifact claimed an
// evidence channel and published an empty string 591 times, and **a replay that reads it prices a gate shown no code.**
//
// **Why a JavaScript harness can produce that.** `aacr-bench.mjs` is `.mjs`, so a field name read off a typed object is
// not checked by anything: `finding.existingCode ?? ''` is a valid expression over any object, and `?? ''` turns the
// mistake into a value that looks like data. **A missing field and an empty field became the same fact.**
//
// Two decisions, and both are about not repeating it:
//
// 1. **The evidence reader is a named function over `LLMFinding`'s own field**, so the place a field name is guessed is
//    one function with a test rather than a line in a five-thousand-line harness.
// 2. **The row says where its evidence came from.** `existingCodeFrom` names the field that filled it, so a run that
//    publishes nothing says `'none'` in the data instead of leaving a reader to infer emptiness from an empty string —
//    which is the difference between "this reviewer quoted no code" and "this harness asked the wrong object".

/** The version of this reader, published beside the evidence so a figure can be tied to the shape that produced it. */
export const EVIDENCE_VERSION = 'published-evidence-v1';

/**
 * **The field on `LLMFinding` that carries the quotation.**
 *
 * Named once, as a constant, because the defect was a field name: `snippet` is the field the engine declares, and
 * `existingCode` is the *comment's* field — the same concept under two names on two objects, which is exactly how one of
 * them came to be read off the other.
 */
export const QUOTATION_FIELD = 'snippet';

/**
 * **The quotation a row publishes, and the name of what filled it.**
 *
 * A finding's `snippet` is the code the lane says the defect is in. When it is absent — which is every row today, because
 * no lane populates it — the field is empty **and `from` says `'none'`**, so the artifact distinguishes a reviewer that
 * quoted nothing from a harness that read the wrong object.
 */
export function quotationOf(finding) {
  const raw = finding?.[QUOTATION_FIELD];
  const text = typeof raw === 'string' ? raw : '';
  return {
    existingCode: text.slice(0, 2000),
    existingCodeFrom: text === '' ? 'none' : QUOTATION_FIELD,
  };
}

/**
 * **The evidence summary a run publishes beside its rows**, because a figure that cannot say how many of its rows carry
 * evidence is a figure that cannot notice all of them losing it.
 */
export function evidenceSummary(rows) {
  let quoted = 0;
  let none = 0;
  for (const row of rows ?? []) {
    if (String(row?.['existingCode'] ?? '') === '') none += 1;
    else quoted += 1;
  }
  return {
    version: EVIDENCE_VERSION,
    field: QUOTATION_FIELD,
    rows: quoted + none,
    quoted,
    none,
    /**
     * **Read this before pricing a grounding gate from the artifact.** A gate replayed over rows with no quotation is a
     * gate shown no code, and its removals say nothing about what it would do on a reviewer that quotes.
     */
    note:
      'existingCode is the finding snippet; existingCodeFrom names what filled it, and none means the finding carried ' +
      'no quotation rather than that the harness read the wrong field',
  };
}
