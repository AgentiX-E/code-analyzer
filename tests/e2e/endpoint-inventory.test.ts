// **The user story: "what does this repository serve?"**
//
// A platform engineer clones a polyglot service and asks the product one question — which HTTP endpoints does this
// checkout answer, with which verbs, from which file. The answer is what `RoutesPhase` builds, and until iteration 92
// the answer was wrong in three ways that the unit tests could not see, because the honesty of the inventory depended
// on the *whole* pipeline having run:
//
// 1. One Express route was counted four times. The graph deduplicated the nodes by qualified name, so the inventory
//    looked right while `routesFound` — the number the CLI prints and the number a reader compares against `grep` — was
//    the size of the framework table. This test asserts the count against the endpoints, not against the patterns.
// 2. Every Spring endpoint was `ALL`. The verb lives in the annotation (`@GetMapping`), and the detector read the
//    capture positions the other way round.
// 3. A Thymeleaf `th:href="@{/owners}"` was read as an endpoint once templates were admitted, which is how
//    `spring-petclinic` reported 55 routes for a 17-endpoint application.
//
// The repository below is deliberately small and deliberately polyglot: one Spring controller, one Express server that
// declares the same route twice, one FastAPI module, one Next.js app-router file, and one Thymeleaf template that links
// to a route without declaring one.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GraphBuilder } from '../../packages/analyzer/src/graph/graph-builder.js';
import { PipelineOrchestrator } from '../../packages/analyzer/src/pipeline/orchestrator.js';
import { createAllPhases } from '../../packages/analyzer/src/pipeline/phases/index.js';

import type { CodeAnalyzerConfig, PipelineContext } from '@code-analyzer/shared';

/** The configuration a checkout of this size needs: every file, no exclusions, the default worker count. */
function config(projectId: string, rootPath: string): CodeAnalyzerConfig {
  return {
    projectId,
    rootPath,
    excludePatterns: [],
    includePatterns: ['**/*'],
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 10_000,
    parseWorkers: 4,
    ignorePaths: [],
  };
}

/** One endpoint as the product reports it: `VERB /path` from a file. */
interface Endpoint {
  readonly verb: string;
  readonly path: string;
  readonly file: string;
  readonly framework: string;
}

let root: string;
let graph: PipelineContext['graph'];

function write(relativePath: string, content: string): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'endpoint-inventory-e2e-'));

  write(
    'src/main/java/io/owners/OwnerController.java',
    [
      'package io.owners;',
      '',
      'import java.util.List;',
      '',
      '@RestController',
      '@RequestMapping("/owners")',
      'public class OwnerController {',
      '  @GetMapping("/owners")',
      '  public List<Owner> list() { return null; }',
      '',
      '  @PostMapping("/owners")',
      '  public Owner create() { return null; }',
      '}',
    ].join('\n'),
  );

  write(
    'src/server.ts',
    [
      "import express from 'express';",
      '',
      'const app = express();',
      '',
      "app.get('/api/health', (_req, res) => res.json({ ok: true }));",
      // The same endpoint, declared twice, because a real server mounts two handlers on one path. **One endpoint.**
      "app.get('/api/health', (_req, res) => res.json({ ok: true, cached: true }));",
      '',
      'export default app;',
    ].join('\n'),
  );

  write(
    'src/api.py',
    [
      'from fastapi import FastAPI',
      '',
      'app = FastAPI()',
      '',
      '@app.get("/items")',
      'async def list_items():',
      '    return []',
    ].join('\n'),
  );

  write(
    'app/api/hello/route.ts',
    ['export async function GET() {', '  return Response.json({ hello: "world" });', '}'].join(
      '\n',
    ),
  );

  // A template links to `/owners`; it does not declare it.
  write(
    'src/main/resources/templates/index.html',
    [
      '<!doctype html>',
      '<html>',
      '  <body><a th:href="@{/owners}">Owners</a></body>',
      '</html>',
    ].join('\n'),
  );

  const context: PipelineContext = {
    projectId: 'endpoint-inventory',
    rootPath: root,
    phaseData: new Map(),
    config: config('endpoint-inventory', root),
  };
  graph = new GraphBuilder(new InMemoryGraphStore()).build(context);
  context.graph = graph;

  const result = await new PipelineOrchestrator(createAllPhases()).execute(context);
  const failed = result.phases
    .filter((phase) => phase.status !== 'success')
    .map((phase) => phase.phaseId);
  expect(failed, 'phases that did not complete').toEqual([]);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function endpoints(): Endpoint[] {
  return [...(graph?.nodes.values() ?? [])]
    .filter((node) => node.label === 'Route')
    .map((node) => ({
      verb: String(node.properties['routeMethod']),
      path: String(node.properties['routePath']),
      file: String(node.properties['filePath']).slice(root.length + 1),
      framework: String(node.properties['framework']),
    }))
    .sort((left, right) => `${left.path}${left.verb}`.localeCompare(`${right.path}${right.verb}`));
}

describe('the endpoints a polyglot checkout serves', () => {
  it('reports every endpoint once, with the verb the declaration names', () => {
    expect(endpoints()).toEqual([
      { verb: 'GET', path: '/api/health', file: 'src/server.ts', framework: 'express' },
      {
        verb: 'GET',
        path: '/api/hello',
        file: 'app/api/hello/route.ts',
        framework: 'nextjs-app-router',
      },
      { verb: 'GET', path: '/items', file: 'src/api.py', framework: 'fastapi' },
      {
        verb: 'GET',
        path: '/owners',
        file: 'src/main/java/io/owners/OwnerController.java',
        framework: 'spring',
      },
      {
        verb: 'POST',
        path: '/owners',
        file: 'src/main/java/io/owners/OwnerController.java',
        framework: 'spring',
      },
    ]);
  });

  it('counts the endpoints, not the patterns that matched them', () => {
    // `app.get('/api/health', …)` matched the Express, Express-router, Koa and Hono patterns; the old count said four.
    const routes = endpoints().filter((endpoint) => endpoint.path === '/api/health');
    expect(routes).toHaveLength(1);
  });

  it('keeps the verb Spring names in the annotation instead of reporting ALL', () => {
    const spring = endpoints().filter((endpoint) => endpoint.framework === 'spring');
    expect(spring.map((endpoint) => endpoint.verb)).toEqual(['GET', 'POST']);
  });

  it('does not read a template link as an endpoint', () => {
    // A Thymeleaf `th:href="@{/owners}"` is a caller of a route. Admitting it is how a 17-endpoint application reported
    // 55 routes, and the template is in this checkout precisely so that stays impossible.
    const fromTemplates = endpoints().filter((endpoint) => endpoint.file.endsWith('.html'));
    expect(fromTemplates).toEqual([]);
  });

  it('attaches every endpoint to the file that declares it', () => {
    const files = new Set(endpoints().map((endpoint) => endpoint.file));
    expect([...files].sort()).toEqual([
      'app/api/hello/route.ts',
      'src/api.py',
      'src/main/java/io/owners/OwnerController.java',
      'src/server.ts',
    ]);
  });
});
