// @code-analyzer/intelligence — Heuristic Analysis Rules
// Static analysis rules for detecting code issues without LLM dependency.

import type {
  ReviewComment,
  ReviewCategory,
  Severity,
  GitDiff,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Rule Result Types
// ---------------------------------------------------------------------------

export interface HeuristicRuleResult {
  triggered: boolean;
  category: ReviewCategory;
  severity: Severity;
  title: string;
  description: string;
  suggestionCode: string | null;
  startLine: number;
  endLine: number;
}

export interface HeuristicResult {
  filePath: string;
  issues: HeuristicRuleResult[];
}

// ---------------------------------------------------------------------------
// Code Pattern Analysis
// ---------------------------------------------------------------------------

/** Rule: Long functions (>50 lines) — maintainability concern */
function checkLongFunction(lines: string[], _filePath: string): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];
  const threshold = 50;

  let inFunction = false;
  let funcStart = 0;
  let braceDepth = 0;
  let funcName = 'anonymous';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Detect function declarations
    const funcMatch = trimmed.match(
      /^(?:export\s+)?(?:async\s+)?(?:static\s+)?function\s+(\w+)/,
    );
    const arrowMatch = trimmed.match(
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
    );
    const methodMatch = trimmed.match(/^\s*(?:public|private|protected|static|async)?\s*(\w+)\s*\(/);

    if (funcMatch || arrowMatch || methodMatch) {
      const name = funcMatch?.[1] ?? arrowMatch?.[1] ?? methodMatch?.[1] ?? 'function';
      if (!inFunction) {
        inFunction = true;
        funcStart = i;
        braceDepth = 0;
        funcName = name;
      }
    }

    if (inFunction) {
      // Track brace depth
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      // Function body ends when braces balance and we started with at least 1
      if (braceDepth === 0 && i > funcStart + 1) {
        const funcLines = i - funcStart + 1;
        if (funcLines > threshold) {
          results.push({
            triggered: true,
            category: 'maintainability',
            severity: 'medium',
            title: `Long function: ${funcName}`,
            description: `Function "${funcName}" is ${funcLines} lines long (threshold: ${threshold}). Consider splitting into smaller, focused functions.`,
            suggestionCode: `// Break "${funcName}" into smaller functions.
// Extract logical blocks into helper functions with clear names.`,
            startLine: funcStart + 1,
            endLine: i + 1,
          });
        }
        inFunction = false;
      }
    }
  }

  // Handle case where file ends without closing brace
  if (inFunction) {
    const funcLines = lines.length - funcStart;
    if (funcLines > threshold) {
      results.push({
        triggered: true,
        category: 'maintainability',
        severity: 'medium',
        title: `Long function: ${funcName}`,
        description: `Function "${funcName}" is ${funcLines} lines long (threshold: ${threshold}). Consider splitting into smaller functions.`,
        suggestionCode: `// Break "${funcName}" into smaller, focused functions.`,
        startLine: funcStart + 1,
        endLine: lines.length,
      });
    }
  }

  return results;
}

/** Rule: Deep nesting (>4 levels) — complexity concern */
function checkDeepNesting(lines: string[], _filePath: string): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];
  const threshold = 4;

  let cumulativeDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimLeft();

    // Count net { and } on this line to adjust cumulative depth
    let netBraces = 0;
    for (const ch of trimmed) {
      if (ch === '{') netBraces++;
      if (ch === '}') netBraces--;
    }
    cumulativeDepth += netBraces;

    if (cumulativeDepth > threshold) {
      results.push({
        triggered: true,
        category: 'maintainability',
        severity: 'high',
        title: 'Deeply nested code',
        description: `Nesting depth exceeds ${threshold} levels at line ${i + 1}. Deep nesting makes code harder to read and test. Consider early returns or extracting helper functions.`,
        suggestionCode: `// Use early returns to reduce nesting:
if (!condition) return;
// Continue with main logic...`,
        startLine: i + 1,
        endLine: i + 1,
      });
    }
  }

  return results;
}

