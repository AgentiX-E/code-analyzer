// @code-analyzer/intelligence — LLM Review Prompt Templates
// Structured prompts for each review lane with few-shot examples.

import { defectChecklist } from './language-rules.js';

import type { ReviewCategory, Severity } from '@code-analyzer/shared';

// **The checklist is a separate module because it is content, not plumbing.** Eleven languages of rules read as one
// file of rules; keeping them beside the five lane templates would have made this file the place both the contract and
// the corpus of language knowledge change, and **the two change for different reasons** - the contract when a
// measurement moves, the rules when a language does.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Expected JSON output structure for a single review finding. */
export interface LLMFinding {
  /** The line number where the issue starts (1-based). */
  startLine: number;
  /** The line number where the issue ends (1-based). */
  endLine: number;
  /** Severity of the finding. */
  severity: Severity;
  /** Category of the finding — must map to one of the valid ReviewCategory values. */
  category: ReviewCategory;
  /** Brief one-line title describing the issue. */
  title: string;
  /** Detailed explanation of the issue and its impact. */
  description: string;
  /** Suggested fix or remediation code. May be null if no specific fix is available. */
  suggestion: string | null;
  /** Optional unique identifier for the finding. */
  id?: string;
  /** Optional review lane that produced this finding. */
  lane?: string;
  /** Optional code snippet showing the problematic code. */
  snippet?: string;
  /**
   * **The file this finding is about, present only when one call covered more than one file.**
   *
   * In a file call the path is the argument and repeating it would be a second copy of the same fact. **A pull-request
   * call has no such argument**: the model is shown several files and chooses which one it is talking about, so the
   * choice has to travel with the finding or it is lost - and **a lost choice is a comment filed against the wrong
   * file.** The engine drops a finding that names no file, and one that names a file the call did not show, counting
   * the two separately.
   */
  path?: string;
  /**
   * **How many findings the engine folded into this one**, set by `deduplicateAcrossLanes` and left undefined when a
   * finding stood alone.
   *
   * **Why a count and not a flag.** Five lanes review one diff from five angles, so **a defect that three of them
   * independently name is likelier a defect than one only a single angle saw** - and that agreement is the one signal
   * the review already paid for and then threw away. **The ranking in `review/actionability.ts` uses it as one of its
   * six terms**, which is the only reason it is stored.
   */
  agreement?: number;
  /**
   * **Set when the claim-checking pass rewrote this finding rather than accepting it**, and the reason it is a field
   * rather than a comparison against the original.
   *
   * **A repaired finding is a different bet from an upheld one**: upheld says the reviewer's sentence was true, repaired
   * says the reviewer was looking at the right code and described the wrong thing. **The two are the whole question the
   * pass exists to answer** - filtering can only trade precision for recall, and a repair is the one move that raises
   * both - so a report that cannot separate them cannot say whether the device worked or merely subtracted.
   */
  repaired?: boolean;
}

/** Parameters passed to each review prompt template. */
export interface PromptContext {
  /** The git diff content to review. */
  diffContent: string;
  /** The file path being reviewed. */
  filePath: string;
  /** The change type (added, modified, deleted, renamed). */
  changeType: string;
  /** Surrounding file context (imports, neighboring functions). */
  fileContext?: string;
  /**
   * **Every path the diff shows, when the call covers more than one file.**
   *
   * A pull-request call concatenates the per-file sections of one unified diff, so the paths are already in
   * `diffContent` - **and they are listed here as well because the contract has to name the choices, not merely
   * contain them.** A model told to name a file has to be told which files there are.
   */
  paths?: readonly string[];
  /**
   * **How many findings this call may return in total.**
   *
   * For a file call this is the per-file cap the lanes have always had. **For a pull-request call it is the whole
   * call's budget**, and that is the one difference the two arms of the AACR measurement differ by: three slots per
   * file per lane over 199 files is 995 answers and 183 findings; three slots per pull request per lane is 25 answers
   * and 15 findings, **with twice the precision and a fifth of the recall.**
   */
  maxFindings?: number;
  /**
   * **What one call covers.** `'file'` is the original scope. `'pull-request'` requires every finding to name its file
   * and gives the call one budget instead of one per file.
   */
  scope?: 'file' | 'pull-request';
  /**
   * **Whether the call is given the per-language defect checklist, and why this is an option rather than a constant.**
   *
   * The checklist in `language-rules.ts` is a claim about precision, and **a claim about a prompt device can only be
   * settled by turning the device off and re-running the same corpus** - so the switch has to exist in the product
   * rather than in the harness. `false` removes the section; **undefined means on**, so every existing caller keeps
   * the behaviour it was measured with.
   */
  languageChecklist?: boolean;
  /**
   * **Where the target-and-diff block sits, which is the only thing the order device changes.** Undefined means
   * `boilerplate-first`, the arrangement that ships; the other two exist so the same corpus can be run with the device
   * and without it. See `composeLanePrompt` for the three arrangements and the measurements behind them.
   */
  promptOrder?: PromptOrder;
  /**
   * **What this file's names reach, rendered by the caller from the repository index.**
   *
   * **The one fact a diff cannot carry.** A lane reads one file's change and the caller that still passes the old
   * arity is in another file, so *"three call sites still pass two arguments"* - the remark a repo-level reviewer
   * sells - was a sentence this engine had no way to make. The index knows it before the call and for free (§100).
   *
   * **A string rather than an index, because the prompt layer must not depend on one.** The engine takes a
   * provider (`LLMReviewOptions.reach`) and renders it here; a caller with no repository index passes nothing and
   * every prompt this repository has measured stays byte-identical.
   */
  reach?: string;
}

// ---------------------------------------------------------------------------
// Shared Output Schema
// ---------------------------------------------------------------------------

const OUTPUT_SCHEMA = `{
  "findings": [
    {
      "startLine": <number>,
      "endLine": <number>,
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "bug" | "security" | "performance" | "maintainability" | "test" | "architecture" | "style" | "documentation" | "other",
      "title": "<one-line summary>",
      "description": "<detailed explanation>",
      "suggestion": "<suggested fix> | null"
    }
  ]
}`;

