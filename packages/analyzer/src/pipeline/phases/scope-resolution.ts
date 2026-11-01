// @code-analyzer/analyzer — Pipeline Phase: ScopeResolution

import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  PhaseLogger,
  createNoopPhaseLogger,
  isDeclarationLabel,
  EDGE_ACCESSES,
  EDGE_CALLS,
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
} from '@code-analyzer/shared';

import { GraphBuilder } from '../../graph/graph-builder.js';
import { buildCallSites } from '../../resolution/call-sites.js';
import {
  baseMemberOf,
  buildFileTypes,
  classMemberOf,
  containerOf,
  createClassIndex,
  mergeClassIndex,
  ownerKeyOf,
  receiverTypeOf,
} from '../../resolution/receiver-types.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type {
  PipelinePhaseId,
  PipelineContext,
  ParsedFile,
  ResolvedImport,
  NodeLabel,
  GraphNode,
  SymbolDefinition,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Phase 7: scopeResolution — Resolve scopes and references
// ---------------------------------------------------------------------------

/** A declaration a simple name can point at. */
interface Resolved {
  readonly nodeId: number;
  readonly label: NodeLabel;
}

/**
 * Record a declaration under a simple name, **and refuse to guess once a second one appears**.
 *
 * The index keeps the first declaration and then replaces it with `ambiguous` on the second — a name declared twice
 * in one file (`get` in two classes, `value` in two branches) has no static answer, and picking the first is how a
 * call graph acquires edges nobody can defend.
 */
function keepUnique(
  index: Map<string, Resolved | 'ambiguous'>,
  name: string,
  resolved: Resolved,
): void {
  if (index.has(name)) {
    index.set(name, 'ambiguous');
    return;
  }
  index.set(name, resolved);
}

/** The declaration a lookup found, or `undefined` when it is absent or ambiguous. */
function resolvable(entry: Resolved | 'ambiguous' | undefined): Resolved | undefined {
  return entry === undefined || entry === 'ambiguous' ? undefined : entry;
}

/** A file's own declarations, separated by the scope that holds them. */
interface FileScope {
  /** module-level `def`, `class`, `interface`, … - what an unqualified name may reach */
  readonly module: Map<string, Resolved | 'ambiguous'>;
  /** methods, constructors and nested types - what `self.`/`this.` may reach */
  readonly member: Map<string, Resolved | 'ambiguous'>;
  /**
   * Names a *function* declares inside itself, keyed `${enclosing declaration}::${name}`.
   *
   * **A nested function used to have no scope of its own to be found in.** Its name was the file's, so a mention of
   * it — `object.__setattr__(self, "_get_current_object", _get_current_object)` — resolved against the module, which
   * was right by accident. Once a declaration is filed under the declaration that contains it, a nested function
   * belongs to the function and to nothing else, and a resolver with only two scopes answers "not found" for a name
   * that is one line above the mention. Measured on `pallets/werkzeug@3.0.3`: `LocalProxy._get_current_object` and
   * `_dt_as_utc` came back as dead code the moment the names stopped colliding.
   */
  readonly local: Map<string, Resolved[]>;
  /**
   * Which declaration holds which, as `child → parent`.
   *
   * **A name is visible to the closures written inside the function that declares it, not only to its own body.**
   * `const readyHandler = () => {…}` inside a method is called from an arrow function three lines further in, and a
   * lookup that asks only the innermost scope finds nothing — the innermost scope is the arrow's. Walking out one
   * holder at a time is what a reader does, and it is the whole of Python's LEGB rule minus the two scopes this phase
   * already indexes.
   */
  readonly owner: Map<number, number>;
  /**
   * Every name a function binds inside itself, whatever kind the binding is, keyed `${enclosing declaration}::${name}`.
   *
   * **`local` holds the bindings a call can *reach*, and this holds the ones that decide what a *receiver* is.** A
   * call on `Registry.put(…)` reaches the class `Registry`, and a `const Registry = { put: … }` four lines into a
   * function is a value of the same name: the receiver's kind is what the resolution turns on, and a set that only
   * kept callable bindings could not see the shadow that makes the receiver a value.
   */
  readonly bound: Set<string>;
}

/**
 * The scope that holds a declaration: the module, a class body, or a function body.
 *
 * **`SymbolDefinition.containerName` would say so and is empty for every Python method** - the provider emits
 * `def __getattr__` as a plain `Function` with no container, and the node inherits the omission. Line ranges are the
 * fact that is actually there, and nesting is what they say: a declaration whose span sits inside another
 * declaration's span belongs to it.
 *
 * **The third answer is the one that mattered most.** A name declared inside a *function* is a closure variable of
 * that function - `def test_x(): class MyException(Exception): …` is not a module-level `MyException`, and neither is
 * `def stream_with_context(g): def generator(): …`. Measured on `pallets/flask`, 40 of the 43 remaining wrong
 * same-file edges were a bare call from one function to a nested declaration inside a different function, and the
 * graph had filed every one of them as module scope.
 */
function declarationScope(
  holders: ReadonlyMap<number, ScopedDeclaration>,
  declaration: ScopedDeclaration,
): 'module' | 'member' | 'local' {
  const holder = holders.get(declaration.id);
  if (holder === undefined) return 'module';
  return isTypeLabel(holder.label) ? 'member' : 'local';
}

/** Whether a declaration is a type, which is the difference between a member scope and a local one. */
function isTypeLabel(kind: NodeLabel): boolean {
  return kind === 'Class' || kind === 'Interface' || kind === 'Enum';
}

/**
 * The narrowest declaration whose span strictly contains each node of one file, computed once for the file.
 *
 * **Once, because asking per node is quadratic and a file can hold a hundred thousand nodes.** The first version ran
 * the containment test for every declaration against every other declaration: correct, and 87 seconds on
 * `redis/ioredis@5.4.2` once every declaration had a node of its own. The file's declarations sorted by start line
 * ascending — and by end line descending, so a container always precedes what it holds — turn the same question into a
 * walk with a stack.
 *
 * **Strictly wider, because a file's symbols are not disjoint.** A one-line arrow function and the function that holds
 * it can share a line range, and reading "contains" as "contains or equals" makes every declaration look nested inside
 * whichever one it was compared with — which filed whole files into the local scope.
 */
function holdersOf(nodes: readonly ScopedDeclaration[]): Map<number, ScopedDeclaration> {
  const holders = new Map<number, ScopedDeclaration>();
  // **Only a declaration can hold a declaration.** The file node spans every line of the file and carries a
  // `filePath`, so counting it as a container makes every symbol in the file local - which is what the first version of
  // this question did, and the reason its own test found nothing at all.
  const order = nodes
    .filter(isContainer)
    .sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
  const stack: RangedDeclaration[] = [];
  for (const node of order) {
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as RangedDeclaration;
      const contains =
        top.startLine <= node.startLine &&
        top.endLine >= node.endLine &&
        (top.startLine < node.startLine || top.endLine > node.endLine);
      if (contains) break;
      stack.pop();
    }
    if (stack.length > 0) holders.set(node.id, stack[stack.length - 1] as RangedDeclaration);
    stack.push(node);
  }
  return holders;
}

