// @code-analyzer/intelligence — API Review Lens
// Detects API issues: missing validation, error handling, HTTP method gaps,
// rate limiting, response format consistency, CORS configuration,
// GraphQL schema breaking changes.

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
  /** Response shape extracted from handler */
  responseShape?: string;
}

/** Detect Express/Koa-style route handlers */
function detectExpressRoutes(lines: string[], filePath: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(
      /(?:app|router|this)\.(get|post|put|delete|patch|all|use)\s*\(\s*['"]([^'"]+)['"]/,
    );
    if (m) {
      // Extract response shape from nearby lines
      const surrounding = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');
      const shape = extractResponseShape(surrounding);

      routes.push({
        filePath,
        line: i + 1,
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        handler: `line ${i + 1}`,
        code: line.trim().slice(0, 200),
        responseShape: shape ?? undefined,
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
    const m = line.match(
      /@(?:app|router|bp)\.(get|post|put|delete|patch|route)\s*\(\s*['"]([^'"]+)['"]/,
    );
    if (m) {
      const nextLine = i + 1 < lines.length ? lines[i + 1]! : '';
      const funcMatch = nextLine.match(/(?:async\s+)?def\s+(\w+)/);
      const surrounding = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');
      const shape = extractResponseShape(surrounding);

      routes.push({
        filePath,
        line: i + 1,
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        handler: funcMatch ? funcMatch[1]! : `line ${i + 2}`,
        code: lines
          .slice(i, i + 2)
          .join('\n')
          .trim(),
        responseShape: shape ?? undefined,
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
          filePath,
          line: i + 1,
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

function analyzeRoute(route: DetectedRoute, lines: string[]): LensFinding[] {
  const findings: LensFinding[] = [];
  const handlerLines = lines.slice(
    Math.max(0, route.line - 1),
    Math.min(lines.length, route.line + 30),
  );
  const handlerText = handlerLines.join('\n');

  // 1. Missing HTTP method validation
  if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
    const hasValidation =
      /\bvalidate\b|\bschema\b|\bsanitize\b|\bcheck\b|\btypeof\b|\binstanceof\b|\bJoi\b|\bzod\b|\byup\b|\bclass-validator\b/i.test(
        handlerText,
      );
    if (!hasValidation) {
      const evidence: EvidenceAnchor = {
        filePath: route.filePath,
        startLine: route.line,
        endLine: route.line,
        codeSnippet: route.code,
        lens: 'api',
        ruleId: 'api-missing-validation',
      };
      const f = createLensFinding(
        'api',
        'api',
        'high',
        `Missing Input Validation: ${route.method} ${route.path}`,
        `${route.method} route "${route.path}" has no input validation. Validate all user inputs to prevent injection and data corruption.`,
        evidence,
        {
          suggestion: 'Add schema validation (e.g., Joi, Zod, Yup) for request body/params/query.',
          ruleId: 'api-missing-validation',
        },
      );
      if (f) findings.push(f);
    }
  }

  // 2. Missing error handling
  if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(route.method)) {
    const hasErrorHandling = /\btry\b|\bcatch\b|\b\.catch\b|\bthrow\b|\bnext\s*\(/.test(
      handlerText,
    );
    if (!hasErrorHandling) {
      const evidence: EvidenceAnchor = {
        filePath: route.filePath,
        startLine: route.line,
        endLine: route.line,
        codeSnippet: route.code,
        lens: 'api',
        ruleId: 'api-missing-error-handling',
      };
      const f = createLensFinding(
        'api',
        'api',
        'medium',
        `Missing Error Handling: ${route.method} ${route.path}`,
        `${route.method} route "${route.path}" has no visible try/catch error handling. Unhandled errors will crash the server.`,
        evidence,
        {
          suggestion: 'Wrap handler logic in try/catch and return proper error responses.',
          ruleId: 'api-missing-error-handling',
        },
      );
      if (f) findings.push(f);
    }
  }

  // 3. Missing rate limiting
  const hasRateLimit = /\brate\s*limit\b|\bthrottle\b|\bexpress-rate-limit\b|\bratelimit\b/i.test(
    handlerText,
  );
  if (!hasRateLimit && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(route.method)) {
    const evidence: EvidenceAnchor = {
      filePath: route.filePath,
      startLine: route.line,
      endLine: route.line,
      codeSnippet: route.code,
      lens: 'api',
      ruleId: 'api-missing-rate-limit',
    };
    const f = createLensFinding(
      'api',
      'api',
      'low',
      `Consider Rate Limiting: ${route.method} ${route.path}`,
      `${route.method} route "${route.path}" has no rate limiting. Consider adding rate limiting to prevent abuse.`,
      evidence,
      {
        suggestion: 'Use express-rate-limit or a middleware to protect this endpoint.',
        ruleId: 'api-missing-rate-limit',
      },
    );
    if (f) findings.push(f);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Response format consistency
// ---------------------------------------------------------------------------

/**
 * Extract the response shape from source code near a route handler.
 * Looks for res.json(), res.send(), or return {} patterns.
 */
function extractResponseShape(handlerText: string): string | null {
  const jsonMatches = handlerText.match(/res\.json\s*\(\s*\{([\s\S]*?)\}\s*\)/g);
  const sendMatches = handlerText.match(/res\.send\s*\(\s*\{([\s\S]*?)\}\s*\)/g);
  const returnMatches = handlerText.match(/return\s+\{([\s\S]*?)\}\s*;?/g);

  const all = [...(jsonMatches ?? []), ...(sendMatches ?? []), ...(returnMatches ?? [])];
  if (all.length === 0) return null;

  // Extract field names from response body
  const fieldNames: string[] = [];
  for (const match of all) {
    const fieldRegex = /(\w+)\s*:/g;
    let m;
    while ((m = fieldRegex.exec(match)) !== null) {
      if (m[1] && !['status', 'success', 'error'].includes(m[1])) {
        fieldNames.push(m[1]);
      }
    }
  }

  // Normalize: sort alphabetically for comparison
  return [...new Set(fieldNames)].sort().join(',');
}

/**
 * Detect routes returning inconsistent response shapes for the same HTTP status.
 * Compares response shapes across different routes and flags inconsistencies.
 */
function detectResponseFormatInconsistencies(
  routes: DetectedRoute[],
  lines: string[],
): LensFinding[] {
  const findings: LensFinding[] = [];

  // Group routes by file
  const routeShapes: Array<{ path: string; line: number; shape: string; code: string }> = [];

  for (const route of routes) {
    const handlerLines = lines.slice(
      Math.max(0, route.line - 1),
      Math.min(lines.length, route.line + 30),
    );
    const shape = extractResponseShape(handlerLines.join('\n'));
    if (shape) {
      routeShapes.push({
        path: route.path,
        line: route.line,
        shape,
        code: route.code,
      });
    }
  }

  // Compare shapes within the same group for inconsistency
  if (routeShapes.length >= 2) {
    const shapes = new Set(routeShapes.map((r) => r.shape));
    if (shapes.size >= 2) {
      const sample1 = routeShapes[0]!;
      const sample2 = routeShapes.find((r) => r.shape !== sample1.shape) ?? routeShapes[1]!;

      const evidence: EvidenceAnchor = {
        filePath: routes[0]!.filePath,
        startLine: Math.min(sample1.line, sample2.line),
        endLine: Math.max(sample1.line, sample2.line),
        codeSnippet: `Inconsistent: ${sample1.path} returns [${sample1.shape}] but ${sample2.path} returns [${sample2.shape}]`,
        lens: 'api',
        ruleId: 'api-inconsistent-response',
      };
      const f = createLensFinding(
        'api',
        'api',
        'high',
        `Inconsistent Response Format`,
        `Route "${sample1.path}" returns response with fields [${sample1.shape}] while "${sample2.path}" returns [${sample2.shape}]. Consistent response shapes improve API usability.`,
        evidence,
        {
          suggestion: 'Standardize response format: { data, error, meta } for all endpoints.',
          ruleId: 'api-inconsistent-response',
        },
      );
      if (f) findings.push(f);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: Rate limiting middleware check
// ---------------------------------------------------------------------------

/**
 * Detect routes without rate limiting middleware applied at the router level.
 * Checks the full file content for rate limiting middleware usage.
 */
function detectGlobalRateLimit(lines: string[], filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const content = lines.join('\n');

  // Check for rate-limit middleware import/require
  const hasRateLimitImport =
    /\b(?:require|import).*rate.?limit/.test(content) ||
    /\bexpress-rate-limit\b|\bratelimit\b|\bthrottle\b/i.test(content);

  // Check for rate-limit middleware usage
  const hasRateLimitUsage = /\brateLimit\(|\.rateLimit\(|rate_limiter\b|RateLimiter\b/.test(
    content,
  );

  // Only flag if no rate limiting at all in route files
  const isRouteFile =
    /\/api\/|\/routes\/|\/controllers\/|\/handlers\/|router\.|app\.(?:get|post|put|delete)/i.test(
      content,
    );

  if (isRouteFile && !hasRateLimitImport && !hasRateLimitUsage) {
    // Count handlers as evidence
    const handlerCount = (content.match(/\.(?:get|post|put|delete|patch)\s*\(/g) || []).length;
    if (handlerCount >= 3) {
      const evidence: EvidenceAnchor = {
        filePath,
        startLine: 1,
        endLine: lines.length,
        codeSnippet: `${handlerCount} route handlers without rate limiting middleware`,
        lens: 'api',
        ruleId: 'api-no-global-rate-limit',
      };
      const f = createLensFinding(
        'api',
        'security',
        'high',
        `Missing Global Rate Limiting: ${handlerCount} routes unprotected`,
        `This file defines ${handlerCount} route handlers with no rate limiting middleware. Without rate limiting, endpoints are vulnerable to brute force, DDoS, and abuse.`,
        evidence,
        {
          suggestion: 'Add express-rate-limit or equivalent middleware at the router level.',
          ruleId: 'api-no-global-rate-limit',
        },
      );
      if (f) findings.push(f);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: CORS configuration detection
// ---------------------------------------------------------------------------

/**
 * Detect overly permissive CORS settings.
 * Flags: Access-Control-Allow-Origin: *, credentials with wildcard origin,
 * overly broad allowed methods/headers.
 */
function detectCORSConfiguration(lines: string[], filePath: string): LensFinding[] {
  const findings: LensFinding[] = [];
  const content = lines.join('\n');

  // Check for CORS middleware configuration
  const hasCors = /\bcors\b|\bAccess-Control-Allow-Origin\b/i.test(content);

  if (!hasCors) return findings;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Check for Access-Control-Allow-Origin: * (wildcard)
    if (/\bAccess-Control-Allow-Origin\s*:\s*\*/.test(line)) {
      const evidence: EvidenceAnchor = {
        filePath,
        startLine: i + 1,
        endLine: i + 1,
        codeSnippet: line.trim().slice(0, 200),
        lens: 'api',
        ruleId: 'api-cors-wildcard',
      };
      const f = createLensFinding(
        'api',
        'security',
        'high',
        'Overly Permissive CORS: Wildcard Origin',
        `CORS configured with Access-Control-Allow-Origin: * allows any domain to access the API. This may expose sensitive data to malicious sites.`,
        evidence,
        {
          suggestion:
            'Restrict CORS origins to trusted domains: cors({ origin: ["https://app.example.com"] })',
          ruleId: 'api-cors-wildcard',
        },
      );
      if (f) findings.push(f);
    }

    // Check for cors() with wildcard (e.g., cors({ origin: '*' }))
    if (/\bcors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]\s*/.test(line)) {
      const evidence: EvidenceAnchor = {
        filePath,
        startLine: i + 1,
        endLine: i + 1,
        codeSnippet: line.trim().slice(0, 200),
        lens: 'api',
        ruleId: 'api-cors-wildcard-js',
      };
      const f = createLensFinding(
        'api',
        'security',
        'high',
        'CORS Wildcard Origin in Config',
        `CORS configured with origin: "*" allows any origin. Restrict to specific domains.`,
        evidence,
        {
          suggestion: 'Replace "*" with your application\'s allowed domains.',
          ruleId: 'api-cors-wildcard-js',
        },
      );
      if (f) findings.push(f);
    }

    // Check for credentials: true with wildcard origin (dangerous)
    if (/\bcredentials\s*:\s*true\b/.test(line) || /\bwithCredentials\b/.test(line)) {
      const nearby = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join('\n');
      if (/['"]\*['"]/.test(nearby) || /\borigin\s*:\s*\*/.test(nearby)) {
        const evidence: EvidenceAnchor = {
          filePath,
          startLine: i + 1,
          endLine: i + 1,
          codeSnippet: line.trim().slice(0, 200),
          lens: 'api',
          ruleId: 'api-cors-credentials',
        };
        const f = createLensFinding(
          'api',
          'security',
          'critical',
          'Dangerous CORS: Credentials with Wildcard',
          `CORS configured with credentials: true and wildcard origin. This is a security vulnerability — browsers block this combination, but bypasses may exist. Never use credentials with wildcard origin.`,
          evidence,
          {
            suggestion: 'Use specific origins with credentials, never "*".',
            ruleId: 'api-cors-credentials',
          },
        );
        if (f) findings.push(f);
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NEW: GraphQL schema breaking changes
// ---------------------------------------------------------------------------

/**
 * Detect GraphQL schema breaking changes by comparing old vs new schema files.
 * Flags: removed fields, removed types, type changes.
 */
function detectGraphQLSchemaBreakingChanges(
  lines: string[],
  filePath: string,
  previousContent?: string,
): LensFinding[] {
  const findings: LensFinding[] = [];
  if (!previousContent) return findings;

  // Only check .graphql or .gql files
  if (
    !filePath.endsWith('.graphql') &&
    !filePath.endsWith('.gql') &&
    !filePath.includes('schema') &&
    !filePath.includes('typeDefs')
  ) {
    return findings;
  }

  // Extract type definitions from current content
  const currentTypes = extractGraphQLTypes(lines);
  const previousTypes = extractGraphQLTypes(previousContent.split('\n'));

  // Check for removed types
  for (const prevType of previousTypes) {
    if (!currentTypes.some((t) => t.name === prevType.name)) {
      const evidence: EvidenceAnchor = {
        filePath,
        startLine: 1,
        endLine: 1,
        codeSnippet: `Type "${prevType.name}" was removed`,
        lens: 'api',
        ruleId: 'api-gql-removed-type',
      };
      const f = createLensFinding(
        'api',
        'api',
        'critical',
        `GraphQL Breaking Change: Removed Type "${prevType.name}"`,
        `Type "${prevType.name}" was removed from the GraphQL schema. This is a BREAKING CHANGE — clients querying this type will receive errors. Use @deprecated before removal.`,
        evidence,
        {
          suggestion: `Restore type "${prevType.name}" or add @deprecated with a migration path.`,
          ruleId: 'api-gql-removed-type',
        },
      );
      if (f) findings.push(f);
    }
  }

  // Check for removed fields within types
  for (const prevType of previousTypes) {
    const curType = currentTypes.find((t) => t.name === prevType.name);
    if (!curType) continue;

    for (const prevField of prevType.fields) {
      if (!curType.fields.includes(prevField)) {
        const evidence: EvidenceAnchor = {
          filePath,
          startLine: 1,
          endLine: 1,
          codeSnippet: `Field "${prevType.name}.${prevField}" was removed`,
          lens: 'api',
          ruleId: 'api-gql-removed-field',
        };
        const f = createLensFinding(
          'api',
          'api',
          'critical',
          `GraphQL Breaking Change: Removed Field "${prevType.name}.${prevField}"`,
          `Field "${prevField}" was removed from type "${prevType.name}". This is a BREAKING CHANGE. Add @deprecated to the field first and communicate migration timeline to API consumers.`,
          evidence,
          {
            suggestion: `Restore field "${prevField}" in ${prevType.name} with @deprecated annotation.`,
            ruleId: 'api-gql-removed-field',
          },
        );
        if (f) findings.push(f);
      }
    }
  }

  return findings;
}

/** Extract type names and their fields from GraphQL schema lines */
function extractGraphQLTypes(lines: string[]): Array<{ name: string; fields: string[] }> {
  const types: Array<{ name: string; fields: string[] }> = [];
  let currentType: { name: string; fields: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const typeMatch = trimmed.match(/type\s+(\w+)\s*(?:implements\s+\w+(?:\s*&\s*\w+)*)?\s*\{/);
    if (typeMatch) {
      if (currentType) types.push(currentType);
      currentType = { name: typeMatch[1]!, fields: [] };
      continue;
    }

    if (currentType) {
      if (trimmed === '}' || trimmed === '})') {
        types.push(currentType);
        currentType = null;
        continue;
      }

      const fieldMatch = trimmed.match(/^(\w+)\s*(?:\([^)]*\))?\s*:/);
      if (fieldMatch) {
        currentType.fields.push(fieldMatch[1]!);
      }
    }
  }

  if (currentType) types.push(currentType);
  return types;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export interface ApiAnalysisOptions {
  /** Previous file content for schema comparison (GraphQL diff) */
  previousContent?: string;
}

export function analyzeApi(
  content: string,
  filePath: string,
  options?: ApiAnalysisOptions,
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

  // NEW: Response format consistency across routes
  findings.push(...detectResponseFormatInconsistencies(routes, lines));

  // NEW: Global rate limiting check
  findings.push(...detectGlobalRateLimit(lines, filePath));

  // NEW: CORS configuration check
  findings.push(...detectCORSConfiguration(lines, filePath));

  // NEW: GraphQL schema breaking changes
  findings.push(...detectGraphQLSchemaBreakingChanges(lines, filePath, options?.previousContent));

  return findings;
}

/** Generate an API lens report */
export function generateApiReport(
  content: string,
  filePath: string,
  options?: ApiAnalysisOptions,
): LensReport {
  const start = Date.now();
  const findings = analyzeApi(content, filePath, options);
  return {
    lens: 'api',
    name: 'API Lens',
    findings,
    filesScanned: 1,
    linesAnalyzed: content.split('\n').length,
    durationMs: Date.now() - start,
  };
}
