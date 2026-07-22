// @code-analyzer/intelligence — Rule Definitions (Pure Data)
// 50 production-grade deterministic rules across 6 categories.
// These are data-only definitions — checker functions live in rule-executor.ts.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuleCategory =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'style'
  | 'architecture';

export type RuleSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface RuleDefinition {
  id: string;
  category: RuleCategory;
  severity: RuleSeverity;
  title: string;
  description: string;
  cwe?: string;
  languageFilter?: string[];
}

// ===========================================================================
// CATEGORY 1: CORRECTNESS (8 Rules)
// ===========================================================================

export const NO_UNDEF: RuleDefinition = {
  id: 'no-undef',
  category: 'correctness',
  severity: 'high',
  title: 'Potentially undefined variable reference',
  description: 'Reference to a variable that has no visible declaration in the file.',
  languageFilter: ['typescript', 'javascript', 'python', 'go', 'rust', 'java'],
};

export const NO_DUPLICATE_IMPORTS: RuleDefinition = {
  id: 'no-duplicate-imports',
  category: 'correctness',
  severity: 'low',
  title: 'Duplicate import statement',
  description: 'The same module is imported more than once. Merge into a single import.',
  languageFilter: ['typescript', 'javascript'],
};

export const NO_UNREACHABLE_CODE: RuleDefinition = {
  id: 'no-unreachable-code',
  category: 'correctness',
  severity: 'medium',
  title: 'Unreachable code detected',
  description: 'Code that appears after return, throw, break, or continue statements will never execute.',
};

export const NO_CONSTANT_CONDITION: RuleDefinition = {
  id: 'no-constant-condition',
  category: 'correctness',
  severity: 'medium',
  title: 'Constant condition in control flow',
  description: 'Condition always evaluates to true or false, making the branch dead code or the loop infinite.',
};

export const NO_EMPTY_CATCH: RuleDefinition = {
  id: 'no-empty-catch',
  category: 'correctness',
  severity: 'medium',
  title: 'Empty catch block',
  description: 'Catch block does not handle the error — silently swallowing errors hides bugs.',
};

export const NO_UNUSED_VARS: RuleDefinition = {
  id: 'no-unused-vars',
  category: 'correctness',
  severity: 'low',
  title: 'Potentially unused variable',
  description: 'Variable is declared but never referenced within the same scope.',
};

export const NO_UNSAFE_OPTIONAL_CHAINING: RuleDefinition = {
  id: 'no-unsafe-optional-chaining',
  category: 'correctness',
  severity: 'medium',
  title: 'Potentially unsafe optional chaining',
  description: 'Optional chaining (?.) used where the left-hand value is known to be defined, suggesting a logic error.',
};

export const NO_ARRAY_INDEX_KEY: RuleDefinition = {
  id: 'no-array-index-key',
  category: 'correctness',
  severity: 'medium',
  title: 'Array index used as key',
  description: 'Using array index as a key in list rendering can cause rendering issues when items are reordered.',
  languageFilter: ['typescript', 'javascript'],
};

// ===========================================================================
// CATEGORY 2: SECURITY (12 Rules)
// ===========================================================================

export const NO_EVAL: RuleDefinition = {
  id: 'no-eval',
  category: 'security',
  severity: 'critical',
  title: 'Dynamic code execution detected (eval/Function)',
  description: 'eval() and Function() constructors allow arbitrary code execution, a critical security risk.',
  cwe: 'CWE-95',
};

export const NO_SQL_INJECTION: RuleDefinition = {
  id: 'no-sql-injection',
  category: 'security',
  severity: 'critical',
  title: 'Potential SQL injection',
  description: 'String concatenation or template interpolation in SQL query construction.',
  cwe: 'CWE-89',
};

export const NO_XSS: RuleDefinition = {
  id: 'no-xss',
  category: 'security',
  severity: 'critical',
  title: 'Cross-site scripting (XSS) vulnerability',
  description: 'Unsafe HTML manipulation that could allow XSS attacks.',
  cwe: 'CWE-79',
};

export const NO_HARDCODED_SECRETS: RuleDefinition = {
  id: 'no-hardcoded-secrets',
  category: 'security',
  severity: 'critical',
  title: 'Hardcoded secrets in source code',
  description: 'Passwords, API keys, tokens, or other credentials appear to be hardcoded.',
  cwe: 'CWE-798',
};

