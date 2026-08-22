// @code-analyzer/intelligence — Taint Analysis Engine
// Implements source→sink taint tracking for security vulnerability
// detection. Supports configurable sources, sinks, and sanitizers
// across 8 programming languages.

import type { GraphEdge, KnowledgeGraph, GraphNode } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_DATA_FLOWS, EDGE_IMPORTS } from '@code-analyzer/shared';

/** Severity level for taint findings */
export type TaintSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Taint source definition */
export interface TaintSource {
  id: string;
  category: TaintCategory;
  patterns: RegExp[];
  description: string;
  severity: TaintSeverity;
  languages: string[];
}

/** Taint sink definition */
export interface TaintSink {
  id: string;
  category: TaintCategory;
  patterns: RegExp[];
  description: string;
  severity: TaintSeverity;
  languages: string[];
  cweId?: string;
}

/** Sanitizer definition */
export interface Sanitizer {
  id: string;
  patterns: RegExp[];
  description: string;
  languages: string[];
}

/** Taint category */
export type TaintCategory =
  | 'sql_injection'
  | 'xss'
  | 'command_injection'
  | 'path_traversal'
  | 'open_redirect'
  | 'ssrf'
  | 'xxe'
  | 'deserialization'
  | 'file_inclusion'
  | 'ldap_injection'
  | 'xpath_injection'
  | 'log_injection';

/** A single taint finding */
export interface TaintFinding {
  id: string;
  sourceNodeId: number;
  sinkNodeId: number;
  category: TaintCategory;
  severity: TaintSeverity;
  cweId?: string;
  sourceDescription: string;
  sinkDescription: string;
  path: number[]; // Node IDs along the taint path
  pathLength: number;
  sanitized: boolean;
  sanitizerPath?: number[];
  confidence: number; // 0.0 - 1.0
}

/** Taint analysis result */
export interface TaintAnalysisResult {
  projectId: string;
  findings: TaintFinding[];
  summary: TaintSummary;
  analysisTimeMs: number;
}

/** Summary statistics */
export interface TaintSummary {
  totalFindings: number;
  bySeverity: Record<TaintSeverity, number>;
  byCategory: Record<TaintCategory, number>;
  sanitizedRatio: number;
  averagePathLength: number;
}

// ---------------------------------------------------------------------------
// Built-in Taint Rules
// ---------------------------------------------------------------------------

