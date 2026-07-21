// @code-analyzer/intelligence — Review Lenses
// Eight specialized review lenses for the PR Review Swarm.
// Each lens defines WHAT to check, with deterministic analysis rules.

import type {
  ReviewComment,
  ReviewCategory,
  Severity,
  GitDiff,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Lens Types
// ---------------------------------------------------------------------------

/** Lens identifiers — one per specialized analysis dimension */
export type LensId =
  | 'structure'
  | 'security'
  | 'performance'
  | 'testing'
  | 'style'
  | 'api'
  | 'docs'
  | 'synthesis';

/** Evidence anchor — required for every finding to be accepted by synthesis */
export interface EvidenceAnchor {
  /** Absolute or repo-relative file path */
  filePath: string;
  /** 1-based start line */
  startLine: number;
  /** 1-based end line */
  endLine: number;
  /** Actual code — minimum 1 line, maximum 20 lines */
  codeSnippet: string;
  /** Which lens produced this finding */
  lens: LensId;
  /** Standards rule ID if applicable */
  ruleId?: string;
  /** Cypher query or graph node reference if applicable */
  graphRef?: string;
}

/** A single finding from one lens */
export interface LensFinding {
  /** Unique finding ID (lens-prefixed, e.g. "sec-001") */
  id: string;
  /** Which lens produced this */
  lens: LensId;
  /** Review category */
  category: ReviewCategory;
  /** Severity level */
  severity: Severity;
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Suggested fix code (optional) */
  suggestion?: string;
  /** Evidence anchor — MUST be present */
  evidence: EvidenceAnchor;
  /** Whether this finding is auto-fixable */
  autoFixable: boolean;
  /**
   * Confidence level:
   * - 'rule': deterministic regex match (high confidence, may have false positives)
   * - 'heuristic': pattern-based detection (medium confidence)
   * - 'graph': knowledge graph-backed analysis (high confidence)
   * - 'low': weak signal — needs LLM validation
   */
  confidence: 'rule' | 'heuristic' | 'graph' | 'low';
  /**
   * Knowledge graph context — related entities from the code intelligence graph.
   * Populated during enrichment phase if a SqliteStore is available.
   */
  graphContext?: {
    /** Callers of the flagged function */
    callers: string[];
    /** Functions called by the flagged code */
    callees: string[];
    /** Related test files */
    relatedTests: string[];
    /** Cross-repo references */
    crossRepoRefs: string[];
  };
}

/** Complete output from one lens */
export interface LensReport {
  /** Lens identifier */
  lens: LensId;
  /** Human-readable lens name */
  name: string;
  /** All findings from this lens */
  findings: LensFinding[];
  /** Files scanned by this lens */
  filesScanned: number;
  /** Lines of code analyzed */
  linesAnalyzed: number;
  /** Duration in milliseconds */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Lens Profile Definitions
// ---------------------------------------------------------------------------

export interface LensProfile {
  id: LensId;
  name: string;
  description: string;
  /** MCP tools recommended for this lens */
  mcpTools: string[];
  /** Standards templates to apply */
  standards: string[];
  /** Categories of findings this lens produces */
  categories: ReviewCategory[];
  /** Default severity for new findings from this lens */
  defaultSeverity: Severity;
  /** Priority in synthesis (lower = earlier) */
  priority: number;
}

export const LENS_PROFILES: Record<LensId, LensProfile> = {
  structure: {
    id: 'structure',
    name: 'Structure Lens',
    description: 'Architectural integrity — layer violations, circular dependencies, module boundaries, orphan code',
    mcpTools: ['query_cypher', 'get_architecture', 'trace_path'],
    standards: ['architecture-layered', 'dependency-management'],
    categories: ['architecture', 'structure'],
    defaultSeverity: 'high',
    priority: 1,
  },
  security: {
    id: 'security',
    name: 'Security Lens',
    description: 'Vulnerability detection — SQL injection, XSS, hardcoded secrets, path traversal, weak cryptography',
    mcpTools: ['check_standards', 'search_code', 'query_cypher'],
    standards: ['security-essentials', 'security-baseline'],
    categories: ['security'],
    defaultSeverity: 'critical',
    priority: 2,
  },
  performance: {
    id: 'performance',
    name: 'Performance Lens',
    description: 'Runtime efficiency — N+1 queries, O(n²) patterns, blocking operations, resource leaks, memory issues',
    mcpTools: ['query_cypher', 'trace_path', 'analyze_impact'],
    standards: ['architecture-layered'],
    categories: ['performance'],
    defaultSeverity: 'medium',
    priority: 3,
  },
  testing: {
    id: 'testing',
    name: 'Testing Lens',
    description: 'Test quality — missing test coverage, flaky patterns, skipped tests, edge case gaps',
    mcpTools: ['query_cypher', 'trace_path', 'search_code'],
    standards: ['testing-standards'],
    categories: ['testing'],
    defaultSeverity: 'medium',
    priority: 4,
  },
  style: {
    id: 'style',
    name: 'Style Lens',
    description: 'Code style — naming conventions, function length, nesting depth, magic numbers, duplication',
    mcpTools: ['check_standards', 'search_code'],
    standards: ['typescript-coding', 'python-pep8', 'go-idiomatic'],
    categories: ['style', 'maintainability'],
    defaultSeverity: 'low',
    priority: 5,
  },
  api: {
    id: 'api',
    name: 'API Lens',
    description: 'API contract integrity — breaking changes, missing validation, inconsistent responses, auth gaps',
    mcpTools: ['query_cypher', 'analyze_impact', 'get_architecture'],
    standards: ['api-design'],
    categories: ['api', 'security'],
    defaultSeverity: 'high',
    priority: 6,
  },
  docs: {
    id: 'docs',
    name: 'Docs Lens',
    description: 'Documentation completeness — missing JSDoc, undocumented APIs, stale docs, missing changelog',
    mcpTools: ['search_code', 'get_architecture'],
    standards: ['documentation'],
    categories: ['documentation'],
    defaultSeverity: 'low',
    priority: 7,
  },
  synthesis: {
    id: 'synthesis',
    name: 'Synthesis Lens',
    description: 'HARD GATE — evidence validation, IoU dedup, severity calibration, consensus merge, action plan, block/approve decision',
    mcpTools: ['generate_report', 'get_trends'],
    standards: [],
    categories: [],
    defaultSeverity: 'info',
    priority: 99, // Always runs last
  },
};

/** Get lens profiles sorted by priority */
export function getLensProfiles(): LensProfile[] {
  return Object.values(LENS_PROFILES).sort((a, b) => a.priority - b.priority);
}

// ---------------------------------------------------------------------------
// Deterministic Analysis Rules
// ---------------------------------------------------------------------------

/**
 * Security patterns detected deterministically (no LLM needed).
 * These are regex-based patterns that the Security Lens checks.
 */
export const SECURITY_PATTERNS: Array<{
  id: string;
  name: string;
  severity: Severity;
  pattern: RegExp;
  description: string;
  suggestion: string;
}> = [
  {
    id: 'sec-eval',
    name: 'Dynamic Code Execution',
    severity: 'critical',
    pattern: /\beval\s*\(/,
    description: 'eval() allows arbitrary code execution and is a severe security risk.',
    suggestion: 'Use JSON.parse() for data parsing, or refactor to avoid dynamic code execution.',
  },
  {
    id: 'sec-new-function',
    name: 'Function Constructor',
    severity: 'critical',
    pattern: /\bnew\s+Function\s*\(/,
    description: 'new Function() is equivalent to eval() and poses the same security risks.',
    suggestion: 'Avoid dynamic function creation. Use static function definitions instead.',
  },
  {
    id: 'sec-sql-concat',
    name: 'SQL String Concatenation',
    severity: 'critical',
    pattern: /(["'`]\s*\+\s*|\$\{[^}]*\}\s*\+\s*|\+\s*["'`])/,
    description: 'String concatenation in SQL queries enables SQL injection attacks.',
    suggestion: 'Use parameterized queries or query builders (e.g., ? placeholders, :named params).',
  },
  {
    id: 'sec-hardcoded-key',
    name: 'Hardcoded API Key',
    severity: 'critical',
    pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*["'][\w\-._]{8,}["']/i,
    description: 'API keys and secrets committed to source code are exposed to anyone with repository access.',
    suggestion: 'Use environment variables (process.env.SECRET) or a secrets manager.',
  },
  {
    id: 'sec-hardcoded-password',
    name: 'Hardcoded Password',
    severity: 'critical',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{3,}["'](?!\s*[;,]?\s*\/\/\s*(?:nosec|no-check))/i,
    description: 'Hardcoded passwords are visible in version control and logs.',
    suggestion: 'Use environment variables or a secure credential store.',
  },
  {
    id: 'sec-xss-innerhtml',
    name: 'XSS via innerHTML',
    severity: 'high',
    pattern: /\.innerHTML\s*=/,
    description: 'Setting innerHTML with unsanitized user input enables XSS attacks.',
    suggestion: 'Use textContent, createElement, or sanitize with DOMPurify before using innerHTML.',
  },
  {
    id: 'sec-xss-dangerously',
    name: 'XSS via dangerouslySetInnerHTML',
    severity: 'high',
    pattern: /dangerouslySetInnerHTML\s*[:=]/,
    description: 'React dangerouslySetInnerHTML bypasses XSS protection.',
    suggestion: 'Use regular JSX rendering, or sanitize HTML with a library like DOMPurify.',
  },
  {
    id: 'sec-path-traversal',
    name: 'Path Traversal',
    severity: 'high',
    pattern: /path\.(?:resolve|join)\s*\(\s*(?:__dirname|process\.cwd\(\))\s*,\s*(?:req\.|request\.|params\.|query\.|body\.)/,
    description: 'Unsanitized user input in file paths enables path traversal attacks.',
    suggestion: 'Validate and sanitize user input, use path.basename() to strip directory components.',
  },
  {
    id: 'sec-weak-crypto-md5',
    name: 'Weak Crypto: MD5',
    severity: 'high',
    pattern: /\b(?:md5|MD5)\b/,
    description: 'MD5 is cryptographically broken — collisions can be generated in seconds.',
    suggestion: 'Use SHA-256 or SHA-3 for hashing. For passwords, use bcrypt, scrypt, or argon2.',
  },
  {
    id: 'sec-weak-crypto-sha1',
    name: 'Weak Crypto: SHA-1',
    severity: 'high',
    pattern: /\b(?:sha1|SHA-?1)\b/,
    description: 'SHA-1 is deprecated — practical collision attacks exist (SHAttered).',
    suggestion: 'Use SHA-256 or SHA-3 instead.',
  },
];

/**
 * Performance anti-patterns detected deterministically.
 */
export const PERFORMANCE_PATTERNS: Array<{
  id: string;
  name: string;
  severity: Severity;
  detection: (lines: string[], filePath: string) => Array<{ startLine: number; endLine: number }>;
  description: string;
  suggestion: string;
}> = [
  {
    id: 'perf-sync-in-handler',
    name: 'Synchronous I/O in Handler',
    severity: 'high',
    detection: (lines) => {
      const findings: Array<{ startLine: number; endLine: number }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (/\breadFileSync\b|\bwriteFileSync\b|\bexistsSync\b|\bmkdirSync\b|\brmdirSync\b/.test(lines[i]!)) {
          findings.push({ startLine: i + 1, endLine: i + 1 });
        }
      }
      return findings;
    },
    description: 'Synchronous file operations block the event loop in request handlers.',
    suggestion: 'Use async versions: fs.promises.readFile(), fs.promises.writeFile(), etc.',
  },
  {
    id: 'perf-nested-loop',
    name: 'Nested Loop (Potential O(n²))',
    severity: 'medium',
    detection: (lines) => {
      const findings: Array<{ startLine: number; endLine: number }> = [];
      let depth = 0;
      let loopStart = 0;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i]!.trim();
        if (/\bfor\s*\(|\bwhile\s*\(|\bforEach\b|\bmap\b/.test(trimmed)) {
          if (depth === 0) loopStart = i + 1;
          depth++;
          if (depth >= 2) {
            findings.push({ startLine: loopStart, endLine: i + 1 });
          }
        }
        if (trimmed === '}' || trimmed === '});' || trimmed === ');') {
          depth = Math.max(0, depth - 1);
        }
      }
      return findings;
    },
    description: 'Nested loops can cause O(n²) runtime. Check if the inner loop can be avoided.',
    suggestion: 'Consider using Map/Set for O(1) lookups, or extract the inner loop to a helper.',
  },
  {
    id: 'perf-memory-leak',
    name: 'Potential Memory Leak',
    severity: 'medium',
    detection: (lines) => {
      const findings: Array<{ startLine: number; endLine: number }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (/\bsetInterval\b/.test(lines[i]!) && !lines.slice(i, i + 5).some(l => /\bclearInterval\b/.test(l))) {
          findings.push({ startLine: i + 1, endLine: i + 1 });
        }
      }
      return findings;
    },
    description: 'setInterval without corresponding clearInterval can cause memory leaks.',
    suggestion: 'Store the interval ID and call clearInterval in cleanup (useEffect return, componentWillUnmount, or try/finally).',
  },
];

/**
 * Testing anti-patterns detected deterministically.
 */
export const TESTING_PATTERNS: Array<{
  id: string;
  name: string;
  severity: Severity;
  pattern: RegExp;
  description: string;
  suggestion: string;
}> = [
  {
    id: 'test-only',
    name: 'Focused Test Left in Code',
    severity: 'high',
    pattern: /\b(?:test|it)\.only\b/,
    description: 'test.only/it.only causes other tests to be skipped, hiding failures.',
    suggestion: 'Remove .only before committing. Use test filtering via CLI instead.',
  },
  {
    id: 'test-skip',
    name: 'Skipped Test',
    severity: 'medium',
    pattern: /\b(?:test|it)\.skip\b|\bxit\b|\bxtest\b/,
    description: 'Skipped tests hide potential bugs. If intentional, add a comment explaining why.',
    suggestion: 'Fix the test or add a comment: // TODO: re-enable after fixing issue #123.',
  },
  {
    id: 'test-no-assert',
    name: 'Test Without Assertion',
    severity: 'medium',
    pattern: /\b(?:test|it)\s*\(\s*["'][^"']+["']\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[^}]*\}\s*\)/,
    description: 'Tests without assertions always pass regardless of correctness.',
    suggestion: 'Add at least one expect() or assert() call to verify behavior.',
  },
  {
    id: 'test-no-edge-cases',
    name: 'Missing Edge Case Tests',
    severity: 'low',
    pattern: /\bexpect\b/, // This is a marker — the actual check is heuristic
    description: 'Function handles null/undefined inputs — verify edge case tests exist.',
    suggestion: 'Add tests for: null, undefined, empty string, empty array, negative numbers.',
  },
];

// ---------------------------------------------------------------------------
// Lens Helpers
// ---------------------------------------------------------------------------

/**
 * Build a lens finding with evidence anchor.
 * If evidence is missing (no filePath or codeSnippet), returns null.
 * This ensures the synthesis HARD GATE can reject unanchored findings.
 */
export function createLensFinding(
  lens: LensId,
  category: ReviewCategory,
  severity: Severity,
  title: string,
  description: string,
  evidence: EvidenceAnchor,
  options?: {
    suggestion?: string;
    autoFixable?: boolean;
    ruleId?: string;
    graphRef?: string;
  },
): LensFinding | null {
  // HARD GATE check: every finding must have evidence
  if (!evidence.filePath || !evidence.codeSnippet || evidence.startLine <= 0) {
    return null;
  }

  const profile = LENS_PROFILES[lens];
  return {
    id: `${lens.slice(0, 3)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    lens,
    category,
    severity,
    title,
    description,
    suggestion: options?.suggestion,
    evidence: {
      ...evidence,
      lens,
      ruleId: options?.ruleId ?? evidence.ruleId,
      graphRef: options?.graphRef ?? evidence.graphRef,
    },
    autoFixable: options?.autoFixable ?? false,
    // Assign confidence based on lens type:
    // - security, style, testing: rule-based (regex match) → 'rule' confidence
    // - performance, api, structure: heuristic → 'heuristic' confidence
    // - docs: pattern-based → 'low' confidence (needs LLM validation)
    confidence:
      lens === 'security' || lens === 'style' || lens === 'testing'
        ? 'rule'
        : lens === 'docs'
          ? 'low'
          : 'heuristic',
  };
}

/**
 * Convert lens findings to ReviewComment format for the existing review pipeline.
 */
export function lensFindingToReviewComment(finding: LensFinding): ReviewComment {
  return {
    filePath: finding.evidence.filePath,
    startLine: finding.evidence.startLine,
    endLine: finding.evidence.endLine,
    existingCode: finding.evidence.codeSnippet,
    category: finding.category,
    severity: finding.severity,
    title: `[${finding.lens}] ${finding.title}`,
    description: finding.description,
    suggestionCode: finding.suggestion ?? null,
  };
}

/**
 * Get the lens profile by ID.
 */
export function getLensProfile(id: LensId): LensProfile {
  return LENS_PROFILES[id];
}