/**
 * What every lane is told about choosing and how many to return, stated once for all six.
 *
 * **Why it exists, in the measurement's own words.** The first scored run produced **2,763 findings and not one
 * categorised `bug`**, against a dataset containing **246 `bug` and 5 `security` ranges**. The schema listed nine
 * categories and **said nothing about which to prefer or how many to return**, so the model did what a reviewer
 * does: **it reported everything it noticed, in its own vocabulary** - `test` 1,071, `maintainability` 703,
 * `architecture` 542. **That is fifteen findings per window, and a precision of 0.0007.** **The re-score of the
 * same output under a severity filter multiplied F1 by 2.6** - which is **what a filter can do; it cannot
 * translate.**
 *
 * **So the contract says it, and says it once**, because **it is a property of the output rather than of any one
 * kind of review** - and **a lane that spelled it differently would be a lane whose numbers could not be compared
 * with the others'.**
 *
 * **And it is two rules, not one.** The category rule makes the model's vocabulary overlap the dataset's; the count
 * rule makes the output a human would read. **Neither alone suffices**: a correct category fifteen times per window
 * is unreadable, and three findings per window in the wrong vocabulary are still unmatchable.
 */
/**
 * **The one requirement every finding in this engine has to meet, and the measurement that says why.**
 *
 * On the AACR corpus, **250 of 452 goldens were missed by a finding on their own file**, and re-reading the corpus's
 * `from_line` against the findings' ranges put **135 of those 250 on the golden's own line and 189 within ten lines of
 * it** (`docs/EVAL-CONTRACT.md` §16.3). **So the lanes were not looking in the wrong place** - they were standing in the
 * right one and describing something the judge would not call the same defect.
 *
 * **And the first version of this rule made things worse, which is why it reads the way it does now.** It ended with
 * "a suggestion that names no failure cannot be right or wrong, which is why it is not reported" - **a sentence that
 * licenses silence**, and the model took it: emission fell from 582 findings to 460 on the same 50 pull requests, hits
 * fell from 86 to 76 on the 35 that both runs read, and none of the 189 coincident rejections was recovered
 * (`docs/EVAL-CONTRACT.md` §17). **A rule that trades recall for precision was the last thing this corpus needed**, so
 * the licence is gone and the requirement is stated with the emission it must not cost.
 *
 * **The contract had rules about where a finding points and none about what it says.** Rule 4 of the file contract
 * spends a hundred and seventy words on lines and severity, and a lane reading it learns that a range "must cover the
 * whole problem" while nothing tells it that the sentence has to name the problem. **A finding that only proposes an
 * improvement cannot be matched to a defect, cannot be checked, and cannot be wrong** - which is a worse property than
 * being wrong.
 *
 * **One constant rather than a paragraph per scope**, because the two scopes disagree about the budget and about the
 * file, and they do not disagree about this.
 */
const DESCRIBE_THE_FAILURE = `**The description names the failure, not the fix.** Say what goes wrong and under which
   input or state, in the vocabulary the code uses - "\`read()\` returns the caller's stream unclosed, so a path that
   never closes it leaks a descriptor on every request" rather than "consider closing the stream". **This is the rule
   the last measurement bought**: on 50 pull requests, **135 of the 250 goldens we missed had a finding on the golden's
   own line** and 189 had one within ten lines, so a finding in the right place that describes the wrong thing is this
   corpus's dominant loss. **A suggestion that names no failure has not been finished** - rewrite it until it does.
   **Do not report fewer findings because of this rule**: a defect you found and could not phrase is one this reviewer
   exists to phrase, not one to leave out.`;

const SELECTION_RULES = `
How to choose and how many to return - this is part of the contract, not advice:

1. **A defect first.** A finding whose category is "bug" or "security" is a defect: the code does something other
   than what it was meant to do. "maintainability", "style", "test", "documentation" and "architecture" are
   improvements, and a review that reports only improvements has missed the point of the exercise. If you can see a
   defect, report it as "bug" or "security" rather than as the improvement it also happens to be.
2. **One finding per defect, not one per observation.** Four style problems in one function are at most one finding
   about its style. Reporting each as its own finding is not thoroughness; it is a list nobody can act on.
3. **At most 3 findings per file.** If you can see more than three defects, return the three most likely to break and
   say so in the first one's description. An empty findings array is a valid and useful answer. **Three, and it was
   raised to eight for one run and put back**: **the raise recovered a true positive (1 to 2) and halved precision
   (0.0256 to 0.0122)**, so **the best filter's F1 fell from 0.0069 to 0.006.** **The cap was not the binding
   constraint; the precision was**, and **the reading that it was is the mistake the re-score corrected.**
4. **Lines are required, must be real, and must cover the whole problem.** "startLine" and "endLine" are the lines of
   the problem in the file. **A finding whose range does not point at the code it describes cannot be checked and will
   be discarded** - and **a range of one or two lines around a defect that is really a wrong function, a mis-set
   condition or a missing guard under-describes it.** **Extend the range to the whole construct that has to change**:
   if the fix is to rewrite a function's body, the range is that body. **The measurement says this matters**: the
   committed figures show findings whose ranges are one to three lines while the defects they describe are larger, and
   **a range that stops short is a finding that cannot be matched to the repair it is about.**
5. **Severity is what a human would stop a merge for.** "critical" is data loss, a security hole or a crash on a
   common path. "high" is a defect a reviewer would block on. "medium" is a defect worth fixing before release. "low"
   is an improvement. **"info" is not a defect**, so **do not use it for one** - and **when you are unsure between two
   levels, choose the lower one**, because **a severity that is claimed and not justified costs precision on every
   row of the measurement that filters by it.**
6. ${DESCRIBE_THE_FAILURE}
`;

// ---------------------------------------------------------------------------
// The same contract, for a call that covers a whole pull request
// ---------------------------------------------------------------------------

/**
 * **Why a pull-request call needs its own contract rather than the file contract with a bigger number.**
 *
 * The file contract's third rule is *"at most 3 findings per file"*, and over 199 files that rule is what produced
 * **183 findings carrying 21 goldens**. The same three slots applied to a whole pull request produced **15 findings
 * carrying 6** - **precision 0.40 against 0.2019, recall 0.12 against 0.42.** So the difference between the two arms
 * is not a threshold, it is **where the budget sits**, and a call whose budget sits on the pull request has to say so.
 *
 * **The other rule this contract states and the file one cannot** is that a finding must name its file - because in a
 * file call the file is the argument, and across a pull request it is a choice the model makes and can get wrong.
 */
