// @code-analyzer/analyzer — Pipeline Phase: Routes

import { basename, dirname } from 'node:path';

import type {
  PipelinePhaseId,
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger , EDGE_BELONGS_TO, EDGE_HANDLES, EDGE_HANDLES_ROUTE } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { GraphBuilder } from '../../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Routes helpers
// ---------------------------------------------------------------------------

const ROUTE_PATTERNS: Array<{ regex: RegExp; framework: string; method: string }> = [
  // Express.js / Connect-style
  { regex: /(?:app|router)\.(get|post|put|delete|patch|options|all|head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'express', method: '$1' },
  // Next.js App Router (export const GET/POST/etc)
  { regex: /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)/g, framework: 'nextjs-app', method: '$1' },
  // Next.js API Routes
  { regex: /export\s+default\s+(?:async\s+)?function\s+handler|export\s+default\s+function\s+handler/g, framework: 'nextjs-api', method: 'ALL' },
  // FastAPI / Flask decorator patterns
  { regex: /@(?:app|router|blueprint)\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'flask', method: '$1' },
  // Python FastAPI decorator
  { regex: /@(?:router|app)\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi, framework: 'fastapi', method: '$1' },
  // Django URL patterns
  { regex: /(?:path|re_path|url)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'django', method: 'ALL' },
  // Gin (Go)
  { regex: /(?:r|router|engine)\.(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'gin', method: 'ALL' },
  // Spring Boot annotations
  { regex: /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/g, framework: 'spring', method: 'ALL' },
  // Express router modules
  { regex: /router\.(get|post|put|delete|patch|options|all|head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'express-router', method: '$1' },
  // Koa
  { regex: /router\.(get|post|put|delete|patch|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'koa', method: '$1' },
  // Hono
  { regex: /app\.(get|post|put|delete|patch|options|all)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'hono', method: '$1' },
  // Hapi.js
  { regex: /server\.route\s*\(\s*\{[\s\S]{0,100}method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH|OPTIONS)['"`][\s\S]{0,100}path\s*:\s*['"`]([^'"`]+)['"`]/g, framework: 'hapi', method: '$1' },
  // NestJS @Controller + HTTP method decorators
  { regex: /@(Get|Post|Put|Delete|Patch|Options|All|Head)\s*\(\s*['"`]([^'"`]*)['"`]/g, framework: 'nestjs', method: '$1' },
  // Echo (Go)
  { regex: /e\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'echo', method: '$1' },
  // Chi (Go)
  { regex: /r\.(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'chi', method: '$1' },
  // Fiber (Go)
  { regex: /app\.(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'fiber', method: '$1' },
  // Rails routes (Ruby)
  { regex: /(get|post|put|patch|delete|resources|resource)\s+['"`]([^'"`]+)['"`]/g, framework: 'rails', method: '$1' },
  // Sinatra (Ruby)
  { regex: /(get|post|put|delete|patch|options)\s+['"`]([^'"`]+)['"`']\s+do/g, framework: 'sinatra', method: '$1' },
  // Laravel (PHP)
  { regex: /Route::(get|post|put|delete|patch|options|any|match)\s*\(\s*['"`]([^'"`]+)['"`]/g, framework: 'laravel', method: '$1' },
];

interface RouteInfo {
  path: string;
  method: string;
  framework: string;
  line: number;
  filePath: string;
}

function detectRoutes(filePath: string, content: string, fileName: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const lines = content.split('\n');

  // Also check for Next.js route file conventions
  if (fileName === 'route.ts' || fileName === 'route.tsx' || fileName === 'route.js' || fileName === 'route.jsx') {
    const dirPath = dirname(filePath);
    const routePath = dirPath.split('/app/')[1] ?? dirPath;
    routes.push({
      path: routePath,
      method: 'ALL',
      framework: 'nextjs-app-router',
      line: 1,
      filePath,
    });
  }

  for (const pattern of ROUTE_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      const pathOrMethod = match[1] ?? '';
      const routePath = match[2] ?? pathOrMethod;

      // Determine if the first capture is the HTTP method or the path
      const isHttpMethod = /^(get|post|put|delete|patch|options|head|all)$/i.test(pathOrMethod);
      const actualPath = isHttpMethod ? routePath : pathOrMethod;
      const actualMethod = isHttpMethod ? pathOrMethod.toUpperCase() : pattern.method;

      routes.push({
        path: actualPath,
        method: actualMethod,
        framework: pattern.framework,
        line: lineNum,
        filePath,
      });
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Phase 8: routes — Detect route handlers
// ---------------------------------------------------------------------------

export class RoutesPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'routes';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Detect and catalog API route handlers';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const scanData = ctx.phaseData.get('scan') as
        | { discoveredFiles: DiscoveredFile[] }
        | undefined;

      if (!scanData?.discoveredFiles || !ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { routesFound: 0 } };
      }

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let routesFound = 0;

      for (const file of scanData.discoveredFiles) {
        const fileName = basename(file.filePath);
        const routes = detectRoutes(file.filePath, file.content, fileName);
        if (routes.length === 0) continue;

        const fileNodeId = ctx.graph.fileIndex.get(file.filePath);
        if (!fileNodeId) continue;

        for (const route of routes) {
          const qname = `route:${file.filePath}:${route.method}:${route.path}`;
          const node = builder.addNode(ctx.graph, 'Route', `${route.method} ${route.path}`, {
            name: `${route.method} ${route.path}`,
            filePath: file.filePath,
            startLine: route.line,
            endLine: route.line,
            routePath: route.path,
            routeMethod: route.method,
            framework: route.framework,
          }, qname);

          builder.addEdge(ctx.graph, fileNodeId, node.id, EDGE_HANDLES_ROUTE, ctx.projectId);

          // Also create BELONGS_TO edges from any functions defined near the route
          const parseData = ctx.phaseData.get('parse') as
            | { parsedFiles: ParsedFile[] }
            | undefined;

          if (parseData?.parsedFiles) {
            const parsedFile = parseData.parsedFiles.find((pf) => pf.filePath === file.filePath);
            if (parsedFile) {
              for (const symbol of parsedFile.symbols) {
                if (symbol.startLine <= route.line + 2 && symbol.endLine >= route.line - 2) {
                  const symQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const symNodeId = ctx.graph.qnameIndex.get(symQname);
                  if (symNodeId) {
                    builder.addEdge(ctx.graph, symNodeId, node.id, EDGE_BELONGS_TO, ctx.projectId);
                    builder.addEdge(ctx.graph, symNodeId, node.id, EDGE_HANDLES, ctx.projectId);
                  }
                }
              }
            }
          }

          routesFound++;
        }
      }

      ctx.phaseData.set('routes', { routesFound });
      return { phaseId: this.id, status: 'success', output: { routesFound } };
    } catch (err) {
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}