/** The facts about nesting that a line range can answer. */
interface ScopedDeclaration {
  readonly id: number;
  readonly label: NodeLabel;
  readonly startLine: number | null;
  readonly endLine: number | null;
}

/** A declaration that has a span, so containment compares two numbers instead of four nullable ones. */
interface RangedDeclaration extends ScopedDeclaration {
  readonly startLine: number;
  readonly endLine: number;
}

/** Whether a declaration can lexically hold another, and has the span needed to say so. */
function isContainer(node: ScopedDeclaration): node is RangedDeclaration {
  return CONTAINER_KINDS.has(node.label) && node.startLine !== null && node.endLine !== null;
}

/** Symbol kinds that can lexically hold another declaration. */
const CONTAINER_KINDS: ReadonlySet<NodeLabel> = new Set<NodeLabel>([
  'Function',
  'Method',
  'Constructor',
  'Class',
  'Interface',
  'Enum',
]);

/** Symbol kinds a call may name. */
const RESOLVABLE_KINDS: ReadonlySet<NodeLabel> = new Set<NodeLabel>([
  'Function',
  'Method',
  'Class',
  'Constructor',
  'Interface',
  'Enum',
  'TypeAlias',
]);

/**
 * Does an unqualified call in this language reach a member of the enclosing class?
 *
 * **Python is the one that says no.** Inside a method, `helper()` looks in the module and then in the builtins;
 * reaching another method of the same class requires `self.helper()`, so a bare name that matches a member is a
 * coincidence and an edge built from it describes a `NameError`. Every other language in the supported set - Java,
 * Kotlin, Groovy, TypeScript, JavaScript, Swift, ArkTS - supplies the receiver implicitly, which is what makes this a
 * property of the language rather than a rule of thumb.
 */
function hasImplicitThis(language: string | undefined): boolean {
  return language !== 'python';
}

/**
 * Is this call's receiver the object the call is written in — or is there no receiver at all?
 *
 * **`self`, `this`, `cls` and `super` are the four spellings a language gives the enclosing object**, and a call on
 * one of them resolves in the enclosing scope. Any other receiver is another object whose type is not in the
 * statement, so its method is not this file's to claim.
 */
function isOwnScopeCall(receiver: string | undefined): boolean {
  if (receiver === undefined) return true;
  return OWN_SCOPE_RECEIVERS.has(receiver);
}

const OWN_SCOPE_RECEIVERS: ReadonlySet<string> = new Set(['self', 'this', 'cls', 'super', '$this']);

/**
 * Does a declaration nested inside another keep the enclosing receiver, or bind its own?
 *
 * **A `function` expression in JavaScript rebinds `this`**, so `const onSpawn = function () { this.bump() }` written
 * inside `class Plain` is not a call on `Plain` — the caller decides, and the call site does not say. An arrow
 * function is the opposite by definition, which is why the syntax exists. In every other language this product reads,
 * the receiver is an ordinary name that a nested function closes over — Python's `self`, Kotlin's and Swift's implicit
 * `this` in a lambda, Java's `this` in a lambda — so nothing stops the walk.
 *
 * A declaration whose syntax is unknown (no `arrow` property a provider recorded) is treated as rebinding, because
 * continuing past it would be a claim the reader cannot check.
 */
function keepsItsThis(
  language: string | undefined,
  symbol: { readonly properties?: Record<string, unknown> },
): boolean {
  if (language !== 'typescript' && language !== 'javascript' && language !== 'arkts') return true;
  return symbol.properties?.['arrow'] === 'true';
}

/**
 * Whether a receiver is the base class - `super` in TypeScript and Java, `super()` in Python.
 *
 * **`super()` is a call and `receiverOf` keeps it whole**, so the text arrives with its argument list; `super(Foo,
 * self)` is the two-argument form and is the same keyword. A method named `superb` is not a `super` call, which is why
 * the pattern ends where the identifier does.
 */
function isSuperReceiver(receiver: string): boolean {
  return /^super(\(.*\))?$/.test(receiver);
}

/** The same question for a receiver that may be absent, which the same-file arm asks before it can look. */
function isSuperCall(receiver: string | undefined): boolean {
  return receiver !== undefined && isSuperReceiver(receiver);
}

/**
 * The file a name bound by an import refers to, when that name is a module.
 *
 * **`import cli` binds `cli` to `cli.py`; `from . import cli` binds it to the submodule `cli` of the package the
 * import names.** Both are read from the resolution the import already has, and neither is a guess: a file is either a
 * module of that name, or a package that could contain one. A name bound to anything else - a class, a function, an
 * instance - is not a namespace, and answering `undefined` is how this stays a rule instead of a lookup.
 */
