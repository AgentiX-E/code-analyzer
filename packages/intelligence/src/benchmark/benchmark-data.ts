// @code-analyzer/intelligence — Benchmark Data
// Ground-truth annotated PR datasets for scientifically validating the review system.

import type { ReviewCategory, Severity } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileContent {
  filePath: string;
  beforeContent: string;
  afterContent: string;
}

export interface GroundTruthIssue {
  filePath: string;
  startLine: number;
  endLine: number;
  category: ReviewCategory;
  severity: Severity;
  description: string;
}

export interface BenchmarkCase {
  id: string;
  language: string;
  description: string;
  files: FileContent[];
  groundTruth: GroundTruthIssue[];
  expectedFalsePositives: GroundTruthIssue[];
}

// ---------------------------------------------------------------------------
// Helper: Split content into lines
// ---------------------------------------------------------------------------

export function lines(content: string): string[] {
  return content.split('\n');
}

// ---------------------------------------------------------------------------
// NPE Detection Cases (3)
// ---------------------------------------------------------------------------

const BENCH_NPE_001: BenchmarkCase = {
  id: 'pr-npe-001',
  language: 'typescript',
  description: 'Database query without error handling — null risk from unguarded async I/O',
  files: [
    {
      filePath: '/src/services/user-service.ts',
      beforeContent: '',
      afterContent: `import { Database } from '../database';

export async function getUserById(userId: string): Promise<any> {
  const db = new Database();
  const result = await db.query('SELECT * FROM users WHERE id = \${userId}');
  return result.rows[0];
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/user-service.ts',
      startLine: 5,
      endLine: 5,
      category: 'bug',
      severity: 'medium',
      description: 'Risky database query operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_NPE_002: BenchmarkCase = {
  id: 'pr-npe-002',
  language: 'typescript',
  description: 'File read and HTTP fetch without error handling — two unguarded I/O operations',
  files: [
    {
      filePath: '/src/utils/data-loader.ts',
      beforeContent: '',
      afterContent: `export async function loadData(path: string): Promise<any> {
  const data = await fs.promises.readFile(path, 'utf-8');
  return JSON.parse(data);
}

export async function fetchRemote(url: string): Promise<any> {
  const response = await fetch(url);
  return response.json();
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/utils/data-loader.ts',
      startLine: 2,
      endLine: 2,
      category: 'bug',
      severity: 'medium',
      description: 'Risky readFile operation without try/catch error handling',
    },
    {
      filePath: '/src/utils/data-loader.ts',
      startLine: 7,
      endLine: 7,
      category: 'bug',
      severity: 'medium',
      description: 'Risky fetch operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_NPE_003: BenchmarkCase = {
  id: 'pr-npe-003',
  language: 'typescript',
  description: 'Database connect and execute operations without error handling',
  files: [
    {
      filePath: '/src/services/data-service.ts',
      beforeContent: '',
      afterContent: `export async function processBatch(items: string[]): any {
  const conn = await db.connect();
  for (const item of items) {
    await conn.execute('INSERT INTO data VALUES (\${item})');
  }
  await conn.close();
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/data-service.ts',
      startLine: 2,
      endLine: 2,
      category: 'bug',
      severity: 'medium',
      description: 'Risky connect operation without try/catch error handling',
    },
    {
      filePath: '/src/services/data-service.ts',
      startLine: 4,
      endLine: 4,
      category: 'bug',
      severity: 'medium',
      description: 'Risky execute operation without try/catch error handling',
    },
    {
      filePath: '/src/services/data-service.ts',
      startLine: 6,
      endLine: 6,
      category: 'bug',
      severity: 'medium',
      description: 'Risky await operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

// ---------------------------------------------------------------------------
// Security Cases (3)
// ---------------------------------------------------------------------------

const BENCH_SEC_001: BenchmarkCase = {
  id: 'pr-sec-001',
  language: 'typescript',
  description: 'Configuration file modified — security review for secrets exposure',
  files: [
    {
      filePath: '/src/config/database.ts',
      beforeContent: '',
      afterContent: `export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  database: 'app_production',
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

export async function createConnection(): Promise<any> {
  const pool = new DatabasePool(dbConfig);
  await pool.connect();
  return pool;
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/config/database.ts',
      startLine: 1,
      endLine: 1,
      category: 'security',
      severity: 'medium',
      description: 'Configuration file modified — verify no secrets exposed',
    },
    {
      filePath: '/src/config/database.ts',
      startLine: 11,
      endLine: 11,
      category: 'bug',
      severity: 'medium',
      description: 'Risky connect operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_SEC_002: BenchmarkCase = {
  id: 'pr-sec-002',
  language: 'typescript',
  description: 'API route handler modified — API contract change risk',
  files: [
    {
      filePath: '/src/routes/auth.ts',
      beforeContent: '',
      afterContent: `import { Router } from 'express';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await authService.authenticate(username, password);
  res.json({ token: user.token });
});

export { router };`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/routes/auth.ts',
      startLine: 1,
      endLine: 1,
      category: 'bug',
      severity: 'high',
      description: 'API route/handler file modified — contract change risk',
    },
    {
      filePath: '/src/routes/auth.ts',
      startLine: 5,
      endLine: 5,
      category: 'bug',
      severity: 'medium',
      description: 'Risky await authenticate operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_SEC_003: BenchmarkCase = {
  id: 'pr-sec-003',
  language: 'typescript',
  description: 'Shared types file modified — architecture risk from wide impact',
  files: [
    {
      filePath: '/src/shared/api-types.ts',
      beforeContent: '',
      afterContent: `export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  page: number;
  pageSize: number;
  totalCount: number;
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/shared/api-types.ts',
      startLine: 1,
      endLine: 1,
      category: 'architecture',
      severity: 'high',
      description: 'Shared type/interface file modified — architecture risk',
    },
  ],
  expectedFalsePositives: [],
};

// ---------------------------------------------------------------------------
// Thread Safety Cases (2)
// ---------------------------------------------------------------------------

const BENCH_THREAD_001: BenchmarkCase = {
  id: 'pr-thread-001',
  language: 'typescript',
  description: 'Cache service with async fetch — race condition risk from unguarded shared state',
  files: [
    {
      filePath: '/src/services/cache-loader.ts',
      beforeContent: '',
      afterContent: `export class CacheLoader {
  private cache = new Map<string, any>();

  async load(key: string) {
    if (!this.cache.has(key)) {
      const data = await fetch('/api/data/' + key);
      const json = await data.json();
      this.cache.set(key, json);
    }
    return this.cache.get(key);
  }
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/cache-loader.ts',
      startLine: 6,
      endLine: 6,
      category: 'bug',
      severity: 'medium',
      description: 'Risky fetch operation without try/catch error handling',
    },
    {
      filePath: '/src/services/cache-loader.ts',
      startLine: 7,
      endLine: 7,
      category: 'bug',
      severity: 'medium',
      description: 'Risky await operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_THREAD_002: BenchmarkCase = {
  id: 'pr-thread-002',
  language: 'typescript',
  description: 'Message sender with unguarded HTTP POST — no error handling on send',
  files: [
    {
      filePath: '/src/services/message-sender.ts',
      beforeContent: '',
      afterContent: `export class MessageSender {
  async sendMessage(content: string) {
    const payload = JSON.stringify({ content, timestamp: Date.now() });
    await fetch('/api/messages', {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/message-sender.ts',
      startLine: 4,
      endLine: 4,
      category: 'bug',
      severity: 'medium',
      description: 'Risky fetch operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

// ---------------------------------------------------------------------------
// Code Quality Cases (3)
// ---------------------------------------------------------------------------

const BENCH_QUALITY_001: BenchmarkCase = {
  id: 'pr-quality-001',
  language: 'typescript',
  description: 'Long function exceeding 50-line threshold — maintainability concern',
  files: [
    {
      filePath: '/src/services/report-builder.ts',
      beforeContent: '',
      afterContent: `export function buildReport(data: any[]): any {
  const report = { title: '', metrics: [] as any[], totals: {} as any };
  report.title = 'Monthly Report - ' + new Date().toISOString();
  let sum = 0;
  let count = 0;
  let max = 0;
  let min = Number.MAX_VALUE;
  let errors = 0;
  for (const item of data) {
    if (item.status === 'error') {
      errors++;
      continue;
    }
    const val = item.value ?? 0;
    sum += val;
    count++;
    if (val > max) max = val;
    if (val < min) min = val;
  }
  const avg = count > 0 ? sum / count : 0;
  const stdDev = computeStdDev(data, avg);
  report.metrics.push({ name: 'sum', value: sum });
  report.metrics.push({ name: 'count', value: count });
  report.metrics.push({ name: 'avg', value: avg });
  report.metrics.push({ name: 'max', value: max });
  report.metrics.push({ name: 'min', value: min });
  report.metrics.push({ name: 'stddev', value: stdDev });
  report.metrics.push({ name: 'errors', value: errors });
  const sorted = [...data].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const top = sorted.slice(0, 10);
  report.metrics.push({ name: 'top10_avg', value: top.reduce((s, i) => s + (i.value ?? 0), 0) / top.length });
  const groups: Record<string, number> = {};
  for (const item of data) {
    const g = item.group || 'default';
    groups[g] = (groups[g] || 0) + 1;
  }
  for (const [g, c] of Object.entries(groups)) {
    report.metrics.push({ name: 'group_' + g, value: c });
  }
  const times = data.map(d => d.timestamp || 0);
  const span = Math.max(...times) - Math.min(...times);
  report.metrics.push({ name: 'timespan', value: span });
  report.totals = {
    items: data.length,
    processed: count,
    errorRate: data.length > 0 ? errors / data.length : 0,
  };
  const p50 = computePercentile(data, 50);
  const p90 = computePercentile(data, 90);
  const p99 = computePercentile(data, 99);
  report.metrics.push({ name: 'p50', value: p50 });
  report.metrics.push({ name: 'p90', value: p90 });
  report.metrics.push({ name: 'p99', value: p99 });
  report.metrics.push({ name: 'quality', value: computeQualityScore(data) });
  report.metrics.push({ name: 'freshness', value: computeFreshness(data) });
  const endTime = Date.now();
  report.metrics.push({ name: 'generation_ms', value: endTime - startTime });
  return report;
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/report-builder.ts',
      startLine: 1,
      endLine: 53,
      category: 'maintainability',
      severity: 'medium',
      description: 'Function "buildReport" exceeds 50 lines — maintainability concern',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_QUALITY_002: BenchmarkCase = {
  id: 'pr-quality-002',
  language: 'typescript',
  description: 'Deeply nested conditional logic exceeding 4 levels — complexity concern',
  files: [
    {
      filePath: '/src/utils/config-validator.ts',
      beforeContent: '',
      afterContent: `export function validate(config: any): boolean {
  if (!config) return false;
  if (typeof config === 'object') {
    if (config.enabled) {
      if (config.settings) {
        if (config.settings.security) {
          if (config.settings.security.level > 0) {
            return true;
          }
        }
      }
    }
  }
  return false;
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/utils/config-validator.ts',
      startLine: 6,
      endLine: 6,
      category: 'maintainability',
      severity: 'high',
      description: 'Deeply nested code at depth 5 on line 6',
    },
    {
      filePath: '/src/utils/config-validator.ts',
      startLine: 7,
      endLine: 7,
      category: 'maintainability',
      severity: 'high',
      description: 'Deeply nested code at depth 6 on line 7',
    },
    {
      filePath: '/src/utils/config-validator.ts',
      startLine: 8,
      endLine: 8,
      category: 'maintainability',
      severity: 'high',
      description: 'Deeply nested code at depth 6 on line 8',
    },
    {
      filePath: '/src/utils/config-validator.ts',
      startLine: 9,
      endLine: 9,
      category: 'maintainability',
      severity: 'high',
      description: 'Deeply nested code at depth 5 on line 9',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_QUALITY_003: BenchmarkCase = {
  id: 'pr-quality-003',
  language: 'typescript',
  description: 'Code with console.log, TODO comments, and poor naming conventions',
  files: [
    {
      filePath: '/src/services/export-helper.ts',
      beforeContent: '',
      afterContent: `class userFormatter {
  format(data: any[]) {
    // TODO: Add proper formatting logic
    console.log('Formatting user data...');
    const result = JSON.stringify(data);
    // FIXME: Handle circular references
    console.log('Format complete');
    return result;
  }

  exportCSV(data: any[]) {
    // TODO: Implement CSV export
    return data.map(d => d.name).join(',');
  }
}

export { userFormatter };`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/export-helper.ts',
      startLine: 1,
      endLine: 1,
      category: 'style',
      severity: 'low',
      description: 'Class name "userFormatter" should use PascalCase',
    },
    {
      filePath: '/src/services/export-helper.ts',
      startLine: 3,
      endLine: 3,
      category: 'documentation',
      severity: 'low',
      description: 'TODO comment found at line 3',
    },
    {
      filePath: '/src/services/export-helper.ts',
      startLine: 4,
      endLine: 4,
      category: 'style',
      severity: 'low',
      description: 'console.log left in production code',
    },
    {
      filePath: '/src/services/export-helper.ts',
      startLine: 7,
      endLine: 7,
      category: 'documentation',
      severity: 'medium',
      description: 'FIXME comment found at line 7',
    },
    {
      filePath: '/src/services/export-helper.ts',
      startLine: 8,
      endLine: 8,
      category: 'style',
      severity: 'low',
      description: 'console.log left in production code',
    },
    {
      filePath: '/src/services/export-helper.ts',
      startLine: 13,
      endLine: 13,
      category: 'documentation',
      severity: 'low',
      description: 'TODO comment found at line 13',
    },
  ],
  expectedFalsePositives: [],
};

// ---------------------------------------------------------------------------
// Architecture Cases (2)
// ---------------------------------------------------------------------------

const BENCH_ARCH_001: BenchmarkCase = {
  id: 'pr-arch-001',
  language: 'typescript',
  description: 'API v1 route handler modified — architecture contract risk',
  files: [
    {
      filePath: '/src/api/v1/users.ts',
      beforeContent: '',
      afterContent: `import { Router } from 'express';

const router = Router();

router.get('/users/:id', async (req, res) => {
  const user = await repo.findById(req.params.id);
  res.json(user);
});

export { router };`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/api/v1/users.ts',
      startLine: 1,
      endLine: 1,
      category: 'bug',
      severity: 'high',
      description: 'API route/handler file modified — contract change risk',
    },
    {
      filePath: '/src/api/v1/users.ts',
      startLine: 6,
      endLine: 6,
      category: 'bug',
      severity: 'medium',
      description: 'Risky await findById operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_ARCH_002: BenchmarkCase = {
  id: 'pr-arch-002',
  language: 'typescript',
  description: 'Utility file deleted — architecture impact from missing dependency',
  files: [
    {
      filePath: '/src/utils/formatter.ts',
      beforeContent: `export function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}
export function formatCurrency(n: number): string {
  return '\$' + n.toFixed(2);
}`,
      afterContent: '',
    },
  ],
  groundTruth: [],
  expectedFalsePositives: [],
};

// ---------------------------------------------------------------------------
// Performance Cases (2)
// ---------------------------------------------------------------------------

const BENCH_PERF_001: BenchmarkCase = {
  id: 'pr-perf-001',
  language: 'typescript',
  description: 'Functions without return type annotations — TypeScript quality regression',
  files: [
    {
      filePath: '/src/services/lookup-service.ts',
      beforeContent: '',
      afterContent: `export function searchItems(query: string, items: any[]): any[] {
  return items.filter(item => item.name.includes(query));
}

export function fetchAndIndex(url) {
  const data = fetch(url);
  indexData(data);
  return data;
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/lookup-service.ts',
      startLine: 4,
      endLine: 4,
      category: 'style',
      severity: 'low',
      description: 'Missing return type annotation on fetchAndIndex',
    },
  ],
  expectedFalsePositives: [],
};

const BENCH_PERF_002: BenchmarkCase = {
  id: 'pr-perf-002',
  language: 'typescript',
  description: 'Service with database read and file write — I/O-intensive path without guards',
  files: [
    {
      filePath: '/src/services/report-writer.ts',
      beforeContent: '',
      afterContent: `export class ReportWriter {
  async writeDailyReport(date: string) {
    const data = await db.query('SELECT * FROM metrics WHERE date = \${date}');
    const report = this.formatReport(data);
    await fs.promises.writeFile('reports/daily.json', JSON.stringify(report));
    return report;
  }

  private formatReport(data: any[]) {
    return data.map(item => ({
      id: item.id,
      value: item.value,
      timestamp: item.timestamp,
    }));
  }
}`,
    },
  ],
  groundTruth: [
    {
      filePath: '/src/services/report-writer.ts',
      startLine: 3,
      endLine: 3,
      category: 'bug',
      severity: 'medium',
      description: 'Risky database query operation without try/catch error handling',
    },
    {
      filePath: '/src/services/report-writer.ts',
      startLine: 5,
      endLine: 5,
      category: 'bug',
      severity: 'medium',
      description: 'Risky writeFile operation without try/catch error handling',
    },
  ],
  expectedFalsePositives: [],
};

// ---------------------------------------------------------------------------
// All Benchmark Cases
// ---------------------------------------------------------------------------

export const ALL_BENCHMARK_CASES: BenchmarkCase[] = [
  BENCH_NPE_001,
  BENCH_NPE_002,
  BENCH_NPE_003,
  BENCH_SEC_001,
  BENCH_SEC_002,
  BENCH_SEC_003,
  BENCH_THREAD_001,
  BENCH_THREAD_002,
  BENCH_QUALITY_001,
  BENCH_QUALITY_002,
  BENCH_QUALITY_003,
  BENCH_ARCH_001,
  BENCH_ARCH_002,
  BENCH_PERF_001,
  BENCH_PERF_002,
];

// ---------------------------------------------------------------------------
// Named exports for individual test access
// ---------------------------------------------------------------------------

export {
  BENCH_NPE_001,
  BENCH_NPE_002,
  BENCH_NPE_003,
  BENCH_SEC_001,
  BENCH_SEC_002,
  BENCH_SEC_003,
  BENCH_THREAD_001,
  BENCH_THREAD_002,
  BENCH_QUALITY_001,
  BENCH_QUALITY_002,
  BENCH_QUALITY_003,
  BENCH_ARCH_001,
  BENCH_ARCH_002,
  BENCH_PERF_001,
  BENCH_PERF_002,
};
