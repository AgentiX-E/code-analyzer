// @code-analyzer/analyzer — Base C-like Language Provider
// Shared extraction logic for C-family languages (Java, Kotlin, C#, Rust, etc.)

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

export function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the end line of a brace-delimited block starting at offset.
 */
export function findBlockEnd(source: string, startOffset: number): number {
  const slice = source.slice(startOffset);
  const openPos = slice.indexOf('{');
  if (openPos === -1) return lineNumberAt(source, startOffset);

  let depth = 0;
  let inString: string | null = null;
  let inComment = false;
  let inLineComment = false;

  for (let i = openPos; i < slice.length; i++) {
    const ch = slice[i]!;
    const prev = i > 0 ? slice[i - 1]! : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inComment) {
      if (prev === '*' && ch === '/') inComment = false;
      continue;
    }

    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }

    if (prev === '/' && ch === '*') { inComment = true; continue; }
    if (prev === '/' && ch === '/') { inLineComment = true; continue; }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      if (depth === 0) {
        return lineNumberAt(source, startOffset + i);
      }
      depth--;
    }
  }

  return lineNumberAt(source, source.length);
}

/**
 * Extract class-like definitions (class, interface, enum, struct, trait, etc.)
 */
export function extractClassLike(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  keyword: string,
  tag: string,
  modifiers?: string[],
): void {
  const modPrefix = modifiers ? `(?:${modifiers.join('|')}\\s+)*` : '';
  const regex = new RegExp(`${modPrefix}(?:export\\s+)?(?:public\\s+)?(?:abstract\\s+)?(?:sealed\\s+)?${keyword}\\s+(\\w+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1]!;
    const startLine = lineNumberAt(source, match.index);
    const endLine = findBlockEnd(source, match.index + match[0].length);
    const fullLine = source.slice(match.index, source.indexOf('\n', match.index) !== -1 ? source.indexOf('\n', match.index) : source.length);
    const extendsMatch = fullLine.match(/extends\s+(\w+)/);
    const implementsMatch = fullLine.match(/implements\s+([\w\s,]+)/);

    captures.push({
      tag,
      text: `${keyword} ${name}`,
      startLine,
      endLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: {
        baseClasses: extendsMatch ? extendsMatch[1]! : '',
        interfaces: implementsMatch ? implementsMatch[1]!.replace(/\s+/g, '') : '',
        abstract: String(match[0].includes('abstract')),
        filePath,
      },
    });
  }
}

/**
 * Extract function/method definitions.
 */
export function extractFunctions(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  reservedKeywords: ReadonlySet<string>,
): void {
  // Function declarations: returnType functionName(...) {
  const funcRegex = /(?:(?:public|private|protected|static|abstract|final|virtual|override|async|unsafe|extern|native|synchronized)\s+)*(\w+(?:<[^>]*>)?)\s+(\w+)\s*\([^)]*\)\s*(?:\{[^}]*\})?\s*(?:\{|;)/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(source)) !== null) {
    const retType = match[1]!;
    const name = match[2]!;
    if (reservedKeywords.has(name)) continue;
    if (['if', 'while', 'for', 'switch', 'catch', 'with', 'lock', 'using', 'synchronized'].includes(name)) continue;
    const startLine = lineNumberAt(source, match.index);
    const isMethod = match[0].includes('{') ? match[0].indexOf('{') < match[0].length : false;
    const endLine = isMethod ? findBlockEnd(source, match.index + match[0].indexOf('{')) : startLine;

    captures.push({
      tag: CAPTURE_TAGS.FUNCTION_DEF,
      text: name,
      startLine,
      endLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: {
        returnType: retType !== name ? retType : 'void',
        async: 'false',
        filePath,
      },
    });
  }
}

/**
 * Extract method calls: obj.method(...) or method(...)
 */
export function extractCalls(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  reservedKeywords: ReadonlySet<string>,
): void {
  const callRegex = /(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(source)) !== null) {
    const name = match[1]!;
    if (reservedKeywords.has(name)) continue;
    if (/^[A-Z]/.test(name) && name === name.toUpperCase()) continue; // Skip ALL_CAPS constants
    const startLine = lineNumberAt(source, match.index);
    captures.push({
      tag: CAPTURE_TAGS.FUNCTION_CALL,
      text: name,
      startLine,
      endLine: startLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: { filePath },
    });
  }
}

/**
 * Extract variable/constant definitions.
 */
export function extractVariables(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  varKeywords: string[],
  reservedKeywords: ReadonlySet<string>,
): void {
  const kwPattern = varKeywords.join('|');
  const varRegex = new RegExp(`(?:${kwPattern})\\s+(\\w+)\\s*(?::\\s*[^=\\n]+)?\\s*=`, 'g');
  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(source)) !== null) {
    const name = match[1]!;
    if (reservedKeywords.has(name)) continue;
    const line = lineNumberAt(source, match.index);
    captures.push({
      tag: match[0].includes('const') || match[0].includes('final') || match[0].includes('val') ? CAPTURE_TAGS.CONSTANT_DEF : CAPTURE_TAGS.VARIABLE_DEF,
      text: name,
      startLine: line,
      endLine: line,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: { filePath },
    });
  }
}

/**
 * Extract decorators/annotations: @Override, #[derive(...)], etc.
 */
export function extractAnnotations(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  prefix: string,
): void {
  const escaped = escapeRegex(prefix);
  const regex = new RegExp(`${escaped}(\\w+)(?:\\([\\s\\S]*?\\))?`, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1]!;
    const startLine = lineNumberAt(source, match.index);
    captures.push({
      tag: CAPTURE_TAGS.DECORATOR,
      text: match[0],
      startLine,
      endLine: startLine,
      startByte: match.index,
      endByte: match.index + match[0].length,
      name,
      properties: { decorator: name, filePath },
    });
  }
}

/**
 * Extract doc comments: /** ... * /, /// ..., etc.
 */
export function extractDocComments(
  source: string,
  filePath: string,
  captures: UnifiedCapture[],
  pattern: RegExp,
): void {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const text = match[0];
    const startLine = lineNumberAt(source, match.index);
    const endLine = startLine + (text.match(/\n/g)?.length ?? 0);
    captures.push({
      tag: CAPTURE_TAGS.DOCSTRING,
      text,
      startLine,
      endLine,
      startByte: match.index,
      endByte: match.index + text.length,
      properties: { filePath },
    });
  }
}
