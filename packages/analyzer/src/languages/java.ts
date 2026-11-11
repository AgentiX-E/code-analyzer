// @code-analyzer/analyzer — Java Tree-sitter Provider

import { CAPTURE_TAGS, simpleTypeName } from '@code-analyzer/shared';

import { collectCLikeTaint } from './base-c-like.js';
import { C_FAMILY_CONSTANTS } from './constant-fold.js';
import { JAVA_CONTAINERS } from './container-calls.js';
import {
  JAVA_TAINT_VOCABULARY,
  declaredConstructedTypes,
  writesToResponseBody,
} from './java-taint.js';
import { lineOf } from './line-index.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import { ELEMENT_OF, ownerKeyOf } from '../resolution/receiver-types.js';

import type { ConstantDialect } from './constant-fold.js';
import type { ContainerDialect } from './container-calls.js';
import type { ParsedImport } from './provider.js';
import type { TaintCollections } from './taint-scan.js';
import type { TaintSink, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

const JAVA_EXTENSIONS = ['.java'];
const JAVA_GLOBS = ['**/*.java'];

/** java's names for the three node kinds the collectors need. */
const JAVA_TAINT_NODES = {
  member: ['field_access', 'method_invocation'],
  call: ['method_invocation', 'object_creation_expression'],
  argumentContainer: ['argument_list'],
};

/** The node types a Java grammar reports a comment as. */
const COMMENT_TYPES: ReadonlySet<string> = new Set(['comment', 'line_comment', 'block_comment']);

/** The two declarations a local belongs to, and the only two a parameter is ever filed under. */
const METHOD_CONTAINERS: ReadonlySet<string> = new Set([
  'method_declaration',
  'constructor_declaration',
]);

/** The node types a Java declaration's type is written as. */

/**
 * The two calls that open a stream over a container, and the container they were written on.
 *
 * **A stream is a view of one collection and holds no element of its own**, so `set.stream()` has the element of `set`.
 * Both spellings are `Iterable`'s and `Collection`'s, and neither takes an argument.
 */
const STREAM_OPENER = /^(.*)\.(?:parallel)?stream\(\)$/;

/**
 * The other way a Java file opens a stream: `Stream.of(x)`, whose elements are `x`'s.
 *
 * **One call with one argument names one container.** `Stream.of(tokens)` holds the elements of the array and
 * `Stream.of(Color.values())` holds the elements of what `values()` returns — so the lambda `anyMatch` and `filter`
 * hand it one of those, and the argument is the path this provider records. A call with several arguments
 * (`Stream.of(a, b)`) names as many elements as it passes and states no single one, so it is refused.
 */
const STREAM_OF = /^Stream\.of\(([\s\S]*)\)$/;

/** A call that passes nothing: `Color.values()` is a name whose value is what the declaration says it returns. */
const NO_ARGUMENT_CALL = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)$/;

const TYPE_NODES: ReadonlySet<string> = new Set([
  'type_identifier',
  'scoped_type_identifier',
  'generic_type',
  'array_type',
  'integral_type',
  'floating_point_type',
  'boolean_type',
  'void_type',
]);

/**
 * The first bound a `type_parameter` declares, or `undefined` when it writes none.
 *
 * **The grammar already made the distinction this needs.** `S extends IOBaseStream<T, S, B>` parses as
 * `type_parameter > (type_identifier, type_bound)`, and `T` alone has no `type_bound` at all - so the clause's presence
 * is the fact and the text is read from it rather than searched for. `T extends Number & Comparable<T>` lists two
 * named children, and the first is the class: a contract declares no body to reach, the same distinction the
 * base-class rule draws.
 *
 * `T extends` - a bound caught mid-edit - yields an empty name, which reads as no bound because a type called nothing
 * declares nothing a member could be looked up in.
 */
function firstBoundOf(parameter: TreeSitterSyntaxNode): string | undefined {
  const clause = namedChildrenOf(parameter).find((child) => child.type === 'type_bound');
  return clause === undefined
    ? undefined
    : namedChildrenOf(clause)
        .slice(0, 1)
        .map((child) => child.text)
        .join('');
}

export class JavaProvider extends TreeSitterBaseProvider {
  readonly language = 'java';
  readonly displayName = 'Java';
  readonly extensions = JAVA_EXTENSIONS;
  readonly globs = JAVA_GLOBS;
  readonly importSemantics = 'named' as const;

  /**
   * `Class` → the declared type of each field, and `Class.method` → the declared type of each local.
   *
   * **Collected during the walk and attached afterwards**, because a class capture is pushed before its body is
   * visited: the fields of `class Holder` are only known once the walk has been through the body, and a capture is
   * immutable by the time it is pushed. `decorateCaptures` is the one place that turns the two maps into the two
   * properties the resolver reads.
   */
  private readonly classFieldTypes = new Map<string, Map<string, string>>();
  private readonly localTypes = new Map<string, Map<string, string>>();

