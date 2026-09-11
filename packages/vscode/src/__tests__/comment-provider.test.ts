// @code-analyzer/vscode — Comment Provider Tests

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CommentLogic } from '../providers/comment-provider.js';
import { EngineBridge } from '../services/engine-bridge.js';

function run(cwd: string, command: string): void {
  execSync(command, { cwd, stdio: 'pipe' });
}

/** A git repository with one commit, built from the given files. */
function createRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vscode-comment-'));
  run(dir, 'git init -q');
  run(dir, 'git config user.email tester@example.com');
  run(dir, 'git config user.name Tester');
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
  run(dir, 'git add -A');
  run(dir, 'git commit -qm init');
  return dir;
}

/** Source with a function long enough to trip the >50-line heuristic. */
function longFunction(name: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `  const v${i} = ${i};`).join('\n');
  return `export function ${name}() {\n${body}\n  return 0;\n}\n`;
}

describe('CommentLogic', () => {
  const logic = new CommentLogic(new EngineBridge());

  // -------------------------------------------------------------------------
  // mapSeverity
  // -------------------------------------------------------------------------

  describe('mapSeverity', () => {
    it('maps critical to error', () => {
      expect(logic.mapSeverity('critical')).toBe('error');
    });

    it('maps high to warning', () => {
      expect(logic.mapSeverity('high')).toBe('warning');
    });

    it('maps medium to information', () => {
      expect(logic.mapSeverity('medium')).toBe('information');
    });

    it('maps low to hint', () => {
      expect(logic.mapSeverity('low')).toBe('hint');
    });

    it('maps info to hint', () => {
      expect(logic.mapSeverity('info')).toBe('hint');
    });

    it('maps unknown severity to information', () => {
      expect(logic.mapSeverity('unknown')).toBe('information');
    });
  });

  // -------------------------------------------------------------------------
  // mapCommentsToDiagnostics
  // -------------------------------------------------------------------------

  describe('mapCommentsToDiagnostics', () => {
    it('converts empty array', () => {
      const result = logic.mapCommentsToDiagnostics([]);
      expect(result).toEqual([]);
    });

    it('converts a single comment to diagnostic', () => {
      const comments = [
        {
          severity: 'high',
          title: 'Missing error handling',
          path: 'src/auth.ts',
          startLine: 42,
          endLine: 45,
          message: 'Missing error handling in login function',
        },
      ];
      const result = logic.mapCommentsToDiagnostics(comments);
      expect(result.length).toBe(1);
      expect(result[0]).toBeDefined();
      expect(result[0]!.filePath).toBe('src/auth.ts');
      expect(result[0]!.severity).toBe('warning');
      expect(result[0]!.source).toBe('Code Analyzer');
    });

    it('adjusts line numbers to 0-based', () => {
      const comments = [
        {
          severity: 'medium',
          title: 'Long function',
          path: 'src/utils.ts',
          startLine: 10,
          endLine: 20,
          message: 'Function is too long',
        },
      ];
      const result = logic.mapCommentsToDiagnostics(comments);
      expect(result[0]!.range.startLine).toBe(9);
      expect(result[0]!.range.endLine).toBe(19);
    });

    it('prefixes message with [Code Analyzer]', () => {
      const comments = [
        {
          severity: 'low',
          title: 'Naming',
          path: 'src/app.ts',
          startLine: 1,
          endLine: 1,
          message: 'Use camelCase naming',
        },
      ];
      const result = logic.mapCommentsToDiagnostics(comments);
      expect(result[0]!.message).toContain('[Code Analyzer]');
    });

    it('converts multiple comments', () => {
      const comments = [
        {
          severity: 'critical',
          title: 'Issue 1',
          path: 'a.ts',
          startLine: 1,
          endLine: 1,
          message: 'msg1',
        },
        {
          severity: 'high',
          title: 'Issue 2',
          path: 'b.ts',
          startLine: 5,
          endLine: 10,
          message: 'msg2',
        },
        {
          severity: 'low',
          title: 'Issue 3',
          path: 'a.ts',
          startLine: 20,
          endLine: 25,
          message: 'msg3',
        },
      ];
      const result = logic.mapCommentsToDiagnostics(comments);
      expect(result.length).toBe(3);
    });

    it('handles single-line comments (startLine === endLine)', () => {
      const comments = [
        {
          severity: 'medium',
          title: 'Note',
          path: 'x.ts',
          startLine: 5,
          endLine: 5,
          message: 'Single line',
        },
      ];
      const result = logic.mapCommentsToDiagnostics(comments);
      expect(result[0]!.range.startLine).toBe(4);
      expect(result[0]!.range.endLine).toBe(4);
    });

    it('ensures line numbers are not negative', () => {
      const comments = [
        {
          severity: 'info',
          title: 'Edge',
          path: 'x.ts',
          startLine: 1,
          endLine: 1,
          message: 'Line 1',
        },
      ];
      const result = logic.mapCommentsToDiagnostics(comments);
      expect(result[0]!.range.startLine).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // groupByFile
  // -------------------------------------------------------------------------

  describe('groupByFile', () => {
    it('groups diagnostics by file path', () => {
      const diagnostics = [
        {
          range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
          message: 'A',
          severity: 'warning' as const,
          source: 'CA',
          filePath: 'a.ts',
        },
        {
          range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 0 },
          message: 'B',
          severity: 'error' as const,
          source: 'CA',
          filePath: 'a.ts',
        },
        {
          range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
          message: 'C',
          severity: 'information' as const,
          source: 'CA',
          filePath: 'b.ts',
        },
      ];

      const groups = logic.groupByFile(diagnostics);

      expect(groups.size).toBe(2);
      expect(groups.get('a.ts')?.length).toBe(2);
      expect(groups.get('b.ts')?.length).toBe(1);
    });

    it('returns empty map for empty input', () => {
      const groups = logic.groupByFile([]);
      expect(groups.size).toBe(0);
    });

    it('handles single file', () => {
      const diagnostics = [
        {
          range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
          message: 'Test',
          severity: 'hint' as const,
          source: 'CA',
          filePath: 'single.ts',
        },
      ];
      const groups = logic.groupByFile(diagnostics);
      expect(groups.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getDecoratedDiagnostics — the engine-backed entry point
  // -------------------------------------------------------------------------

  describe('getDecoratedDiagnostics', () => {
    it('returns nothing when there is no workspace to review', async () => {
      const empty = new CommentLogic(new EngineBridge({ workspaceRoot: '' }));

      expect(await empty.getDecoratedDiagnostics()).toEqual([]);
    });

    it('maps the review of the working tree onto editor diagnostics', async () => {
      const dir = createRepo({ 'src/svc.ts': 'export function short() {\n  return 1;\n}\n' });
      writeFileSync(join(dir, 'src/svc.ts'), longFunction('longOne', 60));

      const engine = new EngineBridge({ workspaceRoot: dir, store: new InMemoryGraphStore() });
      await engine.initialize();

      const diagnostics = await new CommentLogic(engine).getDecoratedDiagnostics();

      // Line 1 of the file is reported as the zero-based line 0 of the buffer,
      // and the engine's severity is mapped onto the editor's.
      expect(diagnostics).toEqual([
        {
          range: { startLine: 0, startCharacter: 0, endLine: 62, endCharacter: 0 },
          message: '[Code Analyzer] Long function: longOne',
          severity: 'information',
          source: 'Code Analyzer',
          filePath: 'src/svc.ts',
        },
        {
          range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
          message: '[Code Analyzer] Missing return type annotation',
          severity: 'hint',
          source: 'Code Analyzer',
          filePath: 'src/svc.ts',
        },
      ]);

      engine.dispose();
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
