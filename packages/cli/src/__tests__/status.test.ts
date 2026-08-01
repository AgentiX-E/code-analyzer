/**
 * Tests for the status command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getStatus, formatStatusReport, type StatusReport } from '../commands/status.js';

describe('getStatus', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = resolve(tmpdir(), `code-analyzer-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('should report project as not initialized', () => {
    const report = getStatus({ directory: testDir });
    expect(report.project.initialized).toBe(false);
    expect(report.health).toBe('unknown');
  });

  it('should report project as initialized when .code-analyzer exists', () => {
    mkdirSync(join(testDir, '.code-analyzer'), { recursive: true });
    const report = getStatus({ directory: testDir });
    expect(report.project.initialized).toBe(true);
    expect(report.health).toBe('healthy');
  });

  it('should include system information', () => {
    const report = getStatus();
    expect(report.system.platform).toBeTruthy();
    expect(report.system.hostname).toBeTruthy();
    expect(report.system.nodeVersion).toBeTruthy();
    expect(report.system.uptime).toBeGreaterThan(0);
  });

  it('should include memory information', () => {
    const report = getStatus();
    expect(report.system.memory.free).toBeGreaterThan(0);
    expect(report.system.memory.total).toBeGreaterThan(0);
    expect(report.system.memory.percentUsed).toBeGreaterThanOrEqual(0);
    expect(report.system.memory.percentUsed).toBeLessThanOrEqual(100);
  });

  it('should include timestamp', () => {
    const report = getStatus();
    expect(report.timestamp).toBeTruthy();
    expect(() => new Date(report.timestamp)).not.toThrow();
  });

  it('should include index information', () => {
    const report = getStatus();
    expect(report.index).toBeDefined();
    expect(typeof report.index.hasIndex).toBe('boolean');
    expect(report.index.nodeCount).toBe(0);
  });

  it('should detect standards.json', () => {
    mkdirSync(join(testDir, '.code-analyzer'), { recursive: true });
    const report = getStatus({ directory: testDir });
    expect(report.project.standardsExist).toBe(false);
  });

  it('should default to current working directory', () => {
    const report = getStatus();
    expect(report).toBeDefined();
    expect(report.system).toBeDefined();
  });
});

describe('formatStatusReport', () => {
  const sampleReport: StatusReport = {
    system: {
      platform: 'linux',
      hostname: 'build-server-01',
      nodeVersion: 'v22.13.0',
      uptime: 7200,
      memory: {
        free: 8589934592,
        total: 17179869184,
        percentUsed: 50,
      },
    },
    project: {
      initialized: true,
      configDir: '/home/user/project/.code-analyzer',
      dataDir: '/home/user/project/.code-analyzer/data',
      dataSize: 1048576,
      standardsExist: true,
    },
    index: {
      hasIndex: true,
      lastIndexed: '2026-07-23T10:00:00Z',
      nodeCount: 15000,
      edgeCount: 32000,
      fileCount: 500,
    },
    health: 'healthy',
    timestamp: '2026-07-23T12:00:00Z',
  };

  it('should format as JSON', () => {
    const output = formatStatusReport(sampleReport, 'json');
    const parsed = JSON.parse(output);
    expect(parsed.health).toBe('healthy');
    expect(parsed.system.platform).toBe('linux');
  });

  it('should format as text', () => {
    const output = formatStatusReport(sampleReport, 'text');
    expect(output).toContain('HEALTHY');
    expect(output).toContain('build-server-01');
    expect(output).toContain('v22.13.0');
    expect(output).toContain('Initialized');
    expect(output).toContain('Standards');
  });

  it('should show uninitialized project', () => {
    const uninit: StatusReport = {
      ...sampleReport,
      project: {
        ...sampleReport.project,
        initialized: false,
        configDir: null,
        dataDir: null,
        dataSize: 0,
        standardsExist: false,
      },
      index: { ...sampleReport.index, hasIndex: false, lastIndexed: null },
      health: 'unknown',
    };
    const output = formatStatusReport(uninit, 'text');
    expect(output).toContain('✗ No');
    expect(output).toContain('Not indexed');
  });

  it('should show memory in MB', () => {
    const output = formatStatusReport(sampleReport, 'text');
    expect(output).toContain('MB');
  });
});
