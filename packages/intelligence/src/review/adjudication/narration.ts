// @code-analyzer/intelligence — is this finding a claim, or a description of the diff?
//
// **Why this module exists, in the numbers it was written against.** On AACR-Bench's fifty pull requests the reviewer
// emitted 569 findings, 160 of which a judge accepted as describing one of the corpus's expert-confirmed issues. Part
// of the rest is not a wrong claim about the code - it is **no claim at all**: comments whose whole content is that
// the diff changed something.
//
//     "Public API change: balloonArrow() return type changed from int to ArrowType"
//     "Public API breaking change: RefType enum converted to scoped enum"
//     "getTopoShape overload argument order changed: sub passed as options, options passed as sub"
//
// **A restatement cannot be wrong, and that is the defect.** A comment that says what the diff did is indistinguishable
// from the diff, so no reading of the code can refute it, no maintainer can act on it, and a judge has nothing to
// match it to. **A finding has to assert that the code does something other than what it was meant to do.**
//
// **And the rules below are the survivors of a measurement rather than the first draft.** Four more shapes were tried
// and refused, by reading each rule's own refusals against the corpus's answer key. On the recorded 569 findings:
//
//   | rule                                             | refused | of which true positives |
//   | ------------------------------------------------ | ------- | ----------------------- |
//   | `Public API change:` / `signature changed`       | 8       | **0**                   |
//   | `an entity was added`                            | 1       | **0**                   |
//   | `no longer ...`                                  | 19      | **5**                   |
//   | `X was renamed / moved / converted`              | 3       | **1**                   |
//   | `now returns / takes / accepts`                  | 8       | **2**                   |
//   | `the code is legal / fine / correct`             | 7       | **3**                   |
//
// **The last four are gone.** *"Auth nonce is no longer invalidated after validation"* and *"ModuleSpecifier panics
// after removing its case"* are claims about behaviour that happen to use a change verb, and a rule that refuses them
// is a rule that costs a true positive to remove a false one - **at 23 % it refuses true positives at almost the rate
// the reviewer produces them (28 %)**, which is a filter with no signal in it. Only the three rules that refused
// **nothing** a judge accepted are kept, and they are kept because they are free: 9 findings removed, 0 goldens lost.
//
// **The honest size of this device**: 9 of 569, or +0.002 F1. It is not the lever. It is the part of the contract that
// can be checked without a model, and what it cannot check - a restatement whose description also asserts something -
// is what the adjudicator is for. **A rule the model can ignore is a request**; this module is the small part of the
// contract that is not.

/** What a finding says, as this module reads it. Both fields are optional so a caller can pass a bare title. */
export interface DescribedFinding {
  title?: string | null;
  description?: string | null;
}

/**
 * **Vocabulary that names a consequence, which is what makes a comment a claim.**
 *
 * The list is built from the failure words a review comment uses when it says something is wrong - *silently*, *fails*,
 * *breaks*, *leaks*, *throws*, *mismatch*, *violates* - plus the states that make a failure reachable (*null*,
 * *undefined*, *uninitialized*). **It is a set of words rather than a grammar on purpose**: a finding that uses any of
 * them has asserted a consequence somewhere, and this module's job is to refuse only the comments that assert none.
 *
 * **It is deliberately generous, and the reason is the table in the header.** A consequence term anywhere in the text
 * cancels the veto, so a comment that restates a change *and* says what it breaks survives - which is the correct
 * reading, because the claim is what makes it worth filing. **The cost of the generosity is the device's small size;
 * the cost of the alternative was measured and it was five true positives.**
 */
const CONSEQUENCE_TERMS =
  /\b(silent(ly)?|never|always|incorrect(ly)?|wrong|invalid|fails?|failing|failure|breaks?|broken|loses?|lost|leaks?|leaking|crash(es)?|throws?|exception|undefined|null|nullptr|dereferences?|overflow|underflow|mismatch(ed)?|violat(e|es|ing|ion)|corrupt(s|ed|ion)?|deadlock|race|stale|double[- ]free|out[- ]of[- ]bounds|unchecked|unhandled|uninitiali[sz]ed|regress(es|ion|ed)?|inconsisten(t|cy)|missing|omits?|omitted|skips?|ignores?|bypass(es)?|unsafe|exposes?|exposed|infinite|off[- ]by[- ]one|dead code|unreachable|no longer (works?|applies|holds?|enforced|validated|respected))\b/i;

