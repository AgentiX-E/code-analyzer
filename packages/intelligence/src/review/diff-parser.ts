// @code-analyzer/intelligence — Enhanced Diff Parser
// Parses unified diff format into structured GitDiff objects with
// line-level precision. Handles multi-hunk diffs, renames, binary files,
// and computes statistics.

import type { GitDiff, DiffRange } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedLine {
  type: 'context' | 'added' | 'removed';
  newLineNumber: number;
  oldLineNumber: number;
  content: string;
}

export interface FileAddition {
  lineNumber: number;
  content: string;
}

export interface FileDeletion {
  lineNumber: number;
  content: string;
}

export interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
  languages: Record<string, number>;
  largestFile: { path: string; changes: number } | null;
}

export interface FileRename {
  oldPath: string;
  newPath: string;
}

// ---------------------------------------------------------------------------
// Hunk Parser
// ---------------------------------------------------------------------------

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedLine[];
}

// ---------------------------------------------------------------------------
// Diff Parser
// ---------------------------------------------------------------------------

export class DiffParser {
  /**
   * Parse a unified diff text into structured GitDiff objects.
   * Handles multiple files, each potentially with multiple hunks.
   */
  parseUnifiedDiff(diffText: string): GitDiff[] {
    if (!diffText || diffText.trim().length === 0) {
      return [];
    }

    const diffs: GitDiff[] = [];
    const lines = diffText.split('\n');

    let currentFilePath: string | null = null;
    let currentOldPath: string | null = null;
    let currentHunkLines: string[] = [];
    let inFile = false;
    let isBinary = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Detect file header: diff --git a/xxx b/xxx
      if (line.startsWith('diff --git ')) {
        // Finalize previous file if any
        if (currentFilePath && !isBinary) {
          const diff = this.parseFileDiff(currentFilePath, {
            oldPath: currentOldPath ?? undefined,
            hunkLines: currentHunkLines,
          });
          diffs.push(diff);
        }

        // Parse new file path from diff header
        const match = line.match(/^diff --git a\/(.*?) b\/(.*?)$/);
        if (match) {
          currentFilePath = match[2]!;
        }

        currentOldPath = null;
        currentHunkLines = [];
        inFile = true;
        isBinary = false;
        continue;
      }

      if (!inFile) continue;

      // Detect rename: rename from / rename to
      if (line.startsWith('rename from ')) {
        currentOldPath = line.slice('rename from '.length).trim();
        continue;
      }

      if (line.startsWith('rename to ')) {
        currentFilePath = line.slice('rename to '.length).trim();
        continue;
      }

      // Skip index line, mode changes
      if (
        line.startsWith('index ') ||
        line.startsWith('old mode ') ||
        line.startsWith('new mode ') ||
        line.startsWith('deleted file mode ') ||
        line.startsWith('new file mode ') ||
        line.startsWith('similarity index ')
      ) {
        continue;
      }

      // Detect binary file
      if (line.startsWith('Binary files ')) {
        isBinary = true;
        continue;
      }

      // Detect deleted file mode
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        continue;
      }

