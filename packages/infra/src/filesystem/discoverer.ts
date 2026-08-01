// @code-analyzer/infra — File Discoverer
// File system discovery with language detection and gitignore support.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getLanguageFromFilename } from '@code-analyzer/shared';

import type {
  SupportedLanguage,
  DiscoveredFile,
} from '@code-analyzer/shared';

export interface DiscoverOptions {
  excludePatterns?: string[];
  includePatterns?: string[];
  maxFileSize?: number;
  respectGitignore?: boolean;
}

export interface FileDiscoverer {
  discover(rootPath: string, options?: DiscoverOptions): Promise<DiscoveredFile[]>;
  detectLanguage(filePath: string): SupportedLanguage | null;
  matchGitignore(rootPath: string, filePath: string): boolean;
}

const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '__pycache__/**',
  '*.pyc',
  '.DS_Store',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.lock',
  '*.log',
];

export function createFileDiscoverer(): FileDiscoverer {
  function minimatch(pattern: string, str: string): boolean {
    // Simple glob matching supporting *, **, and / suffix for directories

    // If pattern ends with /, match directory contents (e.g., "ignored/" matches "ignored/anything")
    if (pattern.endsWith('/')) {
      pattern = pattern + '**';
    }

    // First replace glob wildcards with placeholders
    const placeholder = '\x00';
    let result = pattern;

    // Replace **/ first (longer match)
    result = result.replace(/\*\*\//g, placeholder + 'DS' + placeholder);

    // Replace ** (any number of segments including none)
    result = result.replace(/\*\*/g, placeholder + 'DA' + placeholder);

    // Replace * (single path segment)
    result = result.replace(/\*/g, placeholder + 'S' + placeholder);

    // Replace ? (single character not /)
    result = result.replace(/\?/g, placeholder + 'Q' + placeholder);

    // Escape regex special characters
    result = result.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // Replace placeholders with regex patterns
    result = result.replace(
      new RegExp(placeholder + 'DS' + placeholder, 'g'),
      '(?:.+/)?',
    );
    result = result.replace(
      new RegExp(placeholder + 'DA' + placeholder, 'g'),
      '.*',
    );
    result = result.replace(
      new RegExp(placeholder + 'S' + placeholder, 'g'),
      '[^/]*',
    );
    result = result.replace(
      new RegExp(placeholder + 'Q' + placeholder, 'g'),
      '[^/]',
    );

    return new RegExp(`^${result}$`).test(str);
  }

  function isExcluded(
    relativePath: string,
    excludePatterns: string[],
  ): boolean {
    for (const pattern of excludePatterns) {
      if (minimatch(pattern, relativePath)) return true;
      // Also match against basename for patterns like *.log
      const basename = path.basename(relativePath);
      if (minimatch(pattern, basename)) return true;
    }
    return false;
  }

  function matchesInclude(
    relativePath: string,
    includePatterns: string[],
  ): boolean {
    if (includePatterns.length === 0) return true;
    for (const pattern of includePatterns) {
      if (minimatch(pattern, relativePath)) return true;
      const basename = path.basename(relativePath);
      if (minimatch(pattern, basename)) return true;
    }
    return false;
  }

  function parseGitignore(rootPath: string): string[] {
    const patterns: string[] = [];
    const gitignorePath = path.join(rootPath, '.gitignore');

    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.push(trimmed);
        }
      }
    } catch {
      // No .gitignore file — ignore
    }

    return patterns;
  }

  async function discoverFiles(
    rootPath: string,
    options: DiscoverOptions = {},
  ): Promise<DiscoveredFile[]> {
    const {
      excludePatterns = DEFAULT_EXCLUDE_PATTERNS,
      includePatterns = [],
      maxFileSize = 10 * 1024 * 1024, // 10MB default
      respectGitignore = true,
    } = options;

    const resolved = path.resolve(rootPath);
    const gitignorePatterns = respectGitignore ? parseGitignore(resolved) : [];
    const allExclude = [...excludePatterns, ...gitignorePatterns];

    const results: DiscoveredFile[] = [];
    const dirsToScan: string[] = [resolved];

    while (dirsToScan.length > 0) {
      const currentDir = dirsToScan.pop()!;
      let entries: fs.Dirent[];

      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      /* v8 ignore start */
      } catch {
        // Permission denied or directory removed — skip
        continue;
      }
      /* v8 ignore stop */

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(resolved, fullPath);

        if (entry.isDirectory()) {
          if (!isExcluded(relativePath, allExclude)) {
            dirsToScan.push(fullPath);
          }
        } else if (entry.isFile()) {
          if (isExcluded(relativePath, allExclude)) continue;
          if (!matchesInclude(relativePath, includePatterns)) continue;

          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > maxFileSize) continue;
            if (stat.size <= 0) continue; // Skip empty files

            const language = getLanguageFromFilename(entry.name);

            let content = '';
            try {
              content = fs.readFileSync(fullPath, 'utf-8');
            /* v8 ignore start */
            } catch {
              // Binary or unreadable — skip
              continue;
            }
            /* v8 ignore stop */

            const hash = computeSimpleHash(content);

            results.push({
              filePath: relativePath,
              language,
              content,
              hash,
              size: stat.size,
            });
          /* v8 ignore start */
          } catch {
            // Permission denied or file removed — skip
            continue;
          }
          /* v8 ignore stop */
        }
      }
    }

    return results;
  }

  function computeSimpleHash(content: string): string {
    // Simple hash function for file content identification
    // In production this would use SHA-256, but for discoverer we keep it light
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return 'h_' + Math.abs(hash).toString(16).padStart(8, '0');
  }

  return {
    async discover(rootPath: string, options?: DiscoverOptions): Promise<DiscoveredFile[]> {
      return discoverFiles(rootPath, options);
    },

    detectLanguage(filePath: string): SupportedLanguage | null {
      return getLanguageFromFilename(filePath);
    },

    matchGitignore(rootPath: string, filePath: string): boolean {
      const patterns = parseGitignore(rootPath);
      const relativePath = path.relative(rootPath, filePath);
      return isExcluded(relativePath, patterns);
    },
  };
}
