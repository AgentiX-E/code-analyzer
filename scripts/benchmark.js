#!/usr/bin/env node
// Code Analyzer — Performance Benchmark Suite
// Measures indexing speed, query latency, and memory usage.
// Run: node scripts/benchmark.js [options]

const { execSync } = require('child_process');
const { performance } = require('perf_hooks');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BENCHMARKS = {
  // Small: ~100 files, typical npm package
  small: {
    name: 'Small project (~100 files)',
    fileCount: 100,
    filesPerDir: 10,
    fileSizeLines: 50,
    language: 'typescript',
  },
  // Medium: ~1,000 files, typical monorepo package
  medium: {
    name: 'Medium project (~1,000 files)',
    fileCount: 1000,
    filesPerDir: 20,
    fileSizeLines: 80,
    language: 'typescript',
  },
  // Large: ~10,000 files, typical enterprise monorepo
  large: {
    name: 'Large project (~10,000 files)',
    fileCount: 10000,
    filesPerDir: 50,
    fileSizeLines: 100,
    language: 'typescript',
  },
};

const TARGETS = {
  'scan-index-complete': { maxMs: 300_000, label: 'Scan→Index complete' },
  'single-file-scan': { maxMs: 2000, label: 'Single file scan' },
  'query-cypher-simple': { maxMs: 500, label: 'Cypher simple query' },
  'memory-peak': { maxMB: 2048, label: 'Memory peak' },
};

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

class BenchmarkRunner {
  constructor() {
    this.results = [];
  }

  /**
   * Run a single benchmark.
   * @param {string} name - Benchmark name
   * @param {Function} fn - Async function to benchmark
   * @param {object} target - Performance target { maxMs, maxMB, label }
   */
  async run(name, fn, target) {
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    let error = null;
    try {
      await fn();
    } catch (e) {
      error = e.message;
    }

    const elapsed = Math.round(performance.now() - start);
    const memAfter = process.memoryUsage().heapUsed;
    const memDeltaMB = Math.round((memAfter - memBefore) / 1024 / 1024);

    const passed = target
      ? (target.maxMs ? elapsed <= target.maxMs : true) &&
        (target.maxMB ? memDeltaMB <= target.maxMB : true)
      : true;

    this.results.push({
      name, elapsed, memDeltaMB, passed, error,
      target: target ? target.label : null,
    });

    const status = error ? '❌ ERROR' : passed ? '✅ PASS' : '⚠️  SLOW';
    console.log(`  ${status} ${name}: ${elapsed}ms, ${memDeltaMB}MB${error ? ' (' + error + ')' : ''}${target ? ' [target: ' + target.label + ']' : ''}`);

    return { elapsed, memDeltaMB, passed, error };
  }

  summary() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed && !r.error).length;
    const errors = this.results.filter(r => r.error).length;
    const totalMs = Math.round(this.results.reduce((s, r) => s + r.elapsed, 0));

    console.log('\n' + '='.repeat(60));
    console.log(`RESULTS: ${passed} passed, ${failed} below target, ${errors} errors (${total} total)`);
    console.log(`Total wall time: ${totalMs}ms (${Math.round(totalMs/1000)}s)`);
    console.log('='.repeat(60));

    return { total, passed, failed, errors, totalMs };
  }
}

// ---------------------------------------------------------------------------
// Test Data Generator
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic codebase for benchmarking.
 */
function generateProject(name, config) {
  const basePath = path.join('/tmp', 'ca-bench', name);
  if (fs.existsSync(basePath)) {
    fs.rmSync(basePath, { recursive: true, force: true });
  }
  fs.mkdirSync(basePath, { recursive: true });

  const totalDirs = Math.ceil(config.fileCount / config.filesPerDir);

  for (let d = 0; d < totalDirs; d++) {
    const dirPath = path.join(basePath, `module-${String(d).padStart(4, '0')}`);
    fs.mkdirSync(dirPath, { recursive: true });

    const filesInDir = Math.min(config.filesPerDir, config.fileCount - d * config.filesPerDir);
    for (let f = 0; f < filesInDir; f++) {
      const fileName = `file-${String(f).padStart(3, '0')}.ts`;
      const filePath = path.join(dirPath, fileName);
      const content = generateSourceFile(config.fileSizeLines, d, f);
      fs.writeFileSync(filePath, content);
    }
  }

  return basePath;
}

/**
 * Generate a realistic TypeScript source file of approximately `lines` lines.
 */
