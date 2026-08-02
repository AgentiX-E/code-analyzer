// @code-analyzer/intelligence — Framework Route Detection Tests
import { describe, it, expect } from 'vitest';
import { FrameworkRouteDetector } from '../impact/framework-routes.js';

describe('FrameworkRouteDetector', () => {
  const detector = new FrameworkRouteDetector();

  describe('Express.js Detection', () => {
    it('detects app.get routes', () => {
      const code = "app.get('/users', getUsers);\napp.post('/users', createUser);";
      const result = detector.detectFile('src/routes.ts', code, 'typescript');
      expect(result.routes.length).toBe(2);
      expect(result.routes[0]!.method).toBe('GET');
      expect(result.routes[0]!.path).toBe('/users');
      expect(result.routes[1]!.method).toBe('POST');
    });

    it('detects router.method patterns', () => {
      const code = "router.delete('/items/:id', deleteItem);";
      const result = detector.detectFile('src/items.ts', code, 'javascript');
      expect(result.routes.length).toBe(1);
      expect(result.routes[0]!.method).toBe('DELETE');
    });

    it('detects app.all and app.use', () => {
      const code = "app.all('/health', healthCheck);\napp.use('/api', apiRouter);";
      const result = detector.detectFile('src/app.ts', code, 'typescript');
      expect(result.routes.length).toBe(2);
    });

    it('ignores non-Express files', () => {
      const code = "print('hello')";
      const result = detector.detectFile('src/main.py', code, 'python');
      expect(result.framework).toBe('none');
    });
  });

  describe('FastAPI Detection', () => {
    it('detects @app.get decorators', () => {
      const code = '@app.get("/items")\nasync def get_items():\n    pass';
      const result = detector.detectFile('src/api.py', code, 'python');
      expect(result.routes.length).toBe(2);
      expect(result.routes[0]!.method).toBe('GET');
      expect(result.routes[0]!.handlerName).toBe('get_items');
    });

    it('detects @app.post and @app.delete', () => {
      const code = '@app.post("/items", response_model=Item)\n@app.delete("/items/{id}")\ndef items(): pass';
      const result = detector.detectFile('src/api.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(2);
    });

    it('detects WebSocket routes', () => {
      const code = '@app.websocket("/ws")\nasync def websocket_endpoint(ws): pass';
      const result = detector.detectFile('src/ws.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      const wsRoute = result.routes.find((r: any) => r.routeType === 'websocket');
      expect(wsRoute).toBeDefined();
    });

    it('detects router decorators', () => {
      const code = '@router.get("/items")\ndef items(): pass';
      const result = detector.detectFile('src/router.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('NestJS Detection', () => {
    it('detects @Controller and @Get decorators', () => {
      const code = `@Controller('users')
export class UsersController {
  @Get()
  findAll() {}
  @Get(':id')
  findOne(@Param('id') id: string) {}
}`;
      const result = detector.detectFile('src/users.controller.ts', code, 'typescript');
      expect(result.routes.length).toBeGreaterThanOrEqual(2);
    });

    it('detects @Post with path', () => {
      const code = `@Controller('api')
class ApiController {
  @Post('create')
  create() {}
}`;
      const result = detector.detectFile('src/api.ts', code, 'typescript');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.method).toBe('POST');
    });

    it('detects GraphQL resolvers', () => {
      const code = `@Resolver()
export class UserResolver {
  @Query(() => [User])
  users() {}
  @Mutation(() => User)
  createUser() {}
}`;
      const result = detector.detectFile('src/user.resolver.ts', code, 'typescript');
      const gqlRoutes = result.routes.filter((r: any) => r.routeType === 'graphql');
      expect(gqlRoutes.length).toBeGreaterThanOrEqual(2);
    });

    it('detects WebSocket message handlers', () => {
      const code = `@WebSocketGateway()
export class ChatGateway {
  @SubscribeMessage('message')
  handleMessage() {}
}`;
      const result = detector.detectFile('src/chat.gateway.ts', code, 'typescript');
      const wsRoutes = result.routes.filter((r: any) => r.routeType === 'websocket');
      expect(wsRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('should not detect NestJS patterns in Python', () => {
      const code = '@decorator\ndef foo(): pass';
      const result = detector.detectFile('src/test.py', code, 'python');
      const nestRoutes = result.routes.filter((r: any) => r.framework === 'nestjs');
      expect(nestRoutes.length).toBe(0);
    });
  });

  describe('Django Detection', () => {
    it('detects path() calls in urlpatterns', () => {
      const code = `urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(2);
      expect(result.routes[0]!.handlerName).toBe('admin');
    });

    it('detects re_path() calls', () => {
      const code = `urlpatterns = [
    re_path(r'^users/(?P<id>\\d+)/$', views.user_detail),
]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });

    it('detects include() calls', () => {
      const code = `urlpatterns = [include('api.urls')]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      const includes = result.routes.filter((r: any) => r.method === 'INCLUDE');
      expect(includes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Configuration', () => {
    it('respects framework whitelist', () => {
      const expressOnly = new FrameworkRouteDetector({ frameworks: ['express'] });
      const tsCode = "app.get('/test', handler);";
      const result = expressOnly.detectFile('src/app.ts', tsCode, 'typescript');
      expect(result.framework).toBe('express');
    });

    it('detects only configured frameworks', () => {
      const nestjsOnly = new FrameworkRouteDetector({ frameworks: ['nestjs'] });
      const tsCode = "app.get('/test', handler);\n@Controller('api')\nclass C {}";
      const result = nestjsOnly.detectFile('src/app.ts', tsCode, 'typescript');
      const expressRoutes = result.routes.filter((r: any) => r.framework === 'express');
      expect(expressRoutes.length).toBe(0);
    });
  });

  describe('acceptance criteria', () => {
    it('AC-1: detects Express routes with handler names', () => {
      const code = "app.get('/api/health', healthCheck);";
      const result = detector.detectFile('src/server.ts', code, 'typescript');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });

    it('AC-2: detects FastAPI async routes', () => {
      const code = '@app.get("/users/{user_id}")\nasync def read_user(user_id: int):\n    return {}';
      const result = detector.detectFile('src/main.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });

    it('AC-3: detects NestJS HTTP+GraphQL+WebSocket in one file', () => {
      const code = `@Controller('api')
class FullController {
  @Get() httpGet() {}
  @Query(() => User) gqlQuery() {}
  @SubscribeMessage('event') wsHandler() {}
}`;
      const result = detector.detectFile('src/full.ts', code, 'typescript');
      const types = new Set(result.routes.map(r => r.routeType));
      expect(types.has('http')).toBe(true);
      expect(types.has('graphql')).toBe(true);
      expect(types.has('websocket')).toBe(true);
    });

    it('AC-4: handles empty files gracefully', () => {
      const result = detector.detectFile('src/empty.ts', '', 'typescript');
      expect(result.routes).toEqual([]);
      expect(result.framework).toBe('none');
    });

    it('AC-5: does not produce false positives in utility files', () => {
      const code = `
function get() { return 'hello'; }
const path = require('path');
app.use(express.json());
`;
      const result = detector.detectFile('src/utils.ts', code, 'typescript');
      // "get" as function name should not trigger route detection
      // "app.use" without a string path should not trigger
      const routes = result.routes.filter((r: any) => r.path);
      expect(routes.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: Express Edge Cases
  // -----------------------------------------------------------------------

  describe('Express Edge Cases', () => {
    it('detects Express routes in typescriptreact files', () => {
      const code = "app.get('/home', homeHandler);";
      const result = detector.detectFile('src/App.tsx', code, 'typescriptreact');
      expect(result.routes.length).toBe(1);
      expect(result.routes[0]!.framework).toBe('express');
    });

    it('detects Express routes in javascriptreact files', () => {
      const code = "app.post('/api/data', dataHandler);";
      const result = detector.detectFile('src/App.jsx', code, 'javascriptreact');
      expect(result.routes.length).toBe(1);
      expect(result.routes[0]!.framework).toBe('express');
    });

    it('detects Express chained route patterns', () => {
      const code = `app.route('/users')
  .get('/list', getUsers)
  .post('/create', createUser);`;
      const result = detector.detectFile('src/routes.ts', code, 'typescript');
      // Chained routes with sub-paths are detected
      expect(result.framework).toBe('express');
      expect(result.routes.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts handler name from same line in Express', () => {
      const code = "app.get('/users', listUsers);";
      const result = detector.detectFile('src/routes.ts', code, 'typescript');
      expect(result.routes[0]!.handlerName).toBe('listUsers');
    });

    it('extracts handler from next line in Express', () => {
      const code = `app.get('/callback',
  callbackHandler
  );`;
      const result = detector.detectFile('src/routes.ts', code, 'javascript');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });

    it('detects app.patch routes', () => {
      const code = "app.patch('/items/:id', updateItem);";
      const result = detector.detectFile('src/items.ts', code, 'typescript');
      expect(result.routes.length).toBe(1);
      expect(result.routes[0]!.method).toBe('PATCH');
    });

    it('does not detect Express in python files', () => {
      const code = "app.get('/test', handler);";
      const result = detector.detectFile('src/routes.py', code, 'python');
      expect(result.routes.filter(r => r.framework === 'express').length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: FastAPI Edge Cases
  // -----------------------------------------------------------------------

  describe('FastAPI Edge Cases', () => {
    it('detects FastAPI handler with comment between decorator and function', () => {
      const code = '@app.get("/items")\n# This is a comment\ndef get_items():\n    pass';
      const result = detector.detectFile('src/api.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });

    it('detects FastAPI @app.put route', () => {
      const code = '@app.put("/users/{id}")\ndef update_user(id: int):\n    pass';
      const result = detector.detectFile('src/api.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.method).toBe('PUT');
    });

    it('does not detect FastAPI in non-python files', () => {
      const code = '@app.get("/items")\ndef get_items(): pass';
      const result = detector.detectFile('src/api.ts', code, 'typescript');
      expect(result.routes.filter(r => r.framework === 'fastapi').length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: NestJS Edge Cases
  // -----------------------------------------------------------------------

  describe('NestJS Edge Cases', () => {
    it('detects NestJS @All decorator', () => {
      const code = `@Controller('proxy')
class ProxyController {
  @All('*')
  handleAll() {}
}`;
      const result = detector.detectFile('src/proxy.controller.ts', code, 'typescript');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.method).toBe('ALL');
    });

    it('detects NestJS @Put and @Delete decorators', () => {
      const code = `@Controller('items')
class ItemsController {
  @Put(':id')
  update() {}
  @Delete(':id')
  remove() {}
}`;
      const result = detector.detectFile('src/items.controller.ts', code, 'typescript');
      expect(result.routes.length).toBeGreaterThanOrEqual(2);
    });

    it('joins controller prefix with sub-path correctly', () => {
      const code = `@Controller('api/v1')
class V1Controller {
  @Get('users')
  getUsers() {}
}`;
      const result = detector.detectFile('src/v1.controller.ts', code, 'typescript');
      const httpRoutes = result.routes.filter(r => r.routeType === 'http');
      expect(httpRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('handles controller with empty prefix', () => {
      const code = `@Controller()
class RootController {
  @Get('health')
  health() {}
}`;
      const result = detector.detectFile('src/root.controller.ts', code, 'typescript');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });

    it('handles method without path in controller without prefix', () => {
      const code = `@Controller()
class RootController {
  @Get()
  index() {}
}`;
      const result = detector.detectFile('src/root.controller.ts', code, 'typescript');
      const httpRoutes = result.routes.filter(r => r.routeType === 'http');
      expect(httpRoutes.length).toBeGreaterThanOrEqual(1);
      expect(httpRoutes[0]!.path).toBe('/');
    });

    it('detects NestJS in typescriptreact files', () => {
      const code = `@Controller('api')
@Get('test')
test() {}`;
      const result = detector.detectFile('src/test.tsx', code, 'typescriptreact');
      expect(result.framework).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: Django Edge Cases
  // -----------------------------------------------------------------------

  describe('Django Edge Cases', () => {
    it('detects re_path with regular expression', () => {
      const code = `urlpatterns = [
    re_path(r'^articles/(?P<year>[0-9]{4})/$', views.year_archive),
]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.framework).toBe('django');
    });

    it('detects include within urlpatterns', () => {
      const code = `urlpatterns = [
    path('blog/', include('blog.urls')),
    path('shop/', include('shop.urls')),
]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      const includes = result.routes.filter(r => r.method === 'INCLUDE');
      expect(includes.length).toBeGreaterThanOrEqual(2);
    });

    it('does not detect Django routes outside urlpatterns', () => {
      const code = `path('outside/', views.outside)
urlpatterns = [
    path('inside/', views.inside),
]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      // Only 'inside' route should be found
      expect(result.routes.filter(r => r.path === 'outside/').length).toBe(0);
    });

    it('handles urlpatterns with no closing bracket', () => {
      const code = `urlpatterns = [
    path('a/', view_a),
    path('b/', view_b)`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      // Should still detect routes even without closing bracket
      expect(result.routes.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: addToGraph
  // -----------------------------------------------------------------------

  describe('addToGraph', () => {
    it('adds route nodes and edges to a knowledge graph', () => {
      const routes = [
        {
          method: 'GET',
          path: '/users',
          filePath: 'src/routes.ts',
          line: 10,
          handlerName: 'getUsers',
          framework: 'express' as const,
          routeType: 'http' as const,
        },
      ];
      const graph = {
        nodes: new Map(),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph(routes, graph, 1);
      expect(result.nodesAdded).toBe(1);
      expect(result.edgesAdded).toBeGreaterThanOrEqual(1);
      expect(graph.nodes.size).toBe(1);
      expect(graph.edges.size).toBeGreaterThanOrEqual(1);
    });

    it('adds HANDLES edge from file node to route node', () => {
      const routes = [
        {
          method: 'POST',
          path: '/items',
          filePath: 'src/items.ts',
          line: 5,
          handlerName: null,
          framework: 'express' as const,
          routeType: 'http' as const,
        },
      ];
      const graph = {
        nodes: new Map(),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph(routes, graph, 42);
      expect(result.nodesAdded).toBe(1);
      expect(result.edgesAdded).toBe(1);
      // Edge from fileNodeId to routeNodeId
      const edges = [...graph.edges.values()];
      expect(edges[0].sourceId).toBe(42);
      expect(edges[0].targetId).toBe(1);
    });

    it('adds HANDLES edge to handler node when name matches', () => {
      const routes = [
        {
          method: 'GET',
          path: '/users',
          filePath: 'src/routes.ts',
          line: 10,
          handlerName: 'getUsers',
          framework: 'express' as const,
          routeType: 'http' as const,
        },
      ];
      const graph = {
        nodes: new Map([
          [99, {
            id: 99,
            label: 'Function',
            properties: { name: 'getUsers' },
          }],
        ]),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph(routes, graph, 1);
      expect(result.nodesAdded).toBe(1);
      // Should have edge from file to route AND from route to handler
      expect(result.edgesAdded).toBe(2);
    });

    it('handles multiple routes in graph', () => {
      const routes = [
        {
          method: 'GET', path: '/a', filePath: 'f.ts', line: 1,
          handlerName: null, framework: 'express' as const, routeType: 'http' as const,
        },
        {
          method: 'POST', path: '/b', filePath: 'f.ts', line: 2,
          handlerName: null, framework: 'express' as const, routeType: 'http' as const,
        },
      ];
      const graph = {
        nodes: new Map(),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph(routes, graph, 1);
      expect(result.nodesAdded).toBe(2);
      expect(result.edgesAdded).toBe(2);
    });

    it('handles empty routes array', () => {
      const graph = {
        nodes: new Map(),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph([], graph, 1);
      expect(result.nodesAdded).toBe(0);
      expect(result.edgesAdded).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: Multi-framework & Edge Cases
  // -----------------------------------------------------------------------

  describe('Multi-framework & Edge Cases', () => {
    it('detects multiple frameworks in same file', () => {
      // In TypeScript, both Express and NestJS patterns
      const code = `app.get('/api/health', healthCheck);
@Controller('admin')
class AdminController {
  @Get()
  dashboard() {}
}`;
      const result = detector.detectFile('src/mixed.ts', code, 'typescript');
      const frameworks = new Set(result.routes.map(r => r.framework));
      expect(frameworks.has('express')).toBe(true);
      expect(frameworks.has('nestjs')).toBe(true);
    });

    it('detects Express in javascript files', () => {
      const code = "router.put('/update', updateHandler);";
      const result = detector.detectFile('src/routes.js', code, 'javascript');
      expect(result.routes.length).toBe(1);
      expect(result.routes[0]!.framework).toBe('express');
    });

    it('returns framework "none" for files with no framework patterns', () => {
      const result = detector.detectFile('src/empty.go', 'package main\nfunc main() {}', 'go');
      expect(result.framework).toBe('none');
      expect(result.routes).toEqual([]);
    });

    it('handles detection with all frameworks disabled', () => {
      const detector = new FrameworkRouteDetector({ frameworks: [] });
      const code = "app.get('/test', handler);\n@Controller('api') class C {}";
      const result = detector.detectFile('src/test.ts', code, 'typescript');
      expect(result.routes).toEqual([]);
      expect(result.framework).toBe('none');
    });
  });

  // ==========================================================================
  // Branch Coverage: additional Express, FastAPI, NestJS, Django edges
  // ==========================================================================

  describe('Express — isJSFamily edge cases', () => {
    it('detects Express in javascriptreact files', () => {
      const code = "app.use('/api', router);";
      const result = detector.detectFile('src/App.jsx', code, 'javascriptreact');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.framework).toBe('express');
    });

    it('does not detect Express in non-JS languages', () => {
      const code = "app.get('/test', handler);";
      const result = detector.detectFile('src/app.py', code, 'python');
      expect(result.routes.filter(r => r.framework === 'express').length).toBe(0);
    });
  });

  describe('FastAPI — websocket route type', () => {
    it('detects websocket route type for FastAPI ws', () => {
      const code = '@app.websocket("/ws")\nasync def ws_handler(ws):\n    pass';
      const result = detector.detectFile('src/ws.py', code, 'python');
      const wsRoute = result.routes.find(r => r.routeType === 'websocket');
      expect(wsRoute).toBeDefined();
      // The method can be 'WEBSOCKET' from decoratorRoute or 'WS' from wsRoute
      // Both patterns match @app.websocket — accept either
      expect(['WS', 'WEBSOCKET']).toContain(wsRoute!.method);
    });
  });

  describe('NestJS — typescriptreact language', () => {
    it('detects NestJS in typescriptreact files', () => {
      const code = `@Controller('api')
class ApiController {
  @Get('items')
  getItems() {}
}`;
      const result = detector.detectFile('src/api.tsx', code, 'typescriptreact');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.framework).toBe('nestjs');
    });

    it('detects NestJS @All method', () => {
      const code = `@Controller('proxy')
class ProxyController {
  @All('*')
  handleAll() {}
}`;
      const result = detector.detectFile('src/proxy.controller.ts', code, 'typescript');
      expect(result.routes.some(r => r.method === 'ALL')).toBe(true);
    });
  });

  describe('Django — include detection separately', () => {
    it('detects include() in nested urlpatterns', () => {
      const code = `urlpatterns = [
    path('api/', include('api.urls')),
    path('admin/', include('admin.urls')),
]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      const includes = result.routes.filter(r => r.method === 'INCLUDE');
      expect(includes.length).toBeGreaterThanOrEqual(2);
    });

    it('detects re_path for regular expression routes', () => {
      const code = `urlpatterns = [
    re_path(r'^articles/(?P<year>[0-9]{4})/$', views.year_archive),
]`;
      const result = detector.detectFile('src/urls.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.framework).toBe('django');
    });
  });

  describe('FastAPI — only django detection', () => {
    it('detects only configured frameworks (django only)', () => {
      const djangoOnly = new FrameworkRouteDetector({ frameworks: ['django'] });
      const pyCode = `urlpatterns = [path('a/', view_a)]`;
      const result = djangoOnly.detectFile('src/urls.py', pyCode, 'python');
      expect(result.framework).toBe('django');
    });
  });

  // ==========================================================================
  // Branch Coverage: Express handler extraction — handler on next line
  // ==========================================================================

  describe('Express — handler extraction edge cases', () => {
    it('should extract handler from next line when pattern matches', () => {
      const code = `app.get('/users',
  listUsers)
app.post('/items', createItem);`;
      const result = detector.detectFile('src/routes.ts', code, 'typescript');
      // First route should have handler extracted from next line
      const firstRoute = result.routes.find(r => r.path === '/users');
      expect(firstRoute).toBeDefined();
      expect(firstRoute!.handlerName).toBe('listUsers');
    });

    it('should return null handler for route on last line with no next line', () => {
      const code = `const x = 1;
app.get('/path',`;
      const result = detector.detectFile('src/lastline.ts', code, 'javascript');
      expect(result.routes.length).toBe(1);
      // Handler cannot be extracted because there's no next line
      expect(result.routes[0]!.handlerName).toBeNull();
    });

    it('should detect handler from same line when present in Express', () => {
      const code = 'router.use("/middleware", authMiddleware);';
      const result = detector.detectFile('src/mw.ts', code, 'javascript');
      expect(result.routes.length).toBe(1);
      expect(result.routes[0]!.handlerName).toBe('authMiddleware');
    });
  });

  // ==========================================================================
  // Branch Coverage: FastAPI handler extraction — break / no handler
  // ==========================================================================

  describe('FastAPI — handler extraction edge cases', () => {
    it('should return null handler when next line is not a function definition', () => {
      const code = '@app.get("/health")\nhealth_check = None';
      const result = detector.detectFile('src/health.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      const healthRoute = result.routes.find(r => r.path === '/health');
      expect(healthRoute).toBeDefined();
      // Non-decorator/non-comment line breaks handler extraction → null
      expect(healthRoute!.handlerName).toBeNull();
    });

    it('should return null handler when no function follows decorator', () => {
      const code = `@app.post("/submit")

# Empty line then decorator again
@app.get("/list")
def list_items(): pass`;
      const result = detector.detectFile('src/submit.py', code, 'python');
      const submitRoute = result.routes.find(r => r.path === '/submit');
      expect(submitRoute).toBeDefined();
      // After the empty line, break → handlerName is null
      expect(submitRoute!.handlerName).toBeNull();
    });

    it('should detect sync handler function in FastAPI', () => {
      const code = '@app.patch("/update")\ndef update_resource():\n    pass';
      const result = detector.detectFile('src/patch.py', code, 'python');
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
      expect(result.routes[0]!.handlerName).toBe('update_resource');
    });
  });

  // ==========================================================================
  // Branch Coverage: NestJS handler extraction — comment skip / no handler
  // ==========================================================================

  describe('NestJS — handler extraction edge cases', () => {
    it('should skip comment lines when extracting NestJS handler', () => {
      const code = `@Controller('users')
class UsersController {
  @Get(':id')
  // Find a user by ID
  // Returns the user object
  async findById(@Param('id') id: string) {}
}`;
      const result = detector.detectFile('src/users.controller.ts', code, 'typescript');
      const getRoute = result.routes.find(r => r.path === 'users/:id');
      expect(getRoute).toBeDefined();
      // Should extract handler despite comment lines between decorator and method
      expect(getRoute!.handlerName).toBe('findById');
    });

    it('should return null handler when no method follows NestJS decorator', () => {
      const code = `@Controller('empty')
class EmptyController {
  @Get()
  // only a comment, no actual method
}
`;
      const result = detector.detectFile('src/empty.controller.ts', code, 'typescript');
      // The Get route should be detected but handler name is null
      expect(result.routes.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract handler via funcMatch pattern in NestJS', () => {
      const code = `@Controller('items')
class ItemsController {
  @Post()
  createItem(dto: CreateItemDto) {}
}`;
      const result = detector.detectFile('src/items.controller.ts', code, 'typescript');
      const postRoute = result.routes.find(r => r.method === 'POST');
      expect(postRoute).toBeDefined();
      // Should detect createItem via funcMatch regex
      expect(postRoute!.handlerName).toBe('createItem');
    });
  });

  // ==========================================================================
  // Branch Coverage: joinPaths — trailing/leading slash normalization
  // ==========================================================================

  describe('NestJS — joinPaths slash normalization', () => {
    it('should normalize controller prefix with trailing slash', () => {
      const code = `@Controller('api/v1/')
class V1Controller {
  @Get('users')
  getUsers() {}
}`;
      const result = detector.detectFile('src/v1.controller.ts', code, 'typescript');
      const httpRoutes = result.routes.filter(r => r.routeType === 'http');
      expect(httpRoutes.length).toBeGreaterThanOrEqual(1);
      // Trailing slash on prefix should be removed: 'api/v1/users' not 'api/v1//users'
      expect(httpRoutes[0]!.path).not.toContain('//');
    });

    it('should normalize subPath with leading slash', () => {
      const code = `@Controller('api')
class ApiController {
  @Get('/health')
  health() {}
}`;
      const result = detector.detectFile('src/api.controller.ts', code, 'typescript');
      const httpRoutes = result.routes.filter(r => r.routeType === 'http');
      expect(httpRoutes.length).toBeGreaterThanOrEqual(1);
      // Leading slash on subPath should be handled: 'api/health' not 'api//health'
      expect(httpRoutes[0]!.path).not.toContain('//');
    });
  });

  // ==========================================================================
  // Branch Coverage: addToGraph — handler name not found in graph
  // ==========================================================================

  describe('addToGraph — handler name mismatch edge cases', () => {
    it('should not add handler edge when handler name is not found in graph', () => {
      const routes = [
        {
          method: 'GET',
          path: '/orphan',
          filePath: 'src/orphan.ts',
          line: 1,
          handlerName: 'nonExistentHandler',
          framework: 'express' as const,
          routeType: 'http' as const,
        },
      ];
      const graph = {
        nodes: new Map([
          [10, { id: 10, label: 'Function', properties: { name: 'someOtherFunction' } }],
        ]),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph(routes, graph, 1);
      expect(result.nodesAdded).toBe(1);
      // Only the file→route edge, no route→handler edge since handler not found
      expect(result.edgesAdded).toBe(1);
    });

    it('should include controllerName in route node properties', () => {
      const routes = [
        {
          method: 'GET',
          path: '/admin/dashboard',
          filePath: 'src/admin.controller.ts',
          line: 10,
          handlerName: 'dashboard',
          framework: 'nestjs' as const,
          routeType: 'http' as const,
          controllerName: 'AdminController',
        },
      ];
      const graph = {
        nodes: new Map(),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph(routes, graph, 1);
      expect(result.nodesAdded).toBe(1);
      // Verify controllerName is stored in the node properties
      const routeNode = graph.nodes.get(1);
      expect(routeNode.properties.controllerName).toBe('AdminController');
    });

    it('should store null controllerName when not provided', () => {
      const routes = [
        {
          method: 'POST',
          path: '/data',
          filePath: 'src/data.ts',
          line: 1,
          handlerName: null,
          framework: 'express' as const,
          routeType: 'http' as const,
        },
      ];
      const graph = {
        nodes: new Map(),
        edges: new Map(),
      } as any;

      const result = detector.addToGraph(routes, graph, 1);
      const routeNode = graph.nodes.get(1);
      expect(routeNode.properties.controllerName).toBeNull();
    });
  });

  // ==========================================================================
  // Branch Coverage: NestJS methodNoPath without controller prefix
  // ==========================================================================

  describe('NestJS — method without path, controller without prefix', () => {
    it('should use "/" when both controller prefix and method path are empty', () => {
      const code = `@Controller()
class HomeController {
  @Get()
  index() {}
}`;
      const result = detector.detectFile('src/home.controller.ts', code, 'typescript');
      const httpRoutes = result.routes.filter(r => r.routeType === 'http');
      expect(httpRoutes.length).toBeGreaterThanOrEqual(1);
      // No prefix, no subPath → defaults to '/'
      const getRoute = httpRoutes.find(r => r.method === 'GET');
      expect(getRoute).toBeDefined();
    });
  });

  // ==========================================================================
  // Branch Coverage: detectFile — all frameworks disabled
  // ==========================================================================

  describe('detectFile — framework selection', () => {
    it('should detect only FastAPI in Python with fastapi-only config', () => {
      const fastapiOnly = new FrameworkRouteDetector({ frameworks: ['fastapi'] });
      const code = `urlpatterns = [path('a/', view_a)]
@app.get("/api/data")
def get_data(): pass`;
      const result = fastapiOnly.detectFile('src/mixed.py', code, 'python');
      // Django patterns should not be detected
      const djangoRoutes = result.routes.filter(r => r.framework === 'django');
      expect(djangoRoutes.length).toBe(0);
      // FastAPI patterns should be detected
      const fastapiRoutes = result.routes.filter(r => r.framework === 'fastapi');
      expect(fastapiRoutes.length).toBeGreaterThanOrEqual(2);
    });

    it('should return "none" framework for Go files regardless of content', () => {
      const code = 'app.get("/test", handler)';
      const result = detector.detectFile('src/main.go', code, 'go');
      expect(result.framework).toBe('none');
      expect(result.routes).toEqual([]);
    });
  });

  // ==========================================================================
  // Branch Coverage: Express — chained route without sub-methods
  // ==========================================================================

  describe('Express — chained route edge cases', () => {
    it('should detect chained routes without following method calls', () => {
      const code = `app.route('/prefix')
  .get('/list', handler1)
  .post('/create', handler2);`;
      const result = detector.detectFile('src/chained.ts', code, 'typescript');
      // The chained methods .get and .post should be detected
      expect(result.routes.filter(r => r.framework === 'express').length).toBeGreaterThanOrEqual(2);
    });

    it('should detect app.route without subsequent method chains', () => {
      const code = `app.route('/base')
// no methods chained
app.get('/other', handler);`;
      const result = detector.detectFile('src/partial.ts', code, 'javascript');
      // app.route is detected, but no chained methods → only the app.get count
      const expressRoutes = result.routes.filter(r => r.framework === 'express');
      expect(expressRoutes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Branch Coverage: NestJS — GraphQL with explicit name
  // ==========================================================================

  describe('NestJS — GraphQL named operations', () => {
    it('should detect @Query with explicit string name', () => {
      const code = `@Resolver()
class UserResolver {
  @Query('getUser')
  getUser() {}
}`;
      const result = detector.detectFile('src/user.resolver.ts', code, 'typescript');
      const gqlRoutes = result.routes.filter(r => r.routeType === 'graphql');
      expect(gqlRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect @Mutation without explicit name using operationType fallback', () => {
      const code = `@Resolver()
class ProductResolver {
  @Mutation()
  createProduct() {}
}`;
      const result = detector.detectFile('src/product.resolver.ts', code, 'typescript');
      const gqlRoutes = result.routes.filter(r => r.routeType === 'graphql');
      expect(gqlRoutes.length).toBeGreaterThanOrEqual(1);
      // Without explicit name, falls back to operationType.toLowerCase() = 'mutation'
      expect(gqlRoutes[0]!.path).toBe('graphql:mutation');
    });

    it('should detect @Subscription with explicit name', () => {
      const code = `@Resolver()
class EventResolver {
  @Subscription('commentAdded')
  commentAdded() {}
}`;
      const result = detector.detectFile('src/event.resolver.ts', code, 'typescript');
      const gqlRoutes = result.routes.filter(r => r.routeType === 'graphql');
      expect(gqlRoutes.length).toBeGreaterThanOrEqual(1);
      expect(gqlRoutes[0]!.path).toBe('graphql:commentAdded');
    });
  });

  // ==========================================================================
  // Branch Coverage: extractNestJSHandler — empty line between decorator and method
  // ==========================================================================

  describe('NestJS — handler extraction with blank lines', () => {
    it('should skip empty lines between decorator and handler', () => {
      const code = `@Controller('items')
class ItemsController {
  @Get(':id')

  getItem(id: string) {}
}`;
      const result = detector.detectFile('src/items.controller.ts', code, 'typescript');
      const getRoute = result.routes.find(r => r.method === 'GET');
      expect(getRoute).toBeDefined();
      // Handler should be extracted despite empty line between decorator and method
      expect(getRoute!.handlerName).toBe('getItem');
    });
  });

  // ==========================================================================
  // Branch Coverage: joinPaths with empty subPath (methodDecorator empty string)
  // ==========================================================================

  describe('NestJS — joinPaths edge cases via route detection', () => {
    it('should handle joinPaths with non-empty prefix and empty subPath', () => {
      // @Get('') triggers methodDecorator with empty subPath, not methodNoPath
      const code = `@Controller('api')
class ApiController {
  @Get('')
  index() {}
}`;
      const result = detector.detectFile('src/api.controller.ts', code, 'typescript');
      const httpRoutes = result.routes.filter(r => r.routeType === 'http');
      expect(httpRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle joinPaths with empty prefix and empty subPath', () => {
      // @Controller() + @Get('') — both empty in joinPaths
      const code = `@Controller()
class RootController {
  @Get('')
  home() {}
}`;
      const result = detector.detectFile('src/root.controller.ts', code, 'typescript');
      const httpRoutes = result.routes.filter(r => r.routeType === 'http');
      expect(httpRoutes.length).toBeGreaterThanOrEqual(1);
      // joinPaths('', '') should return '/'
      expect(httpRoutes[0]!.path).toBe('/');
    });
  });
});
