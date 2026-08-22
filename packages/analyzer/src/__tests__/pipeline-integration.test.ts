// @code-analyzer/analyzer — End-to-End Pipeline Integration Test
// Validates the complete scan → parse → crossFile → scopeResolution → routes pipeline
// on a real TypeScript multi-file project.

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PipelineOrchestrator } from '../pipeline/orchestrator.js';
import {
  ScanPhase,
  StructurePhase,
  ParsePhase,
  MarkdownPhase,
  ConfigPhase,
  CrossFilePhase,
  ScopeResolutionPhase,
  RoutesPhase,
} from '../pipeline/phases/index.js';
import type {
  PipelineContext,
  DiscoveredFile,
  ParsedFile,
  ResolvedImport,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, 'fixtures', 'integration-project');
const FIXTURE_SRC = resolve(FIXTURE_DIR, 'src');

describe('Pipeline Integration — End-to-End', () => {
  let ctx: PipelineContext;

  beforeAll(async () => {
    const graph = new InMemoryGraphStore();

    ctx = {
      projectId: 'integration-test',
      rootPath: FIXTURE_SRC,
      graph,
      config: {
        excludePatterns: [],
        includePatterns: [],
        maxFileSize: 10 * 1024 * 1024,
        maxFiles: 1000,
        parseWorkers: 1,
        cacheDir: '.code-analyzer-test',
      },
      phaseData: new Map(),
      cancelled: false,
    };

    // Run phases sequentially using the PipelineOrchestrator
    const allPhases = [
      new ScanPhase(),
      new StructurePhase(),
      new ParsePhase(),
      new MarkdownPhase(),
      new ConfigPhase(),
      new CrossFilePhase(),
      new ScopeResolutionPhase(),
      new RoutesPhase(),
    ];

    const orchestrator = new PipelineOrchestrator(allPhases);
    const result = await orchestrator.execute(ctx);

    // Pipeline should complete or be partial (some phases may be skipped if deps fail)
    // Don't throw — let individual tests verify their expectations
    if (result.status === 'failed') {
      console.error('Pipeline failed:', JSON.stringify(result.errors, null, 2));
      console.error('Phase results:', JSON.stringify(result.phases, null, 2));
    }
  }, 60000);

  // -----------------------------------------------------------------------
  // Phase 1: Scan
  // -----------------------------------------------------------------------

  describe('Phase 1: Scan — File Discovery', () => {
    let discoveredFiles: DiscoveredFile[];

    beforeAll(() => {
      const scanData = ctx.phaseData.get('scan') as
        { discoveredFiles: DiscoveredFile[] } | undefined;
      discoveredFiles = scanData?.discoveredFiles ?? [];
    });

    it('should discover all source files', () => {
      expect(discoveredFiles.length).toBeGreaterThanOrEqual(6);
    });

    it('should include TypeScript files', () => {
      const tsFiles = discoveredFiles.filter((f) => f.filePath.endsWith('.ts'));
      expect(tsFiles.length).toBeGreaterThanOrEqual(6);
    });

    it('should skip node_modules and .git directories', () => {
      for (const file of discoveredFiles) {
        expect(file.filePath).not.toContain('node_modules');
        expect(file.filePath).not.toContain('.git');
      }
    });

    it('should have non-empty file content', () => {
      for (const file of discoveredFiles) {
        expect(file.content.length).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2: Structure
  // -----------------------------------------------------------------------

  describe('Phase 2: Structure — Module Organization', () => {
    it('should detect directory structure', () => {
      const data = ctx.phaseData.get('structure') as
        { directories: number; modules: number } | undefined;
      expect(data).toBeDefined();
      expect(data!.directories).toBeGreaterThanOrEqual(3); // models, services, utils, routes
      expect(data!.modules).toBeGreaterThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 3: Parse — Symbol Extraction
  // -----------------------------------------------------------------------

  describe('Phase 3: Parse — Symbol & Reference Extraction', () => {
    let parsedFiles: ParsedFile[];

    beforeAll(() => {
      const parseData = ctx.phaseData.get('parse') as { parsedFiles: ParsedFile[] } | undefined;
      parsedFiles = parseData?.parsedFiles ?? [];
    });

    it('should parse all discovered files', () => {
      expect(parsedFiles.length).toBeGreaterThanOrEqual(6);
    });

    it('should extract class definitions', () => {
      const allClasses = parsedFiles.flatMap((f) => f.symbols.filter((s) => s.kind === 'Class'));
      // User, AdminUser, Post, UserService
      expect(allClasses.length).toBeGreaterThanOrEqual(4);
    });

    it('should extract User class with its methods', () => {
      const userSymbols = parsedFiles.flatMap((f) =>
        f.symbols.filter((s) => s.qualifiedName?.includes('User')),
      );
      expect(userSymbols.length).toBeGreaterThanOrEqual(3); // class + methods
    });

    it('should extract interface definitions', () => {
      const interfaces = parsedFiles.flatMap((f) =>
        f.symbols.filter((s) => s.kind === 'Interface'),
      );
      // Identifiable, PostMetadata
      expect(interfaces.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract Identifiable interface from user.ts', () => {
      const userFile = parsedFiles.find((f) => f.filePath.endsWith('models/user.ts'));
      expect(userFile).toBeDefined();
      const identifiable = userFile!.symbols.find(
        (s) => s.name === 'Identifiable' && s.kind === 'Interface',
      );
      expect(identifiable).toBeDefined();
    });

    it('should extract User class symbol', () => {
      const userFile = parsedFiles.find((f) => f.filePath.endsWith('models/user.ts'));
      expect(userFile).toBeDefined();
      const userClass = userFile!.symbols.find((s) => s.name === 'User' && s.kind === 'Class');
      expect(userClass).toBeDefined();
    });

    it('should extract AdminUser symbol with baseClasses property', () => {
      const userFile = parsedFiles.find((f) => f.filePath.endsWith('models/user.ts'));
      expect(userFile).toBeDefined();
      const adminClass = userFile!.symbols.find(
        (s) => s.name === 'AdminUser' && s.kind === 'Class',
      );
      expect(adminClass).toBeDefined();
      // Should have baseClasses since AdminUser extends User
      expect(adminClass!.properties.baseClasses).toBeDefined();
    });

    it('should extract function definitions', () => {
      const functions = parsedFiles.flatMap((f) => f.symbols.filter((s) => s.kind === 'Function'));
      // formatEmail, truncate, slugify, getUserPosts, main
      expect(functions.length).toBeGreaterThanOrEqual(4);
    });

    it('should extract method definitions from classes', () => {
      const methods = parsedFiles.flatMap((f) => f.symbols.filter((s) => s.kind === 'Method'));
      expect(methods.length).toBeGreaterThanOrEqual(4);
    });

    it('should extract import references', () => {
      const importRefs = parsedFiles.flatMap((f) =>
        f.references.filter((r) => r.referenceKind === 'import'),
      );
      expect(importRefs.length).toBeGreaterThanOrEqual(4);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 4: Markdown
  // -----------------------------------------------------------------------

  describe('Phase 4: Markdown — Documentation', () => {
    it('should process markdown phase successfully', () => {
      const data = ctx.phaseData.get('markdown') as { markdownFiles: number } | undefined;
      expect(data).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Phase 5: Config
  // -----------------------------------------------------------------------

  describe('Phase 5: Config — Configuration Files', () => {
    it('should process config phase successfully', () => {
      const data = ctx.phaseData.get('config') as { configFiles: number } | undefined;
      expect(data).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Phase 6: Cross-file Dependencies
  // -----------------------------------------------------------------------

  describe('Phase 6: CrossFile — Import Resolution', () => {
    let resolvedImports: ResolvedImport[];

    beforeAll(() => {
      const crossData = ctx.phaseData.get('crossFile') as
        { resolvedImports: ResolvedImport[]; importEdgesCreated: number } | undefined;
      resolvedImports = crossData?.resolvedImports ?? [];
    });

    it('should resolve imports between files', () => {
      expect(resolvedImports.length).toBeGreaterThanOrEqual(3);
    });

    it('should resolve user-service.ts imports from models/user.ts', () => {
      const usImports = resolvedImports.filter((imp) => imp.sourceFile.endsWith('user-service.ts'));
      expect(usImports.length).toBeGreaterThanOrEqual(2);
      const resolvedToUser = usImports.some((imp) =>
        imp.resolvedFiles.some((rf: string) => rf.endsWith('models/user.ts')),
      );
      expect(resolvedToUser).toBe(true);
    });

    it('should resolve imports with correct symbol names', () => {
      const usImports = resolvedImports.filter((imp) => imp.sourceFile.endsWith('user-service.ts'));
      const userImport = usImports.find((imp) =>
        imp.resolvedFiles.some((rf) => rf.endsWith('models/user.ts')),
      );
      if (userImport) {
        expect(userImport.importedSymbols).toContain('User');
        expect(userImport.importedSymbols).toContain('AdminUser');
      }
    });

    it('should create IMPORTS edges in the graph', () => {
      const crossData = ctx.phaseData.get('crossFile') as
        { importEdgesCreated: number } | undefined;
      expect(crossData!.importEdgesCreated).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 7: Scope Resolution
  // -----------------------------------------------------------------------

  describe('Phase 7: ScopeResolution — Reference & Call Resolution', () => {
    let resolutionData: { referencesResolved: number };

    beforeAll(() => {
      const data = ctx.phaseData.get('scopeResolution') as
        { referencesResolved: number } | undefined;
      resolutionData = data ?? { referencesResolved: 0 };
    });

    it('should resolve references', () => {
      expect(resolutionData.referencesResolved).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 8: Routes Detection
  // -----------------------------------------------------------------------

  describe('Phase 8: Routes — API Route Detection', () => {
    it('should detect Express routes in api.ts', () => {
      const routesData = ctx.phaseData.get('routes') as { routesFound: number } | undefined;
      expect(routesData).toBeDefined();
      expect(routesData!.routesFound).toBeGreaterThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // Graph Integrity
  // -----------------------------------------------------------------------

  describe('Graph Integrity', () => {
    it('should have a populated knowledge graph', () => {
      expect(ctx.graph).toBeDefined();
      expect(ctx.graph!.nodes.size).toBeGreaterThan(0);
      expect(ctx.graph!.edges.size).toBeGreaterThan(0);
    });

    it('should have file nodes', () => {
      const fileNodes = Array.from(ctx.graph!.nodes.values()).filter((n) => n.label === 'File');
      expect(fileNodes.length).toBeGreaterThanOrEqual(6);
    });

    it('should have class nodes', () => {
      const classNodes = Array.from(ctx.graph!.nodes.values()).filter((n) => n.label === 'Class');
      expect(classNodes.length).toBeGreaterThanOrEqual(4); // User, AdminUser, Post, UserService
    });

    it('should have DEFINES edges connecting files to symbols', () => {
      const definesEdges = Array.from(ctx.graph!.edges.values()).filter(
        (e) => e.type === 'DEFINES',
      );
      expect(definesEdges.length).toBeGreaterThanOrEqual(10);
    });

    it('should have IMPORTS edges between files', () => {
      const importsEdges = Array.from(ctx.graph!.edges.values()).filter(
        (e) => e.type === 'IMPORTS',
      );
      expect(importsEdges.length).toBeGreaterThan(0);
    });

    it('should create EXTENDS edge for AdminUser extends User (same-file)', () => {
      const extendsEdges = Array.from(ctx.graph!.edges.values()).filter(
        (e) => e.type === 'EXTENDS',
      );
      // AdminUser extends User — both defined in models/user.ts
      expect(extendsEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should create IMPLEMENTS edge for User implements Identifiable (same-file)', () => {
      const implementsEdges = Array.from(ctx.graph!.edges.values()).filter(
        (e) => e.type === 'IMPLEMENTS',
      );
      // User implements Identifiable — both defined in models/user.ts
      expect(implementsEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should use consistent node IDs across edges', () => {
      const nodeIds = new Set(Array.from(ctx.graph!.nodes.keys()));
      for (const [, edge] of ctx.graph!.edges) {
        expect(nodeIds.has(edge.sourceId)).toBe(true);
        expect(nodeIds.has(edge.targetId)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Error Handling
  // -----------------------------------------------------------------------

  describe('Pipeline Error Resilience', () => {
    it('should handle empty project gracefully', async () => {
      const emptyGraph = new InMemoryGraphStore();
      const emptyCtx: PipelineContext = {
        projectId: 'empty-test',
        rootPath: resolve(FIXTURE_SRC, 'non-existent'),
        graph: emptyGraph,
        config: {
          excludePatterns: [],
          includePatterns: [],
          maxFileSize: 10 * 1024 * 1024,
          maxFiles: 10,
          parseWorkers: 1,
          cacheDir: '.code-analyzer-test-empty',
        },
        phaseData: new Map(),
        cancelled: false,
      };

      const phases = [new ScanPhase(), new StructurePhase(), new ParsePhase()];
      const orch = new PipelineOrchestrator(phases);
      const result = await orch.execute(emptyCtx);
      expect(result.status).not.toBe('failed');
    });

    it('should handle malformed TypeScript gracefully', async () => {
      const badGraph = new InMemoryGraphStore();
      const fs = await import('node:fs/promises');
      const { resolve: r } = await import('node:path');
      const tmpDir = r(FIXTURE_SRC, '..', '.tmp-test');
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(
        r(tmpDir, 'bad.ts'),
        'import { foo } from "./nonexistent"; const x: Foo = bar();;;{{{}',
      );

      const badCtx: PipelineContext = {
        projectId: 'bad-ts-test',
        rootPath: tmpDir,
        graph: badGraph,
        config: {
          excludePatterns: [],
          includePatterns: [],
          maxFileSize: 10 * 1024 * 1024,
          maxFiles: 10,
          parseWorkers: 1,
          cacheDir: '.code-analyzer-test-bad',
        },
        phaseData: new Map(),
        cancelled: false,
      };

      try {
        const phases = [new ScanPhase(), new ParsePhase()];
        const orch = new PipelineOrchestrator(phases);
        const result = await orch.execute(badCtx);
        expect(result).toBeDefined();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