export const NO_COMMAND_INJECTION: RuleDefinition = {
  id: 'no-command-injection',
  category: 'security',
  severity: 'critical',
  title: 'Potential command injection',
  description: 'Shell command construction using string concatenation with user input.',
  cwe: 'CWE-78',
};

export const NO_PATH_TRAVERSAL: RuleDefinition = {
  id: 'no-path-traversal',
  category: 'security',
  severity: 'critical',
  title: 'Path traversal vulnerability',
  description: 'File path constructed from user input without sanitization.',
  cwe: 'CWE-22',
};

export const NO_OPEN_REDIRECT: RuleDefinition = {
  id: 'no-open-redirect',
  category: 'security',
  severity: 'high',
  title: 'Open redirect vulnerability',
  description: 'Redirect URL constructed from unvalidated user input.',
  cwe: 'CWE-601',
};

export const NO_UNSAFE_DESERIALIZATION: RuleDefinition = {
  id: 'no-unsafe-deserialization',
  category: 'security',
  severity: 'high',
  title: 'Unsafe deserialization',
  description: 'Deserializing untrusted data without error handling.',
  cwe: 'CWE-502',
};

export const NO_WEAK_CRYPTO: RuleDefinition = {
  id: 'no-weak-crypto',
  category: 'security',
  severity: 'high',
  title: 'Weak cryptographic algorithm',
  description: 'Use of deprecated or insecure cryptographic algorithms.',
  cwe: 'CWE-327',
};

export const NO_INSECURE_RANDOM: RuleDefinition = {
  id: 'no-insecure-random',
  category: 'security',
  severity: 'high',
  title: 'Insecure randomness source',
  description: 'Math.random() is not cryptographically secure for security-sensitive operations.',
  cwe: 'CWE-330',
};

export const NO_HTTP_URL: RuleDefinition = {
  id: 'no-http-url',
  category: 'security',
  severity: 'medium',
  title: 'Hardcoded HTTP URL',
  description: 'Hardcoded http:// URL should use https:// for secure communication.',
  cwe: 'CWE-319',
};

export const NO_DEBUG_STATEMENT: RuleDefinition = {
  id: 'no-debug-statement',
  category: 'security',
  severity: 'low',
  title: 'Debug statement in production code',
  description: 'Debug logging or breakpoints left in code may leak sensitive information.',
  cwe: 'CWE-489',
};

// ===========================================================================
// CATEGORY 3: PERFORMANCE (8 Rules)
// ===========================================================================

export const NO_SYNC_FS: RuleDefinition = {
  id: 'no-sync-fs',
  category: 'performance',
  severity: 'medium',
  title: 'Synchronous file system operation',
  description: 'Blocking file I/O blocks the event loop and degrades server performance.',
};

export const NO_LARGE_ARRAY_COPY: RuleDefinition = {
  id: 'no-large-array-copy',
  category: 'performance',
  severity: 'medium',
  title: 'Potentially expensive array spread',
  description: 'Spread operator on arrays can cause O(n) copies; avoid in hot paths.',
};

export const NO_INEFFICIENT_REGEX: RuleDefinition = {
  id: 'no-inefficient-regex',
  category: 'performance',
  severity: 'medium',
  title: 'Potentially inefficient regular expression',
  description: 'Regex pattern may cause catastrophic backtracking on certain inputs.',
};

export const NO_LOOP_AWAIT: RuleDefinition = {
  id: 'no-loop-await',
  category: 'performance',
  severity: 'medium',
  title: 'Await inside a loop',
  description: 'await inside for/while loops runs operations sequentially — use Promise.all for concurrency.',
};

export const NO_REDUNDANT_COMPUTATION: RuleDefinition = {
  id: 'no-redundant-computation',
  category: 'performance',
  severity: 'low',
  title: 'Redundant computation detected',
  description: 'The same expression is computed multiple times within a scope — cache the result.',
};

export const AVOID_BLOCKING_OPERATIONS: RuleDefinition = {
  id: 'avoid-blocking-operations',
  category: 'performance',
  severity: 'medium',
  title: 'Potentially blocking synchronous operation',
  description: 'CPU-intensive synchronous operations can block the event loop.',
};

export const PREFER_LAZY_LOADING: RuleDefinition = {
  id: 'prefer-lazy-loading',
  category: 'performance',
  severity: 'low',
  title: 'Consider lazy loading for heavy imports',
  description: 'Static imports of heavy modules at module level increase startup time.',
};