function pullRequestRules(ctx: PromptContext): string {
  const budget = ctx.maxFindings ?? 3;
  const paths = ctx.paths ?? [];
  return `
This call covers one pull request - ${paths.length} file${paths.length === 1 ? '' : 's'} in one diff - and you return
at most ${budget} findings for all of it. That is a contract, not advice:

1. **${budget} findings for the pull request, not per file.** The budget is shared: a finding spent in one file is one
   you cannot spend in another, so spend them where a reviewer would stop the merge. **The measurement behind this
   sentence**: the same five lanes filling three slots **per file** over 199 files emitted **183 findings and matched
   21 goldens**; filling three slots **per pull request** over five pull requests they emitted **15 and matched 6**.
   **Precision doubled and recall fell by two thirds**, and the whole difference is that the budget competes.
2. **Every finding names its file.** "path" is required and must be exactly one of these strings, character for
   character:
${paths.map((path) => `   - ${path}`).join('\n')}
   **A finding with no "path", or with a path that is not in that list, is discarded before anybody reads it** - it is
   not moved to a neighbouring file, because **a comment filed against a file the model did not choose is worse than
   no comment.**
3. **A defect that spans files is one finding, anchored where the change has to be made.** Seeing several files at once
   is the reason this scope exists - a contract broken at a call site, a field added in one place and read in another,
   a rename that missed a reference are **invisible to a review that reads one file**. Report the finding on the file
   that must change, and name the other files in the description.
4. **A defect first.** A finding whose category is "bug" or "security" is a defect: the code does something other than
   what it was meant to do. "maintainability", "style", "test", "documentation" and "architecture" are improvements,
   and a review that reports only improvements has missed the point of the exercise - **and at this budget an
   improvement costs a defect.**
5. **One finding per defect, not one per observation.** Four style problems in one function are at most one finding
   about its style.
6. **Lines are required, and must be lines of added code.** "startLine" and "endLine" are lines **in the file "path"
   names**, and are judged against that file alone: two files both have a line 10, so a range that is real in one and
   imaginary in the other is a finding about neither. **Extend the range to the whole construct that has to change**,
   and **keep it inside the lines the diff adds** - a range covering only untouched context is about code this pull
   request did not change.
7. **Severity is what a human would stop a merge for.** "critical" is data loss, a security hole or a crash on a
   common path. "high" is a defect a reviewer would block on. "medium" is a defect worth fixing before release. "low"
   is an improvement. **"info" is not a defect**, so do not use it for one, and when unsure between two levels choose
   the lower one.
8. **An empty findings array is a valid and useful answer.** A pull request that only renames a variable does not
   contain ${budget} defects, and saying so is the correct output rather than a failure of the exercise.
9. ${DESCRIBE_THE_FAILURE}
`;
}

/** The schema a pull-request call must answer in: the file call's, plus the file it is about. */
const PULL_REQUEST_SCHEMA = `{
  "findings": [
    {
      "path": "<one of the paths listed above, exactly>",
      "startLine": <number>,
      "endLine": <number>,
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "bug" | "security" | "performance" | "maintainability" | "test" | "architecture" | "style" | "documentation" | "other",
      "title": "<one-line summary>",
      "description": "<detailed explanation>",
      "suggestion": "<suggested fix> | null"
    }
  ]
}`;

/**
 * **The contract and the schema, chosen by what the call covers.**
 *
 * One function rather than a condition in five lanes: **the two scopes differ in the selection contract and in the
 * output shape, and a lane that stated either of them differently would be a lane whose numbers could not be compared
 * with the others'.**
 */
export function selectionContract(ctx: PromptContext): string {
  return ctx.scope === 'pull-request'
    ? `${pullRequestRules(ctx)}${PULL_REQUEST_SCHEMA}`
    : `${SELECTION_RULES}${OUTPUT_SCHEMA}`;
}

/**
 * **The choosing rules without the schema they are usually printed beside.**
 *
 * A fused call has its own schema - six arrays, one per question - and printing the single-array schema beside it would
 * show a model two contracts for one answer. **What must survive the substitution is the discipline, not the shape**:
 * the category vocabulary the corpus is written in, and the rule about how many findings a window is worth.
 */
export function selectionRulesOnly(ctx: PromptContext): string {
  return ctx.scope === 'pull-request' ? pullRequestRules(ctx) : SELECTION_RULES;
}

/**
 * **What the call is about, said the way the scope allows.**
 *
 * A file call names one file and may carry surrounding context. **A pull-request call names the files it shows**,
 * because rule 2 of its contract asks the model to choose one of them and **a choice the model cannot read is not a
 * choice.**
 */
/**
 * **Whether the call carries a block that is not already in the prompt.**
 *
 * A caller may pass the diff itself as the context - the harness did, and every file-arm call carried the change twice:
 * **38.6 % of a 190-line call's characters**, and a block labelled "File context" that was not context at all. The
 * guard is here rather than at the call site because the same `fileContext` is what the gate parses and what the idiom
 * lane reads: **removing it where it is passed would fix a prompt by breaking two devices that are not prompts.**
 */
function showsContext(ctx: PromptContext): boolean {
  return (
    ctx.fileContext !== undefined &&
    ctx.fileContext.length > 0 &&
    ctx.fileContext !== ctx.diffContent
  );
}

/**
 * **What the reach block says about itself**, which is the difference between evidence and a claim.
 *
 * A list of call sites is an invitation to report a defect that is not there: a name read from three files is three
 * *correct* call sites unless one of them passes something the change no longer accepts. **So the block names its own
 * status** - *this is evidence, not a finding* - because a model told to review and handed a list of callers will
 * otherwise report the list.
 */
function reachSection(ctx: PromptContext): string {
  if (ctx.reach === undefined || ctx.reach.length === 0) return '';
  return `Cross-file reach, from the repository's import graph and not from this diff - **a call site here is correct unless the change makes it wrong, and reporting that a name has callers is not a finding:**
${ctx.reach}
`;
}

export function describeTarget(ctx: PromptContext): string {
  if (ctx.scope === 'pull-request') {
    const paths = ctx.paths ?? [];
    // **The window travels with the target block rather than after the diff**, because it is what the call is about and
    // because a block that sits behind the diff is a block four of five lanes would have to be told separately to keep.
    // **It is placed before the paths list rather than after it**: a model reading a path list and then eight file
    // bodies has to hold the list while it reads, and one that reads the code first and the list last answers about the
    // file it just read.
    const window = showsContext(ctx)
      ? `Surrounding code, unchanged lines included (the block each hunk sits in):\n${ctx.fileContext!}\n`
      : '';
    return `Pull request: ${paths.length} file${paths.length === 1 ? '' : 's'} in one diff.
${window}${reachSection(ctx)}Paths in this pull request:
${paths.map((path) => `- ${path}`).join('\n')}
`;
  }
  return `File: ${ctx.filePath}
Change type: ${ctx.changeType}
${showsContext(ctx) ? `File context:\n${ctx.fileContext!}\n` : ''}${reachSection(ctx)}`;
}

