// @code-analyzer/intelligence — Framework Route Detection
// Detects web framework route definitions and creates Route nodes in the
// knowledge graph with HANDLES edges to handler functions.
//
// Supported frameworks:
//   - Express.js: app.get/post/put/delete/patch(path, ...handlers)
//   - FastAPI: @app.get/post/put/delete/patch("/path") decorator patterns
//   - NestJS: @Get/Post/Put/Delete/Patch("/path") + @Controller("prefix")
//   - Django: urlpatterns + path()/re_path() patterns
//
// Architecture:
//   RouteDetector (orchestrator)
//     └── Framework-specific extractors
//           └── AST pattern matching via tree-sitter
//           └── Route node + HANDLES edge creation

import type { KnowledgeGraph, GraphNode, GraphEdge, NodeLabel } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedRoute {
  /** HTTP method or 'ws' for WebSocket, 'gql' for GraphQL. */
  method: string;
  /** URL path pattern (e.g., "/users/:id"). */
  path: string;
  /** File path where the route is defined. */
  filePath: string;
  /** Line number where the route definition starts (1-based). */
  line: number;
  /** Name of the handler function/class. */
  handlerName: string | null;
  /** Framework that defined this route. */
  framework: 'express' | 'fastapi' | 'nestjs' | 'django';
  /** Route type: http, websocket, graphql. */
  routeType: 'http' | 'websocket' | 'graphql';
  /** Controller/module name if applicable. */
  controllerName?: string;
}

export interface RouteDetectionResult {
  routes: DetectedRoute[];
  framework: string;
  filePath: string;
}

export interface RouteDetectorOptions {
  /** Frameworks to detect (default: all). */
  frameworks?: ('express' | 'fastapi' | 'nestjs' | 'django')[];
  /** Minimum confidence for AST-based detection (default: 0.7). */
  minConfidence?: number;
}

// ---------------------------------------------------------------------------
// Framework Patterns
// ---------------------------------------------------------------------------