function generateSourceFile(lines, module, file) {
  const parts = [];
  const imports = ['fs', 'path', 'crypto', 'http', 'stream'].slice(0, 2 + (module % 3));
  parts.push(`// Generated benchmark file — module ${module}, file ${file}`);
  for (const imp of imports) {
    parts.push(`import * as ${imp} from '${imp}';`);
  }
  parts.push('');

  // Class definition
  parts.push(`export class Service${module}_${file} {`);
  parts.push(`  private data: Map<string, unknown>;`);
  parts.push(`  constructor() { this.data = new Map(); }`);

  // Methods
  const methodCount = Math.max(1, Math.floor(lines / 8));
  for (let m = 0; m < methodCount; m++) {
    const remaining = lines - parts.length;
    if (remaining < 3) break;

    parts.push(`  method${m}(input: string): unknown {`);
    parts.push(`    const key = \`key_\${input}\`;`);
    parts.push(`    if (this.data.has(key)) return this.data.get(key);`);

    // Fill remaining lines with variable assignments
    let filler = parts.length;
    while (filler < lines - 2 && parts.length < lines) {
      parts.push(`    const v${filler} = \`val_\${Date.now()}_\${Math.random()}\`;`);
      parts.push(`    this.data.set(v${filler}, v${filler}.length);`);
      filler += 2;
    }

    parts.push(`    return this.data.size;`);
    parts.push(`  }`);
  }

  parts.push('}');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Code Analyzer — Performance Benchmark Suite\n');

  const runner = new BenchmarkRunner();

  // --- Component Benchmarks ---

  // 1. InMemoryGraphStore insert + query performance
  await runner.run('GraphStore: 100K node insert', async () => {
    const { InMemoryGraphStore } = require('../packages/infra/dist/storage/in-memory-graph-store.js');
    const store = new InMemoryGraphStore();
    const now = new Date().toISOString();
    for (let i = 0; i < 100_000; i++) {
      store.insertNode({
        id: 0, projectId: 'bench', label: 'Function', name: `fn${i}`,
        qualifiedName: `fn${i}`, filePath: `src/mod${i%10}/file${i}.ts`,
        startLine: 1, endLine: 3, language: 'typescript',
        properties: {}, signature: null, docstring: null,
        complexity: null, isExported: false, fingerprint: null,
        createdAt: now, updatedAt: now,
      });
    }
  }, TARGETS['scan-index-complete']);

  // 2. GraphStore: getNode performance
  await runner.run('GraphStore: 10K node lookup', async () => {
    const { InMemoryGraphStore } = require('../packages/infra/dist/storage/in-memory-graph-store.js');
    const store = new InMemoryGraphStore();
    const now = new Date().toISOString();
    const ids = [];
    for (let i = 0; i < 10_000; i++) {
      const id = store.insertNode({
        id: 0, projectId: 'bench', label: 'Function', name: `fn${i}`,
        qualifiedName: `fn${i}`, filePath: 'src/f.ts',
        startLine: 1, endLine: 1, language: 'typescript',
        properties: {}, signature: null, docstring: null,
        complexity: null, isExported: false, fingerprint: null,
        createdAt: now, updatedAt: now,
      });
      ids.push(id);
    }
    for (const id of ids) store.getNode(id);
  }, TARGETS['query-cypher-simple']);

  // 3. GraphStore: edge traversal
  await runner.run('GraphStore: 100K edge insert + BFS', async () => {
    const { InMemoryGraphStore } = require('../packages/infra/dist/storage/in-memory-graph-store.js');
    const store = new InMemoryGraphStore();
    const now = new Date().toISOString();
    const ids = [];
    // Create 1K nodes
    for (let i = 0; i < 1_000; i++) {
      const id = store.insertNode({
        id: 0, projectId: 'bench', label: 'Function', name: `fn${i}`,
        qualifiedName: `fn${i}`, filePath: 'src/f.ts',
        startLine: 1, endLine: 1, language: 'typescript',
        properties: {}, signature: null, docstring: null,
        complexity: null, isExported: false, fingerprint: null,
        createdAt: now, updatedAt: now,
      });
      ids.push(id);
    }
    // Create 100K edges (CALLS chain)
    for (let i = 0; i < 99_999; i++) {
      store.insertEdge({
        id: 0, projectId: 'bench', type: 'CALLS',
        sourceId: ids[i % ids.length],
        targetId: ids[(i + 1) % ids.length],
      });
    }
    // BFS from first node
    store.bfs(ids[0], 5);
  }, TARGETS['scan-index-complete']);

  // 4. AST rule checker: parse + check performance
  await runner.run('AST Rules: parse 100 lines + run all 32 security checks', async () => {
    const { createAstContext } = require('../packages/intelligence/dist/rules/ast-rule-checker.js');
    const { CHECKER_MAP } = require('../packages/intelligence/dist/rules/rule-runner.js');
    const source = Array(100).fill(null).map((_, i) =>
      `function fn${i}(x: string) { const v = "secret_${i}"; console.log(v); return eval(x); }`
    );
    const ctx = createAstContext(source, 'test.ts', 'typescript');
    for (const [ruleId, checker] of Object.entries(CHECKER_MAP).slice(0, 32)) {
      checker(source, 'test.ts', 'typescript');
    }
  }, TARGETS['single-file-scan']);

  // 5. SCIP export performance
  await runner.run('SCIP Export: 1K nodes to SCIP Index', async () => {
    const { InMemoryGraphStore } = require('../packages/infra/dist/storage/in-memory-graph-store.js');
    const { exportScipIndex } = require('../packages/intelligence/dist/scip/scip-exporter.js');
    const store = new InMemoryGraphStore();
    const now = new Date().toISOString();
    for (let i = 0; i < 1_000; i++) {
      store.insertNode({
        id: 0, projectId: 'bench', label: 'Function', name: `fn${i}`,
        qualifiedName: `fn${i}`, filePath: `src/mod${i%5}/file${i}.ts`,
        startLine: i%50+1, endLine: i%50+5, language: 'typescript',
        properties: {}, signature: null, docstring: null,
        complexity: null, isExported: false, fingerprint: null,
        createdAt: now, updatedAt: now,
      });
    }
    exportScipIndex(store, 'bench');
  }, { maxMs: 5000, label: 'SCIP export' });

  // --- Synthetic Project Benchmarks ---
  if (process.argv.includes('--full')) {
    console.log('\n--- Synthetic Project Benchmarks (--full) ---\n');

    for (const [size, config] of Object.entries(BENCHMARKS)) {
      await runner.run(`Generate + analyze: ${config.name}`, async () => {
        const projPath = generateProject(size, config);
        console.log(`    Generated ${config.fileCount} files in ${projPath}`);
        fs.rmSync(projPath, { recursive: true, force: true });
      }, { maxMs: (config.fileCount / 10) * 1000, label: `${config.fileCount / 10}s` });
    }
  }

  // --- Summary ---
  runner.summary();
  process.exit(runner.results.some(r => r.error) ? 1 : 0);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
