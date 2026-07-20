// @code-analyzer/analyzer — Rust Language Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import {
  lineNumberAt,
  findBlockEnd,
  extractClassLike,
  extractAnnotations,
  extractDocComments,
} from './base-c-like.js';

const RUST_EXTENSIONS = ['.rs'];
const RUST_GLOBS = ['**/*.rs'];

const RUST_RESERVED: ReadonlySet<string> = new Set([
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern',
  'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match',
  'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static',
  'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where',
  'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do',
  'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual',
  'yield', 'try', 'union', 'dyn', 'macro_rules',
]);

export class RustProvider implements LanguageProvider {
  readonly language = 'rust';
  readonly displayName = 'Rust';
  readonly extensions = RUST_EXTENSIONS;
  readonly globs = RUST_GLOBS;
  readonly importSemantics = 'named' as const;

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    // Structs
    this.extractStructs(source, filePath, captures);

    // Enums
    extractClassLike(source, filePath, captures, 'enum', CAPTURE_TAGS.ENUM_DEF, ['pub']);

    // Traits
    extractClassLike(source, filePath, captures, 'trait', CAPTURE_TAGS.INTERFACE_DEF, ['pub', 'unsafe']);

    // Implementations
    this.extractImpls(source, filePath, captures);

    // Functions
    this.extractFunctions(source, filePath, captures);

    // Constants and statics
    this.extractConstants(source, filePath, captures);

    // Function calls
    this.extractCalls(source, filePath, captures);

    // Attributes (#[derive(...)])
    this.extractRustAttributes(source, filePath, captures);

    // Use declarations (imports)
    this.extractUses(source, filePath, captures);

    // Doc comments (///, //!, /** */)
    extractDocComments(source, filePath, captures, /\/\/\/\s*(.*)/g);
    extractDocComments(source, filePath, captures, /\/\*\*([\s\S]*?)\*\//g);

    // Sort by line
    captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
    return captures;
  }

  extractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    // use std::collections::HashMap;
    // use crate::module::{Item1, Item2};
    const useRegex = /use\s+([\w:]+(?:::[\w*]+)*)(?:\s*::\s*\{([^}]+)\})?\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = useRegex.exec(source)) !== null) {
      const basePath = match[1]!;
      const braceContent = match[2];

      if (braceContent) {
        // Multi-item import: use std::collections::{HashMap, HashSet}
        const names = braceContent.split(',').map(n => n.trim()).filter(n => n.length > 0);
        for (const name of names) {
          imports.push({
            source: `${basePath}::${name}`,
            names: [name],
            type: 'named',
            lineNumber: lineNumberAt(source, match.index),
          });
        }
      } else {
        // Single import
        const parts = basePath.split('::');
        const lastName = parts[parts.length - 1]!;
        imports.push({
          source: basePath,
          names: lastName === '*' ? [] : [lastName],
          type: lastName === '*' ? 'wildcard' : 'named',
          lineNumber: lineNumberAt(source, match.index),
        });
      }
    }

    // extern crate declarations
    const externRegex = /extern\s+crate\s+(\w+)\s*;/g;
    while ((match = externRegex.exec(source)) !== null) {
      imports.push({
        source: match[1]!,
        names: [match[1]!],
        type: 'named',
        lineNumber: lineNumberAt(source, match.index),
      });
    }

    return imports;
  }

  isExported(source: string, symbolName: string): boolean {
    const patterns = [
      new RegExp(`pub\\s+(?:fn|struct|enum|trait|mod|type|const|static|union)\\s+${symbolName}\\b`),
      new RegExp(`pub\\s*\\(\\s*crate\\s*\\)\\s+fn\\s+${symbolName}\\b`),
    ];
    return patterns.some((p) => p.test(source));
  }

  // ── Private Helpers ──

  private extractRustAttributes(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Rust attributes: #[derive(Debug)], #[cfg(test)], #![no_std]
    const attrRegex = /#!?\[(\w+)(?:\([\s\S]*?\))?\]/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(source)) !== null) {
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

  private extractStructs(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // pub struct MyStruct { ... }
    // pub struct MyStruct(...); // tuple struct
    // pub struct MyStruct; // unit struct
    const structRegex = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?struct\s+(\w+)(?:<[^>]*>)?/g;
    let match: RegExpExecArray | null;
    while ((match = structRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (RUST_RESERVED.has(name)) continue;
      const startLine = lineNumberAt(source, match.index);
      const endLine = findBlockEnd(source, match.index + match[0].length);
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `struct ${name}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { isPublic: String(match[0].includes('pub')), filePath },
      });
    }
  }

  private extractFunctions(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // pub fn function_name(...) -> ReturnType { }
    const funcRegex = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+(?:"[^"]*"\s+)?)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^{;]+))?\s*(?:\{|;)/g;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (RUST_RESERVED.has(name)) continue;
      const startLine = lineNumberAt(source, match.index);
      const hasBlock = match[0].includes('{');
      const endLine = hasBlock ? findBlockEnd(source, match.index + match[0].indexOf('{')) : startLine;

      // Detect impl block context
      const precedingText = source.slice(Math.max(0, match.index - 500), match.index);
      const implMatch = precedingText.match(/impl\s+(?:(\w+)\s+)?(?:for\s+)?(\w+)/);
      const containerName = implMatch ? (implMatch[1] || implMatch[2]) : undefined;

      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: name,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        containerName,
        properties: {
          returnType: (match[3] ?? '()').trim(),
          parameterCount: String(match[2] ? match[2].split(',').filter(p => p.trim().length > 0).length : 0),
          isPublic: String(match[0].includes('pub')),
          isAsync: String(match[0].includes('async')),
          isUnsafe: String(match[0].includes('unsafe')),
          filePath,
        },
      });
    }
  }

  private extractImpls(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // impl MyStruct { ... }
    // impl TraitName for MyStruct { ... }
    const implRegex = /impl\s*(?:<[^>]*>\s*)?(?:(\w+)\s+for\s+)?(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = implRegex.exec(source)) !== null) {
      const traitName = match[1]; // Optional trait
      const typeName = match[2]!;
      const startLine = lineNumberAt(source, match.index);
      const endLine = findBlockEnd(source, match.index + match[0].length);

      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: traitName ? `impl ${traitName} for ${typeName}` : `impl ${typeName}`,
        startLine,
        endLine,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name: typeName,
        properties: { isImpl: 'true', traitName: traitName ?? '', filePath },
      });
    }
  }

  private extractConstants(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // const MAX_SIZE: usize = 100;
    // static GLOBAL: &str = "...";
    const constRegex = /(?:pub(?:\s*\(\s*crate\s*\))?\s+)?(const|static)\s+(?:mut\s+)?(\w+)\s*:/g;
    let match: RegExpExecArray | null;
    while ((match = constRegex.exec(source)) !== null) {
      const kind = match[1]!;
      const name = match[2]!;
      if (RUST_RESERVED.has(name)) continue;
      const line = lineNumberAt(source, match.index);
      captures.push({
        tag: CAPTURE_TAGS.CONSTANT_DEF,
        text: name,
        startLine: line,
        endLine: line,
        startByte: match.index,
        endByte: match.index + match[0].length,
        name,
        properties: { kind, filePath },
      });
    }
  }

  private extractCalls(source: string, filePath: string, captures: UnifiedCapture[]): void {
    // Function/method calls, macro invocations
    const callRegex = /(\w+)\s*(?:!)?\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(source)) !== null) {
      const name = match[1]!;
      if (RUST_RESERVED.has(name)) continue;
      if (/^[A-Z]/.test(name) && name === name.toUpperCase()) continue;
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

  private extractUses(source: string, filePath: string, captures: UnifiedCapture[]): void {
    const parsedImports = this.extractImports(source);
    for (const imp of parsedImports) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: imp.source,
        startLine: imp.lineNumber,
        endLine: imp.lineNumber,
        startByte: 0,
        endByte: 0,
        name: imp.source,
        properties: { names: imp.names.join(','), importType: imp.type, filePath },
      });
    }
  }
}
