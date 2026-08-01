// @code-analyzer/analyzer — Language Provider Interface

import type { UnifiedCapture, ImportSemantics } from '@code-analyzer/shared';

export interface ParsedImport {
  source: string;
  names: string[];
  type: 'named' | 'default' | 'wildcard' | 'namespace';
  alias?: string;
  lineNumber: number;
}

export interface LanguageProvider {
  readonly language: string;
  readonly displayName: string;
  readonly extensions: string[];
  readonly globs: string[];

  parse(source: string, filePath: string): UnifiedCapture[];

  extractImports(source: string): ParsedImport[];

  isExported(source: string, symbolName: string): boolean;

  readonly importSemantics: ImportSemantics;
}
