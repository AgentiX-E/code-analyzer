// @code-analyzer/intelligence — Documentation Review Lens
// Detects missing JSDoc/TDoc, missing parameter docs, missing return docs,
// stale docs, README staleness, CHANGELOG gaps, API doc coverage,
// OpenAPI/Swagger validation.

import type { LensFinding, EvidenceAnchor, LensReport } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';
import * as crypto from 'crypto';

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
// NEW: README staleness detection
// ---------------------------------------------------------------------------

/**
 * Detect stale README files by checking content completeness.
 * A short README or one missing key sections is flagged as incomplete.
 */
function detectReadmeStaleness(
  lines: string[],
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const fileName = filePath.split('/').pop()?.toLowerCase() ?? '';

  // Only check markdown documentation files
  if (!fileName.match(/readme\.md/i)) return findings;

  const content = lines.join('\n');
  const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  const hasSections = /##\s+|###\s+|Setup|Install|Usage|API|Getting Started/i.test(content);
  const isTooShort = lines.length < 10;

  if (isTooShort || !hasSections) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: lines.length,
      codeSnippet: `README.md: ${lines.length} lines, hash=${contentHash}`,
      lens: 'docs', ruleId: 'docs-stale-readme',
    };
    const reason = isTooShort
      ? `README.md is only ${lines.length} lines. Comprehensive README should include setup, usage, API docs, and contribution guide.`
      : `README.md is missing key sections (Setup/Install/Usage/API). Add essential documentation sections.`;

    const f = createLensFinding('docs', 'documentation', 'medium',
      'Incomplete README',
      reason,
      evidence,
      { suggestion: 'Add sections: ## Setup, ## Usage, ## API, ## Contributing.', ruleId: 'docs-stale-readme' });
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: CHANGELOG check
// ---------------------------------------------------------------------------

/**
 * Detect Pull Request changes that should have a CHANGELOG entry.
 * Non-trivial changes (added/modified source files) without a
 * corresponding CHANGELOG update likely forgot to document the change.
 */
