// @code-analyzer/intelligence — Framework route detection branch coverage
// (round 2): Spring no-prefix @RequestMapping fallback, Java handler empty/non-
// method line scanning, and the SvelteKit async layout-server load fallback.

import { describe, it, expect } from 'vitest';
import { FrameworkRouteDetector } from '../impact/framework-routes.js';

const detector = new FrameworkRouteDetector();

describe('FrameworkRouteDetector — Spring no-prefix fallback', () => {
  it('falls back to "/" for @RequestMapping(method=...) without a prefix', () => {
    const code = `@RestController
public class NoPrefixController {
    @RequestMapping(method = RequestMethod.GET)
    public String index() { return "index"; }
}`;
    const result = detector.detectFile('src/NoPrefixController.java', code, 'java');
    const getRoute = result.routes.find((r: any) => r.method === 'GET');
    expect(getRoute).toBeDefined();
    expect(getRoute!.path).toBe('/');
  });
});

describe('FrameworkRouteDetector — Java handler line scanning', () => {
  it('skips an empty line and a non-method line while extracting the handler', () => {
    const code = `@RestController
public class C {
    @GetMapping("/x")

    int field = 5;
    public String get() { return "ok"; }
}`;
    const result = detector.detectFile('src/C.java', code, 'java');
    const getRoute = result.routes.find((r: any) => r.path === '/x');
    expect(getRoute).toBeDefined();
    expect(getRoute!.handlerName).toBe('get');
  });
});

describe('FrameworkRouteDetector — SvelteKit layout-server load fallback', () => {
  it('falls back to "load" for an async layout-server load export', () => {
    const code = `export async function load({ params }) {
    return { props: { id: params.id } };
}`;
    const result = detector.detectFile('src/routes/+layout.server.ts', code, 'typescript');
    const loadRoute = result.routes.find((r: any) => r.method === 'LOAD');
    expect(loadRoute).toBeDefined();
    expect(loadRoute!.handlerName).toBe('load');
  });
});
