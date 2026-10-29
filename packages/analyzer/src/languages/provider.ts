// @code-analyzer/analyzer — Language Provider Interface

import type { ConstantFacts } from './constant-fold.js';
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

  /**
   * Whether the last `parse` gave up on the grammar and used its regex reader instead.
   *
   * **A fallback that is not reported is a different extraction wearing the same name.** The regex reader finds a
   * **smaller and differently-shaped set of symbols** - no comments, no imports, no annotations - and the caller sees
   * a successful parse and a shorter list. **Optional**, because a provider that has no grammar and only ever uses
   * the regex reader has nothing to report: for it the question does not arise rather than being answered "no".
   */
  readonly lastParseWasARegularExpressionFallback?: boolean;

  extractImports(source: string): ParsedImport[];

  isExported(source: string, symbolName: string): boolean;
  /**
   * Every name this file exports, in one walk.
   *
   * **The interface carried a predicate and the pipeline needed a set.** `isExported` recurses the whole tree per
   * name, so a file with 66 distinct exported names was walked 66 times - **10,036ms of a 20,908ms index on a real
   * repository.** **Optional, because a provider that cannot answer is better than one that guesses**: the phase
   * falls back to the predicate when this is absent.
   */
  exportedNames?(source: string): Set<string>;

  /**
   * The values this file's names can only ever hold, and the lines a constant condition closes.
   *
   * **Optional, and absent means "no reachability information"**, which is the direction a security analysis has to
   * fall back in: without it every assignment stays a may-definition, the analysis reports more flows, and none of
   * them is wrong about the model it was given — only about the program.
   *
   * **The question it answers is not "what is the value"** but "is there a value that is the only one this name can
   * hold". `int num = 106;` is; `param = request.getParameter(...)` is not; a name written twice is never.
   */
  extractConstantFacts?(source: string): ConstantFacts;

  readonly importSemantics: ImportSemantics;
}