function moduleFileOf(resolvedFile: string, name: string): string | undefined {
  const base = basename(resolvedFile);
  const stem = base.slice(0, base.lastIndexOf('.') === -1 ? base.length : base.lastIndexOf('.'));
  if (stem === name) return resolvedFile;
  if (stem !== '__init__') return undefined;
  const packageDirectory = dirname(resolvedFile);
  for (const candidate of [
    join(packageDirectory, `${name}.py`),
    join(packageDirectory, name, '__init__.py'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export class ScopeResolutionPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'scopeResolution';
  readonly dependencies: PipelinePhaseId[] = ['parse'];
  readonly description = 'Resolve scope trees and symbol references';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      const parseData = ctx.phaseData.get('parse') as { parsedFiles: ParsedFile[] } | undefined;

      if (!parseData || !parseData.parsedFiles || !ctx.graph) {
        // The same shape as the success path, so a consumer can tell "no call sites" from "the phase did not run".
        return {
          phaseId: this.id,
          status: 'success',
          output: {
            referencesResolved: 0,
            unresolvedMentions: 0,
            callSiteCount: 0,
            callsByArm: {},
          },
        };
      }

      // Read crossFile phase data for import resolution
      const crossFileData = ctx.phaseData.get('crossFile') as
        { resolvedImports: ResolvedImport[]; importEdgesCreated: number } | undefined;

      const builder = new GraphBuilder(null);
      let referencesResolved = 0;
      /** Call sites that resolved to nothing and were recorded as mentions instead, so the count is auditable. */
      let unresolvedMentions = 0;
      /**
       * Which arm produced each `CALLS` edge.
       *
       * **The three arms do not have the same precision, and before this the graph could not tell them apart.** An
       * edge that follows an explicit import is evidence; an edge into a name declared once in the file is an
       * inference; an edge into a name declared once in the whole graph is a guess. Writing which one it was onto the
       * edge is what lets the precision be measured per arm instead of in aggregate, where a good arm hides a bad one.
       */
      const callsByArm: Record<string, number> = {
        import: 0,
        sameFile: 0,
        inherited: 0,
        super: 0,
        receiverType: 0,
      };

      // Build a file-level import resolution map: sourceFile -> targetFile -> importedSymbols
      const importMap = new Map<string, Map<string, Set<string>>>();
      if (crossFileData?.resolvedImports) {
        for (const imp of crossFileData.resolvedImports) {
          for (const resolvedFile of imp.resolvedFiles) {
            let fileMap = importMap.get(imp.sourceFile);
            if (!fileMap) {
              fileMap = new Map();
              importMap.set(imp.sourceFile, fileMap);
            }
            let symbols = fileMap.get(resolvedFile);
            if (!symbols) {
              symbols = new Set();
              fileMap.set(resolvedFile, symbols);
            }
            for (const sym of imp.importedSymbols) {
              symbols.add(sym);
            }
          }
        }
      }

      // Build an index of all known symbols across files
      // qualifiedName -> GraphNode, plus name+file -> GraphNode for precise matching
      const qnameIndex = new Map<string, { nodeId: number; label: NodeLabel }>();
      // file+name -> GraphNode for cross-file resolution
      const fileSymbolIndex = new Map<string, Map<string, { nodeId: number; label: NodeLabel }>>();
      /**
       * The node each declaration became, keyed by the one identity a name cannot give: `file::line::name::kind`.
       *
       * **A qualified name is a name, and a name is shared.** `Response.status` names a getter and a setter; a module
       * that declares `locate_app` three times has three; and in werkzeug the setter's name was also the name of a
       * *parameter* of `Response.__init__`, so `qnameIndex` — first-wins — resolved the caller of `self._clean_status(…)`
       * to that parameter. The edge was written, it just left from a declaration that cannot call anything, and the
       * callee was reported as dead code. **A caller is a declaration, so it is looked up as one.
       */
      const declarationNodes = new Map<string, number>();
      /**
       * Simple name → the declaration, per file, which is the scope a call actually resolves in.
       *
       * **The per-file index and not a global one**, because a simple name is only evidence inside the file that
       * writes it; the cross-file question is answered by imports and by class chains, which are facts rather than
       * coincidences.
       */
      const fileScopes = new Map<string, FileScope>();
      /**
       * Names a file declares more than once — `get` in two classes, `value` in two branches.
       *
       * **A mention of an ambiguous name is not evidence about either declaration**, for the same reason the call arm
       * refuses it: an edge to whichever one the index happened to see first is an edge nobody can defend. Without this
       * set the mention fallback would have re-introduced exactly that defect, and a test written for the call arm
       * caught it — the mention path pointed at `A.get` because `A` was declared first.
       */
      const ambiguousNames = new Map<string, Set<string>>();

      for (const [, node] of ctx.graph.nodes) {
        if (
          node.label === 'Function' ||
          node.label === 'Class' ||
          node.label === 'Method' ||
          node.label === 'Interface' ||
          node.label === 'Enum' ||
          node.label === 'TypeAlias' ||
          node.label === 'Constructor'
        ) {
          // Store by qualified name (precise)
          qnameIndex.set(node.qualifiedName, { nodeId: node.id, label: node.label });

          if (isDeclarationLabel(node.label) && typeof node.properties?.filePath === 'string') {
            declarationNodes.set(
              `${String(node.properties.filePath)}::${String(node.startLine)}::${node.name}::${String(node.label)}`,
              node.id,
            );
          }

          // Store in per-file index for cross-file resolution
          if (node.properties?.filePath) {
            const filePath = String(node.properties.filePath);
            let fileMap = fileSymbolIndex.get(filePath);
            if (!fileMap) {
              fileMap = new Map();
              fileSymbolIndex.set(filePath, fileMap);
            }
            // Store by simple name (in context of this file)
            if (node.name && !fileMap.has(node.name)) {
              fileMap.set(node.name, { nodeId: node.id, label: node.label });
            } else if (node.name) {
              const known = ambiguousNames.get(filePath);
              if (known === undefined) ambiguousNames.set(filePath, new Set([node.name]));
              else known.add(node.name);
            }
            // Also store by qualifiedName for full path matching
            fileMap.set(node.qualifiedName, { nodeId: node.id, label: node.label });
          }
        }
      }

      /**
       * A file's own declarations, **split by the scope that holds them**.
       *
       * **`SymbolDefinition.containerName` is the difference between a function and a method, and the graph node does
       * not carry it.** A bare call `f()` and a call `self.f()` therefore resolved against one undifferentiated bag of
       * names, and in Python those two answer differently: `self.f()` may reach a method, and `f()` may not - Python
       * has no implicit `self`, so an unqualified name inside a method looks in the module and then in the builtins,
       * never in the class. Measured on `pallets/flask`, 49 of the 83 wrong same-file edges were bare calls resolved
       * to a method of a class in the same file, which is a `NameError` in the program being described. Most other
       * languages do have implicit `this`, which is why the split is kept as data and applied per language rather
       * than assumed.
       */
      const nodesByFile = new Map<string, GraphNode[]>();
      for (const [, node] of ctx.graph.nodes) {
        const filePath = node.properties?.filePath;
        if (filePath === undefined) continue;
        const bucket = nodesByFile.get(String(filePath));
        if (bucket) bucket.push(node);
        else nodesByFile.set(String(filePath), [node]);
      }
      for (const [filePath, nodes] of nodesByFile) {
        const scope: FileScope = {
          module: new Map(),
          member: new Map(),
          local: new Map(),
          owner: new Map(),
          bound: new Set(),
        };
        fileScopes.set(filePath, scope);
        const holders = holdersOf(nodes);
        /**
         * The innermost container a declaration is written inside, for declarations that are not containers.
         *
         * **`holdersOf` answers for declarations that can hold one**, which a variable cannot: it would have no
         * children and its span is a single line. But a variable inside a function is exactly the binding that decides
         * whether `Registry.put(…)` names a class or an object, so its holder is the question that has to be answered
         * - and the answer is the same containment the stack above uses, read from the outside in.
         */
        const containers: RangedDeclaration[] = [];
        for (const node of nodes) {
          if (isContainer(node)) containers.push(node);
        }
        containers.sort(
          (left, right) => left.startLine - right.startLine || right.endLine - left.endLine,
        );
        const innermostContainerOf = (declaration: ScopedDeclaration): number | undefined => {
          if (declaration.startLine === null || declaration.endLine === null) return undefined;
          let found: RangedDeclaration | undefined;
          for (const candidate of containers) {
            if (candidate.startLine > declaration.startLine) break;
            if (candidate.endLine < declaration.endLine) continue;
            if (
              candidate.startLine < declaration.startLine ||
              candidate.endLine > declaration.endLine
            ) {
              found = candidate;
            }
          }
          return found?.id;
        };
        for (const node of nodes) {
          if (typeof node.name !== 'string' || node.name.length === 0) continue;
          const where = declarationScope(holders, node);
          const holder = holders.get(node.id);
          // **A binding that is not a callable still shadows one.** Recorded before the kind is tested, because the
          // question this answers - "is this receiver a value here?" - is asked about names a call cannot reach.
          if (!RESOLVABLE_KINDS.has(node.label)) {
            const enclosing = innermostContainerOf(node);
            if (enclosing !== undefined) scope.bound.add(`${String(enclosing)}::${node.name}`);
            continue;
          }
          if (where === 'local') {
            // **A declaration inside a function is that function's**, and the kinds that can be *reached by a name* are
            // the kinds a call can name: a nested `def`, a nested `class`, a nested `TypeAlias`. A local variable is
            // refused, because filing one here would let a mention in one function resolve to a variable in another.
            //
            // **The class case is the one that was missing, and a test suite is where it lives.**
            // `def test_custom_config_class(): class Flask(flask.Flask): …; app = Flask(__name__)` declares a subclass
            // inside a test and instantiates it — a call to a declaration two lines above it, which resolved to the
            // *imported* `Flask` in `flask/app.py` and made the local class look unused.
            const owner = holder;
            if (owner !== undefined) {
              // **Every declaration of the name, not the first one.** `LocalProxy.__init__` defines
              // `_get_current_object` four times, once per branch, and `object.__setattr__(self, "…",
              // _get_current_object)` names whichever branch ran — so the mention is evidence for all four and for
              // none of them in particular. Keeping the first would have left three of them reported as dead code,
              // which is exactly what the measurement said before this line existed.
              const key = `${String(owner.id)}::${node.name}`;
              const known = scope.local.get(key);
              if (known === undefined)
                scope.local.set(key, [{ nodeId: node.id, label: node.label }]);
              else known.push({ nodeId: node.id, label: node.label });
              scope.owner.set(node.id, owner.id);
            }
            continue;
          }
          keepUnique(where === 'member' ? scope.member : scope.module, node.name, {
            nodeId: node.id,
            label: node.label,
          });
        }
      }

      /**
       * What each file says about the types its declarations have, and the classes the graph knows between them.
       *
       * **The one fact a call site writes and the resolver could not read.** `this.index.buildIndex()` names a method
       * of whatever class `index` was declared to be, and until the annotation is read the receiver is a string that
       * matches no declaration: the same-file arm refuses it because it is not the enclosing object, and the
       * global-name arm refuses it because `buildIndex` is declared once and the name says nothing about the receiver.
       * Measured in iteration 42, the two rules that tried to bridge that gap without the type added 55 and 12 edges
       * and **not one correct one**.
       *
       * **Built once, from the symbols the parse phase already produced**, because a type is declared in the file
       * that defines it and used in the file that names it - `this.index` in one file, `class Index` in another.
       */
      const nodeIdOf = (symbol: SymbolDefinition): number | undefined =>
        qnameIndex.get(`project:${ctx.projectId}:${symbol.qualifiedName}`)?.nodeId;

      const classIndex = createClassIndex();
      for (const parsedFile of parseData.parsedFiles) {
        const facts = buildFileTypes(
          parsedFile.symbols.map((symbol) => ({
            name: symbol.name,
            kind: symbol.kind,
            containerName: symbol.containerName,
            properties: symbol.properties ?? {},
            nodeId: nodeIdOf(symbol),
          })),
        );
        mergeClassIndex(classIndex, facts, parsedFile.filePath);
      }

      for (const parsedFile of parseData.parsedFiles) {
        const fileNodeId = ctx.graph.fileIndex.get(parsedFile.filePath);
        if (!fileNodeId) continue;

        // Resolve imports for this file
        const fileImports = importMap.get(parsedFile.filePath);
        // **The files this one imports, which is the evidence a class name is resolved by.** `Flask` extends `App`,
        // and a checkout that vendors an example declaring another `App` makes the simple name ambiguous - the import
        // is what says which one the file means.
        const importedFiles = new Set(fileImports?.keys() ?? []);
        const origin = { file: parsedFile.filePath, imported: importedFiles };

        /**
         * The callables of this file, **narrowest first**.
         *
         * **A call site belongs to the innermost function that contains it**, and the phase used to take the first
         * containing symbol in declaration order, which is the outermost one whenever functions nest. The measured
         * consequence: 40 of the 94 wrong `CALLS` edges on `pallets/flask` were attributed to a function that does not
         * contain the call at all - `def decorator(...)` inside `def view(...)` put every one of the inner body's
         * calls on the outer symbol, and Python's own parser says the owner is the inner one.
         *
         * Sorting once per file rather than filtering per reference keeps the cost where it was: the scan is over
         * symbols, and the innermost containing symbol is the first hit in a narrowness order.
         */
        const callables = parsedFile.symbols
          .filter(
            (symbol) =>
              // **A constructor is a callable, and its body is where the object is wired together.** Leaving it out
              // gave every call written in one no caller at all: `this.initPromise()` in ioredis's `Command` was
              // resolved and then dropped for want of an owner, so `initPromise` looked unreachable while being called
              // from the line above. Python spells it `def __init__`, which is a `Function` and was never affected.
              (symbol.kind === 'Function' ||
                symbol.kind === 'Method' ||
                symbol.kind === 'Constructor') &&
              typeof symbol.qualifiedName === 'string' &&
              symbol.qualifiedName.length > 0,
          )
          .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine));

        /**
         * The class a `this`/`self` written at `line` refers to, **walked out through the scopes that keep it**.
         *
         * A method body is the easy case and was the only one answered: the innermost containing declaration is the
         * method itself and its container is the class. `redis/ioredis@5.4.2` writes the other case four times in one
         * method - `const readyHandler = () => { this.setStatus("ready"); … }` inside `Cluster.connect` - and the
         * innermost containing declaration there is the *arrow*, whose container is `connect`.
         *
         * That shape used to be answered by the file-level member index, which is why nothing noticed; that index is
         * gone for own-scope receivers, because it also answered `this.begin()` with an unrelated class' `begin`. The
         * question it was answering by accident is this one, and the answer is the scope chain: **the nearest
         * enclosing class, reached only across the declarations that preserve the receiver.** An arrow function in a
         * language where `this` is a keyword preserves it; a `function` expression rebinds it, so the walk stops there
         * and answers nothing. In Python `self` is an ordinary closed-over name, so a nested `def` preserves it and the
         * walk continues.
         */
        const enclosingClassOf = (line: number): string | undefined => {
          for (const symbol of callables) {
            if (symbol.startLine > line || symbol.endLine < line) continue;
            const container = containerOf(symbol);
            if (container === undefined) return undefined;
            if (classIndex.classes.has(container)) return container;
            if (!keepsItsThis(parsedFile.language, symbol)) return undefined;
          }
          return undefined;
        };

        /**
         * The node a declaration became, found by identity rather than by name.
         *
         * **The fallback stays**, because a declaration whose node was created by another phase — a tool, a route —
         * has no line to key on, and a name is better than nothing for those.
         */
        const declarationNodeOf = (symbol: SymbolDefinition): number | undefined => {
          const exact = declarationNodes.get(
            `${parsedFile.filePath}::${String(symbol.startLine)}::${symbol.name}::${String(symbol.kind)}`,
          );
          if (exact !== undefined) return exact;
          return ctx.graph?.qnameIndex.get(`project:${ctx.projectId}:${symbol.qualifiedName}`);
        };

        type Reference = (typeof parsedFile.references)[number];

        /**
         * The node of the innermost function a line is written in — the scope a local name belongs to.
         *
         * **`callables` is narrowest first**, so the first containing symbol is the innermost one; taking the first in
         * declaration order instead would answer with the outer function whenever functions nest.
         */
        const enclosingCallableNodeOf = (sourceLine: number): number | undefined => {
          const writer = callables.find(
            (symbol) => symbol.startLine <= sourceLine && symbol.endLine >= sourceLine,
          );
          return writer === undefined ? undefined : declarationNodeOf(writer);
        };

        /**
         * Every local declaration of `name` the function around `sourceLine` holds.
         *
         * **More than one is not a resolution**, it is a set of candidates: `LocalProxy.__init__` declares
         * `_get_current_object` four times, once per branch, and a call to it is evidence for all four and for none of
         * them in particular. The call arm refuses the set and the mention path keeps all of it, which is the same
         * split the ambiguous-name rule makes.
         */
        const localTargetsOf = (name: string, sourceLine: number): Resolved[] => {
          const scope = fileScopes.get(parsedFile.filePath);
          if (scope === undefined) return [];
          // **Outward, one holder at a time.** The innermost function is where a name is looked for first, and a
          // closure is exactly the construct that reads a binding from a function it is written inside.
          let current = enclosingCallableNodeOf(sourceLine);
          while (current !== undefined) {
            const found = scope.local.get(`${String(current)}::${name}`);
            if (found !== undefined && found.length > 0) return found;
            current = scope.owner.get(current);
          }
          return [];
        };

        /**
         * Whether a name written as a receiver is a *value* where the call is written, because a scope binds it.
         *
         * **The one question that keeps a class name from being read as a class.** `Registry.put(…)` reaches the static
         * member of the class `Registry`; `const Registry = { put: … }; Registry.put(…)` inside a function reaches an
         * object. Both are spelled the same, and only the bindings around the call say which one is on the line - which
         * is why this walks outward through every holder rather than asking the file.
         */
        const shadowsLocally = (name: string, sourceLine: number): boolean => {
          const scope = fileScopes.get(parsedFile.filePath);
          if (scope === undefined) return false;
          let current = enclosingCallableNodeOf(sourceLine);
          while (current !== undefined) {
            if (scope.bound.has(`${String(current)}::${name}`)) return true;
            current = scope.owner.get(current);
          }
          return false;
        };

        /**
         * The symbol a bare mention of `name` refers to: the same file, then a file this one imports, then one
         * re-export hop.
         *
         * **Two producers now share it, and they must not drift.** The access arm uses it to turn
         * `callback=_set_app` into evidence; the call arm uses it as the last resort for a call it could not resolve
         * at all (`lambda x: x._get_cache_value(...)`, where `x` has no type). A second implementation of the same
         * three hops is a second answer to the same question, and the one written later is always the one that is
         * wrong.
         */
        const mentionOf = (name: string, sourceLine: number): Resolved[] => {
          // **A mention written as `self._get_file_stream` names `_get_file_stream`.** The Python provider files an
          // attribute use with its full dotted text — `stream_factory=self._get_file_stream` arrived here as
          // `self._get_file_stream` — and an index keyed by declaration name can only answer for the last segment.
          // The call arm has always split the same way (`callee.text.split('.').pop()`); this is the access arm
          // catching up, and it was worth two of werkzeug's eight remaining findings.
          const resolved = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
          // **The scope the mention is written in comes first**, and it is the one place where a repeated name is not
          // an ambiguous name: four `def _get_current_object` in one function are four candidates of one local binding,
          // and the mention reaches all of them.
          const local = localTargetsOf(resolved, sourceLine);
          if (local.length > 0) return local;
          if (ambiguousNames.get(parsedFile.filePath)?.has(resolved) === true) return [];
          let target = fileSymbolIndex.get(parsedFile.filePath)?.get(resolved);
          if (target === undefined && fileImports) {
            for (const [importedFile, importedSymbols] of fileImports) {
              if (!importedSymbols.has(resolved)) continue;
              target = fileSymbolIndex.get(importedFile)?.get(resolved);
              if (target === undefined) {
                // **One re-export hop, for the same reason the call arm needs one**: `from flask import redirect`
                // names a package file that imports the definition rather than making it.
                const reExported = importMap.get(importedFile);
                if (reExported) {
                  for (const [sourceFile, names] of reExported) {
                    if (!names.has(resolved)) continue;
                    target = fileSymbolIndex.get(sourceFile)?.get(resolved);
                    if (target !== undefined) break;
                  }
                }
              }
              if (target !== undefined) break;
            }
          }
          return target === undefined ? [] : [target];
        };

        /**
         * The node a reference is written in: its innermost callable, else its class, else its file.
         *
         * **A module-level mention belongs to the file, because the file is what runs.** `_app_option =
         * click.Option(..., callback=_set_app)` at flask's module scope is a statement executed on import, and it is
         * the only place `_set_app` is ever named — attributing it to "no owner" loses the edge and the function it
         * keeps alive. **A mention inside a class body belongs to the class**, because a class body is executed when
         * the class is created: `_get_cache_value = property(...)` at class scope names a function that runs on
         * attribute access, and attributing it to the file loses the second half of werkzeug's descriptor definitions.
         */
        const mentionSourceOf = (ref: Reference): number | undefined => {
          const graph = ctx.graph;
          if (graph === undefined) return undefined;
          const owner = callables.find(
            (symbol) => symbol.startLine <= ref.sourceLine && symbol.endLine >= ref.sourceLine,
          );
          if (owner !== undefined) {
            return declarationNodeOf(owner);
          }
          const enclosingClass = parsedFile.symbols.find(
            (symbol) =>
              symbol.kind === 'Class' &&
              symbol.startLine <= ref.sourceLine &&
              symbol.endLine >= ref.sourceLine,
          );
          return enclosingClass === undefined
            ? graph.fileIndex.get(parsedFile.filePath)
            : graph.qnameIndex.get(`project:${ctx.projectId}:${enclosingClass.qualifiedName}`);
        };

        // Process references — try to resolve CALLS edges
        for (const ref of parsedFile.references) {
          if (ref.referenceKind === 'call') {
            let target: { nodeId: number; label: NodeLabel } | undefined;
            let arm:
              | 'import'
              | 'sameFile'
              | 'static'
              | 'inherited'
              | 'super'
              | 'receiverType'
              | 'globalUnique' = 'import';

            // **First, try cross-file resolution via imports - and only for a call that writes no receiver.**
            //
            // `x.Command(…)` names a member of `x`; that `Command` is also imported somewhere in the file says nothing
            // about this call. `redis/ioredis@5.4.2` writes `new this.Command(…)` in `Script.execute`, where
            // `this.Command` is an instance property holding a subclass - and the import of the *base* class answered
            // it, pointing the edge at a declaration the call never reaches.
            if (fileImports && ref.receiver === undefined) {
              for (const [resolvedFile, importedSymbols] of fileImports) {
                if (importedSymbols.has(ref.targetName)) {
                  const fileSymbols = fileSymbolIndex.get(resolvedFile);
                  if (fileSymbols) {
                    target = fileSymbols.get(ref.targetName);
                  }
                  // **One re-export hop, because a package file is where a public name is declared.** `from flask
                  // import redirect` names `flask/__init__.py`, which does not define `redirect` - it imports it from
                  // `flask/helpers.py`. Stopping at the package file lost every public name of every package that
                  // re-exports, which is how a library's front door is normally built: measured on `pallets/flask`,
                  // `url_for` and `redirect` at ten call sites were all missed for this reason and nothing else.
                  if (!target) {
                    const reExported = importMap.get(resolvedFile);
                    if (reExported) {
                      for (const [sourceFile, names] of reExported) {
                        if (!names.has(ref.targetName)) continue;
                        target = fileSymbolIndex.get(sourceFile)?.get(ref.targetName);
                        if (target) break;
                      }
                    }
                  }
                  if (target) break;
                }
                // Also try wildcard matching (import * as X from 'y')
                if (importedSymbols.has('*')) {
                  const fileSymbols = fileSymbolIndex.get(resolvedFile);
                  if (fileSymbols) {
                    target = fileSymbols.get(ref.targetName);
                    if (target) break;
                  }
                }
              }
            }

            // **Then a name that is bound to a module, because `alias.member()` is how both languages spell "the member
            // lives in that module".** The import arm above asks whether the *called* name was imported; `from . import
            // cli` imports `cli`, and the call `cli.load_dotenv()` names a member of the file the import bound `cli` to.
            // Measured on `pallets/flask` 3.0.3, that shape is `cli.AppGroup()`, `cli.load_dotenv()` and
            // `cli.show_server_banner(...)` in the framework's own entry points.
            //
            // **Two shapes, and both are read from the import rather than assumed.** `import cli` and `from x import
            // cli` where `cli` is a module bind the name to a file whose module name *is* `cli`; `from . import cli`
            // inside a package binds it to a **submodule of the package the import resolved to**, so the file is
            // `<package>/cli.py`. A binding named `cli` that points at a file which is not a module called `cli` and is
            // not a package is a variable, an instance or a class - and calling a member of that is the receiver's-type
            // arm's question, not this one.
            if (!target && ref.receiver !== undefined && fileImports) {
              const namespace = /^[A-Za-z_$][\w$]*/.exec(ref.receiver)?.[0];
              if (namespace !== undefined) {
                for (const [resolvedFile, importedSymbols] of fileImports) {
                  if (!importedSymbols.has(namespace)) continue;
                  const moduleFile = moduleFileOf(resolvedFile, namespace);
                  if (moduleFile === undefined) continue;
                  const found = fileSymbolIndex.get(moduleFile)?.get(ref.targetName);
                  if (found !== undefined) {
                    target = found;
                    break;
                  }
                }
              }
            }

            // **Then the file itself, which is where a lexical scope starts.** The pass used to skip every same-file
            // call on the grounds that it was "handled elsewhere", and nothing else produced a `CALLS` edge - so
            // `self.validate()` inside a class produced no edge to the `validate` declared forty lines above it, and
            // **16 % of a real repository's functions had any caller at all** (measured on `pallets/flask` 3.0.3:
            // 182 of 1 109). A call resolves to a declaration in its own file when that name is declared **once**
            // there; a name declared twice is ambiguous and stays unresolved, because a wrong edge is worse than a
            // missing one and the reachability pass downstream would inherit it.
            //
            // **And only when the receiver, if there is one, is the object itself.** Measured without this rule, 18 %
            // of the same-file edges on flask pointed at a name as common as `get`, `load` or `close` - because
            // `request.args.get(key)` and `self.get(key)` were indistinguishable. A bare call, or a call on
            // `self`/`this`/`cls`/`super`, is the case where the enclosing scope is the answer.
            //
            // **Two relaxations were tried and both were refused by measurement, not by taste.** Allowing any receiver
            // at all added 55 same-file edges on flask of which **0** were right (precision 94.7 % -> 81.1 %, recall
            // unmoved); allowing a receiver *rooted* in the enclosing object - `this.index.buildIndex()` - added 12 on
            // werkzeug of which **0** were right (95.8 % -> 94.7 %). The calls those relaxations were meant to recover
            // are the `this.field.method()` shape, and recovering them needs the field's **type** - which is the arm
            // below, and not a change to this condition.
            //
            // **A `super` receiver is not own-scope for this arm**, even though the keyword names the enclosing object:
            // the declaration a `super` call reaches is the base's, and the arm below is the one that walks there. Left
            // here it would answer with the override the keyword exists to skip.
            let receiverClass: string | undefined;
            if (!target && isOwnScopeCall(ref.receiver) && !isSuperCall(ref.receiver)) {
              const scope = fileScopes.get(parsedFile.filePath);
              // A receiver of `self`/`cls`/`this` reaches a member; a bare call reaches the module scope, and a member
              // only where the language gives it implicit `this`.
              //
              // **A name the enclosing function declares is reached before either**, because a local binding shadows
              // everything outside it. `def view(): def decorator(): …; return decorator(…)` is the shape every Python
              // decorator in the fixture set is written in, and without this the call resolved to nothing at all — so
              // the only caller an inner function has was invisible and the function read as dead.
              const local =
                ref.receiver === undefined ? localTargetsOf(ref.targetName, ref.sourceLine) : [];
              // **The file's member index is not consulted for a receiver that names the object itself.**
              //
              // It maps a name to every member declaration in the file, whoever declares it, so `this.begin()` inside
              // `Outsider` answers `Unrelated.begin` - the same file, the same name, no relation. That is the
              // coincidence the deleted global-name arm was made of, one file smaller. The question `this.m()` asks is
              // "does the class this call sits in, or a base it declares, declare `m`", and the arm below asks exactly
              // that of exactly the class chain. What is left here is the module scope a bare call reaches, which is a
              // different question and belongs to this arm.
              const member =
                ref.receiver === undefined
                  ? resolvable(scope?.member.get(ref.targetName))
                  : undefined;
              const module = resolvable(scope?.module.get(ref.targetName));
              target =
                // A local name with more than one declaration is a set of candidates rather than an answer; the
                // mention path below keeps all of them as `ACCESSES` edges, which is the honest form of the fact.
                local.length > 1
                  ? undefined
                  : local.length === 1
                    ? (local[0] as Resolved)
                    : ref.receiver === undefined && !hasImplicitThis(parsedFile.language)
                      ? module
                      : (member ?? module);
              if (target) arm = 'sameFile';
            }

            // **Then a receiver that names a class, which is a static call.**
            //
            // `ParseStatus.mergeObjectSync(…)` is how `colinhacks/zod` moves a parsed pair from the async half to the
            // sync one, and the name `mergeObjectSync` is declared once in that file — the call was still unresolved,
            // because the arm above accepts a receiver only when it *is* the enclosing object and a class name is not
            // `this`. Two names sit next to each other in `lib/Command.ts` of `redis/ioredis` that make the same point:
            // `utils.convertMapToArray(…)` is a namespace, `Command.setArgumentTransformer(…)` is an object.
            //
            // **The receiver has to *be* a class, and that is the whole evidence.** A rule keyed on the member name
            // would answer `alias.put(…)` with `Registry.put` — the same name on a receiver that is a value — so the
            // binding is read first: any scope between the call and the module that binds the receiver's name makes
            // the receiver a value, and this arm answers nothing.
            if (
              !target &&
              ref.receiver !== undefined &&
              !isOwnScopeCall(ref.receiver) &&
              !shadowsLocally(ref.receiver, ref.sourceLine)
            ) {
              const member = classMemberOf(classIndex, ref.receiver, ref.targetName, origin);
              if (member !== undefined) {
                target = member;
                arm = 'static';
                receiverClass = ref.receiver;
              }
            }

            // **Then the class the call is written inside, and the bases it declares.**
            //
            // A member a class does not declare may still be a member of the class, because a base declares it:
            // `Flask.__init__` calls `self.add_url_rule(...)` and `add_url_rule` is declared on `App` in
            // `flask/sansio/app.py`. The same-file arm cannot see it - the declaration is in another file - and the
            // global-name arm was the crude version of this rule, resolving a name declared once anywhere in the graph
            // for any receiver that happened to be own-scope. This arm asks the only question that has an answer: does
            // the class this call sits in, or a base it declares, declare this member?
            //
            // **Two shapes, and the difference is the keyword.** `self.m()` starts at the class and walks up, so an
            // override is what runs and the nearest declaration wins. `super().m()` / `super.m()` starts at the base,
            // because that is what the keyword means - starting at the class would point the edge at the override the
            // call exists to skip.
            //
            // **A bare call is own-scope only where the language gives a method implicit `this`**, which is the same
            // condition the same-file arm applies: `m()` inside a Java or Kotlin method is `this.m()`, and inside a
            // Python method it is the module's `m`.
            let inheritedFrom: string | undefined;
            if (!target) {
              const sup = ref.receiver !== undefined && isSuperReceiver(ref.receiver);
              const ownScope =
                ref.receiver === undefined
                  ? hasImplicitThis(parsedFile.language)
                  : isOwnScopeCall(ref.receiver);
              if (sup || ownScope) {
                const ownerClass = enclosingClassOf(ref.sourceLine);
                if (ownerClass !== undefined) {
                  // **`self.m()` searches the whole class chain, not only the class it is written in.** A mixin's
                  // method called from a subclass — `self._get_cache_value(...)` inside werkzeug's
                  // `ResponseCacheControl(_CacheControl)` — is a call to a declaration the enclosing class does not
                  // make, and the own-scope arm stopped at `classMemberOf` and returned nothing. That is the same
                  // statement `super()` makes, one link further up, so it is the same walk: the base chain is the
                  // receiver's scope whenever the receiver *is* the enclosing object.
                  const member = sup
                    ? baseMemberOf(classIndex, ownerClass, ref.targetName, origin)
                    : (classMemberOf(classIndex, ownerClass, ref.targetName, origin) ??
                      baseMemberOf(classIndex, ownerClass, ref.targetName, origin));
                  if (member !== undefined) {
                    target = member;
                    arm = sup ? 'super' : 'inherited';
                    inheritedFrom = ownerClass;
                  }
                }
              }
            }

            // **Then the receiver's type, which is the only rule that can say what `this.index.buildIndex()` calls.**
            //
            // **The two arms around this one are name-based** - the same-file arm asks the file, the global-name arm
            // asks the whole graph - and both are asking the wrong question about a call written on a field. `this.index.buildIndex()` names `buildIndex`, which the
            // file may declare once - on the class `index` happens to be an instance of - and without reading the
            // annotation there is nothing to prefer it over `request.args.get(key)`'s `get`. That is what the thirty
            // minutes spent widening the same-file rule in iteration 42 was actually measuring: **55 added edges on
            // flask, 0 correct; 12 on werkzeug, 0 correct**, because the discriminator was never the receiver's
            // spelling. It is the receiver's type, and the type is written on the field the receiver names.
            //
            // **Placed before the global-name arm, because it is stronger evidence than that one and weaker than the
            // two above it**: an import says where a name comes from, a file scope says it is the only declaration
            // there, and a receiver's class says which class's member this is. When this arm answers, the arm recorded
            // on the edge is this one, so the precision of the rule is measured rather than averaged away.
            if (!target && ref.receiver !== undefined) {
              // **The facts are optional and the rule is what handles that**, rather than a guard here: a file the
              // parse phase reported but that contributed no declarations has no type facts, and a rule that is only
              // ever handed a value is a rule whose "no facts" path nobody ever exercises.
              //
              // **The owners are a chain, and the chain is passed rather than a name.** A local is visible to the
              // functions it is nested in - `const _this = this` in `connect`, used inside a callback in `connect` -
              // so the question "what is this name here" is asked of every enclosing function, innermost first.
              const owners = callables
                .filter(
                  (symbol) =>
                    symbol.startLine <= ref.sourceLine && symbol.endLine >= ref.sourceLine,
                )
                .map((symbol) => ownerKeyOf(containerOf(symbol), symbol.name));
              const receiverType = receiverTypeOf(
                { index: classIndex, origin, owners },
                ref.receiver,
              );
              if (receiverType !== undefined) {
                const member = classMemberOf(
                  classIndex,
                  receiverType.className,
                  ref.targetName,
                  origin,
                );
                if (member !== undefined) {
                  target = member;
                  arm = 'receiverType';
                  receiverClass = receiverType.className;
                }
              }
            }

            // **The global-name arm is gone, and its measurement is why.** It resolved an own-scope call to a name
            // declared once in the whole graph, in another file, and it existed because nothing else could reach a
            // method inherited from a base class - which is what the `inherited` arm above now does with evidence
            // rather than by coincidence. What was left for it was a name declared once anywhere that no class chain
            // reaches: measured across four corpora it claimed 4 edges on the two Python checkouts of which **1** was
            // right, and 16 on the two TypeScript checkouts of which **0** were. An arm whose claims are wrong is a
            // precision sink, and removing it is the cheapest precision ever bought.
            if (target) {
              // The innermost callable containing this reference, which is the first hit in narrowness order.
              const owner = callables.find(
                (symbol) => symbol.startLine <= ref.sourceLine && symbol.endLine >= ref.sourceLine,
              );
              if (owner) {
                const sourceNode = declarationNodeOf(owner);
                if (sourceNode !== undefined && sourceNode !== target.nodeId) {
                  try {
                    const edge = builder.addEdge(
                      ctx.graph,
                      sourceNode,
                      target.nodeId,
                      EDGE_CALLS,
                      ctx.projectId,
                    );
                    // Written on the edge so a consumer - and a precision measurement - can tell an import
                    // resolution from an inference. `receiver` is kept beside it because the arm that follows an
                    // import does not require the receiver to be the enclosing object, and the ones that do are the
                    // ones where a foreign receiver would be a defect.
                    //
                    // **`sourceLine` is here because a call site's identity is `(caller, callee, line)`.** Without the
                    // line, two edges for one call site and one function calling one callee from two statements have
                    // the same shape in the graph - which is how a provider that emitted every call twice survived a
                    // suite of graph assertions. A line is also what an impact answer prints next to a caller.
                    edge.properties = {
                      ...edge.properties,
                      resolution: arm,
                      sourceLine: ref.sourceLine,
                      ...(ref.receiver === undefined ? {} : { receiver: ref.receiver }),
                      // **The class the receiver was read to be**, when a type answered the call. It is the evidence
                      // for the edge, and the difference between `this.index.buildIndex()` (a `Index`) and
                      // `request.args.get(key)` (nothing) is exactly what a review of this edge needs to see.
                      ...(receiverClass === undefined ? {} : { receiverClass }),
                      // **The class whose inheritance chain answered**, when a base's member did. `inherited` and
                      // `super` both reach a declaration the enclosing class does not make, and which class the walk
                      // started from is the whole of the evidence.
                      ...(inheritedFrom === undefined ? {} : { inheritedFrom }),
                    };
                    callsByArm[arm] = (callsByArm[arm] ?? 0) + 1;
                    referencesResolved++;
                  } catch {
                    // Edge may already exist
                  }
                }
              } else {
                // **A call at module scope has no caller, and it still runs.**
                //
                // `_find_exceptions()` at the bottom of `werkzeug/exceptions.py` is followed by
                // `del _find_exceptions` — a one-shot idiom that defines a function, calls it once, and removes the
                // name. The call resolves perfectly and the edge was then dropped for want of an enclosing callable,
                // so the function read as dead. It becomes an `ACCESSES` edge from the **file** rather than a `CALLS`
                // edge from nowhere: a file is a node that runs, the call graph stays free of a caller that does not
                // exist, and reachability — the reader that asks whether anything can run this — gets the fact.
                const sourceNode = mentionSourceOf(ref);
                if (sourceNode !== undefined && sourceNode !== target.nodeId) {
                  try {
                    const edge = builder.addEdge(
                      ctx.graph,
                      sourceNode,
                      target.nodeId,
                      EDGE_ACCESSES,
                      ctx.projectId,
                    );
                    edge.properties = {
                      ...edge.properties,
                      sourceLine: ref.sourceLine,
                      resolution: 'module-level-call',
                    };
                    referencesResolved++;
                  } catch {
                    // Edge may already exist
                  }
                }
              }
            }

            // **A call nothing could resolve is still a mention of the name, and the last resort is to record it as
            // one.**
            //
            // `lambda x: x._get_cache_value(key, empty, type)` calls a method through a parameter with no annotation,
            // so no arm here can say what `x` is — and `werkzeug` wires its whole property layer that way. Dropping the
            // reference made every method it names read as dead, which the measurement then scored as a wrong claim:
            // three of werkzeug's findings were exactly this shape.
            //
            // So the site becomes an `ACCESSES` edge **and not a `CALLS` edge**: the source does depend on that name,
            // and the call graph must not be told a call goes to a specific declaration when the receiver was never
            // typed. `resolution: 'unresolved-mention'` is on the edge, so a reader of the report sees why the symbol
            // is alive and can disagree with the rule rather than with the finding.
            if (!target) {
              const sourceNode = mentionSourceOf(ref);
              if (sourceNode !== undefined) {
                for (const mentioned of mentionOf(ref.targetName, ref.sourceLine)) {
                  if (mentioned.nodeId === sourceNode) continue;
                  builder.addEdge(
                    ctx.graph,
                    sourceNode,
                    mentioned.nodeId,
                    EDGE_ACCESSES,
                    ctx.projectId,
                  ).properties = {
                    sourceLine: ref.sourceLine,
                    resolution: 'unresolved-mention',
                  };
                  unresolvedMentions++;
                }
              }
            }
          } else if (ref.referenceKind === 'access') {
            // **A function used as a value is reachable, and nothing in the graph said so.**
            //
            // `callback=_set_app`, `handlers[name] = dispatch`, `signals.connect(on_ready)`: each of these *invokes*
            // the named function later, and none of them is a call site, so the call graph has no edge for it and a
            // detector reading only `CALLS` reports the function as dead. **On `pallets/flask@3.0.3` that was 38 of
            // the 39 findings** — every one of them a name that occurs in the file, passed rather than called.
            //
            // So a reference that is not a call becomes an `ACCESSES` edge from the callable that mentions the name to
            // the symbol it names. **It is deliberately not a `CALLS` edge**: no call happens at this site, and
            // recording one would inflate the call graph with sites the oracle would score as wrong. What it says is
            // exactly what the source says — this code depends on that symbol — and reachability is the reader that
            // asks for no more than that.
            const targets = mentionOf(ref.targetName, ref.sourceLine);
            if (targets.length > 0) {
              const sourceNode = mentionSourceOf(ref);
              if (sourceNode !== undefined) {
                for (const target of targets) {
                  if (target.nodeId === sourceNode) continue;
                  builder.addEdge(
                    ctx.graph,
                    sourceNode,
                    target.nodeId,
                    EDGE_ACCESSES,
                    ctx.projectId,
                  ).properties = { sourceLine: ref.sourceLine, resolution: 'mention' };
                }
              }
            }
          }
        }

        // Process class inheritance (EXTENDS edges)
        for (const symbol of parsedFile.symbols) {
          if (symbol.kind === 'Class') {
            const baseClasses = symbol.properties['baseClasses'] as string | undefined;
            if (baseClasses) {
              for (const baseClass of baseClasses
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)) {
                let target = qnameIndex.get(baseClass);
                // Try cross-file resolution for extends
                if (!target && fileImports) {
                  for (const [resolvedFile] of fileImports) {
                    const fileSymbols = fileSymbolIndex.get(resolvedFile);
                    if (fileSymbols) {
                      target = fileSymbols.get(baseClass);
                      if (target) break;
                    }
                  }
                }
                // Third fallback: same-file lookup — resolve by searching the same file's symbols
                if (!target) {
                  const sameFileNodes = fileSymbolIndex.get(parsedFile.filePath);
                  if (sameFileNodes) {
                    target = sameFileNodes.get(baseClass);
                  }
                }
                if (target) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNodeId = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNodeId,
                        target.nodeId,
                        EDGE_EXTENDS,
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                }
              }
            }

            // IMPLEMENTS edges for interfaces
            const interfaces = symbol.properties['interfaces'] as string | undefined;
            if (interfaces) {
              for (const iface of interfaces
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)) {
                let target = qnameIndex.get(iface);
                if (!target && fileImports) {
                  for (const [resolvedFile] of fileImports) {
                    const fileSymbols = fileSymbolIndex.get(resolvedFile);
                    if (fileSymbols) {
                      target = fileSymbols.get(iface);
                      if (target) break;
                    }
                  }
                }
                // Third fallback: same-file lookup — resolve by searching the same file's symbols
                if (!target) {
                  const sameFileNodes = fileSymbolIndex.get(parsedFile.filePath);
                  if (sameFileNodes) {
                    target = sameFileNodes.get(iface);
                  }
                }
                if (target) {
                  const sourceQname = `project:${ctx.projectId}:${symbol.qualifiedName}`;
                  const sourceNodeId = ctx.graph.qnameIndex.get(sourceQname);
                  if (sourceNodeId) {
                    try {
                      builder.addEdge(
                        ctx.graph,
                        sourceNodeId,
                        target.nodeId,
                        EDGE_IMPLEMENTS,
                        ctx.projectId,
                      );
                      referencesResolved++;
                    } catch {
                      // Edge may already exist
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Call sites, from the same two things this phase already has in hand: the parsed files and their
      // references. The phase resolved calls inline above to build CALLS edges and then kept only a count; the
      // CFG-based taint subsystem needs the calls themselves, and this is where they become available.
      const references = parseData.parsedFiles.flatMap((file) => file.references);
      const callSites = buildCallSites(parseData.parsedFiles, references);
      let callSiteCount = 0;
      for (const sites of callSites.values()) callSiteCount += sites.length;

      ctx.phaseData.set('scopeResolution', {
        referencesResolved,
        unresolvedMentions,
        callSites,
        callSiteCount,
        callsByArm,
      });

      return {
        phaseId: this.id,
        status: 'success',
        output: { referencesResolved, unresolvedMentions, callSiteCount, callsByArm },
      };
    } catch (err) {
      this.logger.error(
        'Phase execution failed',
        err instanceof Error ? err : new Error(String(err)),
        { phaseId: this.id, filePath: ctx?.rootPath },
      );
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