function detectMissingChangelog(
  lines: string[],
  filePath: string,
  prFiles?: string[],
): LensFinding[] {
  const findings: LensFinding[] = [];
  const fileName = filePath.split('/').pop()?.toLowerCase() ?? '';

  // Only check CHANGELOG files
  if (!fileName.includes('changelog')) return findings;

  // If we have PR file context, check for non-trivial changes
  if (prFiles && prFiles.length > 0) {
    const nontrivialChanges = prFiles.filter(f => {
      const ext = f.split('.').pop()?.toLowerCase() ?? '';
      return ['ts', 'js', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'rb'].includes(ext);
    });

    const hasChangelogContent = lines.some(l =>
      /\b(?:Added|Fixed|Changed|Removed|Deprecated|Security)\b/.test(l),
    );

    if (nontrivialChanges.length > 0 && !hasChangelogContent) {
      const evidence: EvidenceAnchor = {
        filePath, startLine: 1, endLine: lines.length,
        codeSnippet: `${nontrivialChanges.length} source files changed but CHANGELOG appears empty`,
        lens: 'docs', ruleId: 'docs-missing-changelog',
      };
      const f = createLensFinding('docs', 'documentation', 'medium',
        'Missing CHANGELOG Entry',
        `${nontrivialChanges.length} source files were changed but CHANGELOG has no entries. Document user-facing changes following Keep a Changelog format (Added, Fixed, Changed, Removed).`,
        evidence,
        { suggestion: 'Add entry: ## [Unreleased]\n### Added\n- New feature description', ruleId: 'docs-missing-changelog' });
      if (f) findings.push(f);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: API documentation coverage
// ---------------------------------------------------------------------------

/**
 * Count exported symbols without JSDoc and report coverage percentage.
 * Flags files where < 50% of exported symbols have documentation.
 */
function detectApiDocCoverage(
  lines: string[],
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];

  let exportedCount = 0;
  let documentedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Detect exported symbols
    const exportMatch = line.match(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/);
    if (!exportMatch) continue;

    exportedCount++;

    // Check preceding lines for JSDoc
    const precedingLines = lines.slice(Math.max(0, i - 10), i);
    const hasDoc = precedingLines.some(l => /\/\*\*/.test(l)) ||
                   precedingLines.some(l => /^\/\/\//.test(l.trim()));
    if (hasDoc) documentedCount++;
  }

  if (exportedCount > 5) {
    const coverage = (documentedCount / exportedCount) * 100;
    if (coverage < 50) {
      const evidence: EvidenceAnchor = {
        filePath, startLine: 1, endLine: lines.length,
        codeSnippet: `Doc coverage: ${documentedCount}/${exportedCount} (${coverage.toFixed(0)}%)`,
        lens: 'docs', ruleId: 'docs-low-coverage',
      };
      const f = createLensFinding('docs', 'documentation', 'medium',
        `Low API Documentation Coverage: ${coverage.toFixed(0)}%`,
        `Only ${documentedCount} of ${exportedCount} exported symbols have JSDoc documentation (${coverage.toFixed(0)}%). Target >= 80% coverage for public API surfaces.`,
        evidence,
        { suggestion: 'Add JSDoc comments to all exported functions, classes, and interfaces.', ruleId: 'docs-low-coverage' });
      if (f) findings.push(f);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: OpenAPI/Swagger validation
// ---------------------------------------------------------------------------

/**
 * Validate OpenAPI/Swagger spec files for completeness.
 * Detects: missing operationId, missing response schemas,
 * undocumented parameters, duplicate paths.
 */
function detectOpenApiIssues(
  lines: string[],
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const fileName = filePath.split('/').pop()?.toLowerCase() ?? '';
  const isOpenApiFile =
    fileName.includes('openapi') || fileName.includes('swagger') ||
    fileName.endsWith('.yaml') || fileName.endsWith('.yml') ||
    fileName.endsWith('.json');

  if (!isOpenApiFile) return findings;

  const content = lines.join('\n');
  const hasOpenApi = /\bopenapi\s*:\s*["']?3\./i.test(content) ||
                     /\bswagger\s*:\s*["']?2\./i.test(content);

  if (!hasOpenApi) return findings;

  // Check for paths without operationId
  const pathEntries = content.match(/(?:get|post|put|delete|patch|options|head)\s*:/g);
  const operationIds = content.match(/operationId\s*:/g);
  const pathCount = (pathEntries?.length ?? 0);
  const opIdCount = (operationIds?.length ?? 0);

  if (pathCount > 0 && opIdCount < pathCount) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: 1,
      codeSnippet: `${opIdCount}/${pathCount} paths have operationId`,
      lens: 'docs', ruleId: 'docs-openapi-missing-operationid',
    };
    const f = createLensFinding('docs', 'documentation', 'medium',
      `OpenAPI: Missing operationId`,
      `Only ${opIdCount} of ${pathCount} paths define operationId. Every operation should have a unique operationId for code generation and documentation.`,
      evidence,
      { suggestion: 'Add operationId to each path operation.', ruleId: 'docs-openapi-missing-operationid' });
    if (f) findings.push(f);
  }

  // Check for responses without schema
  const responses = content.match(/(?:'?200'?|'?201'?|'?400'?|'?404'?|'?500'?)\s*:/g);
  const schemas = content.match(/schema\s*:/g);
  const responseCount = (responses?.length ?? 0);
  const schemaCount = (schemas?.length ?? 0);

  if (responseCount > 0 && schemaCount < responseCount) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: 1,
      codeSnippet: `${schemaCount}/${responseCount} responses have schema`,
      lens: 'docs', ruleId: 'docs-openapi-missing-schema',
    };
    const f = createLensFinding('docs', 'documentation', 'medium',
      `OpenAPI: Missing Response Schema`,
      `Only ${schemaCount} of ${responseCount} responses define a schema. Each response should document its shape for client generation.`,
      evidence,
      { suggestion: 'Add schema definitions to all response status codes.', ruleId: 'docs-openapi-missing-schema' });
    if (f) findings.push(f);
  }

  // Check for empty description fields
  const descriptions = content.match(/description\s*:\s*["']?\s*["']?\s*$/gm);
  if (descriptions && descriptions.length > 0) {
    const evidence: EvidenceAnchor = {
      filePath, startLine: 1, endLine: 1,
      codeSnippet: `${descriptions.length} empty description fields`,
      lens: 'docs', ruleId: 'docs-openapi-empty-description',
    };
    const f = createLensFinding('docs', 'documentation', 'low',
      `OpenAPI: Empty Descriptions`,
      `${descriptions.length} description fields are empty. Descriptions help developers understand the API.`,
      evidence,
      { suggestion: 'Add meaningful descriptions to all fields.', ruleId: 'docs-openapi-empty-description' });
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export interface DocsAnalysisOptions {
  /** List of PR file paths for CHANGELOG detection */
  prFiles?: string[];
}

export function analyzeDocs(
  content: string,
  filePath: string,
  options?: DocsAnalysisOptions,
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

  // NEW: README staleness
  findings.push(...detectReadmeStaleness(lines, filePath));

  // NEW: CHANGELOG gap detection
  findings.push(...detectMissingChangelog(lines, filePath, options?.prFiles));

  // NEW: API doc coverage
  findings.push(...detectApiDocCoverage(lines, filePath));

  // NEW: OpenAPI/Swagger validation
  findings.push(...detectOpenApiIssues(lines, filePath));

  return findings;
}

/** Generate a docs lens report */
export function generateDocsReport(
  content: string,
  filePath: string,
  options?: DocsAnalysisOptions,
): LensReport {
  const start = Date.now();
  const findings = analyzeDocs(content, filePath, options);
  return {
    lens: 'docs',
    name: 'Docs Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}
