// @code-analyzer/intelligence — API Review Lens
// Detects API issues: missing validation, error handling, HTTP method gaps, rate limiting.

import type { LensFinding, EvidenceAnchor, LensReport } from '../review-lenses.js';
import { createLensFinding } from '../review-lenses.js';

// ---------------------------------------------------------------------------
// Route detection patterns
// ---------------------------------------------------------------------------

interface DetectedRoute {
  filePath: string;
  line: number;
  method: string;
  path: string;
  handler: string;
  code: string;
}

/** Detect Express/Koa-style route handlers */
function detectExpressRoutes(lines: string[], filePath: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/(?:app|router|this)\.(get|post|put|delete|patch|all|use)\s*\(\s*['"]([^'"]+)['"]/);
    if (m) {
      routes.push({
        filePath, line: i + 1,
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        handler: `line ${i + 1}`,
        code: line.trim().slice(0, 200),
      });
    }
  }
  return routes;
}

/** Detect FastAPI/Flask-style decorator routes */
function detectPythonRoutes(lines: string[], filePath: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/@(?:app|router|bp)\.(get|post|put|delete|patch|route)\s*\(\s*['"]([^'"]+)['"]/);
    if (m) {
      // Find the function this decorator wraps
      const nextLine = i + 1 < lines.length ? lines[i + 1]! : '';
      const funcMatch = nextLine.match(/(?:async\s+)?def\s+(\w+)/);
      routes.push({
        filePath, line: i + 1,
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        handler: funcMatch ? funcMatch[1]! : `line ${i + 2}`,
        code: lines.slice(i, i + 2).join('\n').trim(),
      });
    }
  }
  return routes;
}

/** Detect GraphQL resolver patterns */
function detectGraphQLResolvers(lines: string[], filePath: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  let inResolver = false;
  for (let i = 0; i < lines.length; i++) {
    if (/Query\s*:\s*\{/.test(lines[i]!)) inResolver = true;
    if (/Mutation\s*:\s*\{/.test(lines[i]!)) inResolver = true;
    if (inResolver) {
      const m = lines[i]!.match(/(\w+)\s*:\s*(?:async\s*)?\(/);
      if (m && !['Query', 'Mutation', 'Subscription'].includes(m[1]!)) {
        routes.push({
          filePath, line: i + 1,
          method: 'GRAPHQL',
          path: m[1]!,
          handler: m[1]!,
          code: lines[i]!.trim().slice(0, 200),
        });
      }
    }
    if (inResolver && /^\s*\}/.test(lines[i]!)) inResolver = false;
  }
  return routes;
}

// ---------------------------------------------------------------------------
// Route analysis
// ---------------------------------------------------------------------------

function analyzeRoute(
  route: DetectedRoute,
  lines: string[],
): LensFinding[] {
  const findings: LensFinding[] = [];
  const handlerLines = lines.slice(
    Math.max(0, route.line - 1),
    Math.min(lines.length, route.line + 30),
  );
  const handlerText = handlerLines.join('\n');

  // 1. Missing HTTP method validation
  if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
    const hasValidation =
      /\bvalidate\b|\bschema\b|\bsanitize\b|\bcheck\b|\btypeof\b|\binstanceof\b|\bJoi\b|\bzod\b|\byup\b|\bclass-validator\b/i.test(handlerText);
    if (!hasValidation) {
      const evidence: EvidenceAnchor = {
        filePath: route.filePath, startLine: route.line, endLine: route.line,
        codeSnippet: route.code,
        lens: 'api', ruleId: 'api-missing-validation',
      };
      const f = createLensFinding('api', 'api', 'high',
        `Missing Input Validation: ${route.method} ${route.path}`,
        `${route.method} route "${route.path}" has no input validation. Validate all user inputs to prevent injection and data corruption.`,
        evidence,
        { suggestion: 'Add schema validation (e.g., Joi, Zod, Yup) for request body/params/query.', ruleId: 'api-missing-validation' });
      if (f) findings.push(f);
    }
  }

  // 2. Missing error handling
  if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(route.method)) {
    const hasErrorHandling =
      /\btry\b|\bcatch\b|\b\.catch\b|\bthrow\b|\bnext\s*\(/.test(handlerText);
    if (!hasErrorHandling) {
      const evidence: EvidenceAnchor = {
        filePath: route.filePath, startLine: route.line, endLine: route.line,
        codeSnippet: route.code,
        lens: 'api', ruleId: 'api-missing-error-handling',
      };
      const f = createLensFinding('api', 'api', 'medium',
        `Missing Error Handling: ${route.method} ${route.path}`,
        `${route.method} route "${route.path}" has no visible try/catch error handling. Unhandled errors will crash the server.`,
        evidence,
        { suggestion: 'Wrap handler logic in try/catch and return proper error responses.', ruleId: 'api-missing-error-handling' });
      if (f) findings.push(f);
    }
  }

  // 3. Missing rate limiting
  const hasRateLimit = /\brate\s*limit\b|\bthrottle\b|\bexpress-rate-limit\b|\bratelimit\b/i.test(handlerText);
  if (!hasRateLimit && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(route.method)) {
    const evidence: EvidenceAnchor = {
      filePath: route.filePath, startLine: route.line, endLine: route.line,
      codeSnippet: route.code,
      lens: 'api', ruleId: 'api-missing-rate-limit',
    };
    const f = createLensFinding('api', 'api', 'low',
      `Consider Rate Limiting: ${route.method} ${route.path}`,
      `${route.method} route "${route.path}" has no rate limiting. Consider adding rate limiting to prevent abuse.`,
      evidence,
      { suggestion: 'Use express-rate-limit or a middleware to protect this endpoint.', ruleId: 'api-missing-rate-limit' });
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export function analyzeApi(
  content: string,
  filePath: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  const lines = content.split('\n');

  // Detect routes based on file extension
  let routes: DetectedRoute[] = [];
  if (filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
    routes = detectExpressRoutes(lines, filePath);
    if (routes.length === 0) routes = detectGraphQLResolvers(lines, filePath);
  } else if (filePath.endsWith('.py')) {
    routes = detectPythonRoutes(lines, filePath);
  }

  // Analyze each route
  for (const route of routes) {
    findings.push(...analyzeRoute(route, lines));
  }

  return findings;
}

/** Generate an API lens report */
export function generateApiReport(
  content: string,
  filePath: string,
): LensReport {
  const start = Date.now();
  const findings = analyzeApi(content, filePath);
  return {
    lens: 'api',
    name: 'API Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}