  /**
   * The type parameters this file declares, by name.
   *
   * **`T` is not a symbol in any graph, and `<T extends Widget> T pick(T a)` declares it once and writes it twice.**
   * The two writes are separate nodes at separate offsets, so position cannot suppress them - and a file that also
   * declares `class T` would have every one of them filed against that class. **Name-scoped for the reason the
   * TypeScript provider states**: following each write to the declaration that binds it is an ancestor walk per
   * reference, spent to avoid a lookup the resolver answers with nothing anyway.
   */
  private readonly typeParameterNames = new Set<string>();

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-java is a direct dependency of the analyzer, so this
    // require never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-java') as TreeSitterLanguage;
  }

  /** Every identifier under `node`, in document order, without descending again where the walk will arrive. */
  private namesUnder(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode[] {
    const out: TreeSitterSyntaxNode[] = [];
    const visit = (current: TreeSitterSyntaxNode): void => {
      if (current.type === 'identifier') {
        out.push(current);
        return;
      }
      for (const child of namedChildrenOf(current)) visit(child);
    };
    visit(node);
    return out;
  }

  /**
   * Record every name under `node` as a use, on the line the statement begins.
   *
   * **`anchorLine` is the statement's line, not the identifier's.** A statement is a line: `prepareStatement(` on one
   * line and its arguments wrapped one per line below it is a single statement, and the CFG keys facts by line. When
   * each name carried its own line, the sink was filed under the line the callee starts on and the value it consumes
   * under a later one, so a taint wave and the sink it should have reached never occupied the same statement.
   *
   * Measured on OWASP Benchmark: 409 of the corpus's misses had a source and a sink in the same function and no flow
   * between them, and the corpus is formatted by a tool that wraps long argument lists. The two cases in
   * `java-assignment-flow.test.ts` are this shape reduced to one function.
   */
  private captureAccesses(
    node: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
    anchorLine: number,
    argIndex?: number,
  ): void {
    for (const name of this.namesUnder(node)) {
      // **A node the parser inserted carries no text**, and a name of no characters names nothing: `Foo::<String>;`
      // is caught mid-edit, the grammar repairs it with `(MISSING identifier)`, and the access it would record is an
      // edge from the statement to the empty string.
      if (name.text.length === 0) continue;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_ACCESS,
        text: name.text,
        startLine: anchorLine,
        endLine: anchorLine,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        properties:
          argIndex === undefined
            ? { filePath: this.filePath }
            : { filePath: this.filePath, argIndex: String(argIndex) },
      });
    }
  }

  /**
   * Record a call's arguments, **each name tagged with the argument it sits in**.
   *
   * Document order alone cannot say which argument a name belongs to, and the caller needs the position: a callee's
   * summary is a statement about an *argument position*, so a name recorded without one cannot be matched to a
   * parameter at all. `foo(a + b, c)` passes two arguments and reads three names, and only the position separates the
   * first two from the third.
   */
  private captureArgumentAccesses(
    list: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
    anchorLine: number,
  ): void {
    const argumentsOfCall = namedChildrenOf(list);
    for (let index = 0; index < argumentsOfCall.length; index++) {
      this.captureAccesses(argumentsOfCall[index]!, captures, anchorLine, index);
    }
  }

  /**
   * Record a def for each parameter of a function, which is what makes a parameter a binding.
   *
   * `attachArgumentBindings` resolves a call's arguments against the function's bindings, so without this a parameter
   * passed to a callee is recorded as `-1` and the taint the interprocedural wave carries - "parameter 0 of this
   * function" - can never be matched to the sink that receives it.
   *
   * **The name is a `name:` field, not the first identifier found**: `void m(Widget w)` is
   * `formal_parameter type: (type_identifier) name: (identifier)`, so **a search for the first identifier bound the
   * type**. A Java parameter always carries a name, and `method_declaration`/`constructor_declaration` always carry
   * their `formal_parameters`, so neither needs a guard.
   *
   * **`String... parts` is the one parameter that does not carry the field**: it is a `spread_parameter` wrapping a
   * `variable_declarator name: (identifier)`, so the name is read from the declarator there - **and `variableNameNode`
   * rather than a search, because that is the function that knows what a declarator's name looks like.**
   */
  private emitParameterDefs(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const list = namedChildrenOf(node).find((c) => c.type === 'formal_parameters')!;
    // **A comment between two parameters is a named child and is not a parameter.** `void run(Widget widget /* the
    // widget */, Other other)` parse-crashes without this filter: the comment reaches `variableNameNode`, which asks a
    // node with no children for its declarator. Valid Java, and a hard failure rather than a wrong answer.
    //
    // **A receiver parameter is in the list and is not a parameter a call passes.** `void run(Inner this, int size)`
    // names the enclosing instance of an inner class; it has no declarator of its own, so reaching for one threw
    // `Cannot read properties of undefined (reading 'namedChildren')` on valid Java - and counting it would have put
    // every call one argument short of the declaration it calls.
    const parameters = namedChildrenOf(list)
      .filter((parameter) => !COMMENT_TYPES.has(parameter.type))
      .filter((parameter) => parameter.type !== 'receiver_parameter')
      .map((parameter) => {
        const own = parameter.childForFieldName('name');
        const name =
          own ??
          this.variableNameNode(
            namedChildrenOf(parameter).find((c) => c.type === 'variable_declarator')!,
          );
        return { name, type: this.parameterTypeOf(parameter) };
      });
    // **A parameter's type is filed under the method that declares it**, which is the key a call site can build: the
    // call knows the class and the method, and nothing about the file the declaration lives in. Read off the node
    // itself, because this method is reached only for a method or a constructor - so the owner exists.
    const owner = this.declarationKeyOf(node);
    for (const [parameterIndex, { name, type }] of parameters.entries()) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: name.text,
        startLine: name.startPosition.row + 1,
        endLine: name.endPosition.row + 1,
        startByte: name.startIndex,
        endByte: name.endIndex,
        name: name.text,
        // **The position, which is the only handle a call site has on a parameter.** A caller passes argument 1 and
        // the callee's argument 1 is whatever it declared second; without the ordinal the two cannot be matched, and
        // the whole "does this argument reach this return" question has no answer.
        properties: {
          filePath: this.filePath,
          parameterIndex: String(parameterIndex),
          parameterOwner: owner,
          parameterType: type,
        },
      });
    }
  }

  /**
   * The type a parameter declares.
   *
   * **`String... parts` is a `spread_parameter`, and the grammar gives it no `type` field**: the type is its first
   * named child and the name lives inside a declarator. Reading only the field left every variadic parameter untyped,
   * which is the shape `StringUtils.join(…)` is most often called with.
   */
  /**
   * `hasBody` when the declaration writes one, and nothing when it states a signature alone.
   *
   * **An interface method without `default` is written and not implemented**, and the resolver reads a body as the
   * proof that a declaration is code. `IOFileFilter.accept(Path, BasicFileAttributes)` *is* code - it is the method
   * `AbstractFileFilter.preVisitDirectory` runs - while `accept(File)` beside it is a signature the class must fill.
   */
  /**
   * Record the one parameter of a lambda, **as the element of what the lambda is passed to.**
   *
   * **Every call that takes a lambda and one element names that element somewhere a declaration can be read**: on the
   * container the call is written on (`listeners.forEach(listener -> …)`), or on the callee's own first parameter
   * (`forEachObserver(observer -> …)`, whose parameter is a `FailableConsumer<Observer, IOException>`). Both are paths
   * this provider records verbatim and the resolver reads later - the container's element, or the functional
   * interface's type argument - so the two shapes are one rule with two spellings rather than a table of method names.
   * Iteration 62 shipped that table; the twenty-fifth call it did not name was the one `commons-io` needed.
   *
   * **A lambda with two parameters binds nothing.** It is a fold or a comparator, its first parameter is not the
   * element, and answering it would be the guess this provider does not make.
   */
  private recordLambdaElement(node: TreeSitterSyntaxNode): void {
    const list = node.childForFieldName('arguments');
    const receiver = node.childForFieldName('object');
    if (list === null) return;
    // **The count is asked before the children are materialised**, because this runs on every call in the checkout and
    // almost none of them passes a lambda: a call with two arguments allocates nothing here.
    if (list.namedChildCount !== 1) return;
    const lambda = list.namedChild(0);
    if (lambda.type !== 'lambda_expression') return;
    const name = this.lambdaParameterNameOf(lambda);
    if (name === undefined) return;
    // **A path and nothing else**, the same rule the call's receiver follows: `this.listeners` is a declaration,
    // `getListeners()` is a call site that states no type.
    //
    // **A call with no receiver names its container in its own declaration instead.** `forEachObserver(observer -> …)`
    // is `ObservableInputStream`'s own loop over its listeners, and the element is written on `forEachObserver`'s
    // parameter - one file away or one line away, it makes no difference to a reader that resolves the path later.
    // The path is the callee's name, and what it means is decided where the declaration is.
    const generated =
      receiver === null ? node.childForFieldName('name')?.text : this.streamSourceOf(receiver.text);
    if (generated === undefined) return;
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(generated)) return;
    this.recordLocalType(node, name, `${ELEMENT_OF}${generated}`);
  }

  /**
   * The container a stream was opened from, or the expression itself when it was not.
   *
   * **`set.stream().anyMatch(range -> range.contains(ch))` is a loop written as a call**, and the element the lambda is
   * handed is the element of `set` - the stream is a view of one collection and holds nothing of its own. `commons-io`'s
   * `AndFileFilter.accept` and `commons-lang`'s `CharSet.contains` are the same three tokens, and both were unanswered
   * because the receiver was `set.stream()` and the element rule only read paths. Stripping one `.stream()` is the
   * whole of the rule: a stream of a stream is not a thing the language has.
   */
  private streamSourceOf(receiver: string): string {
    const opened = STREAM_OPENER.exec(receiver);
    if (opened?.[1] !== undefined) return opened[1];
    // **`Stream.of(x)` is the second spelling of the same statement.** The stream is a view of `x`'s elements, so the
    // path is `x` — and when `x` is a call that passes nothing, the path is the call's own name, which the reader
    // resolves to what the declaration says it returns. A receiver with several arguments names several elements and
    // is left alone, which is the refusal this provider makes wherever a rule would have to pick one.
    const handed = STREAM_OF.exec(receiver);
    const inner = handed?.[1]?.trim();
    if (inner === undefined || inner.length === 0 || inner.includes(',')) return receiver;
    return NO_ARGUMENT_CALL.exec(inner)?.[1] ?? inner;
  }

  /** The single parameter a lambda declares, or `undefined` when it declares none or several. */
  private lambdaParameterNameOf(lambda: TreeSitterSyntaxNode): string | undefined {
    // **The parameter list is a field, and reading the first named child instead read the body of a lambda that
    // declares no parameter.** `() -> name` has one named child and it is `name` - the expression the lambda returns -
    // so the first version bound the body's identifier to the receiver's element. A test with `() -> cleanup()` passed
    // anyway, because a call is not an identifier; the shape that fails is a body written as a bare name.
    //
    // **The field is always there, and the empty list is written as an empty `inferred_parameters`.** Four malformed
    // lambdas (`-> y`, `-> -> y`, `y ->`, `->`) were parsed to check it: the grammar produces no `lambda_expression`
    // for any of them, so a guard here would be an arm nothing can reach - which is a coverage gate's way of saying the
    // guard is not a safety net but dead code.
    const declared = lambda.childForFieldName('parameters')!;
    // **A bare parameter is an `identifier` and brackets make it `inferred_parameters`**; a typed parameter is
    // `formal_parameters`, which states its own type and is left to the declaration that writes it.
    const parameters =
      declared.type === 'inferred_parameters' ? namedChildrenOf(declared) : [declared];
    const only = parameters.length === 1 ? parameters[0] : undefined;
    return only?.type === 'identifier' ? only.text : undefined;
  }

  private bodyProperty(node: TreeSitterSyntaxNode): Record<string, string> {
    return node.childForFieldName('body') === null ? {} : { hasBody: 'true' };
  }

  protected override parameterTypeOf(parameter: TreeSitterSyntaxNode): string {
    const field = parameter.childForFieldName('type');
    if (field !== null) return field.text;
    // **The shapes without the field are the two the grammar wraps, and both carry their type as a child**: a spread
    // parameter (`String... parts`) is `type ... declarator`, and a receiver parameter (`Inner this`) is `type this`.
    // A `formal_parameter` always has the field, so there is no third shape and nothing here to answer `undefined`
    // for - which is what let the capture below stop guarding a case the production cannot write.
    return namedChildrenOf(parameter).find((child) => TYPE_NODES.has(child.type))!.text;
  }

  /**
   * The class a declaration is lexically written inside, when one encloses it.
   *
   * **A class written inside a class is written inside a scope.** Java resolves a simple name in the enclosing type
   * before it looks anywhere else, so `Builder.setDirectory`'s `toPath(file, null)` names the private static method of
   * `DeferredFileOutputStream` - the class that contains the builder - and `StrategyParser.letterPattern`'s
   * `getStrategy(c, width, calendar)` names `FastDateParser`'s. Neither is a base of the class the call sits in, so a
   * graph that only knew the base chain had no way to reach them: **four pairs `javac` expected on `commons-io` and
   * `commons-lang` and this graph claimed nothing for are this one shape.**
   *
   * **The nearest container, not the outermost.** A class two deep answers the class that directly contains it, and the
   * reader walks outward one link at a time - which is the order the language resolves in.
   */
  private outerClassPropertyOf(node: TreeSitterSyntaxNode): Record<string, string> {
    const container = this.findContainerNode(node);
    if (container === null) return {};
    const name = this.findChild(container, 'identifier')?.text;
    return name === undefined || name.length === 0 ? {} : { outerClass: name };
  }

  /**
   * The two methods every enum declares and no source writes.
   *
   * **`values()` and `valueOf(String)` are members of the enum the language writes for it**, and `javac`'s attribution
   * names them: `IOCase.forName` in `apache/commons-io@2.16.1` filters its own `values()`, and the call resolved to
   * nothing because a graph that files only what the source spells has no declaration to point at. `values()` returns
   * `E[]` and `valueOf` returns `E`, which is what makes the first a container whose element is the enum and the second
   * a value of it.
   *
   * **The span is the line the enum is declared on**, the same discipline the implicit constructor follows: a capture
   * stretched over the body would become the caller of every constant initialiser in it.
   */
  private recordImplicitEnumMembers(
    node: TreeSitterSyntaxNode,
    nameNode: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
  ): void {
    const span = {
      startLine: node.startPosition.row + 1,
      endLine: node.startPosition.row + 1,
      startByte: nameNode.startIndex,
      endByte: nameNode.endIndex,
    };
    for (const [name, returnType] of [
      ['values', `${nameNode.text}[]`],
      ['valueOf', nameNode.text],
    ] as const) {
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: name,
        ...span,
        name,
        containerName: nameNode.text,
        properties: { filePath: this.filePath, implicit: 'true', returnType },
      });
    }
  }

  /**
   * The constructor the language supplies to a class that writes none, and the base constructor it calls.
   *
   * **A class with no `constructor_declaration` still has a constructor**, and it still runs its base's - `javac`'s own
   * attribution names both, which is why the oracle holds the pair. Every other arm of this walk is keyed on a
   * declaration being written, so a class that writes nothing contributed no node and no call, and the call it makes is
   * the first thing every instance of it does. Measured on `apache/commons-lang@3.14.0` and `apache/commons-io@2.16.1`,
   * that shape is **20 of the 40 pairs `javac` expected and this graph claimed nothing for**: the four `Builder` classes
   * of the concurrent initializers, `DirectoryFileComparator`, `LastModifiedFileComparator`, `CsvEscaper`,
   * `CsvUnescaper`, `StateStrategyClosed` and `BoundedInputStream.Builder`, each a two-line subclass whose entire
   * behaviour is the base's.
   *
   * **A class that extends nothing is left alone**, because the constructor it runs is `Object`'s and this graph holds
   * no declaration for it - the same refusal the written-constructor arm above makes, for the same reason. A class that
   * writes a constructor of its own is also left alone: the language then supplies nothing, and the implicit `super()`
   * of that written constructor is recorded where the constructor is.
   */
  private recordDefaultConstructor(
    node: TreeSitterSyntaxNode,
    nameNode: TreeSitterSyntaxNode,
    captures: UnifiedCapture[],
  ): void {
    const body = this.findChild(node, 'class_body');
    if (body === null) return;
    if (namedChildrenOf(body).some((child) => child.type === 'constructor_declaration')) return;
    const base = this.superclassNameOf(node);
    if (base.length === 0) return;
    const span = {
      startLine: node.startPosition.row + 1,
      // **One line, and not the class body.** A declaration's span is what a capture is attributed to, so a constructor
      // stretched over the whole class would claim every field initialiser in it - and `DEFAULT_COMPARATOR = new
      // ReverseFileComparator()` inside `DirectoryFileComparator` moved from no caller at all to a constructor that
      // calls it, which is 5 wrong edges on `apache/commons-io@2.16.1`. The constructor this node stands for is written
      // on the line the class is declared on, and that is the line it spans.
      endLine: node.startPosition.row + 1,
      startByte: nameNode.startIndex,
      endByte: nameNode.endIndex,
    };
    captures.push({
      tag: CAPTURE_TAGS.CONSTRUCTOR_DEF,
      text: nameNode.text,
      ...span,
      name: nameNode.text,
      containerName: nameNode.text,
      // **The fact that it is implicit is stated rather than inferred**, because a reader of the graph cannot tell a
      // constructor written on the class line from one the language supplied, and a coverage question about
      // constructors has to be able to.
      properties: { filePath: this.filePath, implicit: 'true' },
    });
    captures.push({
      tag: CAPTURE_TAGS.FUNCTION_CALL,
      text: base,
      ...span,
      name: base,
      properties: { filePath: this.filePath, implicitSuper: 'true' },
    });
  }

  /**
   * The class a type expression names: `ArrayList` for `ArrayList<>`, and the last segment of a qualified path.
   *
   * **A diamond is a spelling of the class and not part of its name.** `new FailableStream<>(…)` and
   * `new java.util.ArrayList<String>()` both name one class, and the graph files a class by its simple name - the
   * same reduction `import a.b.C` already performs on the way in. The walk descends through the wrappers the grammar
   * puts around a written type (`generic_type`, `scoped_type_identifier`) and stops at the last identifier, which is
   * the one that names the class.
   */
  private classNameOfType(type: TreeSitterSyntaxNode): string {
    if (type.type === 'type_identifier') return type.text;
    // **The last one, because a qualified type nests leftwards**: `java.util.ArrayList` is
    // `scoped_type_identifier(scoped_type_identifier(java, util), ArrayList)`, and the class is the rightmost name.
    const inner = namedChildrenOf(type)
      .filter((child) => TYPE_NODES.has(child.type))
      .pop();
    return inner === undefined ? type.text : this.classNameOfType(inner);
  }

  /**
   * `Strings::isEmpty` is a call that happens later, and the graph had no record of one.
   *
   * **The production is `method_reference`, not `method_invocation` with a receiver**, so every branch of this walk -
   * each of them keyed on a call - stepped past it, and a stream pipeline is written almost entirely of this shape.
   * Measured against `javac`'s own attribution, the two Java corpora hold **254 member references**, of which 254 were
   * counted separately by the oracle and **nothing at all** was claimed by the graph. The 63 that reach a declaration
   * in the checkout are a deferred call by any reading: `this::helper` runs the enclosing class's method,
   * `super::helper` the base's, and `Type::method` the method the type declares.
   *
   * **The keyword and the type are carried as the receiver rather than resolved here**, because the resolver already
   * holds the three rules that answer them - own scope, the base chain, and a class name - and a second reading of
   * the same three hops in the parser is a second answer to the same question.
   */
  private captureMethodReference(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const parts = namedChildrenOf(node);
    // The grammar requires a qualifier - `Type::m`, `expr::m`, `this::m`, `super::m` - so a reference without one is
    // not a shape Java source produces.
    const qualifier = parts[0];
    if (qualifier === undefined) return;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    // **`X::new` writes no name at all.** Its second half is the `new` keyword, so the only named child is the type,
    // and the call is a construction filed under the class's name exactly as `new X()` is.
    if (parts.length === 1) {
      const built = this.referenceClassNameOf(qualifier);
      if (built === undefined) return;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: qualifier.text,
        startLine,
        endLine,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: built,
        properties: { filePath: this.filePath },
      });
      return;
    }
    // **The last named child, because the explicit type arguments sit between the two names**:
    // `Foo::<String>bar` is `(identifier) (type_arguments) (identifier)`, and the method is still the last one.
    const written = parts[parts.length - 1]!;
    // **`(MISSING identifier)` is the half-edited reference, and it is not a name.** `Foo::<String>;` has the explicit
    // type arguments and no method after them, so the last named child is the token the parser inserted - a call site
    // to nothing, which the resolver reads as an external edge named `''`.
    if (written.type !== 'identifier' || written.text.length === 0) return;
    captures.push({
      tag: CAPTURE_TAGS.METHOD_CALL,
      text: `${qualifier.text}.${written.text}`,
      startLine,
      endLine,
      startByte: written.startIndex,
      endByte: written.endIndex,
      name: written.text,
      properties: { filePath: this.filePath },
    });
  }

  /**
   * The class a reference's qualifier names, or `undefined` when it names something the graph has no node for.
   *
   * **An array is the case that must answer nothing.** `String[]::new` constructs an array, and the graph files
   * classes and constructors - a name invented for the array would be an edge to a declaration that does not exist.
   * A qualified type is its last segment and its type arguments are dropped, the same two reductions `new X<>()` and
   * `import a.b.C` already perform.
   */
  private referenceClassNameOf(type: TreeSitterSyntaxNode): string | undefined {
    if (type.type === 'array_type') return undefined;
    const simple = simpleTypeName(type.text);
    return simple === '' ? undefined : simple;
  }

  /**
   * `Class.method` for the declaration a node sits in, or `undefined` at file or class level.
   *
   * **The climb is the node's own parents and not `findContainerNode`**, because that function answers the nearest
   * *class*: a parameter's container is its class, not its method, and the key a call site builds is both.
   *
   * **`undefined` is the answer for a local in an initializer block**, which is a binding that belongs to a class and
   * to no method: `static { int y = 2; }` declares `y` where no call can name it, and a key invented for it would be a
   * key no call site ever builds.
   */
  private methodKeyOf(node: TreeSitterSyntaxNode): string | undefined {
    // **Asked only about a local declaration, so the climb starts at its parent** - the one caller is the local case
    // of the walk, and a `local_variable_declaration` is never itself the method that owns it.
    let method: TreeSitterSyntaxNode | null = node.parent;
    while (method !== null && !METHOD_CONTAINERS.has(method.type)) method = method.parent;
    return method === null ? undefined : this.declarationKeyOf(method);
  }

  /**
   * `Class.method` plus the line the declaration starts on — **a declaration, not a name.**
   *
   * **An overload is one name and several declarations, and each may declare a parameter of the same name with a
   * different type.** `apache/commons-lang`'s `Failable` declares `accept` eleven times, and ten of them take a
   * parameter called `consumer` — `FailableConsumer`, `FailableBiConsumer`, `FailableIntConsumer` and so on. Filed by
   * name alone, the ten answers disagree, the name is dropped, and **every `consumer.accept(…)` in the class becomes
   * unanswerable** — which is 24 of the pairs javac expected and this graph claimed nothing for. A call site sits
   * inside exactly one of those declarations and the walk knows which, so the key carries the line and the answer is
   * the one the enclosing declaration states.
   */
  private declarationKeyOf(method: TreeSitterSyntaxNode): string {
    return `${this.ownerKeyOfMethod(method)}\u0000${method.startPosition.row + 1}`;
  }

  /**
   * `Class.method` for a method or constructor declaration, which always names the method.
   *
   * **The `!` on the method's own name states an invariant rather than suppressing a doubt**: `method_declaration` and
   * `constructor_declaration` are productions with a required `name:` field, so a method with no name is not a shape
   * this grammar has. The alternative was a branch no Java source can take, and a branch nobody can reach is a branch
   * no test can ask a question about.
   */
  private ownerKeyOfMethod(method: TreeSitterSyntaxNode): string {
    return ownerKeyOf(this.enclosingClassName(method), this.findChild(method, 'identifier')!.text);
  }

  /**
   * The class a declaration is written in, by name.
   *
   * **`findContainerNode` answers a container for every declaration this provider files**, because Java has no
   * declaration outside a type: a field, a method, a local and a parameter are all written inside a `class_body`,
   * `interface_body` or `enum_body` that a named type owns. The name is read from the container's own `identifier`,
   * and **`null` is a real answer there** - an anonymous class body and an enum constant body own members and name
   * nobody, which is why a field of one is recorded and filed under no class at all.
   */
  private enclosingClassName(node: TreeSitterSyntaxNode): string {
    const holder = this.findContainerNode(node)!;
    // **A container this package files a member under is a named type**, and every named type in the grammar -
    // `class_declaration`, `interface_declaration`, `enum_declaration` - carries its `name:` field, so the `!` is the
    // grammar's guarantee and not a hope. An anonymous body is not reached here because it is not a container: the
    // climb passes it and answers the type that owns it.
    return this.findChild(holder, 'identifier')!.text;
  }

  /**
   * File one field's declared type under the class that declares it.
   *
   * **The first declaration wins and a second one that disagrees drops the name**, which is the rule the resolver
   * applies to every other name: a field two declarations disagree about has no type this provider can defend.
   */
  private recordFieldType(node: TreeSitterSyntaxNode, field: string, fieldType: string): void {
    this.fileFieldType(this.enclosingClassName(node), field, fieldType);
  }

  /**
   * File one field's type under a class named by the caller, for the declarations that are not a `field_declaration`.
   *
   * **An `enum_constant` is a field the grammar does not call one.** `enum IOCase { SYSTEM("System") }` declares a
   * constant of type `IOCase` and writes no type anywhere, so `IOCase.SYSTEM.checkEquals(…)` had a receiver whose
   * class nobody had recorded — and the constant is the only reason `checkEquals` is reachable at all.
   */
  private fileFieldType(className: string, field: string, fieldType: string): void {
    let fields = this.classFieldTypes.get(className);
    if (fields === undefined) {
      fields = new Map();
      this.classFieldTypes.set(className, fields);
    }
    if (fields.has(field) && fields.get(field) !== fieldType) fields.delete(field);
    else fields.set(field, fieldType);
  }

  /**
   * The bound each of a type's parameters declares, as JSON — **empty and absent when none of them writes one.**
   *
   * **A type variable names no class, and its bound names the class it may be.** `UncheckedIOBaseStream<T, S extends
   * IOBaseStream<T, S, B>, B>` declares a field `S delegate` and calls `delegate.close()` on it: the call runs on
   * whatever `S` is, and the language guarantees it is an `IOBaseStream`. Without the bound the resolver asked for a
   * class called `S`, which is 14 unanswered calls in one file of `commons-io`.
   *
   * **Only the first bound is kept**, because a later one is an interface - `T extends Number & Comparable<T>` - and a
   * contract declares no body to reach, the same distinction the base-class rule draws. A parameter with no bound is
   * absent rather than `Object`: the source does not write one, and a member looked up in `Object` is a claim this
   * provider would be inventing.
   */
  private typeParameterBoundsOf(node: TreeSitterSyntaxNode): string {
    const bounds: Record<string, string> = {};
    for (const clause of namedChildrenOf(node).filter((c) => c.type === 'type_parameters')) {
      for (const parameter of namedChildrenOf(clause).filter((c) => c.type === 'type_parameter')) {
        // **The grammar gives every `type_parameter` a name**, and `findChild` is the declaration of that guarantee.
        const name = this.findChild(parameter, 'type_identifier')!;
        const bound = firstBoundOf(parameter);
        if (bound !== undefined && bound.length > 0) bounds[name.text] = bound;
      }
    }
    return Object.keys(bounds).length === 0 ? '' : JSON.stringify(bounds);
  }

  /** The same fact, as a property a capture carries only when the type declares one. */
  private typeParametersPropertyOf(node: TreeSitterSyntaxNode): Record<string, string> {
    const bounds = this.typeParameterBoundsOf(node);
    const names = this.typeParameterNamesOf(node);
    return {
      ...(bounds.length === 0 ? {} : { typeParameters: bounds }),
      ...(names.length === 0 ? {} : { typeParameterNames: names }),
    };
  }

  /**
   * Every type parameter's name, in the order the declaration writes them, **bounded or not.**
   *
   * **`typeParameters` answers "what is this variable a kind of", and the question here is "which one is it"**:
   * `FailableConsumer<T, E extends Exception>` writes two parameters and bounds one, so a map of bounds alone cannot
   * say that a `FailableConsumer<Observer, IOException>` hands `Observer` to a lambda - the `T` it stands for is
   * exactly the parameter that map has no entry for. The order is the whole of the answer, which is why it is a list.
   */
  private typeParameterNamesOf(node: TreeSitterSyntaxNode): string {
    const names: string[] = [];
    for (const clause of namedChildrenOf(node).filter((c) => c.type === 'type_parameters')) {
      for (const parameter of namedChildrenOf(clause).filter((c) => c.type === 'type_parameter')) {
        const name = this.findChild(parameter, 'type_identifier');
        if (name !== null) names.push(name.text);
      }
    }
    return names.length === 0 ? '' : JSON.stringify(names);
  }

  /** File one local's declared type under the method that declares it. */
  private recordLocalType(node: TreeSitterSyntaxNode, name: string, localType: string): void {
    const owner = this.methodKeyOf(node);
    if (owner === undefined) return;
    let locals = this.localTypes.get(owner);
    if (locals === undefined) {
      locals = new Map();
      this.localTypes.set(owner, locals);
    }
    if (locals.has(name) && locals.get(name) !== localType) locals.delete(name);
    else locals.set(name, localType);
  }

  /**
   * The type a declaration states, which is either the `type` it writes or the type of what it builds.
   *
   * **`var g = new Bar();` names no type and has one**, and it is the only case in Java where a declaration says
   * nothing and still says everything: the initialiser is a constructor call, and the class it constructs is what the
   * name holds. A `var` bound to anything else has no type here, because the alternative is inferring from a call
   * whose return type is not written down.
   */
  private declaredTypeOf(
    declaration: TreeSitterSyntaxNode,
    declarator: TreeSitterSyntaxNode,
  ): string | undefined {
    const written = declaration.childForFieldName('type')?.text;
    if (written !== undefined && written !== 'var') return written;
    const built = namedChildrenOf(declarator).find(
      (child) => child.type === 'object_creation_expression',
    );
    return built?.childForFieldName('type')?.text;
  }

  /**
   * The field and local types this walk recorded, filed onto the declaration each one belongs to.
   *
   * **One property on the class rather than a symbol per field.** A `Property` node per field was measured on
   * TypeScript in iteration 45: 13 891 of them cost the product's own docstring search 0.0145 MRR, for facts the
   * resolver reads off the class anyway.
   */
  protected override decorateCaptures(captures: UnifiedCapture[]): UnifiedCapture[] {
    for (const capture of captures) {
      // **A type capture always names itself**, so the `!` states the production rather than a hope - and a capture
      // that did not name a type would be asking the map for a key no class in the file can have.
      const fields = this.classFieldTypes.get(capture.name!);
      if (
        (capture.tag === CAPTURE_TAGS.CLASS_DEF ||
          capture.tag === CAPTURE_TAGS.INTERFACE_DEF ||
          capture.tag === CAPTURE_TAGS.ENUM_DEF) &&
        fields !== undefined &&
        fields.size > 0
      ) {
        capture.properties = {
          ...capture.properties,
          fieldTypes: JSON.stringify(Object.fromEntries(fields)),
        };
        continue;
      }
      if (
        (capture.tag === CAPTURE_TAGS.METHOD_DEF || capture.tag === CAPTURE_TAGS.CONSTRUCTOR_DEF) &&
        capture.containerName !== undefined
      ) {
        const locals = this.localTypes.get(
          `${ownerKeyOf(capture.containerName, String(capture.name))}\u0000${capture.startLine}`,
        );
        if (locals !== undefined && locals.size > 0) {
          capture.properties = {
            ...capture.properties,
            localTypes: JSON.stringify(Object.fromEntries(locals)),
          };
        }
      }
    }
    this.classFieldTypes.clear();
    this.localTypes.clear();
    this.typeParameterNames.clear();
    return this.attachDeclaredFacts(captures);
  }

  /**
   * One name a type position writes, as the reference the kind `type` was declared for.
   *
   * **`var` is the one place this reads text rather than structure.** `var w = new Widget()` writes a type, and the
   * grammar spells it as a `type_identifier` because that is what the language says it is - a type whose value is
   * inferred - so there is no node type to skip and no declaration for it to name. `int` needs no such line: it is an
   * `integral_type`, and the primitives are skipped structurally.
   */
  private emitTypeReference(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // **The member of a qualified type, which is the only segment that names a declaration.** `java.util.List` parses
    // as nested nodes whose last one is `List`, and a `scoped_type_identifier` always carries at least two names -
    // `a.B` is the shortest qualified type the grammar accepts - so the last element exists. The text keeps the whole
    // path and the name is what a lookup is keyed by, which is the same split TypeScript's `nested_type_identifier` arm
    // makes for `z.ZodTypeAny`.
    const member = node.type === 'scoped_type_identifier' ? namedChildrenOf(node).at(-1)! : node;
    const name = member.text;
    if (name === 'var') return;
    if (this.typeParameterNames.has(name)) return;
    captures.push({
      tag: CAPTURE_TAGS.TYPE_REFERENCE,
      text: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name,
      properties: { filePath: this.filePath },
    });
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;
    // The statement's first line, which is the key its facts are filed under. Every name this node reads is recorded
    // there rather than on the line the name happens to sit on; see `captureAccesses`.
    const line = node.startPosition.row + 1;

    // **A name a type position writes is a name the code depends on, and Java produced none of them.**
    //
    // `private final Registry registry;` is how a dependency-injected Java service is written, and `Registry` is named
    // there and nowhere else: the field is *read* as `registry.find(...)`, and the resolver answers that call from the
    // field's declared type without ever naming the class. So a reachability pass reading calls and value mentions
    // reports the injected class dead on a codebase that cannot run without it.
    //
    // **Java needs no anchor set, because the grammar already drew the boundary.** `int` is an `integral_type` and
    // `void` a `void_type`, so the primitives are skipped structurally; every remaining type position holds a
    // `type_identifier` - a field, a local, a parameter, a return, a cast, an `instanceof`, a `catch`, a `new` - which
    // is why this asks about the node rather than about the statement that contains it. The one declaration the
    // grammar spells with the node type a use has is `type_parameter`, and it is suppressed by name.
    if (nodeType === 'type_parameter') {
      // **A `type_parameter` always writes its name** - the grammar is `type_identifier (type_bound)?` - so the lookup
      // cannot come back empty and the `!` states the production rather than a hope. The bound is the half that is a
      // use, and it is visited as an ordinary `type_identifier` when the walk reaches it.
      const written = namedChildrenOf(node).find((child) => child.type === 'type_identifier')!;
      this.typeParameterNames.add(written.text);
    } else if (nodeType === 'scoped_type_identifier') {
      // **One reference for the whole path.** `java.util.List` parses as three nested nodes and only the last names a
      // declaration: a package is not a symbol in any graph, and filing it would make every `java` token in a checkout
      // a mention of anything called `java`. The resolver's trailing-segment rule already answers with `List`.
      // **No recursion** - everything under this node is a path segment.
      this.emitTypeReference(node, captures);
      return;
    } else if (nodeType === 'type_identifier') {
      this.emitTypeReference(node, captures);
      return;
    }

    if (nodeType === 'method_declaration' || nodeType === 'constructor_declaration') {
      this.emitParameterDefs(node, captures);
    }

    // **Java's statements, which it recorded none of.** It captured a class and a method and nothing inside either,
    // so the pipeline had neither a definition nor a use to work from.
    // **`field_declaration` is NOT handled here, and that is the fix.**
    //
    // **This branch used to name both node types**, and **a later `else if (nodeType === 'field_declaration')` held the
    // correct implementation** - **a loop over every declarator, using `variableNameNode`, which knows about
    // `underscore_pattern`.** **Because this branch matched first, that one was unreachable**, and **two tests failed on
    // exactly the two things the unreachable branch got right**: **`int a, b;` produced only `a`** (this branch used
    // `.find`, which takes the first), and **`int _;` produced nothing** (this branch looked only for `identifier`).
    //
    // **A duplicated branch is not merely dead code**: **it shadows the live one**, and **the tests that would have
    // caught the difference were asking the live one's questions.** **So the local case stays here and the field case
    // goes back to where the loop already is.**
    if (nodeType === 'resource') {
      // **A resource is a declaration, and it is not a `local_variable_declaration`.** `try (Closeable c = open(url))`
      // parses as `resource_specification > resource > (type, name, value)`, so the local branch below never saw it and
      // every call on `c` was unanswered: `commons-io` writes **35** of these headers, and `FileUtils.copyURLToFile`'s
      // three calls on `urlConnection` are one of them. A header that reuses a variable - `try (existing)` - declares
      // nothing and records nothing.
      const written = namedChildrenOf(node).find((child) => TYPE_NODES.has(child.type));
      const declared = namedChildrenOf(node).find((child) => child.type === 'identifier');
      if (written !== undefined && declared !== undefined) {
        this.recordLocalType(node, declared.text, written.text);
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: declared.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: declared.startIndex,
          endByte: declared.endIndex,
          name: declared.text,
          properties: { filePath: this.filePath },
        });
      }
    }

    if (nodeType === 'local_variable_declaration') {
      // **The same loop the field case uses**, because **a local declaration has the same shape**
      // (`local_variable_declaration > variable_declarator`) and **the local copy was the one that had drifted**:
      // it took the first declarator with `.find`, so `int a, b;` produced only `a`, and it looked for an `identifier`
      // where `variableNameNode` knows about `underscore_pattern`.
      for (const declarator of namedChildrenOf(node).filter(
        (c) => c.type === 'variable_declarator',
      )) {
        const nameNode = this.variableNameNode(declarator);
        // **A local's type is what `local.contains(…)` needs**, and it is filed under the method rather than the file
        // because a local is invisible outside it - the key is `Class.method`, which is the same key a parameter uses.
        const declared = this.declaredTypeOf(node, declarator);
        if (declared !== undefined) this.recordLocalType(node, nameNode.text, declared);
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: nameNode.text,
          startLine: nameNode.startPosition.row + 1,
          endLine: nameNode.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
        // `int x;` declares without assigning, so the absent initialiser is ordinary.
        const value = namedChildrenOf(declarator)[1];
        if (value) this.captureAccesses(value, captures, line);
      }
    } else if (nodeType === 'method_invocation') {
      // **`name:` and `arguments:` are fields of the production**: `method_invocation object:? name: (identifier)
      // arguments: (argument_list)` - so the name is not something to search for, and **the argument list exists even
      // when the call takes nothing**.
      const nameNode = node.childForFieldName('name')!;
      const receiver = node.childForFieldName('object');
      const methodArguments = this.argumentCountOf(node);
      captures.push({
        tag: receiver ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL,
        text: receiver ? `${receiver.text}.${nameNode.text}` : nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: {
          filePath: this.filePath,
          ...this.arityProperty(methodArguments),
          // **The call's own two-argument shape, with the names it passes.** `accept(dir, attributes)` and
          // `accept(file, name)` are the same count and different declarations, so the names travel with the count.
          ...this.argumentNamesProperty(node.childForFieldName('arguments')),
        },
      });
      // **A lambda's parameter states no type, and the collection it is passed to states one.** `listeners.forEach(listener
      // -> listener.onStart(…))` is how `commons-io` notifies its eight listeners, and the only place the language says
      // what `listener` is happens to be the field the call is written on - `List<FileAlterationListener>`. The binding
      // is recorded as "the element of that path", which is the same fact a for-each header records and the same one
      // the resolver already knows how to read.
      this.recordLambdaElement(node);
      this.captureArgumentAccesses(node.childForFieldName('arguments')!, captures, line);
    } else if (nodeType === 'enhanced_for_statement') {
      // **`for (Cookie theCookie : theCookies)` binds a name that every iteration writes**, and nothing recorded it.
      // The consequence was concrete: on OWASP Benchmark's cookie vector the chain from the request to the sink runs
      // `request.getCookies()` → `theCookies` → `theCookie` → `theCookie.getValue()` → `param`, and the second arrow
      // was invisible, so a quarter of the corpus's request surface produced no flow at all.
      //
      // The loop variable is a def and the iterable is a use, at the same line: what the loop reads is what the body
      // is about to hold.
      const name = node.childForFieldName('name');
      if (name !== null) {
        // **The loop variable states its own type, and the walk threw it away.** `for (final Pair<String, Object> pair :
        // contextValues)` writes `Pair` on the declaration, and recording only the name left `pair.getKey()` untyped -
        // which is nine of the pairs javac expected on `apache/commons-lang` and this graph claimed nothing for, in
        // `DefaultExceptionContext`, `DiffBuilder` and `DiffResult` alone. The iterable's element is the fallback for a
        // binding that writes no type (TypeScript's `for (const leaf of this.leaves)`), not a replacement for one that
        // does.
        //
        // **`var` is a token where the type would be and is not a type.** `for (var name : names)` parsed it as the
        // declared type of `name`, so every call on the binding was resolved against a class called `var` - the same
        // string `declaredTypeOf` already refuses for a local, refused here for the same reason: an inferred type is
        // not a stated one.
        const written = node.childForFieldName('type');
        if (written !== null && written.text !== 'var') {
          this.recordLocalType(node, name.text, written.text);
        }
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
      const value = node.childForFieldName('value');
      if (value !== null) this.captureAccesses(value, captures, line);
    } else if (nodeType === 'catch_formal_parameter') {
      // A caught exception is a binding a handler reads, and `e.getMessage()` is how its text reaches a response.
      const name = node.childForFieldName('name');
      if (name !== null) {
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
    } else if (nodeType === 'assignment_expression') {
      // **The statement Java writes most, and the one this recorded nothing for.**
      //
      // `fileName = Utils.testfileDir + param;` parses as
      // `expression_statement > assignment_expression left: (identifier) right: (binary_expression)`, and every branch
      // above asked for its own node type: a declaration captured its initialiser, a call captured its arguments, and
      // **an assignment captured neither the def it writes nor the uses it reads**. Measured on OWASP Benchmark, the
      // consequence was that taint could only ever reach a sink when the value was declared and passed on one line —
      // 142 of 1 415 real vulnerabilities — because the two shapes the corpus is built from are
      // `bar = request.getParameter("x")` and `param = bar`.
      //
      // The left side is a def when it names a binding, and a use when it names a field: `this.value = x` reads the
      // receiver even though it writes the field, and dropping that read would hide a flow through a field.
      // **Both fields are required by the grammar**, and this is the same convention the `method_invocation` case
      // below uses for `name:` and `arguments:`: `assignment_expression` is `left: right:`, and a file whose parse
      // loses one of them does not produce the node at all — `x = ;` collapses to nothing rather than to an
      // assignment. A guard here would be a branch no input can take.
      const left = node.childForFieldName('left')!;
      if (left.type === 'identifier') {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: left.text,
          startLine: left.startPosition.row + 1,
          endLine: left.endPosition.row + 1,
          startByte: left.startIndex,
          endByte: left.endIndex,
          name: left.text,
          properties: { filePath: this.filePath },
        });
      } else {
        this.captureAccesses(left, captures, line);
      }
      this.captureAccesses(node.childForFieldName('right')!, captures, line);
    } else if (nodeType === 'return_statement') {
      // **The one place a value leaves a function, and nothing here recorded it.** Every other statement shape was
      // captured - declarations, assignments, calls, loops, catches - so `return bar;` produced no capture at all and
      // the callee's half of every inter-procedural question was structurally empty rather than unanswered. A bare
      // `return;` hands nothing back and has no expression to read.
      if (node.namedChildCount > 0) {
        this.captureAccesses(node.namedChild(0), captures, line);
      }
    } else if (nodeType === 'object_creation_expression') {
      // **`new File(fileName)` is where a path sink's argument is read**, and a constructor is not a
      // `method_invocation`, so nothing recorded the value being passed to it. The creation is recorded as a call as
      // well, because `new ProcessBuilder(cmd)` is how a Java program starts a process and a call graph that omits it
      // cannot see the flow that ends in `start()`.
      const type = node.childForFieldName('type')!;
      // **A construction names its class, not the type arguments it is given and not the package path before it.**
      // `new ArrayList<>()` recorded `ArrayList<>` and `new java.util.ArrayList<String>()` recorded the path, and a
      // name that is neither resolves to nothing: measured on `apache/commons-lang@3.14.0`, **39 construction sites
      // called a class the checkout declares and were scored as missed** because of the diamond alone.
      const built = this.classNameOfType(type);
      // **An anonymous class names no class the graph holds.** `new Diff<Boolean>(fieldName) { … }` constructs a
      // subclass compiled from the body, and the constructor that runs is that subclass's - so a call recorded here
      // would claim the abstract class's constructor, which is what `javac` does *not* say. Measured: 18 sites in
      // `DiffBuilder` claimed `Diff.Diff` between them, and the resolver's own construction rule refuses the same
      // shape for the same reason. The arguments are still read below, because they are still used.
      const anonymous = namedChildrenOf(node).some((child) => child.type === 'class_body');
      const constructedArguments = this.argumentCountOf(node);
      if (!anonymous) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: type.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: built,
          properties: {
            filePath: this.filePath,
            ...this.arityProperty(constructedArguments),
          },
        });
      }
      // `new Foo()` always carries an `argument_list`, empty when the call passes nothing — the grammar requires it.
      this.captureArgumentAccesses(node.childForFieldName('arguments')!, captures, line);
    } else if (nodeType === 'explicit_constructor_invocation') {
      // **A constructor that delegates is a call, and only `new` was ever recorded.** `super(request)` and `this()`
      // write their target as a keyword - the production is `explicit_constructor_invocation super: (argument_list)`
      // with nothing nameable in it - so every branch above, each of them keyed on a name, stepped past them.
      // Measured on `apache/commons-lang@3.14.0`, this shape is **72 of the 327 edges `javac`'s own attribution
      // expects and this graph claimed nothing for**, and each one is the top of a hierarchy: `NumberRange`'s
      // constructor calling `Range(…)`, `StringEscapeUtils.CsvEscaper` calling `CharSequenceTranslator()`.
      //
      // `super` names the class the enclosing type extends and `this` names the enclosing type, because those are the
      // two things the keywords can mean. The arguments are read like any other call's, which is what carries a
      // request into a base constructor that stores it.
      const delegated = this.delegatedConstructorName(node);
      const delegatedArguments = this.argumentCountOf(node);
      if (delegated !== undefined) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: delegated,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: delegated,
          properties: {
            filePath: this.filePath,
            ...this.arityProperty(delegatedArguments),
          },
        });
      }
      this.captureArgumentAccesses(node.childForFieldName('arguments')!, captures, line);
    } else if (nodeType === 'method_reference') {
      this.captureMethodReference(node, captures);
    } else if (nodeType === 'expression_statement') {
      // **A bare name used as a statement**, which Java only permits as an assignment, an increment or a call - but
      // **a file being edited parses into shapes the language would reject**, and `x.y;` is a `field_access` rather
      // than an `identifier`, so both forms are recorded.
      const inner = node.child(0);
      if (inner.type === 'identifier' || inner.type === 'field_access') {
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_ACCESS,
          text: inner.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: inner.startIndex,
          endByte: inner.endIndex,
          name: inner.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'class_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      let interfaces = '';
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'super_interfaces') {
          interfaces = this.interfaceNames(child);
        }
      }
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: {
          baseClasses: this.superclassNameOf(node),
          interfaces,
          filePath: this.filePath,
          // **`abstract class Base` is a class that cannot be instantiated**, and the modifier is a child of the
          // declaration. The matrix claimed the row and nothing recorded the fact, so a reader of the graph could not
          // tell a class with a body from one every subclass has to complete.
          ...(childrenOf(node).some(
            (child) => child.type === 'modifiers' && /\babstract\b/.test(child.text),
          )
            ? { abstract: 'true' }
            : {}),
          ...this.outerClassPropertyOf(node),
          ...this.typeParametersPropertyOf(node),
        },
      });
      this.recordDefaultConstructor(node, nameNode, captures);
    } else if (nodeType === 'interface_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        // **`interface A extends B` makes every member of `B` a member of `A`**, which is a different clause from the
        // `implements` that a class writes. Reading the two as one was measured and refused - a `implements` clause
        // declares no body, so a call that lands on one lands nowhere - but the refusal took the `extends` of an
        // interface with it, and **42 of the pairs javac expected on `apache/commons-io` and this graph claimed
        // nothing for are that shape**: `IOStream` extends `IOBaseStream<T, IOStream<T>, …>` and every one of its
        // methods calls the base's `unwrap()`.
        properties: {
          filePath: this.filePath,
          baseClasses: this.extendedInterfacesOf(node),
          ...this.outerClassPropertyOf(node),
          ...this.typeParametersPropertyOf(node),
        },
      });
    } else if (nodeType === 'enum_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      // **Every constant of an enum is a value of that enum, and the grammar writes no type for one.**
      // `enum IOCase { SYSTEM("System") }` declares `SYSTEM`, and `IOCase.SYSTEM.checkEquals(…)` in `FilenameUtils`
      // names a receiver through it - so the constant is filed as a field whose type is the enum itself.
      const body = this.findChild(node, 'enum_body')!;
      for (const constant of namedChildrenOf(body).filter((c) => c.type === 'enum_constant')) {
        const constantName = namedChildrenOf(constant).find((c) => c.type === 'identifier');
        if (constantName !== undefined) {
          this.fileFieldType(nameNode.text, constantName.text, nameNode.text);
        }
      }
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: {
          filePath: this.filePath,
          ...this.outerClassPropertyOf(node),
          ...this.typeParametersPropertyOf(node),
        },
      });
      this.recordImplicitEnumMembers(node, nameNode, captures);
    } else if (nodeType === 'method_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      // **What the method says it returns**, in the grammar's `type:` field - which is where Java writes it and not
      // the `return_type:` a TypeScript or Python grammar uses. `void` is recorded too and refused later, because the
      // parser's job is to report the source and the resolver's is to decide what a call can be written on.
      this.recordDeclaredReturn(node, 'type', nameNode.text);
      // **And how many arguments it takes**, which is the only part of a Java signature that decides an overload
      // without a type system. `format(x)` in `CompositeFormat` names the base class's one-parameter method and not
      // either of the two the class declares.
      this.recordDeclaredArity(node, nameNode.text);
      // A method_declaration is always a method, never a constructor — Java
      // constructors are parsed as constructor_declaration (no return type).
      const container = this.findContainerNode(node)!;
      const cn = this.findChild(container, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.METHOD_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        containerName: cn.text,
        properties: { filePath: this.filePath, ...this.bodyProperty(node) },
      });
    } else if (nodeType === 'constructor_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      // **Every constructor runs a base constructor, and the source writes the call only sometimes.** `javac`'s own
      // tree holds the implicit `super()` of `Child(int a) { this.a = a; }` and its attribution names it after the
      // base class - so a graph without it is missing a call every instance of the class makes. Measured on
      // `apache/commons-lang@3.14.0`: **37 of the pairs javac expected and this graph claimed nothing for were this
      // shape**, `MutablePair`'s two constructors to `Pair` among them.
      //
      // **Not recorded when the constructor delegates**, because `super(…)` and `this(…)` say where it goes and the
      // walk will read them as calls of their own; and not recorded when the class extends nothing, because that
      // constructor runs `Object`'s, whose declaration this graph does not hold.
      // **The delegation is the body's first statement, so it is one level down**: a constructor is
      // `constructor_declaration name: formal_parameters: body: (constructor_body)`, and the invocation is a child of
      // that body rather than of the declaration.
      const constructorBody = namedChildrenOf(node).find(
        (child) => child.type === 'constructor_body',
      );
      const delegates =
        constructorBody !== undefined &&
        namedChildrenOf(constructorBody).some(
          (child) => child.type === 'explicit_constructor_invocation',
        );
      const inheritedBase = delegates ? undefined : this.superclassNameOfCall(node);
      if (inheritedBase !== undefined) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: inheritedBase,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: inheritedBase,
          properties: { filePath: this.filePath, implicitSuper: 'true' },
        });
      }
      // A constructor is always nested inside a class or enum declaration.
      const container = this.findContainerNode(node)!;
      const cn = this.findChild(container, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.CONSTRUCTOR_DEF,
        text: nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        containerName: cn.text,
        properties: { filePath: this.filePath },
      });
      // **A construction is an overload too.** `new X()` and `new X(a, b)` are two declarations of one name, and the
      // count is filed after the capture for the same reason the method's is filed after its own: the record is keyed
      // by the declaration's line and name, and both are known once the capture exists.
      this.recordDeclaredArity(node, nameNode.text);
    } else if (nodeType === 'field_declaration') {
      // A field_declaration can declare multiple variables (e.g. `int a, b;`),
      // each emitted as its own VARIABLE_DEF capture.
      for (const declarator of namedChildrenOf(node)) {
        if (declarator.type !== 'variable_declarator') continue;
        const nameNode = this.variableNameNode(declarator);
        // **`private final CharSet set = …` is the fact `set.contains(…)` is resolved by**, and Java emitted none of
        // them: a call on a field could only ever be answered by the field's name.
        const declared = this.declaredTypeOf(node, declarator);
        if (declared !== undefined) this.recordFieldType(node, nameNode.text, declared);
        captures.push({
          tag: CAPTURE_TAGS.VARIABLE_DEF,
          text: nameNode.text,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: nameNode.startIndex,
          endByte: nameNode.endIndex,
          name: nameNode.text,
          properties: { filePath: this.filePath },
        });
      }
    } else if (nodeType === 'import_declaration') {
      const parts: string[] = [];
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'scoped_identifier') {
          this._collectIdentifiers(child, parts);
        } else if (child.type === 'identifier') {
          parts.push(child.text);
        }
      }
      // An import_declaration always carries an identifier or scoped_identifier.
      const path = parts.join('.');
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: path,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: path,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'annotation' || nodeType === 'marker_annotation') {
      const nameNode =
        this.findChild(node, 'identifier') ?? this.findChild(node, 'scoped_identifier');
      // An annotation's name field is always an identifier or scoped_identifier.
      const name = nameNode!.text;
      captures.push({
        tag: CAPTURE_TAGS.DECORATOR,
        text: node.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name,
        properties: { decorator: name, filePath: this.filePath },
      });
    }

    for (const child of childrenOf(node)) {
      this.walkAndCapture(child, captures);
    }
  }

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const line = node.startPosition.row + 1;
      let isWildcard = false;
      const parts: string[] = [];

      for (const child of childrenOf(node)) {
        if (child.text === '*') isWildcard = true;
      }
      for (const child of namedChildrenOf(node)) {
        if (child.type === 'scoped_identifier') {
          this._collectIdentifiers(child, parts);
        } else if (child.type === 'identifier') {
          parts.push(child.text);
        }
      }

      // An import_declaration always carries an identifier or scoped_identifier.
      const path = parts.join('.');
      imports.push({
        source: path,
        names: isWildcard ? [] : [parts[parts.length - 1]!],
        type: isWildcard ? 'wildcard' : 'named',
        lineNumber: line,
      });
      return;
    }

    for (const child of childrenOf(node)) {
      this.walkForImports(child, imports);
    }
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    const nodeType = node.type;

    if (
      nodeType === 'class_declaration' ||
      nodeType === 'interface_declaration' ||
      nodeType === 'enum_declaration' ||
      nodeType === 'method_declaration' ||
      nodeType === 'constructor_declaration'
    ) {
      if (this.hasPublicModifier(node)) {
        const nameNode = this.findChild(node, 'identifier')!;
        if (nameNode.text === symbolName) return true;
      }
    } else if (nodeType === 'field_declaration') {
      if (this.hasPublicModifier(node)) {
        for (const declarator of namedChildrenOf(node)) {
          if (declarator.type !== 'variable_declarator') continue;
          if (this.variableNameNode(declarator).text === symbolName) return true;
        }
      }
    }

    for (const child of childrenOf(node)) {
      if (this.checkExported(child, symbolName)) return true;
    }
    return false;
  }

  // Fallbacks
  public override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;
    const clRegex = /(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const ifRegex = /(?:public\s+)?interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const enumRegex = /(?:public\s+)?enum\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
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
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  public override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;
    const regex = /import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/g;
    while ((m = regex.exec(source)) !== null) {
      const parts = m[1]!.split('.');
      imports.push({
        source: m[1]!,
        names: [parts[parts.length - 1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  public override fallbackIsExported(source: string, symbolName: string): boolean {
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `public\\s+(?:class|interface|enum)\\s+${s}\\b|public\\s+(?:static\\s+)?\\w+\\s+${s}\\b|public\\s+\\w+\\s+${s}\\s*\\(`,
    ).test(source);
  }

  // Helpers
  private findChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (const child of namedChildrenOf(node)) {
      if (child.type === type) return child;
    }
    return null;
  }

  /**
   * Extract the leaf name of a class/interface type. Unwraps generic types,
   * scoped (dotted) types, and type-use annotations to the base identifier,
   * e.g. `java.util.AbstractList<String>` -> `AbstractList`.
   */
  private typeBaseName(type: TreeSitterSyntaxNode): string {
    if (
      type.type === 'generic_type' ||
      type.type === 'scoped_type_identifier' ||
      type.type === 'annotated_type'
    ) {
      for (let i = type.namedChildCount - 1; i >= 0; i--) {
        const child = type.namedChild(i);
        if (child.type === 'type_identifier') return child.text;
        if (
          child.type === 'generic_type' ||
          child.type === 'scoped_type_identifier' ||
          child.type === 'annotated_type'
        ) {
          return this.typeBaseName(child);
        }
      }
    }
    return type.text;
  }

  /**
   * The base name a class declaration's `extends` clause names, or the empty string when it has none.
   *
   * **The clause is the only place Java writes a base**, so both the class capture and a `super(…)` call read it
   * here: a `super` written in `Child extends Base` means `Base`, and the two readers must not be able to disagree.
   */
  private superclassNameOf(typeNode: TreeSitterSyntaxNode): string {
    const clause = this.findChild(typeNode, 'superclass');
    // **The clause is `extends Type`, and the grammar states both halves**: a `superclass` node with no named child
    // is not a shape this language produces, so the empty answer belongs to the missing clause and to nothing else.
    return clause === null ? '' : this.typeBaseName(clause.namedChild(0));
  }

  /**
   * Java's `super(…)` target, from the `superclass` clause of the type the call is written in.
   *
   * **A class that extends nothing can still write `super()`** - it means `Object`, whose constructor this graph has
   * no declaration for - so an empty clause answers `undefined` rather than the name `Object`: an edge to a class the
   * graph does not hold is a claim with nothing behind it.
   *
   * **This rule is Java's alone, and TypeScript's version of it was measured and refused.** A TypeScript constructor
   * is *inherited*: `class A extends NoCtor { constructor() { super(); } }` runs `Object`'s constructor, so naming
   * the call after `NoCtor` claims a declaration that does not exist. Written that way it added **2 claims and 0
   * correct ones** on `redis/ioredis@5.4.2` (`Pipeline` and `cluster/index` delegating to a `Commander` that declares
   * no constructor) — the TypeScript checker resolves a `super` call to the nearest ancestor that *declares* one, so
   * the rule needs a constructor-chain walk the class index can answer and this provider cannot. Java has no such
   * hole: a constructor is never inherited, so `super(args)` always names a constructor the direct base declares.
   */
  private superclassNameOfCall(node: TreeSitterSyntaxNode): string | undefined {
    // **A delegation is written in a constructor, and a constructor is written in a type**, so the enclosing
    // container exists by the shape of the grammar rather than by luck - the same reasoning the `!` on a method's own
    // name uses one screen below.
    const base = this.superclassNameOf(this.findContainerNode(node)!);
    return base === '' ? undefined : base;
  }

  /** The class `super(…)` or `this(…)` delegates to, named the way a call site names a constructor. */
  private delegatedConstructorName(node: TreeSitterSyntaxNode): string | undefined {
    return node.namedChild(0).type === 'super'
      ? this.superclassNameOfCall(node)
      : this.enclosingClassName(node);
  }

  /** Join the comma-separated interface names of a super_interfaces clause. */
  private interfaceNames(superInterfaces: TreeSitterSyntaxNode): string {
    const typeList = superInterfaces.namedChild(0);
    const names: string[] = [];
    for (const child of namedChildrenOf(typeList)) {
      names.push(this.typeBaseName(child));
    }
    return names.join(',');
  }

  /**
   * The interfaces an interface extends, as a comma-separated list of simple names.
   *
   * **`extends_interfaces` is `extends A, B` with the types as direct children**, unlike `super_interfaces`, which
   * wraps them in a `type_list`. The two clauses say different things too: a class `implements` a contract that
   * declares no body, while an interface `extends` another interface whose members are its members. Only the second
   * is a base.
   */
  private extendedInterfacesOf(node: TreeSitterSyntaxNode): string {
    const clause = this.findChild(node, 'extends_interfaces');
    // **The clause wraps its types in a `type_list`**, exactly as `super_interfaces` does, so the names are read by
    // the same helper that reads a class's contracts.
    return clause === null ? '' : this.interfaceNames(clause);
  }

  /** Whether a declaration carries a `public` visibility modifier. */
  private hasPublicModifier(node: TreeSitterSyntaxNode): boolean {
    for (const child of namedChildrenOf(node)) {
      if (child.type === 'modifiers') {
        return /\bpublic\b/.test(child.text);
      }
    }
    return false;
  }

  /** The name node of a variable_declarator (an identifier or `_` pattern). */
  private variableNameNode(declarator: TreeSitterSyntaxNode): TreeSitterSyntaxNode {
    const nameNode =
      this.findChild(declarator, 'identifier') ?? this.findChild(declarator, 'underscore_pattern');
    // A variable_declarator always carries an identifier or underscore_pattern name.
    return nameNode!;
  }

  private _collectIdentifiers(node: TreeSitterSyntaxNode, result: string[]): void {
    if (node.type === 'identifier') {
      result.push(node.text);
      return;
    }
    for (const child of namedChildrenOf(node)) {
      this._collectIdentifiers(child, result);
    }
  }

  private ln(source: string, offset: number): number {
    return lineOf(source, offset);
  }
  /**
   * Taint, in one pass over the tree.
   *
   * **The three questions name the same two node shapes**, so the file is traversed once instead of three
   * times - see `collectCLikeTaint`. The collector is the shared one; only the node names are this language's.
   */
  /**
   * The grammar's names for a declaration, an assignment and a condition.
   *
   * **This is what makes reachability cheap and language-wide**: the walk that reads it is shared, and a dialect is the
   * only thing a grammar has to supply. This grammar shares the C-family vocabulary.
   */
  protected override constantDialect(): ConstantDialect {
    return C_FAMILY_CONSTANTS;
  }

  protected override containerDialect(): ContainerDialect {
    return JAVA_CONTAINERS;
  }

  protected override collectTaint(root: TreeSitterSyntaxNode): TaintCollections {
    return collectCLikeTaint(root, JAVA_TAINT_NODES, JAVA_TAINT_VOCABULARY);
  }

  /**
   * The sinks the vocabulary matched, minus the ones whose destination is not the response.
   *
   * **The vocabulary matches a method name, and a method name does not name a destination.** `write` is a response
   * body, a file, or a string builder depending on the receiver's declared type, and the receiver's type is in the
   * file this walk just read. Filtering here rather than in the walk keeps the shared collector free of a notion only
   * Java has, and keeps the filter testable against one file of source.
   *
   * **It filters the fused collection, which is already filtered by nothing.** `super.extractTaintSinks` returns the
   * sinks from the one pass this class declared, so the order of the two is unchanged - collect, then narrow.
   */
  override extractTaintSinks(source: string): TaintSink[] {
    const sinks = super.extractTaintSinks(source);
    const declaredTypes = declaredConstructedTypes(source);
    return sinks.filter((sink) => writesToResponseBody(sink, declaredTypes));
  }
}
