// @code-analyzer — Story 1 on a polyglot repository: one tree, eight languages, one graph.
//
// **`pallets/flask` proves the Python path end to end; it cannot prove the other providers.** A Spring application is
// the other shape a real repository takes: **Java for the code, XML for the build, YAML for the configuration, HTML
// for the templates, Groovy for the build DSL** — and until this suite existed, **four of those five never reached a
// provider at all**, because `getLanguageFromFilename` named only the code extensions. A file the scanner never admits
// is a language whose provider is dead code.
//
// Pinned by SHA and fetched as a tarball, for the same reasons as the Flask suite: a clone carries a history the
// scanner must skip, and a public tarball needs no credential on a runner. **A download failure skips locally and fails
// on a runner.**

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { GraphBuilder } from '../graph/graph-builder.js';
import { PipelineOrchestrator, createAllPhases } from '../pipeline/index.js';

import type {
  CodeAnalyzerConfig,
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  PipelineContext,
} from '@code-analyzer/shared';

/** **Spring's canonical sample application** — the same code in every Spring tutorial, and small enough to index. */
const CORPUS = {
  name: 'spring-projects/spring-petclinic',
  sha: '500158f732419217507c7656904b8e6aa1bcc0d6',
  tarball:
    'https://codeload.github.com/spring-projects/spring-petclinic/tar.gz/500158f732419217507c7656904b8e6aa1bcc0d6',
} as const;

const TIMEOUT = 300_000;

let workDir: string;
let root: string;
let graph: KnowledgeGraph;
let phases: Array<{ phaseId: string; status: string; output?: Record<string, unknown> }>;
let skipped: string | null = null;

/** Files per language the tree holds, by the extensions the scanner admits — the denominator for the split below. */
function treeByLanguage(dir: string, counts: Record<string, number> = {}): Record<string, number> {
  const byExtension: Record<string, string> = {
    '.java': 'java',
    '.kt': 'kotlin',
    '.html': 'html',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.groovy': 'groovy',
    '.gradle': 'groovy',
    '.md': 'markdown',
    '.css': 'css',
  };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // **A dot-directory is scanned** - `.github/workflows` holds the CI definitions and the graph includes them -
      // while a dot-*file* is not. That is the distinction the scanner makes, and this counter mirrors it rather than
      // assuming one rule for both.
      if (entry.name === 'target' || entry.name === 'node_modules') continue;
      treeByLanguage(full, counts);
    } else {
      if (entry.name.startsWith('.')) continue;
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0) continue;
      const language = byExtension[entry.name.slice(dot).toLowerCase()];
      if (language) counts[language] = (counts[language] ?? 0) + 1;
    }
  }
  return counts;
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'ca-polyglot-'));
  const archive = join(workDir, 'corpus.tar.gz');
  root = join(workDir, 'src');
  mkdirSync(root, { recursive: true });

  try {
    const response = await fetch(CORPUS.tarball, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    execFileSync('tar', ['xzf', archive, '-C', root, '--strip-components=1'], { stdio: 'ignore' });
  } catch (err) {
    const reason = `could not fetch ${CORPUS.name}@${CORPUS.sha.slice(0, 8)}: ${(err as Error).message}`;
    if (process.env['CI']) throw new Error(reason);
    skipped = reason;
    return;
  }

  const store = new InMemoryGraphStore();
  const builder = new GraphBuilder(store);
  const config: CodeAnalyzerConfig = {
    projectId: CORPUS.name,
    rootPath: root,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 10_000,
    parseWorkers: 1,
    ignorePaths: [],
  };
  const ctx: PipelineContext = {
    projectId: CORPUS.name,
    rootPath: root,
    phaseData: new Map(),
    graph: builder.build({ projectId: CORPUS.name, rootPath: root, phaseData: new Map(), config }),
    config,
  };

  const result = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  graph = ctx.graph!;
  phases = result.phases as typeof phases;
}, TIMEOUT);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function nodes(): GraphNode[] {
  return [...graph.nodes.values()];
}

function edgesOfType(type: string): GraphEdge[] {
  return [...graph.edges.values()].filter((e) => e.type === type);
}

function phaseOutput(id: string): Record<string, unknown> {
  return phases.find((p) => p.phaseId === id)?.output ?? {};
}

function filesByLanguage(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes()) {
    if (node.label !== 'File') continue;
    const language = String(node.language);
    counts[language] = (counts[language] ?? 0) + 1;
  }
  return counts;
}