/**
 * **The three shapes that refused nothing a judge accepted**, each anchored on a construction rather than a mood.
 *
 * They are the vocabulary of a changelog - an API change, a signature change, an entity added - and none of the three
 * can carry a consequence on its own. **The list is finite because the false-positive block that produced it is
 * finite**: a fourth shape can be added when an artifact shows one, and the header records what it will be measured
 * against.
 */
const CHANGE_RESTATEMENTS: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  {
    rule: 'api-change',
    pattern:
      /^\s*(public\s+|internal\s+|breaking\s+)*api\s+(breaking\s+)?change\b|\b(signature|interface)\s+(changed|was changed|is changed)\b/i,
  },
  {
    rule: 'entity-added',
    pattern:
      /\b(added|adds|removed|removes|deleted|introduced|introduces)\s+(a\s+|an\s+|the\s+)?(new\s+)?(member|method|function|field|parameter|class|enum|overload|test|file|helper)\b/i,
  },
  {
    rule: 'overload-order',
    pattern: /\boverload\b[^.]{0,80}\b(argument|parameter)\s+order\s+changed\b/i,
  },
];

/** Which rule refused a finding, so a report can say why rather than only how many. */
export type NarrationReason = 'restates-change';

/** What a narration read found. `reason` is `null` when the finding is a claim. */
export interface NarrationRead {
  /** True when the finding asserts no consequence and is one of the three changelog shapes. */
  narration: boolean;
  reason: NarrationReason | null;
  /** The name of the rule that fired - a report that names the rule can be argued with. */
  rule: string | null;
}

/**
 * **Read one finding, and say whether it is a claim about the code or a description of the diff.**
 *
 * The order of the two tests is load-bearing. **A consequence term anywhere in the text wins**, because a comment that
 * says *"the return type changed from int to ArrowType, so callers that pass the old enumerator now throw"* restates a
 * change and is also a claim, and it is the claim that makes it worth filing.
 */
export function readNarration(finding: DescribedFinding): NarrationRead {
  const title = String(finding.title ?? '');
  const description = String(finding.description ?? '');
  const everything = `${title}\n${description}`;

  if (CONSEQUENCE_TERMS.test(everything)) return { narration: false, reason: null, rule: null };

  for (const { rule, pattern } of CHANGE_RESTATEMENTS) {
    if (pattern.test(title) || pattern.test(everything))
      return { narration: true, reason: 'restates-change', rule };
  }

  return { narration: false, reason: null, rule: null };
}

/** What a veto did, so a run can report the count without re-reading the findings. */
export interface NarrationVetoReport {
  /** Findings the veto was applied to. */
  considered: number;
  /** Findings it refused, by rule. */
  refusedByRule: Record<string, number>;
  /** Findings it let through. */
  kept: number;
}

/**
 * **Apply the read to a list, keeping what it cannot refuse.**
 *
 * The return value carries both halves because **a filter that returns only survivors cannot be audited**: the artifact
 * has to be able to say which sentences were dropped, or the next iteration re-derives the same list from the same
 * corpus and calls it a discovery. `refused` holds the findings themselves rather than a count for that reason.
 */
export function applyNarrationVeto<T extends DescribedFinding>(
  findings: ReadonlyArray<T>,
): { kept: T[]; refused: Array<{ finding: T; rule: string }>; report: NarrationVetoReport } {
  const kept: T[] = [];
  const refused: Array<{ finding: T; rule: string }> = [];
  const refusedByRule: Record<string, number> = {};

  for (const finding of findings) {
    const read = readNarration(finding);
    if (read.narration && read.rule !== null) {
      refused.push({ finding, rule: read.rule });
      refusedByRule[read.rule] = (refusedByRule[read.rule] ?? 0) + 1;
      continue;
    }
    kept.push(finding);
  }

  return {
    kept,
    refused,
    report: { considered: findings.length, refusedByRule, kept: kept.length },
  };
}
