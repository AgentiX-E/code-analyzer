// @code-analyzer/intelligence — Documentation Review Lens
// Detects missing JSDoc/TDoc, missing parameter docs, missing return docs, stale docs.

import type { LensFinding, EvidenceAnchor, LensReport } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';

// ---------------------------------------------------------------------------
// JSDoc/TSDoc detection
// ---------------------------------------------------------------------------

interface DocCheckResult {
  name: string;
  line: number;
  hasDoc: boolean;
  hasParams: boolean;
  paramCount: number;
  documentedParams: number;
  hasReturn: boolean;
  documentedReturn: boolean;
  isExported: boolean;
}

/** Extract exported function information */
function extractFunctionInfo(
  lines: string[],
  i: number,
): DocCheckResult | null {
  const line = lines[i]!.trim();
  const exportMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
  const noExportMatch = line.match(/(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);

  const match = exportMatch || noExportMatch;
  if (!match) return null;

  const name = match[1]!;
  const params = match[2]!.split(',').filter(p => p.trim()).length;
  const isExported = !!exportMatch;

  // Check preceding lines for JSDoc
  let hasDoc = false;
  let hasParams = false;
  let documentedParams = 0;
  let hasReturn = line.includes(':') || /=>/.test(line); // has return type annotation
  let documentedReturn = false;

  const start = Math.max(0, i - 15);
  for (let j = start; j < i; j++) {
    const docLine = lines[j]!.trim();
    if (/\/\*\*/.test(docLine)) hasDoc = true;
    if (/@param\s+\{?[\w|<>[\]]+\}?\s+\w+/.test(docLine)) {
      hasParams = true;
      documentedParams++;
    }
    if (/@returns?\s+\{?[\w|<>[\]]+\}?/.test(docLine)) documentedReturn = true;
  }

  return {
    name, line: i + 1,
    hasDoc, hasParams,
    paramCount: params,
    documentedParams,
    hasReturn,
    documentedReturn,
    isExported,
  };
}

/** Check a single function for documentation gaps */
function checkFunctionDocs(
  info: DocCheckResult,
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];

  // Only flag exported functions (internal functions don't need docs)
  if (!info.isExported && info.hasDoc) return findings;

  // 1. Missing JSDoc entirely (critical for exported functions)
  if (!info.hasDoc && info.isExported) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: info.line, endLine: info.line,
      codeSnippet: `export function ${info.name}(...)`,
      lens: 'docs', ruleId: 'docs-missing-jsdoc',
    };
    const f = createLensFinding('docs', 'documentation', 'medium',
      `Missing JSDoc: ${info.name}`,
      `Exported function "${info.name}" has no JSDoc/TSDoc comment. Add a documentation block describing purpose, parameters, return value, and examples.`,
      evidence,
      { suggestion: `Add:\n/**\n * Description of ${info.name}\n * @param {Type} name - description\n * @returns {Type} description\n */`, ruleId: 'docs-missing-jsdoc' });
    if (f) findings.push(f);
  }

  // 2. Missing parameter documentation
  if (info.paramCount > 0 && !info.hasParams && info.isExported) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: info.line, endLine: info.line,
      codeSnippet: `function ${info.name}(${info.paramCount} params)`,
      lens: 'docs', ruleId: 'docs-missing-params',
    };
    const f = createLensFinding('docs', 'documentation', 'low',
      `Missing @param Docs: ${info.name}`,
      `Function "${info.name}" has ${info.paramCount} parameter(s) but no @param documentation.`,
      evidence,
      { suggestion: `Add @param tags for each parameter.`, ruleId: 'docs-missing-params' });
    if (f) findings.push(f);
  }

  // 3. Under-documented parameters
  if (info.hasParams && info.documentedParams < info.paramCount) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: info.line, endLine: info.line,
      codeSnippet: `function ${info.name}: ${info.documentedParams}/${info.paramCount} params documented`,
      lens: 'docs', ruleId: 'docs-incomplete-params',
    };
    const f = createLensFinding('docs', 'documentation', 'low',
      `Incomplete @param Docs: ${info.name}`,
      `Function "${info.name}" only documents ${info.documentedParams} of ${info.paramCount} parameter(s).`,
      evidence,
      { suggestion: 'Document all parameters with @param tags.', ruleId: 'docs-incomplete-params' });
    if (f) findings.push(f);
  }

  // 4. Missing @returns
  if (info.hasReturn && !info.documentedReturn && info.isExported) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: info.line, endLine: info.line,
      codeSnippet: `function ${info.name}(...): returnType`,
      lens: 'docs', ruleId: 'docs-missing-returns',
    };
    const f = createLensFinding('docs', 'documentation', 'low',
      `Missing @returns Doc: ${info.name}`,
      `Function "${info.name}" has a return type but no @returns JSDoc tag.`,
      evidence,
      { suggestion: 'Add @returns {Type} description of the return value.', ruleId: 'docs-missing-returns' });
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export function analyzeDocs(
  content: string,
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');

  // Check each function for documentation
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/\bfunction\s+\w+\s*\(/.test(line)) {
      const info = extractFunctionInfo(lines, i);
      if (info) {
        findings.push(...checkFunctionDocs(info, filePath));
      }
    }
  }

  // Check for missing README in root (only for package directories)
  if (filePath.endsWith('package.json')) {
    const dirPath = filePath.replace(/\/?package\.json$/, '');
    const hasReadme = lines.some(l => /"readme"/i.test(l));
    if (!hasReadme) {
      const evidence: EvidenceAnchor = {
        filePath, startLine: 1, endLine: 1,
        codeSnippet: 'No README referenced in package.json',
        lens: 'docs', ruleId: 'docs-missing-readme',
      };
      const f = createLensFinding('docs', 'documentation', 'low',
        'Missing README Reference',
        `No "readme" field in package.json. Add a README.md for project documentation.`,
        evidence,
        { suggestion: 'Add "readme": "README.md" to package.json', ruleId: 'docs-missing-readme' });
      if (f) findings.push(f);
    }
  }

  return findings;
}

/** Generate a docs lens report */
export function generateDocsReport(
  content: string,
  filePath: string,
): LensReport {
  const start = Date.now();
  const findings = analyzeDocs(content, filePath);
  return {
    lens: 'docs',
    name: 'Docs Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}