describe(`a polyglot repository (${CORPUS.name} at ${CORPUS.sha.slice(0, 8)})`, () => {
  it('indexes every language the tree holds, not only the one the application is written in', (ctx) => {
    if (skipped) return ctx.skip();

    const expected = treeByLanguage(root);
    const actual = filesByLanguage();

    // **Nine languages in one Spring project**, and five of them reached no provider before this change.
    for (const language of ['java', 'html', 'xml', 'yaml', 'json', 'groovy', 'markdown', 'css']) {
      expect(expected[language], `${language} in the tree`).toBeGreaterThan(0);
      expect(actual[language], `${language} in the graph`).toBe(expected[language]);
    }
    expect(actual['java']).toBe(50);
  });

  it('keeps the stylesheet the project re-includes from its own .gitignore', (ctx) => {
    if (skipped) return ctx.skip();

    // **This repository's `.gitignore` is `*.css` followed by `!petclinic.css`**, and the matcher answered with the
    // first pattern that matched: the one stylesheet the project tracks was dropped, the CSS provider saw an empty
    // corpus, and every fixture still passed. The file is the assertion because the rule is the defect.
    const css = nodes().filter((n) => n.label === 'File' && String(n.filePath).endsWith('.css'));
    expect(css.map((n) => String(n.filePath).split('/').pop())).toEqual(['petclinic.css']);

    const stylesheet = nodes().find((n) => String(n.filePath).endsWith('petclinic.css'));
    expect(stylesheet, 'petclinic.css').toBeDefined();
  });

  it('finds no agent tools in an application that defines none', (ctx) => {
    if (skipped) return ctx.skip();

    // **`toolsFound` went from 1 to 33 when templates and configuration were admitted**, because the slash-command
    // pattern was `/\/[a-z]…/` anywhere in the text: every `</a>`, every `th:href="@{/owners}"` and every path in a
    // YAML file read as a Slack command. A Spring sample defines no agent tool, so the honest count is zero.
    expect(Number(phaseOutput('tools')['toolsFound'])).toBe(0);
  });

  it('parses every file it admitted', (ctx) => {
    if (skipped) return ctx.skip();

    expect(Number(phaseOutput('parse')['filesParsed'])).toBe(
      Number(phaseOutput('scan')['filesDiscovered']),
    );
    expect(Number(phaseOutput('parse')['filesFailed'])).toBe(0);
  });

  it('puts the application’s classes and their methods in the graph', (ctx) => {
    if (skipped) return ctx.skip();

    const controller = nodes().find((n) => n.name === 'OwnerController' && n.label === 'Class');
    expect(controller, 'OwnerController').toBeDefined();
    expect(controller!.filePath?.endsWith('owner/OwnerController.java')).toBe(true);

    // **The methods are what a change is scored against**, so the class is not enough.
    const methods = nodes().filter(
      (n) => n.label === 'Method' && n.filePath?.endsWith('owner/OwnerController.java'),
    );
    expect(methods.length).toBeGreaterThan(3);
    expect(methods.map((m) => m.name)).toContain('initCreationForm');
  });

  it('reads the HTTP routes out of the framework annotations', (ctx) => {
    if (skipped) return ctx.skip();

    expect(Number(phaseOutput('routes')['routesFound'])).toBe(17);
    expect(edgesOfType('HANDLES_ROUTE').length).toBe(17);

    const paths = nodes()
      .filter((n) => n.label === 'Route')
      .map((n) => n.name);
    expect(paths.some((p) => p.includes('/owners'))).toBe(true);
  });

  it('resolves Java imports to the project’s own types', (ctx) => {
    if (skipped) return ctx.skip();

    // **Every import in a Spring application that is not from the framework is a dotted package path**
    // (`org.springframework.samples.petclinic.model.Owner`), and **they all resolved to nothing** before the resolver
    // learned to anchor a package on the importer's own path: 0 edges over 50 Java files.
    const imports = edgesOfType('IMPORTS');
    expect(imports.length).toBeGreaterThan(0);

    // **A Java file needs no import for a class in its own package**, so the number is far below the file count; that
    // is the language, not the resolver, and it is why this graph alone cannot answer "who calls this".
    expect(imports.length).toBeLessThan(fileCountOfType('java'));
  });

  it('turns the build and configuration files into configurable nodes', (ctx) => {
    if (skipped) return ctx.skip();

    const configs = nodes().filter((n) => n.label === 'Config');
    expect(configs.length).toBeGreaterThan(20);

    // **A config node carries a line**, because one at line 0 cannot be opened: measured 78 such nodes before the
    // flattening learned to locate a key.
    const placed = configs.filter((n) => typeof n.filePath === 'string' && n.filePath.length > 0);
    expect(placed.length).toBe(configs.length);
    const unplaceable = placed.filter((n) => (n.startLine ?? 0) < 1);
    expect(unplaceable.map((n) => `${n.filePath}:${n.name}`)).toEqual([]);

    expect(edgesOfType('CONFIGURES').length).toBeGreaterThan(100);
  });

  it('runs every phase to a terminal state', (ctx) => {
    if (skipped) return ctx.skip();

    const failed = phases.filter((p) => p.status !== 'success' && p.status !== 'skipped');
    expect(failed.map((p) => `${p.phaseId}:${p.status}`)).toEqual([]);
  });
});

/** How many files of a language the graph holds — used to compare an edge count with a file count. */
function fileCountOfType(language: string): number {
  return nodes().filter((n) => n.label === 'File' && n.language === language).length;
}
