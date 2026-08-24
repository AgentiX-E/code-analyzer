// @code-analyzer/intelligence — Framework route detection branch coverage
// (WebSocket routes, prefix-less decorators, SvelteKit inline actions and
// route groups, client-side load fallback, and FeignClient without a name).

import { describe, it, expect } from 'vitest';
import { FrameworkRouteDetector } from '../impact/framework-routes.js';

describe('FrameworkRouteDetector — branch edge cases', () => {
  const detector = new FrameworkRouteDetector();

  it('classifies Express ws() routes as websocket', () => {
    const result = detector.detectFile(
      'src/socket.ts',
      "app.ws('/realtime', handleSocket);",
      'typescript',
    );
    const ws = result.routes.find((r) => r.routeType === 'websocket');
    expect(ws).toBeDefined();
    expect(ws!.method).toBe('WS');
  });

  it('handles a NestJS controller and method with no explicit path', () => {
    const code = [
      '@Controller()',
      'export class HealthController {',
      '  @Get()',
      '  check() { return "ok"; }',
      '}',
    ].join('\n');
    const result = detector.detectFile('src/health.controller.ts', code, 'typescript');
    expect(result.routes.length).toBeGreaterThan(0);
  });

  it('extracts inline SvelteKit form actions from a single line', () => {
    const code = 'export const actions = { default: handler, delete: removeItem };\n';
    const result = detector.detectFile('src/routes/items/+page.server.ts', code, 'typescript');
    const actions = result.routes.filter((r) => r.handlerName && r.handlerName !== 'load');
    expect(actions.length).toBeGreaterThan(0);
  });

  it('strips SvelteKit route groups from the derived path', () => {
    const result = detector.detectFile(
      'src/routes/(app)/about/+page.svelte',
      '<h1>About</h1>',
      'svelte',
    );
    const page = result.routes.find((r) => r.method === 'GET');
    expect(page).toBeDefined();
    expect(page!.path).toBe('/about');
  });

  it('falls back to "load" for an async client-side load export', () => {
    const code =
      'export async function load({ fetch }) {\n  return { data: await fetch("/x") };\n}\n';
    const result = detector.detectFile('src/routes/about/+page.ts', code, 'typescript');
    const load = result.routes.find((r) => r.method === 'LOAD');
    expect(load).toBeDefined();
    expect(load!.handlerName).toBe('load');
  });

  it('handles a FeignClient declaration without a name attribute', () => {
    const code = [
      '@FeignClient(url = "http://inventory-service")',
      'public interface InventoryClient {',
      '  @GetMapping("/items")',
      '  List<Item> listItems();',
      '}',
    ].join('\n');
    const result = detector.detectFile('src/InventoryClient.java', code, 'java');
    expect(result.framework).toBe('springcloud');
  });
});