/**
 * **The block that changes with the file: what the call is about, and what it is looking at.**
 *
 * It is one function rather than a literal repeated in five lanes because **three of them place it in three different
 * positions and the claim under test is that the rest of the prompt does not move when it does.** Five copies would
 * make that true by intention and false at the first typo.
 *
 * **How large it is, measured rather than assumed**: 563 characters at a 500-character diff, 2 063 at 2 000, 4 063 at
 * 4 000 and 8 063 at the default 8 000-character cap - against **7 344-8 144 characters of lane boilerplate**. The
 * share is therefore **7 % to 51 %**, which is the figure that decides where this block belongs; see
 * `composeLanePrompt` for the three arrangements and why the last of them is the one that ships.
 */
export function sharedPrefix(ctx: PromptContext): string {
  return `${describeTarget(ctx)}

Diff content:
\`\`\`
${ctx.diffContent}
\`\`\`

`;
}

/**
 * **The measured order of a lane prompt.** `boilerplate-first` is what ships; `lane-first` is the arrangement
 * before either device and `diff-first` is the one `EVAL-CONTRACT.md` §9 registered. All three exist so the same
 * corpus can be run with a device and without it, which is the only way an order can be settled.
 */
/**
 * **The three orders, as a value rather than as a type only.**
 *
 * The union below is what the engine switches on; this array is what a workflow's `choice` input is checked against.
 * **The two used to be the same thing written twice** - once in TypeScript and once in the dispatch options of
 * `.github/workflows/aacr-bench.yml` - and **a `choice` list that drifts from the union silently runs the fallthrough
 * order while the artifact records a name nobody implemented**, which is an experiment that measures the wrong arm and
 * says so in its own metadata.
 */
export const PROMPT_ORDERS = ['boilerplate-first', 'diff-first', 'lane-first'] as const;

export type PromptOrder = (typeof PROMPT_ORDERS)[number];

/**
 * **Assemble one lane prompt from its two halves and the block they share.**
 *
 * The halves are unchanged by this function, so all three orders contain the same characters and differ only in
 * where the target-and-diff block sits:
 *
 * | order | arrangement | the reusable prefix, over a lane's sweep of many files |
 * | --- | --- | --- |
 * | `lane-first` | `head + shared + tail` | the head - a few hundred characters, and the checklist and the examples sit *after* the file-specific block |
 * | `diff-first` | `shared + head + tail` | nothing across files, because the path is inside the block; shared across one file's five lanes |
 * | `boilerplate-first` | `head + tail + blank line + shared` | **everything the lane says, which is the same for every file it reads** |
 *
 * **Why the third one is the one that ships, in the numbers rather than the argument.** Measured on this file: a lane
 * spends **7 344 to 8 144 characters on its role, its checklist, its output contract and its examples**, and the target
 * and diff add **563 characters at a 500-character diff and 8 063 at an 8 000-character one** - so **the block §9
 * moved to the front is between 7 % and 51 % of a call, and it is a different block for every file.** The lane's own
 * wording is identical for every file the lane ever reads, and putting it first is the only arrangement in which the
 * prefix is *both* large and reused. The vendor documents the same rule from the other side: constant content first,
 * variable content last.
 *
 * **And `lane-first` was not that arrangement either**, which is the part that cost money unnoticed: it leads with the
 * head, but the head is ~860 characters and then the diff arrives, so **the prefix a later call could reuse ended at
 * the file path.** A prompt can lead with a constant and still have no reusable prefix.
 *
 * **A test asserts all three contain the same characters in a different order**, because a reordering device that also
 * rewrote a word would be two changes measured as one.
 */
export function composeLanePrompt(ctx: PromptContext, head: string, tail: string): string {
  const shared = sharedPrefix(ctx);
  if (ctx.promptOrder === 'lane-first') return `${head}${shared}${tail}`;
  if (ctx.promptOrder === 'diff-first') return `${shared}${head}${tail}`;
  // **A blank line before the block, and only here**: in the other two orders the head already ends with one, and the
  // separator is not a wording change - it is what stops the closing sentence from running into the file path.
  return `${head}${tail}\n\n${shared}`;
}

// ---------------------------------------------------------------------------
// Security Review Prompt
// ---------------------------------------------------------------------------

