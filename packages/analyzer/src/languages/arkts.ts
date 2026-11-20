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
    // **The three productions the dialect adds**, which no TypeScript mapping names.
    return new Set([
      ...super.captureTypes(mappings),
      'struct_declaration',
      'public_field_definition',
      // **And the one that made every layout component invisible.** `Column() { … }` is not a `call_expression` in this
      // grammar - it is an `arkui_component_expression` whose children are the trailing block - so **the call mapping
      // matched `Text("hi")` inside the block and nothing matched `Column` outside it.** A component tree is drawn by
      // its containers, and the graph had a leaf with no parent.
      'arkui_component_expression',
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
    } else if (nodeType === 'arkui_component_expression') {
      // **A layout component, which is used without being called.** The grammar gives the production a `function` field
      // - the identifier before the arguments - and a `children` field holding the block, so **both halves are named
      // fields and neither can be absent**; an `if` around them would describe a grammar that does not exist.
      //
      // **Why it is a call and not a definition.** `.fontSize(20)` on the child already captures as a method call, and
      // **the container is what that chain hangs from**; leaving it out put the leaf in the graph and left nothing above
      // it, so impact analysis of a page stopped at its widgets. **`arkuiComponent` is the property that keeps the
      // distinction** - a component is not a user function, and a rule that ranks callees should be able to tell.
      const fn = node.childForFieldName('function')!;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: fn.text,
        startLine: fn.startPosition.row + 1,
        endLine: fn.endPosition.row + 1,
        startByte: fn.startIndex,
        endByte: fn.endIndex,
        name: fn.text,
        properties: { filePath: this.filePath, arkuiComponent: 'true' },
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

  /**
   * **The dialect is newer than its grammar, so one statement must not cost the file.**
   *
   * The corpus in `__tests__/arkts-real-corpus.test.ts` is six real pages; **one of them is ArkTS 1.2 and spells a
   * memoised closure `wrapper = @memo () => {…}`**, which grammar 0.3.0 has no production for. The parse is correct
   * everywhere else in that file and produces **one** `ERROR` node around that statement - and **the base class read one
   * `ERROR` as "the grammar cannot read this file"**, handing the whole page to the regular-expression reader. Measured
   * on that page: **five layout components, three methods and every call under them were lost**, and what survived was
   * its struct name and its twelve imports.
   *
   * **Reading through it is the difference between a component a review can talk about and a name with no body.**
   */
  protected override readsThroughErrors(): boolean {
    return true;
  }

  /** **And the error span is exactly what a walk must not enter**, because there is no structure inside it to read. */
  protected override opaqueSubtrees(): ReadonlySet<string> {
    return ERROR_SUBTREES;
  }
}

/**
 * The one subtree an ArkTS walk steps over.
 *
 * **Shared rather than built per file**, for the same reason the empty default is: a parse is per file, and a set per
 * file is the allocation this walk exists to avoid.
 */
const ERROR_SUBTREES: ReadonlySet<string> = new Set(['ERROR']);
