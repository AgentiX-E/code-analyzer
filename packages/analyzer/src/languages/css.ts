// @code-analyzer/analyzer — CSS Provider (regex-based parser)
//
// A pure regex provider (no tree-sitter): the `tree-sitter-css` package fails
// to load a usable `Language` object, so a tree-sitter path is unreachable dead
// code. The regex parser below handles rule sets, declarations, at-rules,
// imports, plus external-url taint sources and CSS-injection taint sinks.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type { ParsedImport, LanguageProvider } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { TaintSource, TaintSink, TaintSanitizer } from './tree-sitter-base.js';
import { sanitizeSource, lineNumber } from './regex-helpers.js';

const CSS_EXTENSIONS = ['.css', '.scss', '.less'];
const CSS_GLOBS = ['**/*.css', '**/*.scss', '**/*.less'];

/** Regexes that flag CSS-injection sinks (expression() and behavior:). */
const CSS_SINK_PATTERNS = [/expression\s*\(/gi, /behavior\s*:/gi];

export class CssProvider implements LanguageProvider {
  readonly language = 'css';
  readonly displayName = 'CSS';
  readonly extensions = CSS_EXTENSIONS;
  readonly globs = CSS_GLOBS;
  readonly importSemantics = 'none' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const sanitized = sanitizeSource(source);
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => lineNumber(sanitized, off);
    let m: RegExpExecArray | null;

    // Rule sets: selector { ... }
    const ruleRx = /([.#]?[\w\s,.:#>~+[\]="'-]+?)\s*\{/g;
    while ((m = ruleRx.exec(sanitized)) !== null) {
      const selector = m[1]!.trim();
      if (selector.length > 0 && selector !== '}' && !selector.startsWith('@')) {
        captures.push({
          tag: CAPTURE_TAGS.CLASS_DEF,
          text: selector,
          startLine: ln(m.index),
          endLine: ln(m.index + m[0].length),
          startByte: m.index,
          endByte: m.index + m[0].length,
          name: selector,
          properties: { filePath },
        });
      }
    }

    // Declarations: property: value;
    const propRx = /\s+([\w-]+)\s*:\s*([^;]+);/g;
    while ((m = propRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `${m[1]!}: ${m[2]?.trim()}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { value: m[2]!.trim(), filePath },
      });
    }

    // Imports: @import "base.css"; / @import 'base.css'; / @import url(...);
    const importRx = /@import\s+(?:url\(\s*)?["']?([^"'\s)]+)["']?\s*\)?/gi;
    while ((m = importRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'css', filePath },
      });
    }

    // At-rules: @keyframes name { ... }, @media query { ... }, etc.
    const atRuleRx = /@(keyframes|media|font-face|supports|container|page|charset|namespace)\s+(.+?)\s*\{/g;
    while ((m = atRuleRx.exec(sanitized)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `@${m[1]!} ${m[2]!.trim()}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { atRuleType: m[1]!, filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  extractImports(_source: string): ParsedImport[] {
    return [];
  }

  isExported(_source: string, _symbolName: string): boolean {
    return false;
  }

  /** Flag external http(s) url() references as external_resource taint sources. */
  extractTaintSources(source: string): TaintSource[] {
    const sanitized = sanitizeSource(source);
    const sources: TaintSource[] = [];
    const rx = /url\((https?:\/\/[^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(sanitized)) !== null) {
      sources.push({
        name: m[1]!,
        sourceType: 'external_resource',
        line: lineNumber(sanitized, m.index),
        text: m[0],
        properties: {},
      });
    }
    return sources;
  }

  /** Flag expression() and behavior: as CSS-injection taint sinks. */
  extractTaintSinks(source: string): TaintSink[] {
    const sanitized = sanitizeSource(source);
    const sinks: TaintSink[] = [];
    for (const pattern of CSS_SINK_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(sanitized)) !== null) {
        sinks.push({
          name: 'css_injection',
          sinkType: 'css_injection',
          line: lineNumber(sanitized, m.index),
          text: m[0],
          properties: {},
        });
      }
    }
    return sinks;
  }

  extractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }
}
