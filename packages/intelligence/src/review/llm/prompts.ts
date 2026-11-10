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
      "suggestion": "<suggested fix> | null
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
 * On the AACR corpus, **98 of 170 goldens were missed by a finding on their own file**, and re-reading the corpus's
 * `from_line` against the findings' ranges put **40 of those 98 on the golden's own line and 73 within ten lines of
 * it** (`docs/EVAL-CONTRACT.md` §15.4). **So the lanes were not looking in the wrong place** - they were standing in the
 * right one and describing something the judge would not call the same defect.
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
   the last measurement bought**: of 98 goldens whose file we commented on and whose line we commented on within ten
   lines, **we matched none**, so a finding in the right place that describes the wrong thing is this corpus's dominant
   loss. A suggestion that names no failure cannot be right or wrong, which is why it is not reported.`;

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
      "suggestion": "<suggested fix> | null
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
 * **What the call is about, said the way the scope allows.**
 *
 * A file call names one file and may carry surrounding context. **A pull-request call names the files it shows**,
 * because rule 2 of its contract asks the model to choose one of them and **a choice the model cannot read is not a
 * choice.**
 */
export function describeTarget(ctx: PromptContext): string {
  if (ctx.scope === 'pull-request') {
    const paths = ctx.paths ?? [];
    return `Pull request: ${paths.length} file${paths.length === 1 ? '' : 's'} in one diff.
Paths in this pull request:
${paths.map((path) => `- ${path}`).join('\n')}
`;
  }
  return `File: ${ctx.filePath}
Change type: ${ctx.changeType}
${ctx.fileContext ? `File context:\n${ctx.fileContext}\n` : ''}`;
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
// Prompt Registry
// ---------------------------------------------------------------------------

/** All available review lanes with their associated prompt builders. */
export type ReviewLane =
  'security' | 'performance' | 'maintainability' | 'testing' | 'architecture';

export const LANE_PROMPTS: Record<ReviewLane, (ctx: PromptContext) => string> = {
  security: SECURITY_REVIEW_PROMPT,
  performance: PERFORMANCE_REVIEW_PROMPT,
  maintainability: MAINTAINABILITY_REVIEW_PROMPT,
  testing: TESTING_REVIEW_PROMPT,
  architecture: ARCHITECTURE_REVIEW_PROMPT,
};

/** Labels for each review lane (human-readable). */
export const LANE_LABELS: Record<ReviewLane, string> = {
  security: 'Security Review',
  performance: 'Performance Review',
  maintainability: 'Maintainability Review',
  testing: 'Testing Review',
  architecture: 'Architecture Review',
};

/** Review lanes sorted by priority (most critical first). */
export const LANE_PRIORITIES: ReviewLane[] = [
  'security',
  'architecture',
  'performance',
  'maintainability',
  'testing',
];

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the raw JSON response from an LLM review lane into structured findings.
 * Handles common formatting issues like markdown code fences.
 */
export function parseLLMResponse(raw: string): LLMFinding[] {
  // Strip markdown code fences if present
  let json = raw.trim();

  if (json.startsWith('```')) {
    const firstNewline = json.indexOf('\n');
    json = json.slice(firstNewline + 1);
    if (json.endsWith('```')) {
      json = json.slice(0, -3).trim();
    }
  }

  try {
    const parsed = JSON.parse(json) as { findings?: LLMFinding[] };

    if (!Array.isArray(parsed.findings)) {
      return [];
    }

    return parsed.findings
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
        // **A path is passed through only when it is a string.** The spread above copies whatever JSON held, and a
        // number in that field would be a `path` the type promises is a path. **The engine decides whether the path
        // names a file the call showed** - this only refuses to carry a value that is not one.
        const raw: Record<string, unknown> = f as unknown as Record<string, unknown>;
        return typeof raw['path'] === 'string' ? { ...base, path: raw['path'] } : base;
      });
  } catch {
    return [];
  }
}
