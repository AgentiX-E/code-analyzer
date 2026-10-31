// @code-analyzer/analyzer — Regex Provider Helpers
//
// Shared utilities for pure-regex LanguageProviders. These are plain functions
// so every regex-based parser normalizes input identically, computes 1-based
// line numbers the same way, and performs config-secret taint detection alike.

import type { TaintSource } from './tree-sitter-base.js';

/**
 * Normalize input before parsing:
 * 1. Strip a leading BOM (U+FEFF)
 * 2. Strip zero-width characters (U+200B/U+200C/U+200D) and any other BOM
 * 3. Normalize line endings (CRLF and CR) to LF
 *
 * This keeps regex parsing deterministic on files with invisible characters.
 */
export function sanitizeSource(source: string): string {
  return source
    .replace(/^\uFEFF/, '') // BOM at start
    .replace(/[\u200B\u200C\u200D]/g, '') // zero-width spaces/joiners
    .replace(/\uFEFF/g, '') // BOM anywhere
    .replace(/\r\n/g, '\n') // CRLF -> LF
    .replace(/\r/g, '\n'); // CR -> LF
}

/** 1-based line number for a byte offset within `source`. */
export function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/**
 * Line-oriented scan for configuration secrets (password/token/api_key/...).
 * Returns one TaintSource per line that contains any keyword (first match wins).
 */
export function extractSecretSources(
  source: string,
  sourceType: string,
  keywords: string[],
): TaintSource[] {
  const sources: TaintSource[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        sources.push({ name: kw, sourceType, line: i + 1, text: lines[i]!.trim(), properties: {} });
        break;
      }
    }
  }
  return sources;
}
