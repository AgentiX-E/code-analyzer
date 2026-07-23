// @code-analyzer/cli — Status Command
// Reports the current state of Code Analyzer: index status,
// graph stats, memory usage, health checks.

import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EOL, homedir, hostname, uptime, freemem, totalmem } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusOptions {
  /** Project directory to check */
  directory?: string;
  /** Output format */
  format?: 'text' | 'json';
  /** Include detailed health report */
  verbose?: boolean;
}

export interface StatusReport {
  /** System information */
  system: {
    platform: string;
    hostname: string;
    nodeVersion: string;
    uptime: number;
    memory: {
      free: number;
      total: number;
      percentUsed: number;
    };
  };
  /** Project information */
  project: {
    initialized: boolean;
    configDir: string | null;
    dataDir: string | null;
    dataSize: number;
    standardsExist: boolean;
  };
  /** Index information */
  index: {
    hasIndex: boolean;
    lastIndexed: string | null;
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
  };
  /** Health */
  health: 'healthy' | 'degraded' | 'unknown';
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Get the current status of Code Analyzer configuration and index.
 */
export function getStatus(options: StatusOptions = {}): StatusReport {
  const targetDir = resolve(options.directory ?? process.cwd());
  const configDir = join(targetDir, '.code-analyzer');
  const dataDir = join(configDir, 'data');
  const initialized = existsSync(configDir);

  // System info
  const memFree = freemem();
  const memTotal = totalmem();

  // Project info
  let dataSize = 0;
  if (existsSync(dataDir)) {
    try {
      const stat = statSync(dataDir);
      dataSize = stat.size;
    } catch {
      // directory stats may fail
    }
  }

  const report: StatusReport = {
    system: {
      platform: process.platform,
      hostname: hostname(),
      nodeVersion: process.version,
      uptime: Math.floor(uptime()),
      memory: {
        free: memFree,
        total: memTotal,
        percentUsed: Math.round(((memTotal - memFree) / memTotal) * 100),
      },
    },
    project: {
      initialized,
      configDir: initialized ? configDir : null,
      dataDir: initialized ? dataDir : null,
      dataSize,
      standardsExist: existsSync(join(configDir, 'standards.json')),
    },
    index: {
      hasIndex: false,
      lastIndexed: null,
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
    },
    health: initialized ? 'healthy' : 'unknown',
    timestamp: new Date().toISOString(),
  };

  return report;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Format status report for display.
 */
export function formatStatusReport(
  report: StatusReport,
  format: 'text' | 'json',
): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];

  lines.push(`${'='.repeat(60)}`);
  lines.push(`Code Analyzer — Status`);
  lines.push(`${'='.repeat(60)}`);
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Health:    ${report.health.toUpperCase()}`);
  lines.push(` `);

  // System
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`System`);
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`  Platform:   ${report.system.platform}`);
  lines.push(`  Hostname:   ${report.system.hostname}`);
  lines.push(`  Node.js:    ${report.system.nodeVersion}`);
  lines.push(`  Uptime:     ${Math.floor(report.system.uptime / 3600)}h ${Math.floor((report.system.uptime % 3600) / 60)}m`);
  lines.push(`  Memory:     ${Math.round(report.system.memory.free / 1024 / 1024)}MB free / ${Math.round(report.system.memory.total / 1024 / 1024)}MB total (${report.system.memory.percentUsed}% used)`);
  lines.push(` `);

  // Project
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`Project`);
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`  Initialized:    ${report.project.initialized ? '✓ Yes' : '✗ No'}`);
  if (report.project.configDir) {
    lines.push(`  Config Dir:     ${report.project.configDir}`);
  }
  if (report.project.dataDir) {
    const dataMB = Math.round(report.project.dataSize / 1024 / 1024);
    lines.push(`  Data Dir:       ${report.project.dataDir} (${dataMB}MB)`);
  }
  lines.push(`  Standards:      ${report.project.standardsExist ? '✓ Configured' : '✗ Not configured'}`);
  lines.push(` `);

  // Index
  lines.push(`${'─'.repeat(40)}`);
  lines.push(`Index`);
  lines.push(`${'─'.repeat(40)}`);
  if (report.index.hasIndex) {
    lines.push(`  Status:         ✓ Indexed`);
    lines.push(`  Last Indexed:   ${report.index.lastIndexed}`);
    lines.push(`  Nodes:          ${report.index.nodeCount}`);
    lines.push(`  Edges:          ${report.index.edgeCount}`);
    lines.push(`  Files:          ${report.index.fileCount}`);
  } else {
    lines.push(`  Status:         ✗ Not indexed`);
    lines.push(`  Run \`code-analyzer analyze .\` to index this project.`);
  }

  lines.push(`${'='.repeat(60)}`);
  return lines.join(EOL);
}