export function SECURITY_REVIEW_PROMPT(ctx: PromptContext): string {
  const head = `You are an expert security reviewer performing a detailed security audit of a code change. Your focus is on the OWASP Top 10 vulnerabilities including injection flaws, broken authentication, sensitive data exposure, XML external entities, broken access control, security misconfiguration, cross-site scripting, insecure deserialization, use of vulnerable components, and insufficient logging/monitoring.

Review the following code diff and identify any security issues. Pay attention to:
- SQL/NoSQL injection vectors
- Command injection risks
- Hardcoded secrets, API keys, or credentials
- Missing input validation
- Insecure authentication/authorization checks
- Path traversal vulnerabilities
- Insecure cryptography or hashing
- Cross-site scripting (XSS)
- Insecure deserialization
- Exposure of sensitive data in logs/errors

`;
  const tail = `Return a JSON object with this exact structure. Only include findings you are confident about — an empty findings array is acceptable if no issues are found:
${defectChecklist(ctx)}${selectionContract(ctx)}

Few-shot example — SQL injection:
Input: diff showing \`db.query("SELECT * FROM users WHERE id = " + userId)\`
Output:
{
  "findings": [
    {
      "startLine": 42,
      "endLine": 42,
      "severity": "critical",
      "category": "security",
      "title": "SQL injection vulnerability in user query",
      "description": "The user ID is concatenated directly into the SQL query string without parameterization, allowing SQL injection attacks.",
      "suggestion": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [userId])"
    }
  ]
}

Few-shot example — hardcoded secret:
Input: diff showing \`const apiKey = "sk-abc123xyz";\`
Output:
{
  "findings": [
    {
      "startLine": 5,
      "endLine": 5,
      "severity": "critical",
      "category": "security",
      "title": "Hardcoded API key detected",
      "description": "An API key is hardcoded in the source code. Secrets should never be committed to version control.",
      "suggestion": "Read the API key from an environment variable: const apiKey = process.env.API_KEY"
    }
  ]
}

Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}

// ---------------------------------------------------------------------------
// Performance Review Prompt
// ---------------------------------------------------------------------------

export function PERFORMANCE_REVIEW_PROMPT(ctx: PromptContext): string {
  const head = `You are an expert performance engineer reviewing a code change for performance issues. Your focus is on algorithmic efficiency, resource utilization, and scalability.

Review the following code diff and identify performance problems. Pay attention to:
- N+1 query patterns (fetching data in a loop)
- Unnecessary memory allocations
- Blocking synchronous operations in async contexts
- Inefficient collection operations (O(n^2) nested loops for lookup)
- Missing caching opportunities
- Large object copies or deep clones
- Inefficient regular expressions
- Unnecessary recalculations in hot paths
- Missing lazy loading or pagination
- Promise.all optimizations (concurrency vs sequential)

`;
  const tail = `Return a JSON object with this exact structure:
${defectChecklist(ctx)}${selectionContract(ctx)}

Few-shot example — N+1 query:
Input: diff showing \`for (const user of users) { const posts = await db.query("SELECT * FROM posts WHERE user_id = $1", [user.id]); }\`
Output:
{
  "findings": [
    {
      "startLine": 10,
      "endLine": 13,
      "severity": "high",
      "category": "performance",
      "title": "N+1 query pattern detected",
      "description": "Executing a database query inside a loop results in N+1 queries. For N=1000 users, this generates 1001 queries instead of 2.",
      "suggestion": "Use a single batch query: const posts = await db.query('SELECT * FROM posts WHERE user_id IN ($1:list)', [userIds])"
    }
  ]
}

Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}

// ---------------------------------------------------------------------------
// Maintainability Review Prompt
// ---------------------------------------------------------------------------

export function MAINTAINABILITY_REVIEW_PROMPT(ctx: PromptContext): string {
  const head = `You are an expert code quality reviewer evaluating a code change for maintainability. You apply SOLID principles, code smell detection, and readability analysis.

Review the following code diff and identify maintainability issues. Pay attention to:
- Functions that are too long or do too many things (Single Responsibility)
- Deep nesting of conditionals (readability)
- Magic numbers without constants
- Inconsistent naming conventions
- Missing or poor error messages
- Overly complex conditional logic
- Code duplication
- Functions with too many parameters
- Missing type annotations or interfaces
- Commented-out code
- Functions that are hard to test due to tight coupling

`;
  const tail = `Return a JSON object with this exact structure:
${defectChecklist(ctx)}${selectionContract(ctx)}

Few-shot example — magic number:
Input: diff showing \`if (items.length > 100) { ... }\`
Output:
{
  "findings": [
    {
      "startLine": 25,
      "endLine": 25,
      "severity": "low",
      "category": "maintainability",
      "title": "Magic number: 100 should be a named constant",
      "description": "The number 100 is used without explanation. Magic numbers reduce readability and make future changes harder.",
      "suggestion": "Define a constant: const MAX_ITEMS = 100; then use: if (items.length > MAX_ITEMS)"
    }
  ]
}

Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}

// ---------------------------------------------------------------------------
// Testing Review Prompt
// ---------------------------------------------------------------------------

export function TESTING_REVIEW_PROMPT(ctx: PromptContext): string {
  const head = `You are an expert test engineer reviewing a code change for testing quality. Your focus is on test coverage, assertion quality, and test reliability.

Review the following code diff and identify testing issues. Pay attention to:
- Missing test coverage for new or modified code paths
- Weak or insufficient assertions (e.g., asserting truthiness instead of specific values)
- Tests without assertions
- Flaky tests (race conditions, dependency on external state, timing)
- Missing edge case tests (null/undefined, empty arrays, boundary values)
- Hardcoded test values that can't be reproduced
- Missing error path testing
- Test setup/teardown issues
- Mocking issues (over-mocking, missing mocks)
- Tests that test implementation details rather than behavior

`;
  const tail = `Return a JSON object with this exact structure:
${defectChecklist(ctx)}${selectionContract(ctx)}

Few-shot example — weak assertion:
Input: diff showing \`expect(result).toBeTruthy();\`
Output:
{
  "findings": [
    {
      "startLine": 42,
      "endLine": 42,
      "severity": "medium",
      "category": "test",
      "title": "Weak assertion: toBeTruthy() is not specific enough",
      "description": "Using toBeTruthy() passes for any truthy value, including objects, non-zero numbers, and non-empty strings. It does not verify the actual return value.",
      "suggestion": "Use more specific assertions like toEqual(expectedValue) or toMatchObject({ id: 1, name: 'test' })"
    }
  ]
}

Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}

// ---------------------------------------------------------------------------
// Architecture Review Prompt
// ---------------------------------------------------------------------------

export function ARCHITECTURE_REVIEW_PROMPT(ctx: PromptContext): string {
  const head = `You are an expert software architect reviewing a code change for architectural integrity. Your focus is on layer violations, circular dependencies, and structural soundness.

Review the following code diff and identify architecture issues. Pay attention to:
- Layer violations (e.g., UI layer importing from data access layer)
- Circular dependencies between modules
- Missing abstraction layers (direct coupling to concrete implementations)
- Importing from forbidden or deprecated modules
- Breaking changes to public APIs/interfaces
- Inconsistent abstraction levels
- Unnecessary cross-cutting concerns
- Missing separation of concerns
- God modules or classes
- Inverted dependencies (low-level module depending on high-level)

`;
  const tail = `Return a JSON object with this exact structure:
${defectChecklist(ctx)}${selectionContract(ctx)}

Few-shot example — layer violation:
Input: diff showing a component importing directly from a database module
Output:
{
  "findings": [
    {
      "startLine": 3,
      "endLine": 3,
      "severity": "high",
      "category": "architecture",
      "title": "Layer violation: UI component importing from data access layer",
      "description": "The component imports directly from the database module, bypassing the service/domain layer. This couples the UI to the persistence implementation.",
      "suggestion": "Introduce a service layer or repository interface. The component should depend on abstractions, not concrete data access implementations."
    }
  ]
}

Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}

// ---------------------------------------------------------------------------
// Behaviour Review Prompt — the lane asked a different question
// ---------------------------------------------------------------------------

