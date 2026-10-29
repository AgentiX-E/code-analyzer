// @code-analyzer/analyzer — ArkTS Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { TypeScriptProvider } from './typescript.js';

import type {
  NodeTypeMapping,
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
} from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

/**
 * ArkTS, HarmonyOS's TypeScript dialect - and **the one place in this repository where the dialect needs its own grammar
 * rather than the base's.**
 *
 * **The probe that settled it**: **`@Entry @Component struct Index { ... }` parsed with `tree-sitter-typescript` produced
 * the AST `program | ERROR[@Entry ...]`** - **the whole declaration collapsed into a single error node**, because
 * **`struct` is an ArkTS keyword and TypeScript has no production for it.** **`interface` and `function` parsed fine**, so
 * **the failure was specific to the construct an ArkUI application is made of**: **every component in every `.ets` file
 * was invisible.**
 *
 * **`tree-sitter-arkts` parses it**, so **the extension is real rather than nominal** - **and everything else still comes
 * from `TypeScriptProvider`**, because **ArkTS statements, imports and expressions are TypeScript's.**
 *
 * **`.ets` is the only extension**, and **`.d.ets` is a declaration file** - **excluded for the same reason `.d.ts` is in
 * the base: a declaration has no body to capture.**
 */
export class ArkTSProvider extends TypeScriptProvider {
  override readonly language = 'arkts';
  override readonly displayName = 'ArkTS';
  override readonly extensions = ['.ets'];
  override readonly globs = ['**/*.ets', '!**/*.d.ets'];

  /**
   * **And the one production the base does not know**, because **`tree-sitter-arkts` has it and TypeScript does not**:
   * **`struct_declaration`**, which is **the construct an ArkUI application is made of.**
   *
   * **`program > struct_declaration > decorator* · type_identifier · struct_body`** - so **the name is the
   * `type_identifier`**, and **the body holds `public_field_definition` nodes**, which **are the `@State`/`@Prop` members
   * the framework binds to.**
   *
   * **Without this branch a struct produced only its decorators and its methods** - **the component itself was unnamed**,
   * so **search could not find `Index`, and impact analysis could not say which component a `<Index />` referred to.**
   *
   * **Both names are `name:` fields of their production rather than search targets** - a probe of
   * `@Entry struct Index { @State count: number = 0 }` shows `struct_declaration name: (type_identifier)` and
   * `public_field_definition name: (property_identifier)` - **so there is no absent case to guard against**, and
   * **an `if` around them would describe a grammar that does not exist.** The decorators and the accessibility
   * modifier sit beside the name and never replace it.
   */
  protected override captureTypes(mappings: NodeTypeMapping[]): ReadonlySet<string> {
    // **The two productions the dialect adds**, which no TypeScript mapping names.
    return new Set([
      ...super.captureTypes(mappings),
      'struct_declaration',
      'public_field_definition',
    ]);
  }

  protected override captureExtra(
    node: TreeSitterSyntaxNode,
    nodeType: string,
    captures: UnifiedCapture[],
  ): void {
    if (nodeType === 'struct_declaration') {
      const name = node.childForFieldName('name')!;
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: name.text,
        startLine: name.startPosition.row + 1,
        endLine: name.endPosition.row + 1,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        properties: { filePath: this.filePath, arktsStruct: 'true' },
      });
    } else if (nodeType === 'public_field_definition') {
      // **A component's state member**, which is **the thing a template binds to** - so **it belongs in the graph for the
      // same reason a field does in C#**: **a write to it is a write to something that is read elsewhere.**
      const name = node.childForFieldName('name')!;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: name.text,
        startLine: name.startPosition.row + 1,
        endLine: name.endPosition.row + 1,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        properties: { filePath: this.filePath },
      });
    }
  }

  protected override loadGrammar(): TreeSitterLanguage | null {
    // **The dialect's own grammar**, because **the base's cannot see a `struct`** - and **a component is the one thing an
    // ArkTS file is for.**
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-arkts') as TreeSitterLanguage;
  }
}
