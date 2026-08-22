// @code-analyzer/intelligence — Style Review Lens
// Detects style issues: naming conventions, magic numbers, comment ratio,
// whitespace, line length, duplicate code, inconsistent naming, comment quality.

import type { LensFinding, EvidenceAnchor, LensReport } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';
import { MinHashSimilarity } from '../../similarity/minhash.js';

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

/** Check naming convention of an identifier */
function checkNaming(name: string, line: number, filePath: string): LensFinding | null {
  // Constants (UPPER_CASE)
  if (/^[A-Z][A-Z0-9_]+$/.test(name) && name.length > 1) return null; // valid constant

  // Classes/Types (PascalCase)
  if (/^[A-Z][a-zA-Z0-9]+$/.test(name)) return null; // valid PascalCase

  // Functions/variables (camelCase)
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return null; // valid camelCase

  // snake_case
  if (/^[a-z][a-z0-9_]+$/.test(name)) return null; // valid snake_case

  // Private (underscore prefix)
  if (/^_[a-z][a-zA-Z0-9]*$/.test(name)) return null;

  const evidence: EvidenceAnchor = {
    filePath,
    startLine: line,
    endLine: line,
    codeSnippet: name,
    lens: 'style',
    ruleId: 'style-naming',
  };
  return createLensFinding(
    'style',
    'style',
    'low',
    `Non-Standard Naming: "${name}"`,
    `Identifier "${name}" does not follow camelCase, PascalCase, UPPER_CASE, or snake_case conventions.`,
    evidence,
    {
      suggestion: `Rename to follow language convention (camelCase for variables, PascalCase for classes).`,
      ruleId: 'style-naming',
    },
  );
}

