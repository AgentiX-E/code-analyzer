// @code-analyzer/intelligence — Framework Route Detection
// Detects web framework route definitions and creates Route nodes in the
// knowledge graph with HANDLES edges to handler functions.
//
// Supported frameworks:
//   - Express.js: app.get/post/put/delete/patch(path, ...handlers)
//   - FastAPI: @app.get/post/put/delete/patch("/path") decorator patterns
//   - NestJS: @Get/Post/Put/Delete/Patch("/path") + @Controller("prefix")
//   - Django: urlpatterns + path()/re_path() patterns
//   - SvelteKit: file-based routing (+page.svelte, +server.ts, +layout.svelte)
//   - Spring Boot: @RestController/@Controller + @GetMapping/@PostMapping/etc.
//   - Spring Cloud: @FeignClient, @EnableDiscoveryClient, @SpringBootApplication
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
  framework: 'express' | 'fastapi' | 'nestjs' | 'django' | 'sveltekit' | 'springboot' | 'springcloud';
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
  frameworks?: ('express' | 'fastapi' | 'nestjs' | 'django' | 'sveltekit' | 'springboot' | 'springcloud')[];
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

const SVELTEKIT_PATTERNS = {
  // File-based route pages: +page.svelte
  pageComponent: /\+page\.svelte$/,
  // Universal page load functions: +page.ts, +page.js
  pageLoad: /\+page\.(?:ts|js)$/,
  // Server page load functions: +page.server.ts, +page.server.js
  pageServerLoad: /\+page\.server\.(?:ts|js)$/,
  // Layout component
  layoutComponent: /\+layout\.svelte$/,
  // Universal layout load: +layout.ts, +layout.js
  layoutLoad: /\+layout\.(?:ts|js)$/,
  // Layout server load: +layout.server.ts, +layout.server.js
  layoutServerLoad: /\+layout\.server\.(?:ts|js)$/,
  // API endpoints: +server.ts, +server.js
  serverEndpoint: /\+server\.(?:ts|js)$/,
  // Load function exports
  loadExport: /export\s+(?:const|function|async\s+function)\s+load\b/,
  actionsExport: /export\s+const\s+actions\b/,
  // HTTP method exports in +server.ts/+server.js
  httpMethodExport: /export\s+(?:const|function|async\s+function)\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/,
  // Error pages
  errorPage: /\+error\.svelte$/,
  // Route parameter: [param] directories (indicated by path structure)
  routeParam: /\[.*?\]/,
};

