// @code-analyzer/analyzer — Language Provider Interface

import type { ConstantFacts } from './constant-fold.js';
import type { ContainerCall } from './container-calls.js';
import type { SourceRegion } from './regions.js';
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

  /**
   * The lines this file hands a value back to its caller from, or `null` when the grammar's returns cannot be read.
   *
   * **`null` and `[]` are different answers and the difference is the whole point.** An empty list is a file whose
   * functions all return nothing; `null` is a file this provider cannot answer for. A caller may stop assuming that a
   * call passes its argument through only in the first case, because only there is "the callee's returns do not read
   * this parameter" a fact rather than a gap.
   *
   * Optional, and absent means the same as `null` - the conservative direction.
   */
  extractReturnLines?(source: string): readonly number[] | null;

  /**
   * The calls this file makes on a container it owns, or `null` when the grammar's calls cannot be read.
   *
   * **`null` and `[]` are different answers.** An empty list is a file that puts nothing into a collection and takes
   * nothing out; `null` is a file this provider cannot answer for. A caller may stop assuming that every call whose
   * argument is tainted hands that taint to its result only in the first case.
   *
   * Optional, and absent means the same as `null` - the conservative direction.
   */
  extractContainerCalls?(source: string): readonly ContainerCall[] | null;

  /**
   * The line ranges this file's statements may not run in, or `null` when the grammar's branches cannot be read.
   *
   * **Absent means every definition stays a may-definition**, which is the answer this project gave before the fact
   * existed and the correct one when a grammar cannot say whether a statement sits inside an `if`.
   */
  extractConditionalRegions?(source: string): readonly SourceRegion[] | null;

  /**
   * The line ranges of the statements that compute a value and keep none of it, or `null` when the grammar cannot say.
   *
   * **This is what separates "the value vanished" from "the value travelled".** A bare call statement -
   * `map.put("k", param)`, `log(param)` - is the only place a value leaves the def→use graph without a name to carry
   * it, and a range list is the only shape that says which. `bar = new String(decode(encode(param)))` passes the value
   * through three calls, and every one of them belongs to one statement that writes `bar`.
   *
   * **Absent or `null` means every statement may be discarding**, which is the conservative direction: an analysis
   * that does not know asks a callee to prove its negative instead of asserting one.
   */
  extractDiscardedValueRegions?(source: string): readonly SourceRegion[] | null;

  /**
   * The line ranges of the nodes that introduce a **name scope**, or `null` when the grammar cannot say.
   *
   * **A name is not a variable, and this is the fact that separates them.** `String value` inside one loop and
   * `Element value` inside another are two variables sharing a spelling; a def→use graph keyed by spelling connects
   * the first's value to the second's sink, which is a false positive, and lets the second's write end the first's
   * value, which is a false negative. A declaration's variable is decided by the innermost region here that contains
   * its line.
   *
   * **Absent or `null` means one variable per name**, which is the answer that existed before this question was asked
   * and the correct one for a grammar whose blocks are not scopes.
   */
  extractScopeRegions?(source: string): readonly SourceRegion[] | null;

  readonly importSemantics: ImportSemantics;
}