export const NO_N_PLUS_ONE: RuleDefinition = {
  id: 'no-n-plus-one',
  category: 'performance',
  severity: 'high',
  title: 'Potential N+1 query pattern',
  description: 'Database query inside a loop can cause N+1 performance problems.',
};

// ===========================================================================
// CATEGORY 4: MAINTAINABILITY (10 Rules)
// ===========================================================================

export const MAX_FUNCTION_LINES: RuleDefinition = {
  id: 'max-function-lines',
  category: 'maintainability',
  severity: 'medium',
  title: 'Function exceeds maximum line limit',
  description: 'Function exceeds 50 lines. Consider splitting into smaller, focused functions.',
};

export const MAX_PARAMS: RuleDefinition = {
  id: 'max-params',
  category: 'maintainability',
  severity: 'medium',
  title: 'Too many function parameters',
  description: 'Function has more than 5 parameters, making it difficult to understand and use.',
};

export const MAX_NESTING_DEPTH: RuleDefinition = {
  id: 'max-nesting-depth',
  category: 'maintainability',
  severity: 'high',
  title: 'Excessive nesting depth',
  description: 'Nesting depth exceeds 4 levels. Deep nesting makes code harder to read and test.',
};

export const MAX_CYCLOMATIC_COMPLEXITY: RuleDefinition = {
  id: 'max-cyclomatic-complexity',
  category: 'maintainability',
  severity: 'medium',
  title: 'High cyclomatic complexity',
  description: 'Function has high cyclomatic complexity (>15), making it difficult to maintain.',
};

export const NO_MAGIC_NUMBERS: RuleDefinition = {
  id: 'no-magic-numbers',
  category: 'maintainability',
  severity: 'low',
  title: 'Magic number without explanation',
  description: 'Numeric literals used without being assigned to a named constant.',
};

export const NO_TODO_FIXME: RuleDefinition = {
  id: 'no-todo-fixme',
  category: 'maintainability',
  severity: 'low',
  title: 'Unresolved TODO or FIXME comment',
  description: 'TODO/FIXME comments without a ticket reference may never be addressed.',
};

export const CONSISTENT_NAMING: RuleDefinition = {
  id: 'consistent-naming',
  category: 'maintainability',
  severity: 'low',
  title: 'Inconsistent naming convention',
  description: 'Mixed or non-standard naming conventions detected.',
};

export const NO_DEAD_CODE: RuleDefinition = {
  id: 'no-dead-code',
  category: 'maintainability',
  severity: 'low',
  title: 'Commented-out code block',
  description: 'Large blocks of commented-out code should be removed — use version control instead.',
};

export const NO_GOD_CLASS: RuleDefinition = {
  id: 'no-god-class',
  category: 'maintainability',
  severity: 'medium',
  title: 'God class anti-pattern',
  description: 'Class has too many methods (>20) or too many lines (>500).',
};

export const PREFER_EARLY_RETURN: RuleDefinition = {
  id: 'prefer-early-return',
  category: 'maintainability',
  severity: 'low',
  title: 'Deeply nested if-else — consider early return',
  description: 'Deeply nested if-else blocks can be flattened with early returns or guard clauses.',
};

// ===========================================================================
// CATEGORY 5: STYLE (6 Rules)
// ===========================================================================

export const TRAILING_WHITESPACE: RuleDefinition = {
  id: 'trailing-whitespace',
  category: 'style',
  severity: 'low',
  title: 'Trailing whitespace',
  description: 'Lines should not have trailing whitespace characters.',
};

export const NO_CONSOLE: RuleDefinition = {
  id: 'no-console',
  category: 'style',
  severity: 'low',
  title: 'console statement in production code',
  description: 'console.log/warn/error should be replaced with a proper logging library.',
};

export const CONSISTENT_QUOTES: RuleDefinition = {
  id: 'consistent-quotes',
  category: 'style',
  severity: 'low',
  title: 'Inconsistent quote style',
  description: 'File uses a mix of single and double quotes — pick one and stay consistent.',
};

export const NO_LONG_LINES: RuleDefinition = {
  id: 'no-long-lines',
  category: 'style',
  severity: 'low',
  title: 'Line exceeds maximum length',
  description: 'Lines exceeding 120 characters are difficult to read and review.',
};

export const SPACING_CONSISTENCY: RuleDefinition = {
  id: 'spacing-consistency',
  category: 'style',
  severity: 'low',
  title: 'Inconsistent spacing around operators',
  description: 'Inconsistent spacing around operators reduces readability.',
};