/**
 * **The value that reaches a line and what that line produces instead.**
 *
 * **Why this lane exists, in the corpus's own numbers.** Of the 1 054 goldens on the merged corpus, **449 sit on a file
 * we commented on and were judged not to address them**, and only seven of those are recoverable by a better matcher
 * (`EVAL-CONTRACT.md` §69.4). **426 of the 1 054 name a boundary condition** - an unchecked return, an empty
 * collection, a zero denominator, an index at the end - and the findings that name one are the ones that get accepted:
 * precision 0.257 against 0.196 over 2 438 ranked rows. **What the five lanes produce instead is mostly the shape of
 * the change**: a title like *"field removed without deprecation"* where the golden says *"`///` replaced with `//`,
 * so the field loses its documentation"*.
 *
 * **So the question is the value, not the category.** A lane told to look for a category of improvement reports what it
 * notices about the diff; a lane told to name a value that reaches a line and say what goes wrong with it reports a
 * defect and, when there is none, says nothing. **The second framing is the one two independent sources measured**:
 * requiring a triggering input filters speculative comments because *"a model that cannot name the input usually does
 * not have a real finding"*, and a clean-control study took accusations on correct items from 93.8 % to 0 % with one
 * sentence granting that most items are correct, at unchanged detection.
 *
 * **What it must not become.** Not *"find bugs"* - the directive framing roughly triples the false-positive rate
 * against the trace framing - and not a sixth category checklist, because four other lanes already ask those and a
 * lane that repeats them is four calls wearing five hats.
 */
