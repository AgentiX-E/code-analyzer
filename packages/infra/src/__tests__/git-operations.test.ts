// @code-analyzer/infra — GitOperations Tests

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGitOperations } from '../git/git-operations.js';
import type { GitOperations } from '../git/git-operations.js';

describe('GitOperations', () => {
  let repoPath: string;
  let git: GitOperations;

  beforeAll(() => {
    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analyzer-git-test-'));
    execSync('git init', { cwd: repoPath });
    execSync('git config user.email "test@test.com"', { cwd: repoPath });
    execSync('git config user.name "Test User"', { cwd: repoPath });

    // Create initial commit
    fs.writeFileSync(path.join(repoPath, 'file1.ts'), 'const a = 1;\nconst b = 2;\n');
    fs.writeFileSync(path.join(repoPath, 'file2.ts'), 'export class Foo {}\n');
    execSync('git add -A', { cwd: repoPath });
    execSync('git commit -m "initial commit"', { cwd: repoPath });

    // Create second commit with modifications
    fs.writeFileSync(path.join(repoPath, 'file1.ts'), 'const a = 10;\nconst b = 20;\nconst c = 30;\n');
    fs.writeFileSync(path.join(repoPath, 'file3.ts'), 'export function bar() {}\n');
    execSync('git add -A', { cwd: repoPath });
    execSync('git commit -m "second commit"', { cwd: repoPath });

    git = createGitOperations(repoPath);
  });

  afterAll(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('gets last commit', async () => {
    const commit = await git.getLastCommit();
    expect(commit).toBeTruthy();
    expect(commit.length).toBe(40);
  });

  it('detects clean workspace', async () => {
    const dirty = await git.isDirty();
    expect(dirty).toBe(false);
  });

  it('detects dirty workspace', async () => {
    fs.writeFileSync(path.join(repoPath, 'file1.ts'), '// changed\n', 'utf-8');
    const dirty = await git.isDirty();
    expect(dirty).toBe(true);

    // Clean up
    execSync('git checkout -- file1.ts', { cwd: repoPath });
  });

  it('gets workspace diff', async () => {
    fs.writeFileSync(path.join(repoPath, 'file1.ts'), '// changed\n', 'utf-8');
    const diffs = await git.getWorkspaceDiff();
    expect(diffs.length).toBeGreaterThanOrEqual(1);
    expect(diffs.some((d) => d.filePath === 'file1.ts')).toBe(true);

    execSync('git checkout -- file1.ts', { cwd: repoPath });
  });

  it('gets diff between commits', async () => {
    const allCommits = execSync('git log --format=%H -n 2', { cwd: repoPath, encoding: 'utf-8' })
      .trim()
      .split('\n');

    const older = allCommits[1]!;
    const newer = allCommits[0]!;

    const diffs = await git.getDiff(older, newer);
    expect(diffs.length).toBeGreaterThanOrEqual(1);
  });

  it('gets commit diff', async () => {
    const head = await git.getLastCommit();
    const diffs = await git.getCommitDiff(head);
    expect(diffs.length).toBeGreaterThanOrEqual(1);
  });

  it('gets merge base', async () => {
    const head = await git.getLastCommit();
    const mergeBase = await git.getMergeBase(head, 'HEAD');
    expect(mergeBase).toBeTruthy();
  });

  it('gets changed files between commits', async () => {
    const allCommits = execSync('git log --format=%H -n 2', { cwd: repoPath, encoding: 'utf-8' })
      .trim()
      .split('\n');

    const older = allCommits[1]!;
    const newer = allCommits[0]!;

    const files = await git.getChangedFiles(older, newer);
    expect(files.length).toBeGreaterThan(0);
  });

  it('gets staleness result (stale)', async () => {
    const result = await git.getStaleness('0000000000000000000000000000000000000000');
    expect(result.isStale).toBe(true);
  });

  it('gets staleness result (current)', async () => {
    const head = await git.getLastCommit();
    const result = await git.getStaleness(head);
    expect(result.isStale).toBe(false);
  });

  it('gets file content at HEAD', async () => {
    const content = await git.getFileContent('HEAD', 'file1.ts');
    expect(content).toContain('const a');
  });

  it('throws for non-existent file', async () => {
    await expect(git.getFileContent('HEAD', 'nonexistent.ts')).rejects.toThrow(
      'File not found',
    );
  });

  it('gets file hash', async () => {
    const hash = await git.getFileHash('HEAD', 'file1.ts');
    expect(hash).toBeTruthy();
  });

  it('lists branches', async () => {
    const branches = await git.listBranches();
    expect(branches.length).toBeGreaterThan(0);
  });

  it('gets current branch', async () => {
    const branch = await git.getCurrentBranch();
    expect(branch).toBeTruthy();
  });

  it('handles diff with context lines', async () => {
    const head = await git.getLastCommit();
    const diffWithContext = await git.getDiff(head + '~1', head, 5);
    expect(diffWithContext.length).toBeGreaterThanOrEqual(1);
  });
});
