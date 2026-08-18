// @code-analyzer/analyzer — Markdown Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `@tree-sitter-grammars/
// tree-sitter-markdown` package fails to load a usable `Language` object, so a
// tree-sitter path is unreachable dead code. The regex parser below handles
// headings, links, images, code blocks, lists, blockquotes, frontmatter,
// tables, and inline code, plus external-link taint source detection.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TaintSource, TaintSink, TaintSanitizer } from './tree-sitter-base.js';
import { sanitizeSource, lineNumber } from './regex-helpers.js';

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];
const MARKDOWN_GLOBS = ['**/*.md', '**/*.mdx', '**/*.markdown'];

export class MarkdownProvider implements LanguageProvider {
  readonly language = 'markdown';
  readonly displayName = 'Markdown';
  readonly extensions = MARKDOWN_EXTENSIONS;
  readonly globs = MARKDOWN_GLOBS;
  readonly importSemantics = 'none' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = sanitizeSource(source);
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => lineNumber(sanitized, off);
    let m: RegExpExecArray | null;

    // ATX headings: # ... ###### ...
    const headingRx = /^(#{1,6})\s+(.+)$/gm;
    while ((m = headingRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: m[2]!.trim(),
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[2]!.trim(),
        properties: { level: String(m[1]!.length), filePath },
      });
    }

    // Inline links: [text](url)
    const linkRx = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = linkRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { url: m[2]!, linkType: 'markdown', filePath },
      });
    }

    // Images: ![alt](url)
    const imgRx = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = imgRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: `img:${m[1]!}`,
        properties: { url: m[2]!, isImage: 'true', filePath },
      });
    }

    // Fenced code blocks: ```lang
    const codeRx = /^```(\w+)/gm;
    while ((m = codeRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: 'code-block',
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { language: m[1]!, filePath },
      });
    }

    // List items: - item or 1. item
    const listRx = /^(\s*)(?:-\s+(.+)|(\d+)\.\s+(.+))$/gm;
    while ((m = listRx.exec(sanitized)) !== null) {
      const text = (m[2] ?? m[4])!.trim();
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: text,
        properties: { isListItem: 'true', filePath },
      });
    }

    // Blockquotes: > text
    const bqRx = /^>\s+(.+)$/gm;
    while ((m = bqRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!.trim(),
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: `quote:${m[1]!.trim()}`,
        properties: { isBlockquote: 'true', filePath },
      });
    }

    // Frontmatter: leading --- ... ---
    if (sanitized.startsWith('---')) {
      const endIdx = sanitized.indexOf('---', 3);
      if (endIdx > 0) {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: 'frontmatter',
          startLine: 1,
          endLine: sanitized.slice(0, endIdx + 3).split('\n').length,
          startByte: 0,
          endByte: endIdx + 3,
          name: 'frontmatter',
          properties: { isFrontmatter: 'true', filePath },
        });
      }
    }

    // Tables: | header | ... \n | --- | ...
    const tblRx = /^\|.+\|.*\n\|[-|: ]+\|/gm;
    while ((m = tblRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: 'table',
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: 'table',
        properties: { isTable: 'true', filePath },
      });
    }

    // Inline code: `code`
    const inlineCodeRx = /`([^`]+)`/g;
    while ((m = inlineCodeRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: `code:${m[1]!}`,
        properties: { isInlineCode: 'true', filePath },
      });
    }

    return captures;
  }

  extractImports(_source: string): ParsedImport[] {
    return [];
  }

  isExported(_source: string, _symbolName: string): boolean {
    return false;
  }

  /** Flag external http(s) links as external_link taint sources. */
  extractTaintSources(source: string): TaintSource[] {
    const sanitized = sanitizeSource(source);
    const sources: TaintSource[] = [];
    const rx = /\]\((https?:\/\/[^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(sanitized)) !== null) {
      sources.push({
        name: m[1]!,
        sourceType: 'external_link',
        line: lineNumber(sanitized, m.index),
        text: m[0],
        properties: {},
      });
    }
    return sources;
  }

  extractTaintSinks(_source: string): TaintSink[] {
    return [];
  }

  extractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }
}
