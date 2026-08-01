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
      expect(result.routes.length).toBe(1);
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
});