export function BEHAVIOUR_REVIEW_PROMPT(ctx: PromptContext): string {
  const head = `You are tracing what a change does to the values that reach it. You are not reviewing this diff for
style, structure, tests or documentation - other reviewers are doing that, and a remark of that kind here is one this
lane cannot price.

Ask one question about every changed line: **which value, state or sequence that can actually reach this line makes it
produce something other than what the surrounding code expects?**

Answer it by naming the value first, in the vocabulary the code uses:
- an argument the caller can pass: empty, null, zero, negative, longer than the buffer, a key that appears twice
- a state the code can be in: not yet initialised, already closed, called twice, called concurrently
- a return this line does not check: an error, a missing row, a partial write, a value the type admits and the logic
  does not
- a boundary the arithmetic crosses: an index at the end, a division by a count that can be zero, a comparison that is
  exclusive where its caller reads it as inclusive

**Then say what the line produces instead.** "The empty case returns NaN and the caller compares it against a
threshold" is a finding. "This could be fragile" is not, and neither is a sentence about the change itself - what it
replaces, what it now does, what it would be cleaner as. **A finding whose description cannot name a value that reaches
the line has not answered the question**, and the right output is to leave it out rather than to phrase it more
carefully.

**Do not report an improvement here.** A naming problem, a long function, a missing test and a layer violation are all
real, all four other reviewers' business, and all four cost a comment that a defect needed.

**Most changed lines are correct.** A rename, a reformat, a comment, a test fixture and most configuration changes
carry nothing this lane can say, and an empty findings array is the expected answer for them rather than a failure of
the exercise.

`;
  const tail = `Return a JSON object with this exact structure:
${defectChecklist(ctx)}${selectionContract(ctx)}

Few-shot example — a divisor the caller does not know is zero:
Input: diff adding \`const ratio = delta / Math.min(previous, current);\`
Output:
{
  "findings": [
    {
      "startLine": 41,
      "endLine": 41,
      "severity": "high",
      "category": "bug",
      "title": "Two equal intervals make Math.min zero and the ratio Infinity",
      "description": "Math.min(previous, current) is the gap between consecutive events, and two events on the same tick pass 0 here. The division then returns Infinity, which the caller compares against a threshold and never exceeds; the previous expression divided by Math.max and could not be zero.",
      "suggestion": "Guard the zero before dividing: if (Math.min(previous, current) === 0) return 0;"
    }
  ]
}

Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}

// ---------------------------------------------------------------------------
// Prompt Registry
// ---------------------------------------------------------------------------

/** All available review lanes with their associated prompt builders. */
export type ReviewLane =
  'security' | 'performance' | 'maintainability' | 'testing' | 'architecture' | 'behaviour';

export const LANE_PROMPTS: Record<ReviewLane, (ctx: PromptContext) => string> = {
  security: SECURITY_REVIEW_PROMPT,
  performance: PERFORMANCE_REVIEW_PROMPT,
  maintainability: MAINTAINABILITY_REVIEW_PROMPT,
  testing: TESTING_REVIEW_PROMPT,
  architecture: ARCHITECTURE_REVIEW_PROMPT,
  behaviour: BEHAVIOUR_REVIEW_PROMPT,
};

/** Labels for each review lane (human-readable). */
export const LANE_LABELS: Record<ReviewLane, string> = {
  security: 'Security Review',
  performance: 'Performance Review',
  maintainability: 'Maintainability Review',
  testing: 'Testing Review',
  architecture: 'Architecture Review',
  behaviour: 'Behaviour Review',
};

/**
 * **The two questions a run can put to one diff, named so an artifact can say which it asked.**
 *
 * `shipped` is the five lanes every published figure was measured under, and it stays the default: **a lane set is a
 * reviewer, and a reviewer that changes silently re-prices every number in this repository.**
 *
 * `behaviour` swaps *one* of them - `testing`, whose findings reach the corpus's question 8.6 % of the time at
 * precision 0.111 and whose own removal gains 0.0069 F1 (§69.3's table) - for the lane that asks for the value that
 * breaks the line. **A substitution rather than a sixth call**, because a device that also costs 20 % more per file
 * cannot be priced against one that does not, and because the registration R-35 asks about the *question* rather than
 * about the budget.
 *
 * **Read by the benchmark and by nothing else.** The engine's default lanes are still `shipped`; a caller that wants
 * the other set passes it, and the artifact records which set it passed.
 */
export const LANE_SETS = {
  shipped: ['security', 'architecture', 'performance', 'maintainability', 'testing'],
  behaviour: ['security', 'architecture', 'performance', 'maintainability', 'behaviour'],
  /**
   * **The union, which is R-37's arm, and the reason it is a union rather than a third substitution.**
   *
   * R-35 asked whether `behaviour` should replace `testing` and the answer was no: F1 0.1973 against 0.2076, Δ −0.0103,
   * p = 0.354 (§72.1). **But the substitution was a forced choice between two lanes that are not the same device.**
   * `testing` filed 289 findings and hit 59 goldens at precision 0.158; `behaviour` filed 75 and hit 24 at precision
   * 0.258. **The wide set asks both and pays one call per file for it** - the arithmetic then belongs to the judge,
   * which is where §69's substitution should have left it.
   *
   * **Why width at all, when four devices have been read off this corpus.** §72.4 measured a perfect ordering of the
   * merged pool at p@16 = 0.267, and the shipped set reaches recall 0.1973 against that ceiling. **The ranker is not
   * the constraint; the pool is**, and a wider pool is the only device in this repository that widens it without
   * touching the judge, the deduplicator or the gate.
   */
  wide: ['security', 'architecture', 'performance', 'maintainability', 'testing', 'behaviour'],
  /**
   * **The four questions this corpus scores, and the one it pays for and deletes.**
   *
   * On two artifacts of fifty pull requests `testing` filed **152 findings whose category is `test`** - 73 and 79 - and
   * the shipped cut emitted **none of them**: `drop test` is the first step of the cut, so the lane's entire product - in
   * both runs, without exception - reached no judge. Its bill is not zero, because five lanes see the same diff five
   * times: `testing` is **19.9 % of a run's prompt tokens** (§107.1's ledger, 1 362 399 of 6 859 281).
   *
   * **The lane is not a defect and this set is not a removal.** A product reviewer that never asks for the missing test
   * is a worse reviewer, and `drop test` is a rule about *AACR-Bench*, whose goldens are written about `src/`. What is
   * true is narrower: **the benchmark pays a fifth of its bill for findings its own cut deletes**, and every device
   * priced against that run was priced against a figure that includes the waste.
   *
   * **A set rather than a change of default**, for the reason every switch in this file has: `shipped` is what every
   * published figure was measured under, and `pair-lean` dispatches both it and this one over the same rows so the
   * difference between the two artifacts is this line.
   */
  lean: ['security', 'architecture', 'performance', 'maintainability'],
} as const satisfies Record<string, readonly ReviewLane[]>;

/** Review lanes sorted by priority (most critical first). */
export const LANE_PRIORITIES: ReviewLane[] = [
  'security',
  'architecture',
  'performance',
  'maintainability',
  'testing',
  'behaviour',
];

// ---------------------------------------------------------------------------
// One call, five questions
// ---------------------------------------------------------------------------

/**
 * **How a run puts its lanes to a file: one call each, or one call for all of them.**
 *
 * `separate` is what every published figure was measured under, and it stays the default for the reason every switch in
 * this repository has: **a run that changed the shape of its calls silently would re-price every number in this
 * document.** `fused` is the device R-47 registered, and its claim is about money rather than about accuracy.
 *
 * **Why the shape is worth a switch at all.** On the fifty-pull-request run of §106.7 the ledger splits 2 945 lane calls
 * into five almost equal bills - `security` 1 456 332 prompt tokens, `performance` 1 364 316, `testing` 1 362 399,
 * `maintainability` 1 338 756, `architecture` 1 337 478 - and **five equal bills over one diff is five copies of the
 * diff.** The shared block is the price; the lane's own instruction is 7 344 to 8 144 characters and does not change
 * with the file.
 */
export const LANE_MODES = ['separate', 'fused'] as const;

export type LaneMode = (typeof LANE_MODES)[number];

/**
 * **Which lane a finding belongs to when the reviewer did not say, read from the category it did say.**
 *
 * The label is not decoration: it is the key of the per-lane ledger, of the agreement feature that feeds the ranker,
 * and of the table §69 published lane economics from. **A fused answer that names no lane would otherwise have to be
 * dropped** - and dropping a true finding to protect a table is the trade this campaign has refused everywhere else.
 *
 * **The table is a reading of the categories, not a second taxonomy.** `bug` goes to `behaviour` because that is the
 * lane that asks what the value at the line does; `style`, `documentation` and `api` go to `maintainability` because
 * that is the lane whose question they answer. Every category the reviewer may assert has an entry, and the test that
 * says so is `one-prompt-can-ask-five-questions`.
 */
export const LANE_OF_CATEGORY: Record<ReviewCategory, ReviewLane> = {
  bug: 'behaviour',
  security: 'security',
  performance: 'performance',
  maintainability: 'maintainability',
  test: 'testing',
  style: 'maintainability',
  documentation: 'maintainability',
  architecture: 'architecture',
  api: 'architecture',
  other: 'maintainability',
};

/**
 * **The five questions, each written once, each naming the lane it is.**
 *
 * A fused call is not the five lane prompts concatenated: **the five prompt heads share a role statement, a checklist,
 * an output contract and two or three worked examples each**, and copying all of that into one prompt would pay most of
 * the bill this device exists to remove. What is kept is the *question* - the part a reviewer answers - and what is
 * dropped is the ceremony around it, which the shared selection contract below states once.
 *
 * **`ask` is written as an instruction to look, not as a category name**, because the measurement §47.7 recorded is
 * that a lane told to find defects describes defects: the sentence has to say what to look *at*.
 */
export const FUSED_QUESTIONS: ReadonlyArray<{ readonly lane: ReviewLane; readonly ask: string }> = [
  {
    lane: 'security',
    ask: 'Does this change let input reach a sink it did not reach before - injection, path traversal, deserialisation, a secret in the source or in a log, a missing authorisation check, a weakened comparison?',
  },
  {
    lane: 'performance',
    ask: 'Does this change add work per element, per call or per frame that the previous line did not do - an allocation inside a loop, a quadratic scan, a repeated lookup, a copy of a large object, a synchronous call on a hot path?',
  },
  {
    lane: 'maintainability',
    ask: 'Does this change duplicate a helper or a constant that already exists, contradict the convention the rest of the file follows, leave a dead branch, a commented-out statement or a name that says something the code does not?',
  },
  {
    lane: 'testing',
    ask: 'Does this change alter behaviour that no test in the patch covers - a new branch, an error path, a boundary the old code could not reach - and is the missing test the thing a reviewer should ask for?',
  },
  {
    lane: 'architecture',
    ask: 'Does this change reach across a boundary the module did not cross before - a dependency on a layer above it, a public API that breaks its callers, a shared state introduced between components, an ownership or lifecycle rule violated?',
  },
  {
    lane: 'behaviour',
    ask: 'What the value at the changed line does when it is empty, zero, negative, absent, or larger than the buffer: does the new expression divide by something that can be zero, index past an end, dereference what can be null, or return a type its caller does not expect?',
  },
];

/**
 * **One prompt that asks every question the run bought, and asks the reviewer to label its answers.**
 *
 * **The one thing this prompt must not do is let a finding arrive without a lane.** The label is read by the ledger,
 * by the agreement feature and by the per-lane tables, so the contract below states it as a required field, the parser
 * keeps it only when it is a string, and the engine files a finding that names no lane - or names one this run did not
 * buy - under the lane its own category names.
 *
 * **Order is the run's** (`composeLanePrompt`), so the diff sits where the measured arrangement puts it and the prefix
 * a warm cache reuses is the same prefix it reuses in a separate run.
 */
export function FUSED_REVIEW_PROMPT(ctx: PromptContext): string {
  const questions = FUSED_QUESTIONS.map(
    (question) => `- **${question.lane}** - ${question.ask}`,
  ).join('\n');
  const head = `You are reviewing one change and answering several independent questions about it. **Each question names the lane that owns it.** Answer **every** question, in order, from the same diff.

${questions}

**Six answers are required, one per lane, and an empty answer is a real answer.** A change that has nothing to say about ownership says so; a review that answers only one of these has not done this task, and the six arrays are how the difference is visible.

**Most changed lines answer none of these.** A rename, a reformat, a comment, a test fixture and most configuration changes carry nothing here.

`;
  const tail = `Return a JSON object with exactly this structure - an **object with one key, \`answers\`**, holding one entry per lane above, in the order above, each with its own findings array:
${defectChecklist(ctx)}${selectionRulesOnly(ctx)}

{
  "answers": [
    {
      "lane": "maintainability",
      "findings": [
        {
          "startLine": 12,
          "endLine": 12,
          "severity": "medium",
          "category": "maintainability",
          "title": "The new branch rebuilds the path that \`joinPath\` already builds",
          "description": "\`joinPath(base, name)\` in this package does exactly this concatenation, including the separator handling this branch re-derives by hand.",
          "suggestion": "Call \`joinPath(base, name)\` instead of rebuilding it here."
        }
      ]
    },
    { "lane": "security", "findings": [] }
  ]
}

**The example shows two of the six on purpose**: the object must carry all of them, and a lane with nothing to report carries an empty array rather than being left out. Respond ONLY with the JSON object. Do not include any markdown formatting, explanations, or additional text.`;
  return composeLanePrompt(ctx, head, tail);
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the raw JSON response from an LLM review lane into structured findings.
 * Handles common formatting issues like markdown code fences.
 */
function stripFences(raw: string): string {
  let json = raw.trim();
  if (json.startsWith('```')) {
    const firstNewline = json.indexOf('\n');
    json = json.slice(firstNewline + 1);
    if (json.endsWith('```')) {
      json = json.slice(0, -3).trim();
    }
  }
  return json;
}

/**
 * **The findings in one list, validated and normalised, from whichever shape they arrived in.**
 *
 * One function for both contracts because **the validation is the same claim in both**: a finding is a range, a severity,
 * a category and a title, and a `lane` only when the answer wrote a string there. A second copy for the six-array shape
 * would be a second opinion about what a finding is.
 */
export function toFindings(list: unknown): LLMFinding[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((f: unknown): f is LLMFinding => {
      if (!f || typeof f !== 'object') return false;
      const finding = f as Record<string, unknown>;
      return (
        typeof finding['startLine'] === 'number' &&
        typeof finding['endLine'] === 'number' &&
        typeof finding['severity'] === 'string' &&
        typeof finding['category'] === 'string' &&
        typeof finding['title'] === 'string'
      );
    })
    .map((f: LLMFinding) => {
      const base: LLMFinding = {
        ...f,
        description: f.description ?? '',
        suggestion: f.suggestion ?? null,
      };
      // **A path is passed through only when it is a string.** The spread above copies whatever JSON held, and a number
      // in that field would be a `path` the type promises is a path. **The engine decides whether the path names a file
      // the call showed** - this only refuses to carry a value that is not one.
      const raw: Record<string, unknown> = f as unknown as Record<string, unknown>;
      // **The same rule for the lane**, and here it is the whole attribution of a fused answer: a number or an object in
      // that field is not a lane, and the engine's fallback to the category is truthful where a coerced string would not
      // be. See `FUSED_REVIEW_PROMPT`.
      const withPath: LLMFinding =
        typeof raw['path'] === 'string' ? { ...base, path: raw['path'] } : base;
      if (typeof raw['lane'] !== 'string') {
        // **Removed rather than left to the spread.** `...f` copies whatever the JSON held, so a number in `lane` would
        // reach the engine as a lane the type says is a string; the engine's fallback then reads the category, and a
        // stripped field is what makes that fallback the one that runs.
        const stripped = { ...withPath } as LLMFinding & { lane?: unknown };
        delete stripped.lane;
        return stripped;
      }
      return { ...withPath, lane: raw['lane'] };
    });
}

export function parseLLMResponse(raw: string): LLMFinding[] {
  try {
    const parsed = JSON.parse(stripFences(raw)) as { findings?: unknown };
    return toFindings(parsed.findings);
  } catch {
    return [];
  }
}

/**
 * **A fused answer, read as one list per question.**
 *
 * The fused contract asks for `{"answers":[{"lane":"security","findings":[…]},…]}`, **one entry per lane whether or not
 * it has anything to say**, because §107.7 measured what a list of questions without a structure produces: ninety-one per
 * cent of the findings came back as one category, which is the shape of a reviewer that answered the question its
 * example was about.
 *
 * **Two shapes are accepted, and the second is the one every earlier run wrote.** An answer that used the single-array
 * contract still parses - its findings carry their own `lane`, or none, and the engine's fallback reads the category.
 * **A parser that only knew the new shape would turn a wrong answer into no answer**, which is the failure the fenced
 * branch above exists to prevent one level down.
 *
 * The key of the map is the lane the answer named, or `''` when it named none; the engine decides what `''` means.
 */
export function parseFusedResponse(raw: string): Map<string, LLMFinding[]> {
  const byLane = new Map<string, LLMFinding[]>();
  const push = (lane: string, findings: LLMFinding[]): void => {
    if (findings.length === 0) return;
    byLane.set(lane, [...(byLane.get(lane) ?? []), ...findings]);
  };
  try {
    const parsed = JSON.parse(stripFences(raw)) as { answers?: unknown; findings?: unknown };
    if (Array.isArray(parsed.answers)) {
      for (const answer of parsed.answers) {
        if (!answer || typeof answer !== 'object') continue;
        const entry = answer as Record<string, unknown>;
        const lane = typeof entry['lane'] === 'string' ? entry['lane'] : '';
        push(lane, toFindings(entry['findings']));
      }
      // **An answer that filled `answers` and left `findings` at the top level as well** is a reviewer hedging between
      // two contracts; both are read rather than one being discarded, because a finding is a sentence either way.
    }
    for (const found of toFindings(parsed.findings)) push(found.lane ?? '', [found]);
    return byLane;
  } catch {
    return byLane;
  }
}