/** Check for magic numbers (excluding common allowed values) */
function checkMagicNumbers(line: string, lineNum: number, filePath: string): LensFinding | null {
  const allowed = new Set([
    '0',
    '1',
    '-1',
    '2',
    '3',
    '10',
    '100',
    '1000',
    '1024',
    '60',
    '24',
    '12',
    '365',
  ]);
  const numMatch = line.match(/(?<![a-zA-Z0-9_.#])(-?\d+\.?\d*)(?![a-zA-Z0-9_])/g);
  if (!numMatch) return null;

  const magicNums = numMatch.filter((n) => !allowed.has(n) && parseFloat(n) > 3);
  if (magicNums.length === 0) return null;

  const evidence: EvidenceAnchor = {
    filePath,
    startLine: lineNum,
    endLine: lineNum,
    codeSnippet: line.trim().slice(0, 200),
    lens: 'style',
    ruleId: 'style-magic-number',
  };
  return createLensFinding(
    'style',
    'style',
    'low',
    `Magic Numbers: ${magicNums.join(', ')}`,
    `Literal values ${magicNums.join(', ')} should be extracted to named constants for readability.`,
    evidence,
    {
      suggestion: `Extract to const: const MEANINGFUL_NAME = ${magicNums[0]};`,
      ruleId: 'style-magic-number',
    },
  );
}

/** Check line length */
function checkLineLength(line: string, lineNum: number, filePath: string): LensFinding | null {
  if (line.length <= 120) return null;
  const evidence: EvidenceAnchor = {
    filePath,
    startLine: lineNum,
    endLine: lineNum,
    codeSnippet: line.slice(0, 150) + '...',
    lens: 'style',
    ruleId: 'style-line-length',
  };
  return createLensFinding(
    'style',
    'style',
    'low',
    `Line Too Long: ${line.length} chars`,
    `Line ${lineNum} is ${line.length} characters long (>120 threshold). Break into multiple lines.`,
    evidence,
    {
      suggestion: 'Split the line using line breaks or extract to helper.',
      ruleId: 'style-line-length',
    },
  );
}

/** Check trailing whitespace */
function checkTrailingWhitespace(
  line: string,
  lineNum: number,
  filePath: string,
): LensFinding | null {
  if (!/\s$/.test(line) || line.length === 0) return null;
  const evidence: EvidenceAnchor = {
    filePath,
    startLine: lineNum,
    endLine: lineNum,
    codeSnippet: line,
    lens: 'style',
    ruleId: 'style-trailing-whitespace',
  };
  return createLensFinding(
    'style',
    'style',
    'low',
    'Trailing Whitespace',
    `Line ${lineNum} has trailing whitespace. Remove for clean diffs.`,
    evidence,
    {
      suggestion: 'Run your editor\'s "Trim Trailing Whitespace" command.',
      ruleId: 'style-trailing-whitespace',
      autoFixable: true,
    },
  );
}

// ---------------------------------------------------------------------------
// NEW: Aggregated magic number detection (>5 per file)
// ---------------------------------------------------------------------------

/**
 * Detect files with excessive magic numbers (>5 distinct numeric literals
 * outside of constant contexts). Aggregates per-file instead of per-line.
 */
interface MagicNumberRecord {
  value: string;
  line: number;
  snippet: string;
}

function detectAggregatedMagicNumbers(lines: string[], filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const allowed = new Set([
    '0',
    '1',
    '-1',
    '2',
    '3',
    '10',
    '100',
    '1000',
    '1024',
    '60',
    '24',
    '12',
    '365',
  ]);
  const records: MagicNumberRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip comments, string literals, enum values, constant declarations
    if (/^\s*(\/\/|\/\*|\*|#)/.test(line)) continue;
    if (/\bconst\s+\w+\s*[:=]/.test(line) || /\benum\b/.test(line)) continue;
    if (/\bcase\s+-?\d+/.test(line)) continue;

    const numMatch = line.match(/(?<![a-zA-Z0-9_.#])(-?\d+\.?\d*)(?![a-zA-Z0-9_])/g);
    if (!numMatch) continue;

    const magicNums = numMatch.filter((n) => !allowed.has(n) && parseFloat(n) > 3);
    for (const num of magicNums) {
      records.push({ value: num, line: i + 1, snippet: line.trim().slice(0, 200) });
    }
  }

  // Count distinct values per file
  const distinctMagic = new Set(records.map((r) => r.value));
  if (distinctMagic.size > 5) {
    const groupedLines = records.map((r) => r.line).join(', ');
    const evidence: EvidenceAnchor = {
      filePath,
      startLine: 1,
      endLine: lines.length,
      codeSnippet: `${distinctMagic.size} magic numbers: [${[...distinctMagic].slice(0, 10).join(', ')}]`,
      lens: 'style',
      ruleId: 'style-magic-number-aggregated',
    };
    const f = createLensFinding(
      'style',
      'style',
      'medium',
      `Excessive Magic Numbers: ${distinctMagic.size} distinct values`,
      `File contains ${distinctMagic.size} distinct magic numbers (>5 threshold) at lines: ${groupedLines.slice(0, 200)}. Extract to named constants for readability.`,
      evidence,
      {
        suggestion: `Extract magic numbers to const declarations or a constants file.`,
        ruleId: 'style-magic-number-aggregated',
      },
    );
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Duplicate code detection using MinHash
// ---------------------------------------------------------------------------

/**
 * Compute token shingles for MinHash from source lines.
 */
function tokenizeCode(lines: string[]): string[] {
  const tokens: string[] = [];
  for (const line of lines) {
    const stripped = line
      .replace(/\/\/.*$/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    if (!stripped) continue;
    // Split into tokens, normalize
    const lineTokens = stripped
      .split(/[\s\{\}\(\)\[\];,\.:+\-*\/=!<>&|?]+/)
      .filter((t) => t.length > 0)
      .map((t) => t.toLowerCase());
    tokens.push(...lineTokens);
  }
  return tokens;
}

/**
 * Detect duplicate code fragments using MinHash similarity.
 * Computes Jaccard similarity between pairs and flags those ≥ 0.85.
 * Only detects within the same repository context.
 */
function detectDuplicateCode(
  currentLines: string[],
  filePath: string,
  repoFiles?: Map<string, string>,
): LensFinding[] {
  const findings: LensFinding[] = [];
  if (!repoFiles || repoFiles.size === 0) return findings;

  const minHash = new MinHashSimilarity(128);
  const currentTokens = tokenizeCode(currentLines);
  if (currentTokens.length < 10) return findings;

  const fp1 = minHash.computeFingerprint(currentTokens);

  for (const [otherPath, otherContent] of repoFiles) {
    if (otherPath === filePath) continue;

    const otherLines = otherContent.split('\n');
    const otherTokens = tokenizeCode(otherLines);
    if (otherTokens.length < 10) continue;

    const fp2 = minHash.computeFingerprint(otherTokens);
    const similarity = minHash.estimateSimilarity(fp1, fp2);

    if (similarity >= 0.7) {
      const evidence: EvidenceAnchor = {
        filePath,
        startLine: 1,
        endLine: currentLines.length,
        codeSnippet: `Duplicate of ${otherPath} (Jaccard: ${(similarity * 100).toFixed(1)}%)`,
        lens: 'style',
        ruleId: 'style-duplicate-code',
      };
      const f = createLensFinding(
        'style',
        'maintainability',
        'high',
        `Duplicate Code: ${(similarity * 100).toFixed(0)}% similarity with ${otherPath}`,
        `This file has ${(similarity * 100).toFixed(0)}% similarity with "${otherPath}". Extract shared logic into a shared module to reduce duplication.`,
        evidence,
        {
          suggestion: `Extract common logic into a shared utility module imported by both files.`,
          ruleId: 'style-duplicate-code',
        },
      );
      if (f) findings.push(f);
      break; // One finding per file pair is enough
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Inconsistent naming detection
// ---------------------------------------------------------------------------

/**
 * Detect files with mixed naming conventions (camelCase + snake_case
 * + PascalCase in the same file for the same type of declaration).
 */
function detectInconsistentNaming(lines: string[], filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const conventions = new Map<string, Set<string>>();

  // Extract all variable names
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
    if (varMatch) {
      const name = varMatch[1]!;
      let conv: string;
      if (/^[A-Z][A-Z0-9_]+$/.test(name))
        conv = 'UPPER_CASE'; // constants
      else if (/^[a-z][a-z0-9_]+$/.test(name)) conv = 'snake_case';
      else if (/^[a-z][a-zA-Z0-9]*$/.test(name)) conv = 'camelCase';
      else if (/^_[a-z][a-zA-Z0-9]*$/.test(name)) conv = '_camelCase';
      else conv = 'other';

      if (!conventions.has('variable')) conventions.set('variable', new Set());
      conventions.get('variable')!.add(conv);
    }

    const funcMatch = line.match(/(?:function|async\s+function)\s+(\w+)/);
    if (funcMatch) {
      const name = funcMatch[1]!;
      let conv: string;
      if (/^[a-z][a-zA-Z0-9]*$/.test(name)) conv = 'camelCase';
      else if (/^[a-z][a-z0-9_]+$/.test(name)) conv = 'snake_case';
      else conv = 'PascalCase';

      if (!conventions.has('function')) conventions.set('function', new Set());
      conventions.get('function')!.add(conv);
    }
  }

  // Check for type-level mixing
  const varConvs = conventions.get('variable');
  if (varConvs && varConvs.size >= 2 && varConvs.has('camelCase') && varConvs.has('snake_case')) {
    const evidence: EvidenceAnchor = {
      filePath,
      startLine: 1,
      endLine: lines.length,
      codeSnippet: `Mixed naming conventions: variables use ${[...varConvs].join(', ')}`,
      lens: 'style',
      ruleId: 'style-inconsistent-naming',
    };
    const f = createLensFinding(
      'style',
      'style',
      'low',
      'Inconsistent Variable Naming Convention',
      `File uses mixed variable naming conventions: ${[...varConvs].join(', ')}. Choose one convention and apply consistently.`,
      evidence,
      {
        suggestion:
          'Standardize on a single naming convention (e.g., camelCase for JavaScript/TypeScript).',
        ruleId: 'style-inconsistent-naming',
      },
    );
    if (f) findings.push(f);
  }

  const funcConvs = conventions.get('function');
  if (
    funcConvs &&
    funcConvs.size >= 2 &&
    funcConvs.has('camelCase') &&
    funcConvs.has('snake_case')
  ) {
    const evidence: EvidenceAnchor = {
      filePath,
      startLine: 1,
      endLine: lines.length,
      codeSnippet: `Mixed function naming: ${[...funcConvs].join(', ')}`,
      lens: 'style',
      ruleId: 'style-inconsistent-function-naming',
    };
    const f = createLensFinding(
      'style',
      'style',
      'low',
      'Inconsistent Function Naming Convention',
      `File uses mixed function naming conventions: ${[...funcConvs].join(', ')}. Standardize to camelCase.`,
      evidence,
      {
        suggestion: 'Use camelCase consistently for all function names.',
        ruleId: 'style-inconsistent-function-naming',
      },
    );
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Comment quality checks
// ---------------------------------------------------------------------------

/**
 * Detect functions/methods >20 lines without JSDoc/docstring comments.
 */
function detectCommentQuality(lines: string[], filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Match function declarations
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
    const arrowMatch = line.match(
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\s*\(/,
    );

    const match = funcMatch || arrowMatch;
    if (!match) continue;

    const funcName = match[1]!;

    // Find the end of this function
    let depth = 0;
    let started = false;
    let funcEnd = i + 1;
    for (let j = i; j < lines.length; j++) {
      const braceCount =
        (lines[j]!.match(/\{/g) || []).length - (lines[j]!.match(/\}/g) || []).length;
      depth += braceCount;
      if (braceCount > 0) started = true;
      if (started && depth === 0) {
        funcEnd = j + 1;
        break;
      }
    }

    const funcLength = funcEnd - i;
    if (funcLength <= 20) continue; // Skip small functions

    // Check for JSDoc before the function
    const hasJSDoc = lines.slice(Math.max(0, i - 10), i).some((l) => /\/\*\*/.test(l));
    if (hasJSDoc) continue;

    const evidence: EvidenceAnchor = {
      filePath,
      startLine: i + 1,
      endLine: funcEnd,
      codeSnippet: `${funcName}: ${funcLength} lines without JSDoc`,
      lens: 'style',
      ruleId: 'style-missing-comment',
    };
    const f = createLensFinding(
      'style',
      'maintainability',
      'medium',
      `Missing Documentation: ${funcName} (${funcLength} lines)`,
      `Function "${funcName}" is ${funcLength} lines long (>20) without a JSDoc/docstring. Large functions need documentation explaining purpose, parameters, and return value.`,
      evidence,
      {
        suggestion: `Add JSDoc comment describing what ${funcName} does, its parameters, and return value.`,
        ruleId: 'style-missing-comment',
      },
    );
    if (f) findings.push(f);

    i = funcEnd - 1; // Skip past this function
  }

  return findings;
}

export interface StyleAnalysisOptions {
  /** Contents of other files in the repository (path → content) for duplicate detection */
  repoFiles?: Map<string, string>;
}

export function analyzeStyle(
  content: string,
  filePath: string,
  options?: StyleAnalysisOptions,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (
      !trimmed ||
      /^\s*\/\//.test(line) ||
      /^\s*\/\*/.test(line) ||
      /^\s*\*/.test(line) ||
      /^\s*#/.test(line)
    )
      continue;

    // 1. Naming convention checks
    const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
    if (varMatch) {
      const f = checkNaming(varMatch[1]!, lineNum, filePath);
      if (f) findings.push(f);
    }

    const funcMatch = line.match(/(?:function|async\s+function)\s+(\w+)/);
    if (funcMatch) {
      const f = checkNaming(funcMatch[1]!, lineNum, filePath);
      if (f) findings.push(f);
    }

    // 2. Magic numbers (per-line)
    const magicF = checkMagicNumbers(line, lineNum, filePath);
    if (magicF) findings.push(magicF);

    // 3. Line length
    const lenF = checkLineLength(line, lineNum, filePath);
    if (lenF) findings.push(lenF);

    // 4. Trailing whitespace
    const trailF = checkTrailingWhitespace(line, lineNum, filePath);
    if (trailF) findings.push(trailF);
  }

  // 5. Comment-to-code ratio
  const codeLines = lines.filter((l) => l.trim() && !/^\s*(\/\/|\/\*|\*|#)/.test(l)).length;
  const commentLines = lines.filter((l) => /^\s*(\/\/|\/\*|\*|#)/.test(l)).length;
  const total = codeLines + commentLines;
  if (total > 0 && commentLines / total < 0.05 && total > 50) {
    const evidence: EvidenceAnchor = {
      filePath,
      startLine: 1,
      endLine: lines.length,
      codeSnippet: `Comment-to-code ratio: ${((commentLines / total) * 100).toFixed(1)}% (${commentLines}/${total} lines)`,
      lens: 'style',
      ruleId: 'style-comment-ratio',
    };
    const f = createLensFinding(
      'style',
      'style',
      'low',
      `Low Comment Ratio: ${((commentLines / total) * 100).toFixed(1)}%`,
      `This file has a low comment-to-code ratio (${((commentLines / total) * 100).toFixed(1)}%). Consider adding documentation for complex logic.`,
      evidence,
      {
        suggestion: 'Add JSDoc/TDoc comments for exported functions and classes.',
        ruleId: 'style-comment-ratio',
      },
    );
    if (f) findings.push(f);
  }

  // 6. NEW: Aggregated magic numbers per file
  findings.push(...detectAggregatedMagicNumbers(lines, filePath));

  // 7. NEW: Inconsistent naming
  findings.push(...detectInconsistentNaming(lines, filePath));

  // 8. NEW: Comment quality (large functions without documentation)
  findings.push(...detectCommentQuality(lines, filePath));

  // 9. NEW: Duplicate code detection (only if repo context available)
  findings.push(...detectDuplicateCode(lines, filePath, options?.repoFiles));

  // 10. Console.log in production code
  findings.push(...detectConsoleLog(lines, filePath));

  // 11. Function length and nesting depth
  findings.push(...detectFunctionMetrics(lines, filePath));

  return findings;
}

// ---------------------------------------------------------------------------
// Console.log and function metrics detection
// ---------------------------------------------------------------------------

/**
 * Detect console.log in production (non-test) code.
 */
function detectConsoleLog(lines: string[], filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return findings;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (/\bconsole\.log\b/.test(trimmed) && !trimmed.startsWith('//')) {
      const evidence: EvidenceAnchor = {
        filePath,
        startLine: i + 1,
        endLine: i + 1,
        codeSnippet: trimmed.slice(0, 200),
        lens: 'style',
        ruleId: 'style-console-log',
      };
      const f = createLensFinding(
        'style',
        'style',
        'low',
        'Debug console.log',
        'console.log() left in production code. Remove or replace with proper logging.',
        evidence,
        { ruleId: 'style-console-log' },
      );
      if (f) findings.push(f);
    }
  }
  return findings;
}

/**
 * Detect long functions (>50 lines) and deep nesting (>4 levels).
 */
function detectFunctionMetrics(lines: string[], filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  let inFunction = false;
  let funcStart = 0;
  let funcName = '';
  let braceDepth = 0;
  let maxNestingDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    // Detect function start
    const funcMatch = trimmed.match(
      /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(\w+)\s*\([^)]*\)\s*\{)/,
    );
    if (funcMatch) {
      inFunction = true;
      funcStart = i + 1;
      funcName = funcMatch[1] ?? funcMatch[2] ?? funcMatch[3] ?? 'anonymous';
      braceDepth = 0;
      maxNestingDepth = 0;
    }

    // Track depth
    if (inFunction) {
      const opens = (trimmed.match(/\{/g) ?? []).length;
      const closes = (trimmed.match(/\}/g) ?? []).length;
      braceDepth += opens - closes;
      maxNestingDepth = Math.max(maxNestingDepth, braceDepth);
    }

    // Function end
    if (inFunction && braceDepth <= 0 && trimmed.includes('}')) {
      const funcLength = i + 1 - funcStart;
      inFunction = false;

      // Check function length
      if (funcLength > 50) {
        const evidence: EvidenceAnchor = {
          filePath,
          startLine: funcStart,
          endLine: i + 1,
          codeSnippet: `${funcName}: ${funcLength} lines`,
          lens: 'style',
          ruleId: 'style-func-length',
        };
        const f = createLensFinding(
          'style',
          'style',
          'medium',
          'Long Function',
          `Function "${funcName}" is ${funcLength} lines (threshold: 50). Consider splitting into smaller, focused functions.`,
          evidence,
          { ruleId: 'style-func-length' },
        );
        if (f) findings.push(f);
      }

      // Check nesting depth
      if (maxNestingDepth > 4) {
        const evidence: EvidenceAnchor = {
          filePath,
          startLine: funcStart,
          endLine: i + 1,
          codeSnippet: `${funcName}: nesting depth ${maxNestingDepth}`,
          lens: 'style',
          ruleId: 'style-nesting-depth',
        };
        const f = createLensFinding(
          'style',
          'style',
          'medium',
          'Deep Nesting',
          `Function "${funcName}" has nesting depth of ${maxNestingDepth} (threshold: 4). Extract inner logic to helper functions.`,
          evidence,
          { ruleId: 'style-nesting-depth' },
        );
        if (f) findings.push(f);
      }
    }
  }

  return findings;
}

/** Generate a style lens report */
export function generateStyleReport(
  content: string,
  filePath: string,
  options?: StyleAnalysisOptions,
): LensReport {
  const start = Date.now();
  const findings = analyzeStyle(content, filePath, options);
  return {
    lens: 'style',
    name: 'Style Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}