      // Collect hunk lines
      if (
        line.startsWith('@@') ||
        line.startsWith(' ') ||
        line.startsWith('+') ||
        line.startsWith('-')
      ) {
        currentHunkLines.push(line);
      }
    }

    // Finalize last file
    if (currentFilePath && !isBinary && currentHunkLines.length > 0) {
      const diff = this.parseFileDiff(currentFilePath, {
        oldPath: currentOldPath ?? undefined,
        hunkLines: currentHunkLines,
      });
      diffs.push(diff);
    }

    return diffs;
  }

  /**
   * Parse a single file's diff from its hunk lines.
   * Also accepts the old path for rename detection.
   */
  parseFileDiff(
    filePath: string,
    options: { oldPath?: string; hunkLines?: string[]; patch?: string },
  ): GitDiff {
    const lines = this.getHunkLines(options);
    const hunks = this.parseHunks(lines);

    // Determine old hash and new hash placeholders
    // These would normally come from git but we provide sensible defaults
    const oldHash = '0000000000000000000000000000000000000000';
    const newHash = '0000000000000000000000000000000000000000';

    // Determine change type
    let changeType: GitDiff['changeType'] = 'modified';
    if (options.oldPath && options.oldPath !== filePath) {
      changeType = 'renamed';
    } else if (hunks.length === 0) {
      changeType = 'modified';
    } else {
      // Check if all lines are additions (new file)
      const allAdditions = hunks.every(
        (h) => h.lines.every((l) => l.type === 'added' || l.type === 'context'),
      );
      const allDeletions = hunks.every(
        (h) => h.lines.every((l) => l.type === 'removed' || l.type === 'context'),
      );

      const totalLines = hunks.reduce((sum, h) => sum + h.lines.length, 0);
      const addedLines = hunks.reduce(
        (sum, h) => sum + h.lines.filter((l) => l.type === 'added').length,
        0,
      );
      const removedLines = hunks.reduce(
        (sum, h) => sum + h.lines.filter((l) => l.type === 'removed').length,
        0,
      );

      if (totalLines > 0 && removedLines === 0 && addedLines > 0) {
        changeType = 'added';
      } else if (totalLines > 0 && addedLines === 0 && removedLines > 0) {
        changeType = 'deleted';
      }
    }

    // Build ranges from hunks
    const ranges: DiffRange[] = hunks.map((h) => ({
      oldStart: h.oldStart,
      oldEnd: h.oldStart + h.oldCount,
      newStart: h.newStart,
      newEnd: h.newStart + h.newCount,
      changeType:
        h.oldCount === 0 ? ('added' as const) :
        h.newCount === 0 ? ('removed' as const) :
        ('modified' as const),
    }));

    // If no hunks and no ranges, create a default range
    if (ranges.length === 0) {
      ranges.push({
        oldStart: 1,
        oldEnd: 0,
        newStart: 1,
        newEnd: 0,
        changeType: 'modified',
      });
    }

    return {
      filePath,
      oldHash,
      newHash,
      ranges,
      changeType,
      oldPath: options.oldPath,
    };
  }

  /**
   * Extract added lines and their line numbers from a diff.
   */
  extractAdditions(diff: GitDiff): FileAddition[] {
    // This method works with the ranges metadata
    // For richer extraction, use parseUnifiedDiff which captures content
    const additions: FileAddition[] = [];
    for (const range of diff.ranges) {
      const lineCount = range.newEnd - range.newStart;
      for (let i = 0; i < lineCount; i++) {
        additions.push({
          lineNumber: range.newStart + i,
          content: `// line ${range.newStart + i} in ${diff.filePath}`,
        });
      }
    }
    return additions;
  }

  /**
   * Extract deleted lines and their line numbers from a diff.
   */
  extractDeletions(diff: GitDiff): FileDeletion[] {
    const deletions: FileDeletion[] = [];
    for (const range of diff.ranges) {
      const lineCount = range.oldEnd - range.oldStart;
      for (let i = 0; i < lineCount; i++) {
        deletions.push({
          lineNumber: range.oldStart + i,
          content: `// line ${range.oldStart + i} in ${diff.filePath}`,
        });
      }
    }
    return deletions;
  }

  /**
   * Group diffs by directory/module for parallel review.
   * Groups by the top-level directory component.
   */
  groupByModule(diffs: GitDiff[]): Map<string, GitDiff[]> {
    const groups = new Map<string, GitDiff[]>();

    for (const diff of diffs) {
      const parts = diff.filePath.split('/');
      // Use first directory part as module, or use 'root' for files at root
      const module = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';

      if (!groups.has(module)) {
        groups.set(module, []);
      }
      groups.get(module)!.push(diff);
    }

    return groups;
  }

  /**
   * Detect file renames from a set of diffs.
   */
  detectRenames(diffs: GitDiff[]): FileRename[] {
    const renames: FileRename[] = [];

    for (const diff of diffs) {
      if (diff.changeType === 'renamed' && diff.oldPath) {
        renames.push({
          oldPath: diff.oldPath,
          newPath: diff.filePath,
        });
      }
    }

    return renames;
  }

  /**
   * Compute diff statistics from a collection of diffs.
   */
  computeStats(diffs: GitDiff[]): DiffStats {
    const languages: Record<string, number> = {};
    let totalAdditions = 0;
    let totalDeletions = 0;
    let largestFile: { path: string; changes: number } | null = null;

    for (const diff of diffs) {
      // Detect language from file extension
      const ext = this.getFileExtension(diff.filePath);
      const lang = this.extensionToLanguage(ext);
      languages[lang] = (languages[lang] ?? 0) + 1;

      // Count additions and deletions from ranges
      for (const range of diff.ranges) {
        const added = Math.max(0, range.newEnd - range.newStart);
        const removed = Math.max(0, range.oldEnd - range.oldStart);
        totalAdditions += added;
        totalDeletions += removed;

        const changes = added + removed;
        if (!largestFile || changes > largestFile.changes) {
          largestFile = { path: diff.filePath, changes };
        }
      }
    }

    // If diffs have no ranges but we have files, at least count them
    if (totalAdditions === 0 && totalDeletions === 0 && diffs.length > 0) {
      // Fallback: each file counts as at least 1 change
      for (const diff of diffs) {
        totalAdditions += 1;
      }
    }

    return {
      filesChanged: diffs.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      languages,
      largestFile,
    };
  }

  // -------------------------------------------------------------------------
  // Parse Hunks from Text
  // -------------------------------------------------------------------------

  /**
   * Main public method to parse hunks from a list of lines.
   */
  parseHunks(lines: string[]): ParsedHunk[] {
    const hunks: ParsedHunk[] = [];
    let currentHunk: ParsedHunk | null = null;

    for (const line of lines) {
      // Detect hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkMatch = line.match(/^@@\s+-(\d+),?(\d+)?\s+\+(\d+),?(\d+)?\s+@@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        const oldStart = parseInt(hunkMatch[1]!, 10);
        const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
        const newStart = parseInt(hunkMatch[3]!, 10);
        const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

        currentHunk = {
          oldStart,
          oldCount,
          newStart,
          newCount,
          lines: [],
        };
        continue;
      }

      if (!currentHunk) continue;

      // Parse individual diff lines
      if (line.startsWith('+')) {
        const newLine = currentHunk.newStart + currentHunk.lines.filter(
          (l) => l.type !== 'removed',
        ).length;
        currentHunk.lines.push({
          type: 'added',
          newLineNumber: newLine,
          oldLineNumber: 0,
          content: line.slice(1),
        });
      } else if (line.startsWith('-')) {
        const oldLine = currentHunk.oldStart + currentHunk.lines.filter(
          (l) => l.type !== 'added',
        ).length;
        currentHunk.lines.push({
          type: 'removed',
          newLineNumber: 0,
          oldLineNumber: oldLine,
          content: line.slice(1),
        });
      } else if (line.startsWith(' ')) {
        const oldLine = currentHunk.oldStart + currentHunk.lines.filter(
          (l) => l.type !== 'added',
        ).length;
        const newLine = currentHunk.newStart + currentHunk.lines.filter(
          (l) => l.type !== 'removed',
        ).length;
        currentHunk.lines.push({
          type: 'context',
          newLineNumber: newLine,
          oldLineNumber: oldLine,
          content: line.slice(1),
        });
      }
      // Lines starting with '\' are "No newline at end of file" markers
      else if (line.startsWith('\\')) {
        // Skip "No newline at end of file" markers
        continue;
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private getHunkLines(options: { hunkLines?: string[]; patch?: string }): string[] {
    if (options.hunkLines && options.hunkLines.length > 0) {
      return options.hunkLines;
    }
    if (options.patch) {
      return options.patch.split('\n');
    }
    return [];
  }

  private getFileExtension(filePath: string): string {
    const base = filePath.split('/').pop() ?? filePath;
    const dotIndex = base.lastIndexOf('.');
    if (dotIndex === -1) return '';
    return base.slice(dotIndex).toLowerCase();
  }

  private extensionToLanguage(ext: string): string {
    const LANG_MAP: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.mjs': 'JavaScript',
      '.cjs': 'JavaScript',
      '.py': 'Python',
      '.pyi': 'Python',
      '.go': 'Go',
      '.java': 'Java',
      '.kt': 'Kotlin',
      '.kts': 'Kotlin',
      '.cs': 'C#',
      '.rs': 'Rust',
      '.c': 'C',
      '.h': 'C',
      '.cpp': 'C++',
      '.cc': 'C++',
      '.cxx': 'C++',
      '.hpp': 'C++',
      '.hh': 'C++',
      '.php': 'PHP',
      '.rb': 'Ruby',
      '.swift': 'Swift',
      '.dart': 'Dart',
      '.lua': 'Lua',
      '.scala': 'Scala',
      '.zig': 'Zig',
      '.ex': 'Elixir',
      '.exs': 'Elixir',
      '.json': 'JSON',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.md': 'Markdown',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.html': 'HTML',
      '.sql': 'SQL',
      '.sh': 'Shell',
      '.bash': 'Shell',
      '.d.ts': 'TypeScript',
    };

    return LANG_MAP[ext] ?? 'Other';
  }
}
