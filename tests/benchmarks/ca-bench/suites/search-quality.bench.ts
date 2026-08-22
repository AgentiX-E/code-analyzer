// @code-analyzer — CA-Bench: Search Quality Suite
// Measures search precision, recall, and ranking quality using
// the HybridSearchEngine with a seeded graph store.
/* v8 ignore file -- @preserve */

import type { BenchmarkSuite, BenchmarkResult } from '../runner.js';
import { measurement, makeResult } from '../reporter.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { HybridSearchEngine } from '@code-analyzer/intelligence';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

export class SearchQualitySuite implements BenchmarkSuite {
  readonly name = 'search-quality';
  readonly description = 'Measures BM25 search precision@k, recall@k, and ranking quality';

  async run(): Promise<BenchmarkResult> {
    const store = new InMemoryGraphStore();
    const engine = new HybridSearchEngine(store);

    // Seed with test nodes
    const nodes: GraphNode[] = [
      this.makeNode(
        1,
        'UserAuthentication',
        CAPTURE_TAGS.CLASS_DEF,
        'Handles user login and session management',
      ),
      this.makeNode(
        2,
        'authenticateUser',
        CAPTURE_TAGS.FUNCTION_DEF,
        'Authenticate a user with username and password',
      ),
      this.makeNode(
        3,
        'PaymentProcessor',
        CAPTURE_TAGS.CLASS_DEF,
        'Processes credit card payments',
      ),
      this.makeNode(
        4,
        'processPayment',
        CAPTURE_TAGS.FUNCTION_DEF,
        'Process a payment transaction',
      ),
      this.makeNode(
        5,
        'SessionManager',
        CAPTURE_TAGS.CLASS_DEF,
        'Manages user sessions and tokens',
      ),
      this.makeNode(6, 'createSession', CAPTURE_TAGS.FUNCTION_DEF, 'Create a new user session'),
      this.makeNode(
        7,
        'DatabaseConnection',
        CAPTURE_TAGS.CLASS_DEF,
        'Manages database connection pool',
      ),
      this.makeNode(
        8,
        'executeQuery',
        CAPTURE_TAGS.FUNCTION_DEF,
        'Execute a SQL query against the database',
      ),
      this.makeNode(9, 'FileUploader', CAPTURE_TAGS.CLASS_DEF, 'Handles file upload to S3'),
      this.makeNode(10, 'uploadFile', CAPTURE_TAGS.FUNCTION_DEF, 'Upload a file to cloud storage'),
    ];

    for (const node of nodes) {
      store.insertNode(node);
    }

    engine.initialize();

    const details: string[] = [];
    const measurements = [];

    // Test 1: Exact name search
    const exactResults = await engine.search({ query: 'authenticateUser', limit: 5 });
    const exactPrecisionAt1 =
      exactResults.length > 0 && exactResults[0]!.node.name === 'authenticateUser' ? 1.0 : 0.0;
    measurements.push(
      measurement('Exact Name Match (P@1)', exactPrecisionAt1, 'ratio', { target: 1.0, min: 1.0 }),
    );

    // Test 2: Semantic search (description-based)
    const authResults = await engine.search({ query: 'user login authentication', limit: 5 });
    const authRelevant = authResults.filter((r) =>
      ['UserAuthentication', 'authenticateUser', 'SessionManager', 'createSession'].includes(
        r.node.name,
      ),
    ).length;
    const authPrecisionAt5 =
      authResults.length > 0 ? authRelevant / Math.min(5, authResults.length) : 0;
    measurements.push(
      measurement('Auth Query P@5', authPrecisionAt5, 'ratio', { target: 0.6, min: 0.3 }),
    );

    // Test 3: Payment search
    const payResults = await engine.search({ query: 'payment processing', limit: 3 });
    const payRelevant = payResults.filter((r) =>
      ['PaymentProcessor', 'processPayment'].includes(r.node.name),
    ).length;
    const payPrecisionAt3 =
      payResults.length > 0 ? payRelevant / Math.min(3, payResults.length) : 0;
    measurements.push(
      measurement('Payment Query P@3', payPrecisionAt3, 'ratio', { target: 0.5, min: 0.3 }),
    );

    // Test 4: Recall for file-related query
    const fileResults = await engine.search({ query: 'file upload storage', limit: 5 });
    const fileRelevant = fileResults.filter((r) =>
      ['FileUploader', 'uploadFile'].includes(r.node.name),
    ).length;
    const fileRecall = fileRelevant / 2; // 2 relevant nodes
    measurements.push(
      measurement('File Query Recall', fileRecall, 'ratio', { target: 1.0, min: 0.5 }),
    );

    // Test 5: Empty query handling
    const emptyResults = await engine.search({ query: '', limit: 5 });
    measurements.push(
      measurement('Empty Query Results', emptyResults.length, 'count', { target: 0, max: 0 }),
    );

    // Test 6: Search latency
    const start = Date.now();
    await engine.search({ query: 'database connection pool', limit: 10 });
    const latencyMs = Date.now() - start;
    measurements.push(measurement('Search Latency', latencyMs, 'ms', { target: 50, max: 200 }));

    details.push(
      `Indexed ${nodes.length} nodes across 10 symbols`,
      `BM25 engine initialized with inverted index`,
    );

    return makeResult(this.name, this.description, measurements, details);
  }

  private makeNode(id: number, name: string, tag: string, signature: string): GraphNode {
    return {
      id,
      name,
      label: tag as GraphNode['label'],
      filePath: `src/${name.toLowerCase()}.ts`,
      startLine: 1,
      endLine: 5,
      signature,
      properties: { filePath: `src/${name.toLowerCase()}.ts` },
      dependencies: [],
      callers: [],
      complexity: 1,
    };
  }
}
