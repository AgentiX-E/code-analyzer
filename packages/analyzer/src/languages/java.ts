// @code-analyzer/analyzer — Java Tree-sitter Provider

import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { collectCLikeTaint } from './base-c-like.js';
import { C_FAMILY_CONSTANTS } from './constant-fold.js';
import { JAVA_CONTAINERS } from './container-calls.js';
import {
  JAVA_TAINT_VOCABULARY,
  declaredConstructedTypes,
  writesToResponseBody,
} from './java-taint.js';
import { childrenOf, namedChildrenOf } from './syntax-children.js';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import { ownerKeyOf } from '../resolution/receiver-types.js';

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

/** The two declarations a local belongs to, and the only two a parameter is ever filed under. */
const METHOD_CONTAINERS: ReadonlySet<string> = new Set([
  'method_declaration',
  'constructor_declaration',
]);

/** The node types a Java declaration's type is written as. */
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
    const parameters = namedChildrenOf(list).map((parameter) => {
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
    const owner = this.ownerKeyOfMethod(node);
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
          // **A parameter with no type is the shape a file being edited parses into**, and it is the one arm here that
          // no complete Java source can take - `void run(Widget)` is not a method the grammar produces, and the walk
          // does not even reach this loop for it. Kept, because the alternative is a resolver handed the string
          // `"undefined"` as a class name; the same contract the docstring guard in `tree-sitter-base.ts` states.
          ...(type === undefined ? {} : { parameterType: type }),
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
  private parameterTypeOf(parameter: TreeSitterSyntaxNode): string | undefined {
    const field = parameter.childForFieldName('type');
    if (field !== null) return field.text;
    const first = namedChildrenOf(parameter).find((child) => TYPE_NODES.has(child.type));
    return first?.text;
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
    return method === null ? undefined : this.ownerKeyOfMethod(method);
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
    const className = this.enclosingClassName(node);
    let fields = this.classFieldTypes.get(className);
    if (fields === undefined) {
      fields = new Map();
      this.classFieldTypes.set(className, fields);
    }
    if (fields.has(field) && fields.get(field) !== fieldType) fields.delete(field);
    else fields.set(field, fieldType);
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
        const locals = this.localTypes.get(ownerKeyOf(capture.containerName, String(capture.name)));
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
    return captures;
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;
    // The statement's first line, which is the key its facts are filed under. Every name this node reads is recorded
    // there rather than on the line the name happens to sit on; see `captureAccesses`.
    const line = node.startPosition.row + 1;

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
      captures.push({
        tag: receiver ? CAPTURE_TAGS.METHOD_CALL : CAPTURE_TAGS.FUNCTION_CALL,
        text: receiver ? `${receiver.text}.${nameNode.text}` : nameNode.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
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
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_CALL,
        text: type.text,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: node.startIndex,
        endByte: node.endIndex,
        name: type.text,
        properties: { filePath: this.filePath },
      });
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
      if (delegated !== undefined) {
        captures.push({
          tag: CAPTURE_TAGS.FUNCTION_CALL,
          text: delegated,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: delegated,
          properties: { filePath: this.filePath },
        });
      }
      this.captureArgumentAccesses(node.childForFieldName('arguments')!, captures, line);
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
        },
      });
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
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'enum_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${nameNode.text}`,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startByte: nameNode.startIndex,
        endByte: nameNode.endIndex,
        name: nameNode.text,
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'method_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
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
        properties: { filePath: this.filePath },
      });
    } else if (nodeType === 'constructor_declaration') {
      const nameNode = this.findChild(node, 'identifier')!;
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
    return source.slice(0, offset).split('\n').length;
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