const DEFAULT_SOURCES: TaintSource[] = [
  {
    id: 'user-input',
    category: 'xss',
    patterns: [
      /req\.(body|query|params|param)\b/,
      /\brequest\.(GET|POST|form|args|json|data)\b/,
      /\bprocess\.argv\b/,
      /\binput\s*\(/,
      /\bScanner\b/,
      /\bread_line\b/,
      /\bcin\b/,
      /\$_(GET|POST|REQUEST|COOKIE|SERVER)\b/,
    ],
    description: 'User-controlled input from HTTP request or CLI',
    severity: 'high',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'rust', 'php', 'ruby'],
  },
  {
    id: 'file-read',
    category: 'path_traversal',
    patterns: [
      /\bfs\.readFile\b/,
      /\bopen\s*\(/,
      /\bFileInputStream\b/,
      /\bstd::fs::read\b/,
      /\bFile\.open\b/,
      /\bfile_get_contents\b/,
    ],
    description: 'File content from filesystem read',
    severity: 'medium',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'rust', 'php', 'ruby'],
  },
  {
    id: 'network-input',
    category: 'command_injection',
    patterns: [
      /\bfetch\s*\(/,
      /\baxios\b/,
      /\brequests\.(get|post)\b/,
      /\bhttp\.Get\b/,
      /\bHttpClient\b/,
      /\bcurl_exec\b/,
    ],
    description: 'Data from network requests',
    severity: 'medium',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php'],
  },
  {
    id: 'database-input',
    category: 'sql_injection',
    patterns: [/\bdatabase\.query\b/, /\bdb\.execute\b/, /\bcursor\.fetch/, /\bquery\s*\(/],
    description: 'Data from database queries',
    severity: 'medium',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php', 'ruby'],
  },
];

const DEFAULT_SINKS: TaintSink[] = [
  {
    id: 'sql-query',
    category: 'sql_injection',
    patterns: [
      /\b(?:query|execute|exec|run)\s*\(\s*[`'"]/,
      /\b(?:query|execute|exec)\s*\(\s*(?:`|'|")\s*SELECT/,
      /\brawQuery\b/,
      /\bcreateQueryBuilder\b/,
      /\bcursor\.execute\b/,
      /\bmysql_query\b/,
      /\bpg_query\b/,
    ],
    description: 'SQL query execution with string concatenation',
    severity: 'critical',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php', 'ruby'],
    cweId: 'CWE-89',
  },
  {
    id: 'html-output',
    category: 'xss',
    patterns: [
      /\binnerHTML\b/,
      /\bdocument\.write\b/,
      /\bdangerouslySetInnerHTML\b/,
      /\bsend\s*\(\s*['"][^'"]*<[^>]+>/,
      /\bresponse\.write\b/,
      /\becho\s+(?!json_encode)/,
    ],
    description: 'Direct HTML output without sanitization',
    severity: 'high',
    languages: ['typescript', 'javascript', 'python', 'go', 'php', 'ruby'],
    cweId: 'CWE-79',
  },
  {
    id: 'shell-exec',
    category: 'command_injection',
    patterns: [
      /\bexec\s*\(/,
      /\bexecSync\b/,
      /\bspawn\s*\(/,
      /\bos\.system\b/,
      /\bsubprocess\.(?:run|call|Popen)\b/,
      /\bexec\.Command\b/,
      /\bRuntime\.exec\b/,
      /\bshell_exec\b/,
      /\bsystem\s*\(/,
      /\bpassthru\b/,
    ],
    description: 'Shell command execution with user input',
    severity: 'critical',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php', 'ruby'],
    cweId: 'CWE-78',
  },
  {
    id: 'file-write',
    category: 'path_traversal',
    patterns: [
      /\bfs\.writeFile\b/,
      /\bfs\.createWriteStream\b/,
      /\bopen\s*\(\s*['"][^'"]*['"]\s*,\s*['"]w/,
      /\bFileOutputStream\b/,
      /\bstd::fs::write\b/,
      /\bfile_put_contents\b/,
    ],
    description: 'File write with user-controlled path',
    severity: 'high',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'rust', 'php', 'ruby'],
    cweId: 'CWE-22',
  },
  {
    id: 'url-redirect',
    category: 'open_redirect',
    patterns: [
      /\bredirect\s*\(/,
      /\bresponse\.redirect\b/,
      /\bwindow\.location\b/,
      /\bheader\s*\(\s*['"]Location/,
    ],
    description: 'URL redirect with user-controlled target',
    severity: 'medium',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php'],
    cweId: 'CWE-601',
  },
  {
    id: 'deserialize',
    category: 'deserialization',
    patterns: [
      /\bJSON\.parse\b/,
      /\bpickle\.loads?\b/,
      /\byaml\.load\b(?!\w*_safe)/,
      /\bObjectInputStream\b/,
      /\bunserialize\b/,
      /\bMarshal\.load\b/,
    ],
    description: 'Deserialization of untrusted data',
    severity: 'high',
    languages: ['typescript', 'javascript', 'python', 'java', 'php', 'ruby'],
    cweId: 'CWE-502',
  },
];

const DEFAULT_SANITIZERS: Sanitizer[] = [
  {
    id: 'sql-parameterized',
    patterns: [/\?\s*,\s*\[/, /:\w+\s*=>/, /\bparameterized\b/i, /\bprepared\s+statement\b/i],
    description: 'Parameterized SQL query',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php', 'ruby'],
  },
  {
    id: 'html-escape',
    patterns: [/\bescapeHtml\b/, /\bhtmlspecialchars\b/, /\bDOMPurify\b/, /\bxss\s*\.\s*filter\b/i],
    description: 'HTML entity escaping',
    languages: ['typescript', 'javascript', 'python', 'php', 'ruby'],
  },
  {
    id: 'shell-escape',
    patterns: [/\bescapeShellArg\b/, /\bshlex\.quote\b/, /\bShellwords\.escape\b/],
    description: 'Shell argument escaping',
    languages: ['typescript', 'javascript', 'python', 'ruby'],
  },
  {
    id: 'path-sanitize',
    patterns: [/\bpath\.normalize\b/, /\bpath\.resolve\b/, /\brealpath\b/, /\bbasename\b/],
    description: 'File path normalization',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php', 'ruby'],
  },
  {
    id: 'url-validate',
    patterns: [/\bvalidUrl\b/i, /\bisSafeRedirect\b/i, /\burl\.parse\b/],
    description: 'URL validation before redirect',
    languages: ['typescript', 'javascript', 'python', 'go', 'java', 'php'],
  },
];

/**
 * TaintAnalysisEngine performs inter-procedural taint analysis
 * by tracking data flow from sources (user input, network, files)
 * to sinks (SQL, shell, HTML, etc.) through the knowledge graph.
 *
 * Algorithm:
 * 1. Identify source nodes matching source patterns
 * 2. Identify sink nodes matching sink patterns
 * 3. BFS/DFS from each source to find reachable sinks
 * 4. Check for sanitizers along the path
 * 5. Report findings with severity and confidence scoring
 */
export class TaintAnalysisEngine {
  private sources: TaintSource[];
  private sinks: TaintSink[];
  private sanitizers: Sanitizer[];
  private maxPathDepth: number;
  private maxPathsPerSource: number;

  constructor(options?: {
    sources?: TaintSource[];
    sinks?: TaintSink[];
    sanitizers?: Sanitizer[];
    maxPathDepth?: number;
    maxPathsPerSource?: number;
  }) {
    this.sources = options?.sources ?? DEFAULT_SOURCES;
    this.sinks = options?.sinks ?? DEFAULT_SINKS;
    this.sanitizers = options?.sanitizers ?? DEFAULT_SANITIZERS;
    this.maxPathDepth = options?.maxPathDepth ?? 10;
    this.maxPathsPerSource = options?.maxPathsPerSource ?? 50;
  }

  /**
   * Run taint analysis on a knowledge graph.
   *
   * @param graph — Knowledge graph to analyze
   * @param projectId — Project identifier
   * @returns Taint analysis result
   */
  analyze(graph: KnowledgeGraph, projectId: string): TaintAnalysisResult {
    const startTime = performance.now();
    const findings: TaintFinding[] = [];

    // Build efficient lookup structures
    const sourceNodes = this.identifySourceNodes(graph);
    const sinkNodes = this.identifySinkNodes(graph);
    const sanitizerNodes = this.identifySanitizerNodes(graph);

    if (sourceNodes.length === 0 || sinkNodes.length === 0) {
      return {
        projectId,
        findings: [],
        summary: this.emptySummary(),
        analysisTimeMs: performance.now() - startTime,
      };
    }

    // Build adjacency for path finding
    const adjacency = this.buildAdjacency(graph);

    // For each source, find paths to sinks
    for (const sourceMatch of sourceNodes) {
      const paths = this.findPathsToSinks(sourceMatch, sinkNodes, sanitizerNodes, adjacency, graph);

      for (const path of paths) {
        findings.push(path);
        if (findings.length >= this.maxPathsPerSource * sourceNodes.length) break;
      }

      if (findings.length >= this.maxPathsPerSource * sourceNodes.length) break;
    }

    // Deduplicate findings (same source→sink pair)
    const deduped = this.deduplicateFindings(findings);
    const summary = this.computeSummary(deduped);

    return {
      projectId,
      findings: deduped,
      summary,
      analysisTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Add a custom taint source rule.
   */
  addSource(source: TaintSource): void {
    this.sources.push(source);
  }

  /**
   * Add a custom taint sink rule.
   */
  addSink(sink: TaintSink): void {
    this.sinks.push(sink);
  }

  /**
   * Add a custom sanitizer rule.
   */
  addSanitizer(sanitizer: Sanitizer): void {
    this.sanitizers.push(sanitizer);
  }

  // ---------------------------------------------------------------------------
  // Private: Node Identification
  // ---------------------------------------------------------------------------

  private identifySourceNodes(
    graph: KnowledgeGraph,
  ): Array<{ node: GraphNode; source: TaintSource }> {
    const matches: Array<{ node: GraphNode; source: TaintSource }> = [];

    for (const [, node] of graph.nodes) {
      if (!node.signature && !node.name) continue;
      const text = (node.signature ?? '') + ' ' + (node.name ?? '');

      for (const source of this.sources) {
        if (!source.languages.includes(node.language ?? '')) continue;
        if (!source.languages.includes('*') && !source.languages.includes(node.language ?? ''))
          continue;

        for (const pattern of source.patterns) {
          if (pattern.test(text)) {
            matches.push({ node, source });
            break;
          }
        }
      }
    }

    return matches;
  }

  private identifySinkNodes(graph: KnowledgeGraph): Array<{ node: GraphNode; sink: TaintSink }> {
    const matches: Array<{ node: GraphNode; sink: TaintSink }> = [];

    for (const [, node] of graph.nodes) {
      if (!node.signature && !node.name) continue;
      const text = (node.signature ?? '') + ' ' + (node.name ?? '');

      for (const sink of this.sinks) {
        if (!sink.languages.includes(node.language ?? '')) continue;

        for (const pattern of sink.patterns) {
          if (pattern.test(text)) {
            matches.push({ node, sink });
            break;
          }
        }
      }
    }

    return matches;
  }

  private identifySanitizerNodes(graph: KnowledgeGraph): Set<number> {
    const sanitizerIds = new Set<number>();

    for (const [, node] of graph.nodes) {
      const text = (node.signature ?? '') + ' ' + (node.name ?? '');

      for (const sanitizer of this.sanitizers) {
        if (!sanitizer.languages.includes(node.language ?? '')) continue;

        for (const pattern of sanitizer.patterns) {
          if (pattern.test(text)) {
            sanitizerIds.add(node.id);
            break;
          }
        }
      }
    }

    return sanitizerIds;
  }

  // ---------------------------------------------------------------------------
  // Private: Path Finding
  // ---------------------------------------------------------------------------

  private buildAdjacency(graph: KnowledgeGraph): Map<number, number[]> {
    const adjacency = new Map<number, number[]>();

    for (const [, edge] of graph.edges) {
      // Follow CALLS and DATA_FLOWS edges
      if (edge.type === EDGE_CALLS || edge.type === EDGE_DATA_FLOWS || edge.type === EDGE_IMPORTS) {
        let neighbors = adjacency.get(edge.sourceId);
        if (!neighbors) {
          neighbors = [];
          adjacency.set(edge.sourceId, neighbors);
        }
        neighbors.push(edge.targetId);
      }
    }

    return adjacency;
  }

  private findPathsToSinks(
    source: { node: GraphNode; source: TaintSource },
    sinks: Array<{ node: GraphNode; sink: TaintSink }>,
    sanitizerIds: Set<number>,
    adjacency: Map<number, number[]>,
    _graph: KnowledgeGraph,
  ): TaintFinding[] {
    const findings: TaintFinding[] = [];
    const sinkIds = new Set(sinks.map((s) => s.node.id));

    // BFS from source. Note: cycle avoidance is handled per-path via
    // `current.path.includes(neighborId)` below — a global `visited` set must
    // NOT be used here, because it would block valid alternative paths to the
    // same sink (e.g. a diamond-shaped graph) after the first path visits an
    // intermediate node.
    const queue: Array<{
      nodeId: number;
      path: number[];
      sanitized: boolean;
      sanitizerPath: number[];
    }> = [{ nodeId: source.node.id, path: [source.node.id], sanitized: false, sanitizerPath: [] }];

    while (queue.length > 0 && findings.length < this.maxPathsPerSource) {
      const current = queue.shift()!;

      // Check if we've reached a sink
      if (sinkIds.has(current.nodeId) && current.nodeId !== source.node.id) {
        const sink = sinks.find((s) => s.node.id === current.nodeId)!;
        const confidence = this.computeConfidence(
          { sanitized: current.sanitized, pathLength: current.path.length },
          sanitizerIds,
        );

        findings.push({
          id: `taint-${source.node.id}-${current.nodeId}-${findings.length}`,
          sourceNodeId: source.node.id,
          sinkNodeId: current.nodeId,
          category: sink.sink.category,
          severity: sink.sink.severity,
          cweId: sink.sink.cweId,
          sourceDescription: source.source.description,
          sinkDescription: sink.sink.description,
          path: current.path,
          pathLength: current.path.length,
          sanitized: current.sanitized,
          sanitizerPath: current.sanitizerPath.length > 0 ? current.sanitizerPath : undefined,
          confidence,
        });

        continue;
      }

      // Stop at max depth
      if (current.path.length >= this.maxPathDepth) continue;

      // Explore neighbors
      const neighbors = adjacency.get(current.nodeId) ?? [];
      for (const neighborId of neighbors) {
        if (current.path.includes(neighborId)) continue; // No cycles within a path

        const isSanitizer = sanitizerIds.has(neighborId);
        queue.push({
          nodeId: neighborId,
          path: [...current.path, neighborId],
          sanitized: current.sanitized || isSanitizer,
          sanitizerPath: isSanitizer
            ? [...current.sanitizerPath, neighborId]
            : current.sanitizerPath,
        });
      }
    }

    return findings;
  }

  // ---------------------------------------------------------------------------
  // Private: Scoring & Helpers
  // ---------------------------------------------------------------------------

  private computeConfidence(
    path: { sanitized: boolean; pathLength: number },
    _sanitizerIds: Set<number>,
  ): number {
    // Base confidence
    let confidence = 0.8;

    // Reduce if sanitized (sanitizer may not cover all cases)
    if (path.sanitized) {
      confidence *= 0.3;
    }

    // Reduce for very long paths (less likely to be exploitable)
    if (path.pathLength > 5) {
      confidence *= 0.8;
    }
    if (path.pathLength > 8) {
      confidence *= 0.6;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private deduplicateFindings(findings: TaintFinding[]): TaintFinding[] {
    const seen = new Set<string>();
    return findings.filter((f) => {
      const key = `${f.sourceNodeId}-${f.sinkNodeId}-${f.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private computeSummary(findings: TaintFinding[]): TaintSummary {
    const bySeverity: Record<TaintSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    const byCategory: Record<TaintCategory, number> = {
      sql_injection: 0,
      xss: 0,
      command_injection: 0,
      path_traversal: 0,
      open_redirect: 0,
      ssrf: 0,
      xxe: 0,
      deserialization: 0,
      file_inclusion: 0,
      ldap_injection: 0,
      xpath_injection: 0,
      log_injection: 0,
    };
    let sanitizedCount = 0;
    let totalPathLength = 0;

    for (const finding of findings) {
      bySeverity[finding.severity]++;
      byCategory[finding.category]++;
      if (finding.sanitized) sanitizedCount++;
      totalPathLength += finding.pathLength;
    }

    return {
      totalFindings: findings.length,
      bySeverity,
      byCategory,
      sanitizedRatio: findings.length > 0 ? sanitizedCount / findings.length : 0,
      averagePathLength: findings.length > 0 ? totalPathLength / findings.length : 0,
    };
  }

  private emptySummary(): TaintSummary {
    return this.computeSummary([]);
  }
}