const SPRING_PATTERNS = {
  // Class-level annotations
  // @RestController — REST controller, implies all methods return @ResponseBody
  restController: /@RestController\b/,
  // @Controller — MVC controller (view-based)
  controller: /@Controller\b/,
  // @RestController("/prefix") or @Controller("/prefix") — class-level path prefix
  controllerWithPrefix: /@(?:Rest)?Controller\s*\(\s*['"]([^'"]*)['"]/,
  // @RequestMapping("/path") — class-level base path mapping
  requestMappingClass: /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/g,

  // Method-level HTTP mapping annotations
  // @GetMapping("/path"), @PostMapping("/path"), etc.
  getMapping: /@GetMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/g,
  postMapping: /@PostMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/g,
  putMapping: /@PutMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/g,
  deleteMapping: /@DeleteMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/g,
  patchMapping: /@PatchMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/g,
  // @RequestMapping(method=GET) / @RequestMapping(method=POST) — method-level generic mapping
  requestMappingMethod: /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]\s*,\s*method\s*=\s*RequestMethod\.(\w+)/g,
  // @RequestMapping with empty path (uses class-level prefix only)
  requestMappingNoPath: /@RequestMapping\s*\(\s*method\s*=\s*RequestMethod\.(\w+)/g,

  // Path variable and query param patterns (informational)
  pathVariable: /@PathVariable\s*(?:\(\s*(?:value\s*=\s*)?['"]?(\w+)['"]?\s*\))?/,
  requestParam: /@RequestParam\s*(?:\(\s*(?:value\s*=\s*)?['"]?(\w+)['"]?\s*\))?/,

  // Spring Cloud annotations
  // @FeignClient(name="service-name", url="...") — declarative REST client
  feignClient: /@FeignClient\s*\(([^)]*)\)/,
  feignClientName: /name\s*=\s*['"]([^'"]+)['"]/,
  feignClientUrl: /url\s*=\s*['"]([^'"]+)['"]/,
  // @FeignClient method mappings
  feignGetMapping: /@GetMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g,
  feignPostMapping: /@PostMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g,
  feignPutMapping: /@PutMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g,
  feignDeleteMapping: /@DeleteMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g,

  // Spring Cloud infrastructure annotations
  enableDiscoveryClient: /@EnableDiscoveryClient\b/,
  enableCircuitBreaker: /@EnableCircuitBreaker\b/,
  springBootApplication: /@SpringBootApplication\b/,
  configuration: /@Configuration\b/,
  bean: /@Bean\b/,

  // Service layer annotations (metadata, not routes)
  service: /@Service\b/,
  repository: /@Repository\b/,

  // Java method name extraction
  javaMethod: /(?:public|private|protected)\s+(?:static\s+)?(?:@\w+\s+)*(?:[\w<>,\[\]]+)\s+(\w+)\s*\(/,
};

// ---------------------------------------------------------------------------
// Framework Route Detector
// ---------------------------------------------------------------------------

export class FrameworkRouteDetector {
  private readonly frameworks: string[];
  private readonly minConfidence: number;

  constructor(options: RouteDetectorOptions = {}) {
    this.frameworks = options.frameworks ?? ['express', 'fastapi', 'nestjs', 'django', 'sveltekit', 'springboot', 'springcloud'];
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

    // SvelteKit detection (Svelte file-based routing)
    if (this.frameworks.includes('sveltekit') && (language === 'svelte' || language === 'typescript' || language === 'javascript')) {
      const sveltekitRoutes = this.detectSvelteKitRoutes(filePath, content);
      if (sveltekitRoutes.length > 0) {
        routes.push(...sveltekitRoutes);
        detectedFrameworks.push('sveltekit');
      }
    }

    // Spring Boot / Spring Cloud detection (Java)
    if ((this.frameworks.includes('springboot') || this.frameworks.includes('springcloud')) && language === 'java') {
      const springRoutes = this.detectSpringRoutes(filePath, content);
      if (springRoutes.length > 0) {
        routes.push(...springRoutes);
        const springFrameworks = new Set(springRoutes.map(r => r.framework));
        for (const fw of springFrameworks) {
          detectedFrameworks.push(fw);
        }
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
      const routeNode = {
        id: routeNodeId,
        label: 'Route' as NodeLabel,
        properties: {
          name: route.path,
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
      } as unknown as GraphNode;

      graph.nodes.set(routeNodeId, routeNode);
      nodesAdded++;

      // Create HANDLES edge from file to route
      const edge = {
        id: graph.edges.size + 1,
        sourceId: fileNodeId,
        targetId: routeNodeId,
        type: 'HANDLES',
        properties: { method: route.method, path: route.path },
      } as unknown as GraphEdge;

      graph.edges.set(edge.id, edge);
      edgesAdded++;

      // If we have a handler name, try to find the handler node and create a HANDLES edge
      if (route.handlerName) {
        for (const [id, node] of graph.nodes) {
          const name = (node.properties as Record<string, unknown>)['name'];
          if (name === route.handlerName) {
            const handlerEdge = {
              id: graph.edges.size + 1,
              sourceId: routeNodeId,
              targetId: id,
              type: 'HANDLES',
              properties: { method: route.method, path: route.path },
            } as unknown as GraphEdge;
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
  // SvelteKit Detection
  // ---------------------------------------------------------------------------

  private detectSvelteKitRoutes(filePath: string, content: string): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    const lines = content.split('\n');

    // Determine file type from filename
    const isPageComponent = SVELTEKIT_PATTERNS.pageComponent.test(filePath);
    const isPageServerLoad = SVELTEKIT_PATTERNS.pageServerLoad.test(filePath);
    const isPageLoad = SVELTEKIT_PATTERNS.pageLoad.test(filePath);
    const isServerEndpoint = SVELTEKIT_PATTERNS.serverEndpoint.test(filePath);
    const isLayoutComponent = SVELTEKIT_PATTERNS.layoutComponent.test(filePath);
    const isLayoutServerLoad = SVELTEKIT_PATTERNS.layoutServerLoad.test(filePath);

    // Extract route path from filePath: src/routes/about/+page.svelte → /about
    const routePath = this.extractSvelteKitRoutePath(filePath);

    // +page.svelte — page component (default GET route)
    if (isPageComponent) {
      routes.push({
        method: 'GET',
        path: routePath,
        filePath,
        line: 1,
        handlerName: null,
        framework: 'sveltekit',
        routeType: 'http',
      });
    }

    // +layout.svelte — layout component
    if (isLayoutComponent) {
      routes.push({
        method: 'GET',
        path: routePath,
        filePath,
        line: 1,
        handlerName: null,
        framework: 'sveltekit',
        routeType: 'http',
      });
    }

    // +error.svelte — error page
    if (SVELTEKIT_PATTERNS.errorPage.test(filePath)) {
      routes.push({
        method: 'ERROR',
        path: routePath,
        filePath,
        line: 1,
        handlerName: null,
        framework: 'sveltekit',
        routeType: 'http',
      });
    }

    // +page.server.ts — server-side load functions and actions
    if (isPageServerLoad) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        // export const load = ...
        if (SVELTEKIT_PATTERNS.loadExport.test(trimmed)) {
          // Extract the handler name from the variable/function
          const nameMatch = trimmed.match(/export\s+(?:const|function)\s+(load)\b/);
          routes.push({
            method: 'LOAD',
            path: routePath,
            filePath,
            line: i + 1,
            handlerName: nameMatch ? nameMatch[1]! : 'load',
            framework: 'sveltekit',
            routeType: 'http',
          });
        }

        // export const actions = { ... }
        if (SVELTEKIT_PATTERNS.actionsExport.test(trimmed)) {
          const actionBlock = this.extractSvelteActionBlock(lines, i);
          for (const actionName of actionBlock) {
            routes.push({
              method: 'POST',
              path: `${routePath}?/${actionName}`,
              filePath,
              line: i + 1,
              handlerName: actionName,
              framework: 'sveltekit',
              routeType: 'http',
            });
          }
          // Also add a catch-all for the actions object
          routes.push({
            method: 'POST',
            path: routePath,
            filePath,
            line: i + 1,
            handlerName: null,
            framework: 'sveltekit',
            routeType: 'http',
          });
        }
      }
    }

    // +page.ts — client-side load functions
    if (isPageLoad && !isPageServerLoad) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        if (SVELTEKIT_PATTERNS.loadExport.test(trimmed)) {
          const nameMatch = trimmed.match(/export\s+(?:const|function)\s+(load)\b/);
          routes.push({
            method: 'LOAD',
            path: routePath,
            filePath,
            line: i + 1,
            handlerName: nameMatch ? nameMatch[1]! : 'load',
            framework: 'sveltekit',
            routeType: 'http',
          });
        }
      }
    }

    // +layout.server.ts — layout server load
    if (isLayoutServerLoad) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        if (SVELTEKIT_PATTERNS.loadExport.test(trimmed)) {
          const nameMatch = trimmed.match(/export\s+(?:const|function)\s+(load)\b/);
          routes.push({
            method: 'LOAD',
            path: routePath,
            filePath,
            line: i + 1,
            handlerName: nameMatch ? nameMatch[1]! : 'load',
            framework: 'sveltekit',
            routeType: 'http',
          });
        }
      }
    }

    // +server.ts — API endpoints with HTTP method exports
    if (isServerEndpoint) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        SVELTEKIT_PATTERNS.httpMethodExport.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = SVELTEKIT_PATTERNS.httpMethodExport.exec(trimmed)) !== null) {
          const method = match[1]!;
          routes.push({
            method: method.toUpperCase(),
            path: routePath,
            filePath,
            line: i + 1,
            handlerName: method,
            framework: 'sveltekit',
            routeType: 'http',
          });
        }

        // export const actions in +server.ts (form actions with named handlers)
        if (SVELTEKIT_PATTERNS.actionsExport.test(trimmed)) {
          const actionBlock = this.extractSvelteActionBlock(lines, i);
          for (const actionName of actionBlock) {
            routes.push({
              method: 'POST',
              path: `${routePath}?/${actionName}`,
              filePath,
              line: i + 1,
              handlerName: actionName,
              framework: 'sveltekit',
              routeType: 'http',
            });
          }
        }
      }
    }

    return routes;
  }

  /**
   * Extract the route path from a SvelteKit file path.
   * src/routes/about/+page.svelte → /about
   * src/routes/blog/[slug]/+page.svelte → /blog/[slug]
   * src/routes/+page.svelte → /
   */
  private extractSvelteKitRoutePath(filePath: string): string {
    // Normalize path
    const normalized = filePath.replace(/\\/g, '/');

    // Find the routes directory
    const routesIndex = normalized.lastIndexOf('/routes/');
    if (routesIndex === -1) return '/';

    // Get everything after /routes/ and before the +filename
    const afterRoutes = normalized.slice(routesIndex + 8); // +8 to skip '/routes/'
    const lastSlash = afterRoutes.lastIndexOf('/');

    let routeSegment: string;
    if (lastSlash === -1) {
      // Routes root: src/routes/+page.svelte
      routeSegment = '';
    } else {
      routeSegment = afterRoutes.slice(0, lastSlash);
    }

    // Remove group parentheses: (group) → group, ((nested)) → nested
    routeSegment = routeSegment.replace(/\(/g, '').replace(/\)/g, '');

    return '/' + routeSegment;
  }

  /**
   * Extract action names from an actions block.
   * Supports both inline object literals and named functions.
   */
  private extractSvelteActionBlock(lines: string[], startLine: number): string[] {
    const actions: string[] = [];
    let depth = 0;
    let inBlock = false;

    // Also check the startLine itself for inline actions like:
    // export const actions = { default: ..., delete: ... };
    const firstLine = lines[startLine]!.trim();
    if (firstLine.includes('actions') && firstLine.includes('=')) {
      inBlock = true;
      depth = (firstLine.match(/\{/g) || []).length - (firstLine.match(/\}/g) || []).length;
      // Extract names from the same line (inline actions)
      const inlineNames = this.extractActionNamesFromLine(firstLine);
      for (const name of inlineNames) {
        if (name && name !== 'default' && name !== 'actions' && !actions.includes(name)) {
          actions.push(name);
        }
      }
    }

    for (let i = startLine + 1; i < Math.min(startLine + 30, lines.length); i++) {
      const trimmed = lines[i]!.trim();

      if (!inBlock) continue;

      depth += (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;

      // Extract action names: actionName: async (event) => { ... }
      // or: async actionName(event) { ... }
      const objMatch = trimmed.match(/^\s*(\w+)\s*:/);
      if (objMatch && objMatch[1] !== 'default') {
        actions.push(objMatch[1]!);
      }

      const funcMatch = trimmed.match(/^\s*(?:async\s+)?(?:function\s+)?(\w+)\s*\(/);
      if (funcMatch && funcMatch[1] !== 'async') {
        actions.push(funcMatch[1]!);
      }

      if (depth <= 0) break;
    }

    return actions;
  }

  /**
   * Extract action names from a single line (inline actions).
   */
  private extractActionNamesFromLine(line: string): string[] {
    const names: string[] = [];
    // Match patterns like: actionName: handler
    // in: { default: ..., delete: ..., create }
    const regex = /(\w+)\s*(?::\s*(?:async\s*)?(?:function\s*)?\w*\s*\(|,|$)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      const name = match[1]!;
      if (name !== 'export' && name !== 'const' && name !== 'actions' && name !== 'function' && name !== 'async') {
        names.push(name);
      }
    }
    return names;
  }

  // ---------------------------------------------------------------------------
  // Spring Boot / Spring Cloud Detection
  // ---------------------------------------------------------------------------

  /**
   * Detect Spring Boot (Spring MVC) and Spring Cloud routes in Java source code.
   *
   * Detects:
   *   - @RestController / @Controller class annotations
   *   - @RequestMapping class-level prefix
   *   - @GetMapping, @PostMapping, @PutMapping, @DeleteMapping, @PatchMapping
   *   - @FeignClient with method mappings
   *   - @SpringBootApplication, @EnableDiscoveryClient, @EnableCircuitBreaker
   *   - @Service, @Repository (as informational nodes)
   */
  private detectSpringRoutes(filePath: string, content: string): DetectedRoute[] {
    const routes: DetectedRoute[] = [];
    const lines = content.split('\n');

    // Determine which frameworks are enabled for this file
    const enableSpringBoot = this.frameworks.includes('springboot');
    const enableSpringCloud = this.frameworks.includes('springcloud');

    // First pass: extract controller-level information
    let controllerPrefix = '';
    let controllerName: string | undefined;
    let isRestController = false;
    let isFeignClient = false;
    let feignClientName: string | undefined;
    let feignClientUrl: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Detect @SpringBootApplication (main class)
      if (enableSpringBoot && SPRING_PATTERNS.springBootApplication.test(trimmed)) {
        routes.push({
          method: 'APPLICATION',
          path: '/',
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'springboot',
          routeType: 'http',
        });
      }

      // Detect @EnableDiscoveryClient (Spring Cloud)
      if (enableSpringCloud && SPRING_PATTERNS.enableDiscoveryClient.test(trimmed)) {
        routes.push({
          method: 'DISCOVERY',
          path: 'discovery-client',
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'springcloud',
          routeType: 'http',
        });
      }

      // Detect @EnableCircuitBreaker (Spring Cloud)
      if (enableSpringCloud && SPRING_PATTERNS.enableCircuitBreaker.test(trimmed)) {
        routes.push({
          method: 'CIRCUIT_BREAKER',
          path: 'circuit-breaker',
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'springcloud',
          routeType: 'http',
        });
      }

      // Detect @FeignClient
      if (enableSpringCloud) {
        SPRING_PATTERNS.feignClient.lastIndex = 0;
        const feignMatch = SPRING_PATTERNS.feignClient.exec(trimmed);
        if (feignMatch) {
        isFeignClient = true;
        const clientParams = feignMatch[1]!;

        // Extract name
        const nameMatch = SPRING_PATTERNS.feignClientName.exec(clientParams);
        if (nameMatch) {
          feignClientName = nameMatch[1]!;
        }

        // Extract url
        const urlMatch = SPRING_PATTERNS.feignClientUrl.exec(clientParams);
        if (urlMatch) {
          feignClientUrl = urlMatch[1]!;
        }
      }
      }

      // Detect @RestController or @Controller with optional prefix
      if (SPRING_PATTERNS.restController.test(trimmed)) {
        isRestController = true;
      }

      // Extract controller prefix from @RestController("prefix") or @Controller("prefix")
      SPRING_PATTERNS.controllerWithPrefix.lastIndex = 0;
      const ctrlPrefixMatch = SPRING_PATTERNS.controllerWithPrefix.exec(trimmed);
      if (ctrlPrefixMatch) {
        controllerPrefix = ctrlPrefixMatch[1] ?? '';
      }

      // Extract controller name from class declaration (interface for FeignClient or class)
      if (isFeignClient) {
        const interfaceMatch = trimmed.match(/(?:public\s+)?interface\s+(\w+)/);
        if (interfaceMatch) {
          controllerName = interfaceMatch[1]!;
        }
      } else if (isRestController || SPRING_PATTERNS.controller.test(trimmed)) {
        // Look for class name following @RestController/@Controller on the next few lines
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const classMatch = lines[j]!.match(/(?:public\s+)?class\s+(\w+)/);
          if (classMatch) {
            controllerName = classMatch[1]!;
            break;
          }
        }
      }

      // Extract @RequestMapping class-level paths (multiple)
      SPRING_PATTERNS.requestMappingClass.lastIndex = 0;
      let rmMatch: RegExpExecArray | null;
      while ((rmMatch = SPRING_PATTERNS.requestMappingClass.exec(trimmed)) !== null) {
        controllerPrefix = rmMatch[1]!;
      }

      // Detect @Service annotation
      if (enableSpringBoot && SPRING_PATTERNS.service.test(trimmed)) {
        routes.push({
          method: 'SERVICE',
          path: `service:${controllerName ?? 'unknown'}`,
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'springboot',
          routeType: 'http',
          controllerName,
        });
      }

      // Detect @Repository annotation
      if (enableSpringBoot && SPRING_PATTERNS.repository.test(trimmed)) {
        routes.push({
          method: 'REPOSITORY',
          path: `repository:${controllerName ?? 'unknown'}`,
          filePath,
          line: i + 1,
          handlerName: null,
          framework: 'springboot',
          routeType: 'http',
          controllerName,
        });
      }

      // -------------------------------------------------------
      // Method-level HTTP mapping annotations
      // -------------------------------------------------------

      if (enableSpringBoot || isFeignClient) {

      // Determine which framework to assign
      const routeFramework = isFeignClient ? 'springcloud' : 'springboot';

      // @GetMapping
      SPRING_PATTERNS.getMapping.lastIndex = 0;
      while ((rmMatch = SPRING_PATTERNS.getMapping.exec(trimmed)) !== null) {
        const subPath = rmMatch[1]!;
        const fullPath = this.joinPaths(controllerPrefix, subPath);
        const handlerName = this.extractJavaHandler(lines, i);

        routes.push({
          method: 'GET',
          path: fullPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: routeFramework,
          routeType: 'http',
          controllerName: feignClientName ?? controllerName,
        });
      }

      // @PostMapping
      SPRING_PATTERNS.postMapping.lastIndex = 0;
      while ((rmMatch = SPRING_PATTERNS.postMapping.exec(trimmed)) !== null) {
        const subPath = rmMatch[1]!;
        const fullPath = this.joinPaths(controllerPrefix, subPath);
        const handlerName = this.extractJavaHandler(lines, i);

        routes.push({
          method: 'POST',
          path: fullPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: routeFramework,
          routeType: 'http',
          controllerName: feignClientName ?? controllerName,
        });
      }

      // @PutMapping
      SPRING_PATTERNS.putMapping.lastIndex = 0;
      while ((rmMatch = SPRING_PATTERNS.putMapping.exec(trimmed)) !== null) {
        const subPath = rmMatch[1]!;
        const fullPath = this.joinPaths(controllerPrefix, subPath);
        const handlerName = this.extractJavaHandler(lines, i);

        routes.push({
          method: 'PUT',
          path: fullPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: routeFramework,
          routeType: 'http',
          controllerName: feignClientName ?? controllerName,
        });
      }

      // @DeleteMapping
      SPRING_PATTERNS.deleteMapping.lastIndex = 0;
      while ((rmMatch = SPRING_PATTERNS.deleteMapping.exec(trimmed)) !== null) {
        const subPath = rmMatch[1]!;
        const fullPath = this.joinPaths(controllerPrefix, subPath);
        const handlerName = this.extractJavaHandler(lines, i);

        routes.push({
          method: 'DELETE',
          path: fullPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: routeFramework,
          routeType: 'http',
          controllerName: feignClientName ?? controllerName,
        });
      }

      // @PatchMapping
      SPRING_PATTERNS.patchMapping.lastIndex = 0;
      while ((rmMatch = SPRING_PATTERNS.patchMapping.exec(trimmed)) !== null) {
        const subPath = rmMatch[1]!;
        const fullPath = this.joinPaths(controllerPrefix, subPath);
        const handlerName = this.extractJavaHandler(lines, i);

        routes.push({
          method: 'PATCH',
          path: fullPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: routeFramework,
          routeType: 'http',
          controllerName: feignClientName ?? controllerName,
        });
      }

      // @RequestMapping(method = RequestMethod.XXX) — generic request mapping
      SPRING_PATTERNS.requestMappingMethod.lastIndex = 0;
      while ((rmMatch = SPRING_PATTERNS.requestMappingMethod.exec(trimmed)) !== null) {
        const subPath = rmMatch[1]!;
        const method = rmMatch[2]!.toUpperCase();
        const fullPath = this.joinPaths(controllerPrefix, subPath);
        const handlerName = this.extractJavaHandler(lines, i);

        routes.push({
          method,
          path: fullPath,
          filePath,
          line: i + 1,
          handlerName,
          framework: routeFramework,
          routeType: 'http',
          controllerName,
        });
      }

      // @RequestMapping(method = RequestMethod.XXX) without explicit path
      SPRING_PATTERNS.requestMappingNoPath.lastIndex = 0;
      while ((rmMatch = SPRING_PATTERNS.requestMappingNoPath.exec(trimmed)) !== null) {
        const method = rmMatch[1]!.toUpperCase();

        routes.push({
          method,
          path: controllerPrefix || '/',
          filePath,
          line: i + 1,
          handlerName: this.extractJavaHandler(lines, i),
          framework: routeFramework,
          routeType: 'http',
          controllerName,
        });
      }
      } // end if (enableSpringBoot || isFeignClient)
    }

    // If the file has framework annotations but no explicit routes were detected,
    // only return the metadata routes (service, repository, application, etc.)
    return routes;
  }

  /**
   * Extract the Java method handler name following a mapping annotation.
   * Looks for: public/private/protected returnType methodName(params) {
   */
  private extractJavaHandler(lines: string[], annotationLine: number): string | null {
    for (let j = annotationLine + 1; j < Math.min(annotationLine + 10, lines.length); j++) {
      const next = lines[j]!;
      const trimmed = next.trim();

      // Skip comments and annotations
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }
      if (trimmed.startsWith('@')) {
        continue;
      }

      // Match Java method declaration: public/private/protected [static] ReturnType methodName(
      SPRING_PATTERNS.javaMethod.lastIndex = 0;
      const methodMatch = SPRING_PATTERNS.javaMethod.exec(trimmed);
      if (methodMatch) {
        return methodMatch[1]!;
      }

      // If we hit a non-empty, non-comment, non-annotation line that's not a method,
      // stop looking
      if (trimmed.length > 0 && !trimmed.startsWith('//')) {
        // Could be a method split across lines, continue scanning
        if (!trimmed.includes('(')) {
          continue;
        }
        break;
      }
    }
    return null;
  }

  /**
   * Check if the file content indicates a FeignClient interface.
   */
  private isFeignClientFile(content: string): boolean {
    return SPRING_PATTERNS.feignClient.test(content);
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