export const FILE_HEADER: RuleDefinition = {
  id: 'file-header',
  category: 'style',
  severity: 'low',
  title: 'Missing file header comment',
  description: 'File should have a header comment describing its purpose and package.',
};

// ===========================================================================
// CATEGORY 6: ARCHITECTURE (6 Rules)
// ===========================================================================

export const NO_CIRCULAR_DEPS: RuleDefinition = {
  id: 'no-circular-deps',
  category: 'architecture',
  severity: 'high',
  title: 'Circular dependency detected',
  description: 'Circular dependencies between modules cause tight coupling and make the codebase fragile.',
};

export const NO_LAYER_VIOLATION: RuleDefinition = {
  id: 'no-layer-violation',
  category: 'architecture',
  severity: 'high',
  title: 'Layer import violation',
  description: 'Lower layer importing from an upper layer, violating layered architecture.',
};

export const NO_BARREL_EXPORT: RuleDefinition = {
  id: 'no-barrel-export',
  category: 'architecture',
  severity: 'low',
  title: 'Barrel export anti-pattern',
  description: 'Barrel exports (export * from) can cause circular dependencies and tree-shaking issues.',
};

export const MAX_MODULE_SIZE: RuleDefinition = {
  id: 'max-module-size',
  category: 'architecture',
  severity: 'medium',
  title: 'Module may be too large',
  description: 'Module appears to contain too many files (>30), making it difficult to maintain.',
};

export const NO_CROSS_BOUNDARY_ACCESS: RuleDefinition = {
  id: 'no-cross-boundary-access',
  category: 'architecture',
  severity: 'medium',
  title: 'Cross-boundary access detected',
  description: 'Accessing internal/private symbols across module boundaries.',
};

export const MISSING_ABSTRACTION: RuleDefinition = {
  id: 'missing-abstraction',
  category: 'architecture',
  severity: 'medium',
  title: 'Concrete class used where interface expected',
  description: 'Direct usage of concrete classes instead of interfaces reduces flexibility.',
};

// ---------------------------------------------------------------------------
// Master Rule Set
// ---------------------------------------------------------------------------

/** All 50 rule definitions in a single array, ordered by category. */
export const ALL_RULE_DEFINITIONS: RuleDefinition[] = [
  // Correctness (8)
  NO_UNDEF,
  NO_DUPLICATE_IMPORTS,
  NO_UNREACHABLE_CODE,
  NO_CONSTANT_CONDITION,
  NO_EMPTY_CATCH,
  NO_UNUSED_VARS,
  NO_UNSAFE_OPTIONAL_CHAINING,
  NO_ARRAY_INDEX_KEY,

  // Security (12)
  NO_EVAL,
  NO_SQL_INJECTION,
  NO_XSS,
  NO_HARDCODED_SECRETS,
  NO_COMMAND_INJECTION,
  NO_PATH_TRAVERSAL,
  NO_OPEN_REDIRECT,
  NO_UNSAFE_DESERIALIZATION,
  NO_WEAK_CRYPTO,
  NO_INSECURE_RANDOM,
  NO_HTTP_URL,
  NO_DEBUG_STATEMENT,

  // Performance (8)
  NO_SYNC_FS,
  NO_LARGE_ARRAY_COPY,
  NO_INEFFICIENT_REGEX,
  NO_LOOP_AWAIT,
  NO_REDUNDANT_COMPUTATION,
  AVOID_BLOCKING_OPERATIONS,
  PREFER_LAZY_LOADING,
  NO_N_PLUS_ONE,

  // Maintainability (10)
  MAX_FUNCTION_LINES,
  MAX_PARAMS,
  MAX_NESTING_DEPTH,
  MAX_CYCLOMATIC_COMPLEXITY,
  NO_MAGIC_NUMBERS,
  NO_TODO_FIXME,
  CONSISTENT_NAMING,
  NO_DEAD_CODE,
  NO_GOD_CLASS,
  PREFER_EARLY_RETURN,

  // Style (6)
  TRAILING_WHITESPACE,
  NO_CONSOLE,
  CONSISTENT_QUOTES,
  NO_LONG_LINES,
  SPACING_CONSISTENCY,
  FILE_HEADER,

  // Architecture (6)
  NO_CIRCULAR_DEPS,
  NO_LAYER_VIOLATION,
  NO_BARREL_EXPORT,
  MAX_MODULE_SIZE,
  NO_CROSS_BOUNDARY_ACCESS,
  MISSING_ABSTRACTION,
];
