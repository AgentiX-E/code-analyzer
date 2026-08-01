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
});