const EXPRESS_PATTERNS = {
  // app.get("/path", handler)
  methodRoute: /\b(app|router)\s*\.\s*(get|post|put|delete|patch|all|use)\s*\(\s*['"]([^'"]+)['"]/g,
  // app.route("/path").get(handler)
  chainedRoute: /\b(app|router)\s*\.\s*route\s*\(\s*['"]([^'"]+)['"]/g,
  // express.Router()
  routerCreate: /\bexpress\s*\.\s*Router\s*\(\s*\)/g,
};

const FASTAPI_PATTERNS = {
  // @app.get("/path")
  decoratorRoute: /@(\w+)\s*\.\s*(get|post|put|delete|patch|websocket)\s*\(\s*['"]([^'"]+)['"]/g,
  // @router.get("/path")
  routerDecorator: /@(\w+)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g,
  // APIRouter definition
  routerCreate: /\bAPIRouter\s*\(\s*(?:prefix\s*=\s*['"]([^'"]+)['"])?/g,
  // WebSocket route
  wsRoute: /@(\w+)\s*\.\s*websocket\s*\(\s*['"]([^'"]+)['"]/g,
};

const NESTJS_PATTERNS = {
  // @Controller("prefix")
  controllerDecorator: /@Controller\s*\(\s*['"]([^'"]*)['"]/g,
  // @Get("path"), @Post("path"), etc.
  methodDecorator: /@(Get|Post|Put|Delete|Patch|All)\s*\(\s*['"]([^'"]*)['"]/g,
  // Method decorator without explicit path
  methodNoPath: /@(Get|Post|Put|Delete|Patch|All)\s*\(\s*\)/g,
  // @WebSocketGateway(port)
  wsGateway: /@WebSocketGateway\s*\(\s*(\d+)?\s*/g,
  // @SubscribeMessage("event")
  wsMessage: /@SubscribeMessage\s*\(\s*['"]([^'"]+)['"]/g,
  // GraphQL: @Query(), @Mutation(), @Subscription()
  gqlQuery: /@(Query|Mutation|Subscription)\s*\(\s*(?:['"]([^'"]*)['"])?\s*/g,
  // GraphQL: @Resolver()
  gqlResolver: /@Resolver\s*\(\s*(?:\(\)\s*=>\s*(\w+))?\s*/g,
};

const DJANGO_PATTERNS = {
  // path("url/", view, name="name")
  pathCall: /\bpath\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g,
  // re_path(r"^regex/", view)
  rePathCall: /\bre_path\s*\(\s*r?['"]([^'"]+)['"]\s*,\s*(\w+)/g,
  // urlpatterns = [...]
  urlPatterns: /\burlpatterns\s*=\s*\[/g,
  // include("app.urls")
  includeCall: /\binclude\s*\(\s*['"]([^'"]+)['"]/g,
};

// ---------------------------------------------------------------------------
// Framework Route Detector
// ---------------------------------------------------------------------------

export class FrameworkRouteDetector {
  private readonly frameworks: string[];
  private readonly minConfidence: number;

  constructor(options: RouteDetectorOptions = {}) {
    this.frameworks = options.frameworks ?? ['express', 'fastapi', 'nestjs', 'django'];
    this.minConfidence = options.minConfidence ?? 0.7;
  }

  /**
   * Detect routes in a single file's source code.
   *
   * @param filePath — path of the file being analyzed
   * @param content — the file's source code content
   * @param language — the language of the file
   * @returns RouteDetectionResult with detected routes
   */
  detectFile(
    filePath: string,
    content: string,
    language: string,
  ): RouteDetectionResult {
    const routes: DetectedRoute[] = [];
    const detectedFrameworks: string[] = [];

    // Express.js detection (JavaScript/TypeScript)
    if (this.frameworks.includes('express') && this.isJSFamily(language)) {
      const expressRoutes = this.detectExpressRoutes(filePath, content);
      if (expressRoutes.length > 0) {
        routes.push(...expressRoutes);
        detectedFrameworks.push('express');
      }
    }

    // FastAPI detection (Python)
    if (this.frameworks.includes('fastapi') && language === 'python') {
      const fastAPIRoutes = this.detectFastAPIRoutes(filePath, content);
      if (fastAPIRoutes.length > 0) {
        routes.push(...fastAPIRoutes);
        detectedFrameworks.push('fastapi');
      }
    }

    // NestJS detection (TypeScript)
    if (this.frameworks.includes('nestjs') && (language === 'typescript' || language === 'typescriptreact')) {
      const nestJSRoutes = this.detectNestJSRoutes(filePath, content);
      if (nestJSRoutes.length > 0) {
        routes.push(...nestJSRoutes);
        detectedFrameworks.push('nestjs');
      }
    }

    // Django detection (Python)
    if (this.frameworks.includes('django') && language === 'python') {
      const djangoRoutes = this.detectDjangoRoutes(filePath, content);
      if (djangoRoutes.length > 0) {
        routes.push(...djangoRoutes);
        detectedFrameworks.push('django');
      }
    }

    return {
      routes,
      framework: detectedFrameworks.join(', ') || 'none',
      filePath,
    };
  }

  /**
   * Create Route nodes and HANDLES edges in a knowledge graph.
   */
  addToGraph(
    routes: DetectedRoute[],
    graph: KnowledgeGraph,
    fileNodeId: number,
  ): { nodesAdded: number; edgesAdded: number } {
    let nodesAdded = 0;
    let edgesAdded = 0;

    for (const route of routes) {
      // Create route node
      const routeNodeId = graph.nodes.size + 1;
      const routeNode: GraphNode = {
        id: routeNodeId,
        labels: ['Route' as NodeLabel],
        properties: {
          method: route.method,
          path: route.path,
          filePath: route.filePath,
          line: route.line,
          framework: route.framework,
          routeType: route.routeType,
          controllerName: route.controllerName ?? null,
          handlerName: route.handlerName ?? null,
        },
        filePath: route.filePath,
        startLine: route.line,
        endLine: route.line,
        isExported: false,
      };

      graph.nodes.set(routeNodeId, routeNode);
      nodesAdded++;

      // Create HANDLES edge from file to route
      const edge: GraphEdge = {
        id: graph.edges.size + 1,
        sourceId: fileNodeId,
        targetId: routeNodeId,
        edgeType: 'HANDLES',
        sourceLabel: 'File',
        targetLabel: 'Route',
        properties: { method: route.method, path: route.path },
      };

      graph.edges.set(edge.id, edge);
      edgesAdded++;

      // If we have a handler name, try to find the handler node and create a HANDLES edge
      if (route.handlerName) {
        for (const [id, node] of graph.nodes) {
          const name = (node.properties as Record<string, unknown>)['name'];
          if (name === route.handlerName) {
            const handlerEdge: GraphEdge = {
              id: graph.edges.size + 1,
              sourceId: routeNodeId,
              targetId: id,
              edgeType: 'HANDLES',
              sourceLabel: 'Route',
              targetLabel: node.labels[0] ?? 'Symbol',
              properties: { method: route.method, path: route.path },
            };
            graph.edges.set(handlerEdge.id, handlerEdge);
            edgesAdded++;
            break;
          }
        }
      }
    }

    return { nodesAdded, edgesAdded };
  }

  // ---------------------------------------------------------------------------
  // Express.js Detection
  // ---------------------------------------------------------------------------

  private detectExpressRoutes(filePath: string, content: string): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Reset regex state
      EXPRESS_PATTERNS.methodRoute.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = EXPRESS_PATTERNS.methodRoute.exec(trimmed)) !== null) {
        const method = match[2]!;
        const urlPath = match[3]!;

        // Determine if it's WebSocket
        const routeType = method === 'ws' ? 'websocket' : 'http';

        // Try to find the handler name on the same or next line
        const handlerName = this.extractExpressHandler(lines, i);

        routes.push({
          method: method.toUpperCase(),
          path: urlPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: 'express',
          routeType,
        });
      }

      // Check for chained routes
      EXPRESS_PATTERNS.chainedRoute.lastIndex = 0;
      while ((match = EXPRESS_PATTERNS.chainedRoute.exec(trimmed)) !== null) {
        const basePath = match[2]!;
        // Look for method chaining on subsequent lines
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j]!.trim();
          const methodMatch = nextLine.match(/\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/);
          if (methodMatch) {
            routes.push({
              method: methodMatch[1]!.toUpperCase(),
              path: `${basePath}${methodMatch[2]}`,
              filePath,
              line: j + 1,
              handlerName: null,
              framework: 'express',
              routeType: 'http',
            });
          }
        }
      }
    }

    return routes;
  }

  private extractExpressHandler(lines: string[], currentLine: number): string | null {
    const line = lines[currentLine]!.trim();
    // Try: app.get("/path", handlerFunction)
    const handlerMatch = line.match(/\b(app|router)\s*\.\s*\w+\s*\([^)]*,\s*(\w+)\s*\)/);
    if (handlerMatch) return handlerMatch[2]!;

    // Try: function reference on next line
    if (currentLine + 1 < lines.length) {
      const nextLine = lines[currentLine + 1]!.trim();
      const funcMatch = nextLine.match(/^(\w+)\s*[,\)]/);
      if (funcMatch) return funcMatch[1]!;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // FastAPI Detection
  // ---------------------------------------------------------------------------

  private detectFastAPIRoutes(filePath: string, content: string): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Decorator routes: @app.get("/path")
      FASTAPI_PATTERNS.decoratorRoute.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = FASTAPI_PATTERNS.decoratorRoute.exec(trimmed)) !== null) {
        const method = match[2]!;
        const urlPath = match[3]!;
        const routeType = method === 'websocket' ? 'websocket' : 'http';

        // Handler is the function on the next line
        const handlerName = this.extractPythonHandler(lines, i);

        routes.push({
          method: method.toUpperCase(),
          path: urlPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: 'fastapi',
          routeType,
        });
      }

      // Router decorators
      FASTAPI_PATTERNS.routerDecorator.lastIndex = 0;
      while ((match = FASTAPI_PATTERNS.routerDecorator.exec(trimmed)) !== null) {
        const method = match[2]!;
        const urlPath = match[3]!;
        const handlerName = this.extractPythonHandler(lines, i);

        routes.push({
          method: method.toUpperCase(),
          path: urlPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: 'fastapi',
          routeType: 'http',
        });
      }

      // WebSocket routes
      FASTAPI_PATTERNS.wsRoute.lastIndex = 0;
      while ((match = FASTAPI_PATTERNS.wsRoute.exec(trimmed)) !== null) {
        const urlPath = match[2]!;
        const handlerName = this.extractPythonHandler(lines, i);

        routes.push({
          method: 'WS',
          path: urlPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: 'fastapi',
          routeType: 'websocket',
        });
      }
    }

    return routes;
  }

  private extractPythonHandler(lines: string[], decoratorLine: number): string | null {
    for (let j = decoratorLine + 1; j < Math.min(decoratorLine + 3, lines.length); j++) {
      const next = lines[j]!;
      // async def handler_name(...):
      const asyncMatch = next.match(/async\s+def\s+(\w+)\s*\(/);
      if (asyncMatch) return asyncMatch[1]!;
      // def handler_name(...):
      const defMatch = next.match(/def\s+(\w+)\s*\(/);
      if (defMatch) return defMatch[1]!;
      // Break on next decorator or non-empty non-function line
      if (next.trim() && !next.trim().startsWith('@') && !next.trim().startsWith('#')) break;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // NestJS Detection
  // ---------------------------------------------------------------------------

  private detectNestJSRoutes(filePath: string, content: string): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    const lines = content.split('\n');

    // First pass: find @Controller("prefix")
    let controllerPrefix = '';
    let controllerName: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      NESTJS_PATTERNS.controllerDecorator.lastIndex = 0;
      const ctrlMatch = NESTJS_PATTERNS.controllerDecorator.exec(trimmed);
      if (ctrlMatch) {
        controllerPrefix = ctrlMatch[1] ?? '';

        // Find the class name on the next line
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const classMatch = lines[j]!.match(/export\s+class\s+(\w+)/);
          if (classMatch) {
            controllerName = classMatch[1];
            break;
          }
        }
      }

      // Method decorators: @Get("path")
      NESTJS_PATTERNS.methodDecorator.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = NESTJS_PATTERNS.methodDecorator.exec(trimmed)) !== null) {
        const method = match[1]!;
        const subPath = match[2] ?? '';
        const fullPath = this.joinPaths(controllerPrefix, subPath);
        const handlerName = this.extractNestJSHandler(lines, i);

        routes.push({
          method: method.toUpperCase(),
          path: fullPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: 'nestjs',
          routeType: 'http',
          controllerName,
        });
      }

      // Method decorators without explicit path
      NESTJS_PATTERNS.methodNoPath.lastIndex = 0;
      while ((match = NESTJS_PATTERNS.methodNoPath.exec(trimmed)) !== null) {
        const method = match[1]!;
        const handlerName = this.extractNestJSHandler(lines, i);

        routes.push({
          method: method.toUpperCase(),
          path: controllerPrefix || '/',
          filePath,
          line: i + 1,
          handlerName,
          framework: 'nestjs',
          routeType: 'http',
          controllerName,
        });
      }

      // GraphQL: @Query(), @Mutation(), @Subscription()
      NESTJS_PATTERNS.gqlQuery.lastIndex = 0;
      while ((match = NESTJS_PATTERNS.gqlQuery.exec(trimmed)) !== null) {
        const operationType = match[1]!;
        const gqlName = match[2] ?? operationType.toLowerCase();

        routes.push({
          method: operationType.toUpperCase(),
          path: `graphql:${gqlName}`,
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'nestjs',
          routeType: 'graphql',
          controllerName,
        });
      }

      // WebSocket: @SubscribeMessage("event")
      NESTJS_PATTERNS.wsMessage.lastIndex = 0;
      while ((match = NESTJS_PATTERNS.wsMessage.exec(trimmed)) !== null) {
        routes.push({
          method: 'WS',
          path: match[1]!,
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'nestjs',
          routeType: 'websocket',
          controllerName,
        });
      }
    }

    return routes;
  }

  private extractNestJSHandler(lines: string[], decoratorLine: number): string | null {
    for (let j = decoratorLine + 1; j < Math.min(decoratorLine + 5, lines.length); j++) {
      const next = lines[j]!;
      // async methodName(...)
      const asyncMatch = next.match(/async\s+(\w+)\s*\(/);
      if (asyncMatch) return asyncMatch[1]!;
      // methodName(...)
      const funcMatch = next.match(/\b(\w+)\s*\(\s*(?:\)|[^)]*:\s*\w+)/);
      if (funcMatch) return funcMatch[1]!;
      if (next.trim().startsWith('//') || next.trim().startsWith('*')) continue;
      if (next.trim()) break;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Django Detection
  // ---------------------------------------------------------------------------

  private detectDjangoRoutes(filePath: string, content: string): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    const lines = content.split('\n');
    let inUrlPatterns = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Detect urlpatterns block
      DJANGO_PATTERNS.urlPatterns.lastIndex = 0;
      if (DJANGO_PATTERNS.urlPatterns.test(trimmed)) {
        inUrlPatterns = true;
        continue;
      }

      if (inUrlPatterns && trimmed === ']') {
        inUrlPatterns = false;
        continue;
      }

      if (!inUrlPatterns) continue;

      // path("url/", view_func)
      DJANGO_PATTERNS.pathCall.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = DJANGO_PATTERNS.pathCall.exec(trimmed)) !== null) {
        const urlPath = match[1]!;
        const viewFunc = match[2]!;

        routes.push({
          method: 'GET/POST',
          path: urlPath,
          filePath,
          line: i + 1,
          handlerName: viewFunc,
          framework: 'django',
          routeType: 'http',
        });
      }

      // re_path(r"regex/", view_func)
      DJANGO_PATTERNS.rePathCall.lastIndex = 0;
      while ((match = DJANGO_PATTERNS.rePathCall.exec(trimmed)) !== null) {
        routes.push({
          method: 'GET/POST',
          path: match[1]!,
          filePath,
          line: i + 1,
          handlerName: match[2]!,
          framework: 'django',
          routeType: 'http',
        });
      }

      // include("app.urls")
      DJANGO_PATTERNS.includeCall.lastIndex = 0;
      while ((match = DJANGO_PATTERNS.includeCall.exec(trimmed)) !== null) {
        routes.push({
          method: 'INCLUDE',
          path: match[1]!,
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'django',
          routeType: 'http',
        });
      }
    }

    return routes;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isJSFamily(language: string): boolean {
    return ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(language);
  }

  private joinPaths(prefix: string, subPath: string): string {
    if (!prefix) return subPath || '/';
    if (!subPath) return prefix || '/';
    const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const normalizedSub = subPath.startsWith('/') ? subPath : `/${subPath}`;
    return `${normalizedPrefix}${normalizedSub}`;
  }
}
