// @code-analyzer/intelligence — LLM Review Prompt Templates
// Structured prompts for each review lane with few-shot examples.

import type { ReviewCategory, Severity } from '@code-analyzer/shared';

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
`;

// ---------------------------------------------------------------------------
// Security Review Prompt
// ---------------------------------------------------------------------------

export function SECURITY_REVIEW_PROMPT(ctx: PromptContext): string {
  return `You are an expert security reviewer performing a detailed security audit of a code change. Your focus is on the OWASP Top 10 vulnerabilities including injection flaws, broken authentication, sensitive data exposure, XML external entities, broken access control, security misconfiguration, cross-site scripting, insecure deserialization, use of vulnerable components, and insufficient logging/monitoring.

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

File: ${ctx.filePath}
Change type: ${ctx.changeType}
${ctx.fileContext ? `File context:\n${ctx.fileContext}\n` : ''}

Diff content:
\`\`\`
${ctx.diffContent}
\`\`\`

Return a JSON object with this exact structure. Only include findings you are confident about — an empty findings array is acceptable if no issues are found:
${SELECTION_RULES}${OUTPUT_SCHEMA}

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
}

// ---------------------------------------------------------------------------
// Performance Review Prompt
// ---------------------------------------------------------------------------

export function PERFORMANCE_REVIEW_PROMPT(ctx: PromptContext): string {
  return `You are an expert performance engineer reviewing a code change for performance issues. Your focus is on algorithmic efficiency, resource utilization, and scalability.

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

File: ${ctx.filePath}
Change type: ${ctx.changeType}
${ctx.fileContext ? `File context:\n${ctx.fileContext}\n` : ''}

Diff content:
\`\`\`
${ctx.diffContent}
\`\`\`

Return a JSON object with this exact structure:
${SELECTION_RULES}${OUTPUT_SCHEMA}

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
}

// ---------------------------------------------------------------------------
// Maintainability Review Prompt
// ---------------------------------------------------------------------------

export function MAINTAINABILITY_REVIEW_PROMPT(ctx: PromptContext): string {
  return `You are an expert code quality reviewer evaluating a code change for maintainability. You apply SOLID principles, code smell detection, and readability analysis.

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

File: ${ctx.filePath}
Change type: ${ctx.changeType}
${ctx.fileContext ? `File context:\n${ctx.fileContext}\n` : ''}

Diff content:
\`\`\`
${ctx.diffContent}
\`\`\`

Return a JSON object with this exact structure:
${SELECTION_RULES}${OUTPUT_SCHEMA}

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
}

// ---------------------------------------------------------------------------
// Testing Review Prompt
// ---------------------------------------------------------------------------

export function TESTING_REVIEW_PROMPT(ctx: PromptContext): string {
  return `You are an expert test engineer reviewing a code change for testing quality. Your focus is on test coverage, assertion quality, and test reliability.

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

File: ${ctx.filePath}
Change type: ${ctx.changeType}
${ctx.fileContext ? `File context:\n${ctx.fileContext}\n` : ''}

Diff content:
\`\`\`
${ctx.diffContent}
\`\`\`

Return a JSON object with this exact structure:
${SELECTION_RULES}${OUTPUT_SCHEMA}

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
}

// ---------------------------------------------------------------------------
// Architecture Review Prompt
// ---------------------------------------------------------------------------

export function ARCHITECTURE_REVIEW_PROMPT(ctx: PromptContext): string {
  return `You are an expert software architect reviewing a code change for architectural integrity. Your focus is on layer violations, circular dependencies, and structural soundness.

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

File: ${ctx.filePath}
Change type: ${ctx.changeType}
${ctx.fileContext ? `File context:\n${ctx.fileContext}\n` : ''}

Diff content:
\`\`\`
${ctx.diffContent}
\`\`\`

Return a JSON object with this exact structure:
${SELECTION_RULES}${OUTPUT_SCHEMA}

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
      .map((f: LLMFinding) => ({
        ...f,
        description: f.description ?? '',
        suggestion: f.suggestion ?? null,
      }));
  } catch {
    return [];
  }
}
