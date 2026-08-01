// @code-analyzer/intelligence — Style Review Lens
// Detects style issues: naming conventions, magic numbers, comment ratio, whitespace, line length.

import type { LensFinding, EvidenceAnchor, LensReport } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

/** Check naming convention of an identifier */
function checkNaming(
  name: string,
  line: number,
  filePath: string,
): LensFinding | null {
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
    filePath, startLine: line, endLine: line,
    codeSnippet: name,
    lens: 'style', ruleId: 'style-naming',
  };
  return createLensFinding('style', 'style', 'low',
    `Non-Standard Naming: "${name}"`,
    `Identifier "${name}" does not follow camelCase, PascalCase, UPPER_CASE, or snake_case conventions.`,
    evidence,
    { suggestion: `Rename to follow language convention (camelCase for variables, PascalCase for classes).`, ruleId: 'style-naming' });
}

/** Check for magic numbers (excluding common allowed values) */
function checkMagicNumbers(
  line: string,
  lineNum: number,
  filePath: string,
): LensFinding | null {
  const allowed = new Set(['0', '1', '-1', '2', '3', '10', '100', '1000', '1024', '60', '24', '12', '365']);
  const numMatch = line.match(/(?<![a-zA-Z0-9_.#])(-?\d+\.?\d*)(?![a-zA-Z0-9_])/g);
  if (!numMatch) return null;

  const magicNums = numMatch.filter(n => !allowed.has(n) && parseFloat(n) > 3);
  if (magicNums.length === 0) return null;

  const evidence: EvidenceAnchor = {
    filePath, startLine: lineNum, endLine: lineNum,
    codeSnippet: line.trim().slice(0, 200),
    lens: 'style', ruleId: 'style-magic-number',
  };
  return createLensFinding('style', 'style', 'low',
    `Magic Numbers: ${magicNums.join(', ')}`,
    `Literal values ${magicNums.join(', ')} should be extracted to named constants for readability.`,
    evidence,
    { suggestion: `Extract to const: const MEANINGFUL_NAME = ${magicNums[0]};`, ruleId: 'style-magic-number' });
}

/** Check line length */
function checkLineLength(
  line: string,
  lineNum: number,
  filePath: string,
): LensFinding | null {
  if (line.length <= 120) return null;
  const evidence: EvidenceAnchor = {
    filePath, startLine: lineNum, endLine: lineNum,
    codeSnippet: line.slice(0, 150) + '...',
    lens: 'style', ruleId: 'style-line-length',
  };
  return createLensFinding('style', 'style', 'low',
    `Line Too Long: ${line.length} chars`,
    `Line ${lineNum} is ${line.length} characters long (>120 threshold). Break into multiple lines.`,
    evidence,
    { suggestion: 'Split the line using line breaks or extract to helper.', ruleId: 'style-line-length' });
}

/** Check trailing whitespace */
function checkTrailingWhitespace(
  line: string,
  lineNum: number,
  filePath: string,
): LensFinding | null {
  if (!/\s$/.test(line) || line.length === 0) return null;
  const evidence: EvidenceAnchor = {
    filePath, startLine: lineNum, endLine: lineNum,
    codeSnippet: line,
    lens: 'style', ruleId: 'style-trailing-whitespace',
  };
  return createLensFinding('style', 'style', 'low',
    'Trailing Whitespace',
    `Line ${lineNum} has trailing whitespace. Remove for clean diffs.`,
    evidence,
    { suggestion: 'Run your editor\'s "Trim Trailing Whitespace" command.', ruleId: 'style-trailing-whitespace', autoFixable: true });
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export function analyzeStyle(
  content: string,
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || /^\s*\/\//.test(line) || /^\s*\/\*/.test(line) || /^\s*\*/.test(line) || /^\s*#/.test(line)) continue;

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

    // 2. Magic numbers
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
  const codeLines = lines.filter(l => l.trim() && !/^\s*(\/\/|\/\*|\*|#)/.test(l)).length;
  const commentLines = lines.filter(l => /^\s*(\/\/|\/\*|\*|#)/.test(l)).length;
  const total = codeLines + commentLines;
  if (total > 0 && commentLines / total < 0.05 && total > 50) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: lines.length,
      codeSnippet: `Comment-to-code ratio: ${((commentLines / total) * 100).toFixed(1)}% (${commentLines}/${total} lines)`,
      lens: 'style', ruleId: 'style-comment-ratio',
    };
    const f = createLensFinding('style', 'style', 'low',
      `Low Comment Ratio: ${((commentLines / total) * 100).toFixed(1)}%`,
      `This file has a low comment-to-code ratio (${((commentLines / total) * 100).toFixed(1)}%). Consider adding documentation for complex logic.`,
      evidence,
      { suggestion: 'Add JSDoc/TDoc comments for exported functions and classes.', ruleId: 'style-comment-ratio' });
    if (f) findings.push(f);
  }

  return findings;
}

/** Generate a style lens report */
export function generateStyleReport(
  content: string,
  filePath: string,
): LensReport {
  const start = Date.now();
  const findings = analyzeStyle(content, filePath);
  return {
    lens: 'style',
    name: 'Style Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}
