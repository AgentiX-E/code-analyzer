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

  it('handles diff between same commit (empty diff)', async () => {
    const head = await git.getLastCommit();
    const diffs = await git.getDiff(head, head);
    expect(diffs).toEqual([]);
  });

  it('detects new file in diff', async () => {
    // Create a new file and commit it
    fs.writeFileSync(path.join(repoPath, 'newfile.ts'), 'export const z = 1;\n', 'utf-8');
    execSync('git add newfile.ts', { cwd: repoPath });
    execSync('git commit -m "add new file"', { cwd: repoPath });

    const head = await git.getLastCommit();
    const diffs = await git.getCommitDiff(head);

    const newFile = diffs.find((d) => d.changeType === 'added');
    expect(newFile).toBeDefined();
    expect(newFile!.filePath).toBe('newfile.ts');
  });

  it('detects deleted file in diff', async () => {
    // Create and then delete a file
    fs.writeFileSync(path.join(repoPath, 'todelete.ts'), 'export const w = 1;\n', 'utf-8');
    execSync('git add todelete.ts', { cwd: repoPath });
    execSync('git commit -m "add file to delete"', { cwd: repoPath });

    fs.unlinkSync(path.join(repoPath, 'todelete.ts'));
    execSync('git add -A', { cwd: repoPath });
    execSync('git commit -m "delete file"', { cwd: repoPath });

    const head = await git.getLastCommit();
    const diffs = await git.getCommitDiff(head);

    const deleted = diffs.find((d) => d.changeType === 'deleted');
    expect(deleted).toBeDefined();
    expect(deleted!.filePath).toBe('todelete.ts');
  });

  it('detects renamed file in diff', async () => {
    // Create a file, then rename it
    fs.writeFileSync(path.join(repoPath, 'oldname.ts'), 'export const v = 1;\n', 'utf-8');
    execSync('git add oldname.ts', { cwd: repoPath });
    execSync('git commit -m "add file to rename"', { cwd: repoPath });

    execSync('git mv oldname.ts newname.ts', { cwd: repoPath });
    execSync('git commit -m "rename file"', { cwd: repoPath });

    const head = await git.getLastCommit();
    const diffs = await git.getCommitDiff(head);

    const renamed = diffs.find((d) => d.changeType === 'renamed');
    expect(renamed).toBeDefined();
    expect(renamed!.filePath).toBe('newname.ts');
  });

  it('handles diff with single-line changes (compact hunk format)', async () => {
    // Create a file at the very top with one line and change it
    fs.writeFileSync(path.join(repoPath, 'singleline.ts'), 'line 1\n', 'utf-8');
    execSync('git add singleline.ts', { cwd: repoPath });
    execSync('git commit -m "add single line file"', { cwd: repoPath });

    fs.writeFileSync(path.join(repoPath, 'singleline.ts'), 'modified line 1\n', 'utf-8');
    execSync('git add singleline.ts', { cwd: repoPath });
    execSync('git commit -m "modify single line"', { cwd: repoPath });

    const head = await git.getLastCommit();
    const diffs = await git.getCommitDiff(head);
    expect(diffs.length).toBeGreaterThanOrEqual(1);
    expect(diffs[0]!.ranges.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty workspace (no diff)', async () => {
    // Repo is clean, so workspace diff should find nothing meaningful
    // (HEAD diff of a clean workspace produces no output)
    const diffs = await git.getWorkspaceDiff();
    // In a clean workspace, git diff HEAD produces empty output => empty array
    expect(diffs).toEqual([]);
  });

  it('returns empty array for changed files between same commit', async () => {
    const head = await git.getLastCommit();
    const files = await git.getChangedFiles(head, head);
    expect(files).toEqual([]);
  });
});

describe('GitOperations — Error Handling', () => {
  let invalidPath: string;

  beforeAll(() => {
    invalidPath = path.join(os.tmpdir(), 'non-existent-repo-' + Date.now());
  });

  it('throws for git operations on non-existent directory', async () => {
    const gitOps = createGitOperations(invalidPath);

    await expect(gitOps.getLastCommit()).rejects.toThrow('Git command failed');
  });

  it('throws for getDiff on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getDiff('main', 'HEAD')).rejects.toThrow('Git command failed');
  });

  it('throws for getWorkspaceDiff on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getWorkspaceDiff()).rejects.toThrow('Git command failed');
  });

  it('throws for getCommitDiff on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getCommitDiff('HEAD')).rejects.toThrow('Git command failed');
  });

  it('throws for getMergeBase on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getMergeBase('main', 'HEAD')).rejects.toThrow(
      'Git command failed',
    );
  });

  it('throws for getChangedFiles on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getChangedFiles('main', 'HEAD')).rejects.toThrow(
      'Git command failed',
    );
  });

  it('throws for isDirty on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.isDirty()).rejects.toThrow('Git command failed');
  });

  it('returns stale on invalid repo for getStaleness', async () => {
    const gitOps = createGitOperations(invalidPath);
    const result = await gitOps.getStaleness('abc123');
    expect(result.isStale).toBe(true);
    expect(result.reason).toBe('Unable to determine staleness');
  });

  it('throws for getFileContent on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getFileContent('HEAD', 'file.ts')).rejects.toThrow(
      'File not found',
    );
  });

  it('throws for getFileHash on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getFileHash('HEAD', 'file.ts')).rejects.toThrow(
      'Git command failed',
    );
  });

  it('throws for listBranches on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.listBranches()).rejects.toThrow('Git command failed');
  });

  it('throws for getCurrentBranch on non-existent repo', async () => {
    const gitOps = createGitOperations(invalidPath);
    await expect(gitOps.getCurrentBranch()).rejects.toThrow('Git command failed');
  });

  it('lists branches in empty repo (no commits)', () => {
    const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-git-'));
    execSync('git init', { cwd: emptyRepo });
    const gitOps = createGitOperations(emptyRepo);
    // Since git log may return empty if there are no commits, listBranches
    // should return an empty array or throw depending on git version
    return gitOps.listBranches().then(
      (branches) => {
        expect(Array.isArray(branches)).toBe(true);
        fs.rmSync(emptyRepo, { recursive: true, force: true });
      },
      () => {
        fs.rmSync(emptyRepo, { recursive: true, force: true });
      },
    );
  });
});
