// @code-analyzer/analyzer — Pipeline Phase: ScopeResolution

import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import {
  PhaseLogger,
  createNoopPhaseLogger,
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

import type { FileTypes } from '../../resolution/receiver-types.js';
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
  peers: readonly ScopedDeclaration[],
  declaration: ScopedDeclaration,
): 'module' | 'member' | 'local' {
  const isType = (kind: NodeLabel): boolean =>
    kind === 'Class' || kind === 'Interface' || kind === 'Enum';
  // A node with no span is a declaration a provider could not place; it is module scope by default because that is
  // the widest claim and the one a lookup is allowed to fall back to.
  if (declaration.startLine === null || declaration.endLine === null) return 'module';
  const span = declaration.endLine - declaration.startLine;
  let local = false;
  let member = false;
  let narrowest = Number.POSITIVE_INFINITY;
  for (const candidate of peers) {
    if (candidate === declaration) continue;
    // **Only a declaration can hold a declaration.** The file node spans every line of the file and carries a
    // `filePath`, so counting it as a container makes every symbol in the file local - which is what the first
    // version of this function did, and the reason its own test found nothing at all.
    if (!CONTAINER_KINDS.has(candidate.label)) continue;
    if (candidate.startLine === null || candidate.endLine === null) continue;
    if (candidate.startLine > declaration.startLine || candidate.endLine < declaration.endLine)
      continue;
    // **Strictly wider, because a file's symbols are not disjoint.** A one-line arrow function and the function that
    // holds it can share a line range, and reading "contains" as "contains or equals" makes every declaration look
    // nested inside whichever one it was compared with - which filed whole files into the local scope.
    const candidateSpan = candidate.endLine - candidate.startLine;
    if (candidateSpan <= span) continue;
    const holds = !isType(candidate.label);
    if (!holds && !isType(candidate.label)) continue;
    if (candidateSpan > narrowest) continue;
    narrowest = candidateSpan;
    local = holds;
    member = !holds;
  }
  if (narrowest === Number.POSITIVE_INFINITY) return 'module';
  return local ? 'local' : member ? 'member' : 'module';
}

/** The two facts about nesting that a line range can answer. */
interface ScopedDeclaration {
  readonly label: NodeLabel;
  readonly startLine: number | null;
  readonly endLine: number | null;
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
          output: { referencesResolved: 0, callSiteCount: 0, callsByArm: {} },
        };
      }

      // Read crossFile phase data for import resolution
      const crossFileData = ctx.phaseData.get('crossFile') as
        { resolvedImports: ResolvedImport[]; importEdgesCreated: number } | undefined;

      const builder = new GraphBuilder(null as unknown as InMemoryGraphStore);
      let referencesResolved = 0;
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
       * Simple name → the declaration, per file, which is the scope a call actually resolves in.
       *
       * **The per-file index and not a global one**, because a simple name is only evidence inside the file that
       * writes it; the cross-file question is answered by imports and by class chains, which are facts rather than
       * coincidences.
       */
      const fileScopes = new Map<string, FileScope>();

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
        const scope: FileScope = { module: new Map(), member: new Map() };
        fileScopes.set(filePath, scope);
        for (const node of nodes) {
          if (!RESOLVABLE_KINDS.has(node.label)) continue;
          if (typeof node.name !== 'string' || node.name.length === 0) continue;
          const where = declarationScope(nodes, node);
          // A declaration inside a function is nobody else's to call: skip it rather than file it anywhere.
          if (where === 'local') continue;
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

      const typeFacts = new Map<string, FileTypes>();
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
        typeFacts.set(parsedFile.filePath, facts);
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
              (symbol.kind === 'Function' || symbol.kind === 'Method') &&
              typeof symbol.qualifiedName === 'string' &&
              symbol.qualifiedName.length > 0,
          )
          .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine));

        // Process references — try to resolve CALLS edges
        for (const ref of parsedFile.references) {
          if (ref.referenceKind === 'call') {
            let target: { nodeId: number; label: NodeLabel } | undefined;
            let arm:
              'import' | 'sameFile' | 'inherited' | 'super' | 'receiverType' | 'globalUnique' =
              'import';

            // First, try cross-file resolution via imports
            if (fileImports) {
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
            if (!target && isOwnScopeCall(ref.receiver) && !isSuperCall(ref.receiver)) {
              const scope = fileScopes.get(parsedFile.filePath);
              // A receiver of `self`/`cls`/`this` reaches a member; a bare call reaches the module scope, and a member
              // only where the language gives it implicit `this`.
              const member = resolvable(scope?.member.get(ref.targetName));
              const module = resolvable(scope?.module.get(ref.targetName));
              target =
                ref.receiver === undefined && !hasImplicitThis(parsedFile.language)
                  ? module
                  : (member ?? module);
              if (target) arm = 'sameFile';
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
                const owner = callables.find(
                  (symbol) =>
                    symbol.startLine <= ref.sourceLine && symbol.endLine >= ref.sourceLine,
                );
                const ownerClass = owner === undefined ? undefined : containerOf(owner);
                if (ownerClass !== undefined) {
                  const member = sup
                    ? baseMemberOf(classIndex, ownerClass, ref.targetName, origin)
                    : classMemberOf(classIndex, ownerClass, ref.targetName, origin);
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
            let receiverClass: string | undefined;
            if (!target && ref.receiver !== undefined) {
              // **The facts are optional and the rule is what handles that**, rather than a guard here: a file the
              // parse phase reported but that contributed no declarations has no type facts, and a rule that is only
              // ever handed a value is a rule whose "no facts" path nobody ever exercises.
              const owner = callables.find(
                (symbol) => symbol.startLine <= ref.sourceLine && symbol.endLine >= ref.sourceLine,
              );
              const receiverType = receiverTypeOf(
                typeFacts.get(parsedFile.filePath),
                ref.receiver,
                owner === undefined ? undefined : ownerKeyOf(containerOf(owner), owner.name),
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
                const sourceQname = `project:${ctx.projectId}:${owner.qualifiedName}`;
                const sourceNode = ctx.graph.qnameIndex.get(sourceQname);
                if (sourceNode && sourceNode !== target.nodeId) {
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
        callSites,
        callSiteCount,
        callsByArm,
      });

      return {
        phaseId: this.id,
        status: 'success',
        output: { referencesResolved, callSiteCount, callsByArm },
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