/** Rule: Missing error handling — try/catch absence */
function checkMissingErrorHandling(lines: string[], _filePath: string): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];
  const riskyOperations = [
    /\.readFile/, /\.writeFile/, /\.fetch\s*\(/, /axios/,
    /await\s+(?!.*(?:catch|try))/, /\.query\s*\(/, /\.execute\s*\(/,
    /\.connect\s*\(/, /new\s+Promise/, /\.send\s*\(/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Skip if we're already inside a try block
    // Simple heuristic: track whether we've seen "try {" without corresponding "} catch"
    // This is approximate — full AST parsing would be needed for accurate detection

    for (const pattern of riskyOperations) {
      if (pattern.test(line)) {
        results.push({
          triggered: true,
          category: 'bug',
          severity: 'medium',
          title: 'Potentially missing error handling',
          description: `Risky operation at line ${i + 1} may need try/catch error handling. Asynchronous operations and I/O should always handle errors gracefully.`,
          suggestionCode: `try {
  // risky operation
} catch (error) {
  // handle or propagate error appropriately
}`,
          startLine: i + 1,
          endLine: i + 1,
        });
        break; // One issue per line
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Graph Analysis Rules
// ---------------------------------------------------------------------------

/** Rule: High out-degree coupling (many outgoing edges → tightly coupled) */
function checkHighCoupling(
  filePath: string,
  outDegree: number,
  _edgeCounts: Map<string, number>,
): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];
  const threshold = 15;

  if (outDegree > threshold) {
    results.push({
      triggered: true,
      category: 'architecture',
      severity: 'high',
      title: `High coupling: ${outDegree} outgoing dependencies`,
      description: `File "${filePath}" has ${outDegree} outgoing dependencies, exceeding the recommended maximum of ${threshold}. High coupling makes the system harder to change and test.`,
      suggestionCode: `// High coupling remediation strategies:
// 1. Introduce abstraction layers (interfaces/facades)
// 2. Split the component into smaller, focused modules
// 3. Use dependency injection to reduce direct coupling`,
      startLine: 1,
      endLine: 1,
    });
  }

  return results;
}

/** Rule: Potential dead code — files with many definitions but few callers */
function checkDeadCodePotential(
  filePath: string,
  inDegree: number,
  outDegree: number,
  exportedSymbolCount: number,
): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];

  // Files with many exports but few incoming edges may indicate dead code
  if (exportedSymbolCount > 5 && inDegree === 0 && outDegree > 0) {
    results.push({
      triggered: true,
      category: 'maintainability',
      severity: 'low',
      title: 'Potential dead code — unused exports',
      description: `File "${filePath}" exports ${exportedSymbolCount} symbols but has no incoming dependencies. These symbols may be unused and could be removed.`,
      suggestionCode: '// Verify these exports are not used externally before removal.\n// Consider marking unused exports as deprecated first.',
      startLine: 1,
      endLine: 1,
    });
  }

  return results;
}

/** Rule: Circular dependency detection */
function checkCircularDeps(
  filePath: string,
  cyclePaths: string[][],
): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];

  for (const cycle of cyclePaths) {
    if (cycle.includes(filePath)) {
      const cycleStr = cycle.join(' -> ');
      results.push({
        triggered: true,
        category: 'architecture',
        severity: 'high',
        title: 'Circular dependency detected',
        description: `Circular dependency chain: ${cycleStr}. Circular dependencies cause tight coupling and make the codebase fragile to changes.`,
        suggestionCode: `// To break the cycle, consider:
// 1. Extracting shared types/interfaces into a separate module
// 2. Using dependency inversion (interfaces in lower-level modules)
// 3. Moving the shared logic to a common dependency`,
        startLine: 1,
        endLine: 1,
      });
      break; // One entry per file
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Standards & Style Rules
// ---------------------------------------------------------------------------

/** Rule: Check naming conventions */
function checkNamingConventions(lines: string[], filePath: string): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];
  const isTestFile = filePath.includes('.test.') || filePath.includes('.spec.') ||
    filePath.includes('__tests__') || filePath.includes('__mocks__');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Check class names (should be PascalCase)
    const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
    if (classMatch) {
      const name = classMatch[1]!;
      if (name[0] !== name[0]!.toUpperCase()) {
        results.push({
          triggered: true,
          category: 'style',
          severity: 'low',
          title: 'Class name should use PascalCase',
          description: `Class "${name}" at line ${i + 1} should use PascalCase naming convention.`,
          suggestionCode: `class ${name[0]!.toUpperCase() + name.slice(1)}`,
          startLine: i + 1,
          endLine: i + 1,
        });
      }
    }

    // Check variable/function names (should be camelCase)
    if (!isTestFile) {
      const varMatch = trimmed.match(/^(?:const|let|var)\s+([A-Z][a-z]+\w*)\s*=/);
      if (varMatch) {
        const name = varMatch[1]!;
        // Allow uppercase for constants
        if (name !== name.toUpperCase()) {
          results.push({
            triggered: true,
            category: 'style',
            severity: 'low',
            title: 'Variable name should use camelCase',
            description: `Variable "${name}" at line ${i + 1} starts with uppercase. Use camelCase for variables, UPPER_SNAKE_CASE for constants.`,
            suggestionCode: `const ${name[0]!.toLowerCase() + name.slice(1)} = ...`,
            startLine: i + 1,
            endLine: i + 1,
          });
        }
      }
    }

    // Check for console.log in production code
    if (!isTestFile && trimmed.includes('console.log')) {
      results.push({
        triggered: true,
        category: 'style',
        severity: 'low',
        title: 'console.log left in code',
        description: `"console.log" found at line ${i + 1}. Remove debug logging before committing to production code.`,
        suggestionCode: '// Use a proper logger instead, or remove.',
        startLine: i + 1,
        endLine: i + 1,
      });
    }

    // Check for TODO comments
    if (trimmed.includes('TODO') || trimmed.includes('FIXME')) {
      const isFIXME = trimmed.includes('FIXME');
      results.push({
        triggered: true,
        category: 'documentation',
        severity: isFIXME ? 'medium' : 'low',
        title: `${isFIXME ? 'FIXME' : 'TODO'} comment found`,
        description: `${isFIXME ? 'FIXME' : 'TODO'} comment at line ${i + 1}: "${trimmed.slice(0, 80)}". ${isFIXME ? 'Address this fix before merging.' : 'Track this task and address it.'}`,
        suggestionCode: null,
        startLine: i + 1,
        endLine: i + 1,
      });
    }
  }

  return results;
}

/** Rule: Missing TypeScript return types */
function checkMissingReturnTypes(lines: string[], filePath: string): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];

  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    return results;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Match function declarations without return type
    // function name(args) { ... }  — missing return type
    const funcMatch = trimmed.match(
      /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*(\w+))?\s*\{/,
    );
    if (funcMatch && funcMatch[1] === undefined) {
      results.push({
        triggered: true,
        category: 'style',
        severity: 'low',
        title: 'Missing return type annotation',
        description: `Function at line ${i + 1} is missing an explicit return type annotation. Add return type for better type safety and documentation.`,
        suggestionCode: 'function name(args): ReturnType {',
        startLine: i + 1,
        endLine: i + 1,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Change Analysis
// ---------------------------------------------------------------------------

/** Rule: Detect risky changes (shared interfaces, API routes, config) */
function checkRiskyChanges(
  filePath: string,
  changeType: string,
): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];

  // Shared interfaces and types are high-risk
  if (filePath.includes('/types/') || filePath.includes('/interfaces/') ||
      filePath.endsWith('.d.ts') || filePath.includes('/shared/')) {
    results.push({
      triggered: true,
      category: 'architecture',
      severity: 'high',
      title: 'Risky change: shared type/interface modified',
      description: `File "${filePath}" contains shared types or interfaces. Changes here can impact many consumers across the codebase.`,
      suggestionCode: '// Verify all consumers are compatible with this change.\n// Consider versioning or backward-compatible approaches.',
      startLine: 1,
      endLine: 1,
    });
  }

  // API routes
  if (filePath.includes('/routes/') || filePath.includes('/api/') ||
      filePath.includes('route') || filePath.includes('handler')) {
    results.push({
      triggered: true,
      category: 'bug',
      severity: 'high',
      title: 'Risky change: API route modified',
      description: `File "${filePath}" appears to contain API routes or handlers. Changes to API contracts can break consumers and require careful testing.`,
      suggestionCode: '// Verify API tests pass and the contract hasn\'t changed unintentionally.\n// Consider API versioning if changing behavior.',
      startLine: 1,
      endLine: 1,
    });
  }

  // Config files
  if (filePath.includes('/config/') || filePath.includes('/.env') ||
      filePath.includes('config.ts') || filePath.includes('config.js') ||
      filePath.includes('settings')) {
    results.push({
      triggered: true,
      category: 'security',
      severity: 'medium',
      title: 'Configuration file modified',
      description: `File "${filePath}" appears to be configuration. Verify no secrets are exposed and changes are backward-compatible.`,
      suggestionCode: '// Double-check no secrets or credentials are exposed in this change.',
      startLine: 1,
      endLine: 1,
    });
  }

  // Deleted files
  if (changeType === 'deleted') {
    results.push({
      triggered: true,
      category: 'architecture',
      severity: 'high',
      title: 'File deletion',
      description: `File "${filePath}" is being deleted. Verify all imports and references to this file are updated.`,
      suggestionCode: '// Search for all imports referencing this file before deletion.',
      startLine: 1,
      endLine: 1,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Heuristic Engine
// ---------------------------------------------------------------------------

export interface GraphAnalysisData {
  outDegree: number;
  inDegree: number;
  exportedSymbolCount: number;
  cyclicPaths: string[][];
  edgeCounts: Map<string, number>;
}

const EMPTY_GRAPH_DATA: GraphAnalysisData = {
  outDegree: 0,
  inDegree: 0,
  exportedSymbolCount: 0,
  cyclicPaths: [],
  edgeCounts: new Map(),
};

/**
 * Run all heuristic rules against a file's content and diff info.
 * Returns all detected issues as HeuristicRuleResult objects.
 */
export function analyzeFileHeuristics(
  filePath: string,
  lines: string[],
  diff?: GitDiff,
  graphData?: Partial<GraphAnalysisData>,
): HeuristicRuleResult[] {
  const results: HeuristicRuleResult[] = [];
  const gd: GraphAnalysisData = { ...EMPTY_GRAPH_DATA, ...graphData };

  // Code pattern rules
  results.push(...checkLongFunction(lines, filePath));
  results.push(...checkDeepNesting(lines, filePath));
  results.push(...checkMissingErrorHandling(lines, filePath));

  // Graph analysis rules
  results.push(...checkHighCoupling(filePath, gd.outDegree, gd.edgeCounts));
  results.push(...checkDeadCodePotential(filePath, gd.inDegree, gd.outDegree, gd.exportedSymbolCount));
  results.push(...checkCircularDeps(filePath, gd.cyclicPaths));

  // Standards & style rules
  results.push(...checkNamingConventions(lines, filePath));
  results.push(...checkMissingReturnTypes(lines, filePath));

  // Change analysis rules (diff context)
  if (diff) {
    results.push(...checkRiskyChanges(filePath, diff.changeType));
  }

  return results;
}

/**
 * Convert a HeuristicRuleResult to a standard ReviewComment.
 */
export function toReviewComment(
  filePath: string,
  result: HeuristicRuleResult,
  index: number,
  lines: string[],
): ReviewComment {
  const now = new Date().toISOString();
  const existingLines: string[] = [];

  for (let i = Math.max(0, result.startLine - 3); i < Math.min(lines.length, result.endLine + 3); i++) {
    existingLines.push(lines[i]!);
  }

  return {
    id: `heuristic-${index}-${Date.now()}`,
    path: filePath,
    content: result.title,
    thinking: result.description,
    existingCode: existingLines.join('\n'),
    suggestionCode: result.suggestionCode ?? undefined,
    startLine: result.startLine,
    endLine: result.endLine,
    category: result.category,
    severity: result.severity,
    filtered: false,
    createdAt: now,
  };
}
