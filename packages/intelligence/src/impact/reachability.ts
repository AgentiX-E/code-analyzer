// Whether a symbol can ever run, and the two surfaces that keep one alive.
//
// **The feature a competitor ships and this product did not** — and the reason the first draft of it was wrong. The
// draft asked "does this function have an incoming `CALLS` edge", which is the question every cheap dead-code tool
// asks, and on `pallets/flask@3.0.3` it answers **979 of 1 109 functions** — a report in which nine tenths of a
// published library is dead. The defect is not a threshold. **A function called only by a function that is itself
// dead is dead**, and an edge-count cannot see that; and **a method nothing in the repository calls is the normal
// state of a library's public API**, which an edge-count cannot see either.
//
// So the question is asked the way a linker asks it: from roots, over use edges, transitively.
//
// **Two surfaces, because two different things keep code alive.**
//
//   * the **executed surface** — what a run can reach: entry points, routes a framework dispatches, tests a runner
//     collects. A symbol reachable from here runs when the program runs.
//   * the **published surface** — what another repository can reach through this package's public names. `Flask.run`
//     has no caller anywhere in flask's own sources and is not dead; it is the API. The same is true of
//     `zod`'s exported schemas and of every Spring controller a `@RestController` annotation registers.
//
// **A symbol is dead only when both surfaces miss it**, and the report says which surface kept each survivor alive,
// because "not called here" and "not reachable at all" are different statements and only the second is a finding.
//
// **What this deliberately does not model**, stated so the report can be read for what it is: a call through
// reflection or a string-keyed dispatcher, a symbol reached only through a configuration file, and a symbol reached
// only by code outside the analysed root. Those are the escapes that make a dead-code report a *lead* rather than a
// verdict, which is why every finding carries the rule that produced it and why `ignoreNames` exists.

import {
  EDGE_ACCESSES,
  EDGE_CALLS,
  EDGE_EXTENDS,
  EDGE_HANDLES,
  EDGE_HANDLES_ROUTE,
  EDGE_HAS_METHOD,
  EDGE_IMPLEMENTS,
  EDGE_INSTANTIATES,
  EDGE_METHOD_IMPLEMENTS,
  EDGE_METHOD_OVERRIDES,
} from '@code-analyzer/shared';

import type { GraphNode, KnowledgeGraph, NodeLabel } from '@code-analyzer/shared';

/** Why a node is a root. Printed in the report so a reader can disagree with the rule rather than with the finding. */
export type RootKind = 'entry' | 'route' | 'test' | 'published' | 'declared';

export interface ReachRoot {
  readonly nodeId: number;
  readonly kind: RootKind;
  readonly because: string;
}

/** How a symbol stays alive, or that it does not. */
export type Liveness = 'entry' | 'called' | 'published' | 'dead';

export interface DeadSymbol {
  readonly nodeId: number;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly label: NodeLabel;
  readonly startLine: number | null;
  /** The rule that made it a finding, in a sentence a reader can check. */
  readonly because: string;
}

export interface ReachabilityOptions {
  /** Names a runtime calls with no call site in the repository. Added to the built-in list, never instead of it. */
  readonly entryNames?: readonly string[];
  /** Files whose contents are executed rather than imported. Added to the built-in list. */
  readonly entryFiles?: readonly RegExp[];
  /** Qualified names or globs that are roots whatever the graph says. */
  readonly entryPoints?: readonly string[];
  /** Names that are never reported, for the escapes this analysis does not model. */
  readonly ignoreNames?: readonly string[];
  /** Report symbols in test files too. A test helper nothing calls is dead like anything else, so this is on. */
  readonly includeTests?: boolean;
}

export interface ReachabilityReport {
  readonly roots: ReachRoot[];
  /** Function-like and class nodes the question was asked about. */
  readonly considered: number;
  readonly reachableFromEntry: number;
  readonly reachableFromPublished: number;
  /** **Zero here means the graph cannot answer the question**, and every list below is empty because of that. */
  readonly callEdges: number;
  readonly dead: DeadSymbol[];
  /** Not executed inside this repository, but part of a surface something outside it can reach. */
  readonly published: DeadSymbol[];
  readonly ignored: number;
}

/** Edges along which "this can run" implies "the target can run". */
const REACHING_EDGES: ReadonlySet<string> = new Set([
  EDGE_CALLS,
  // **A name mentioned is a name depended on.** A function passed as a callback, stored in a dispatch table or
  // registered with a signal is invoked by something this graph cannot see, so the mention is the only evidence there
  // is — and without it the detector reports the product's own `callback=...` idiom as 38 dead functions on flask.
  EDGE_ACCESSES,
  EDGE_INSTANTIATES,
  EDGE_HANDLES,
  EDGE_HANDLES_ROUTE,
  EDGE_HAS_METHOD,
  EDGE_EXTENDS,
  EDGE_IMPLEMENTS,
  EDGE_METHOD_IMPLEMENTS,
  EDGE_METHOD_OVERRIDES,
]);

/**
 * An edge whose two ends are invoked interchangeably.
 *
 * **An override is reached when the call goes through the base type**, and a base implementation is reached when a
 * caller holds the subclass — so the pass reads these edges in both directions. Without that, every override in a
 * repository whose calls resolve to the interface looks dead, which is the second-largest false-positive class a
 * dead-code tool has.
 */
const BIDIRECTIONAL_EDGES: ReadonlySet<string> = new Set([
  EDGE_METHOD_OVERRIDES,
  EDGE_METHOD_IMPLEMENTS,
]);

/** Names a runtime invokes without a call site. */
const ENTRY_NAMES: ReadonlySet<string> = new Set([
  'main',
  '__main__',
  'activate',
  'deactivate',
  'bootstrap',
  'setup',
  'teardown',
]);

/** Files that are executed rather than imported. */
const ENTRY_FILES: readonly RegExp[] = [
  /(^|\/)(bin|scripts?)\/[^/]+$/,
  // **A file under `benchmarks/` is a program, not a library.** `zod` ships `src/benchmarks/realworld.ts`, which builds
  // a schema and times it: its helpers are called from its own top level and nowhere else, which is what every script
  // looks like. Four of the last four findings on `colinhacks/zod@3.23.8` were exactly this file.
  /(^|\/)(benchmarks?|perf)\/[^/]+$/,
  /(^|\/)(manage|setup|conftest|noxfile|fabfile|wsgi|asgi)\.py$/,
  /(^|\/)[^/]*\.config\.[cm]?[jt]s$/,
];

/** A file that carries a package's public names: `__init__.py`, or a JavaScript/TypeScript entry module. */
const PACKAGE_ENTRY_FILE = /(^|\/)__init__\.py$|(^|\/)index\.[cm]?[jt]sx?$/;

/**
 * Directories a repository ships *with* a package rather than *as* one.
 *
 * **`tests/__init__.py` is a package in the Python sense and not part of what anyone imports from the repository**, and
 * a rule that published it would keep every test helper alive. The list is a statement about what a repository's front
 * door is, and it is short on purpose.
 */
const NOT_PUBLISHED: ReadonlySet<string> = new Set([
  'test',
  'tests',
  'testing',
  '__tests__',
  'example',
  'examples',
  'sample',
  'samples',
  'docs',
  'doc',
  'scripts',
  'tools',
  'benchmarks',
  'fixtures',
  'vendor',
]);

const CALLABLE_LABELS: ReadonlySet<string> = new Set(['Function', 'Method', 'Constructor']);

function isCallable(label: NodeLabel): boolean {
  return CALLABLE_LABELS.has(String(label));
}

/** A name another repository can reach by asking for it: no leading underscore, in either language's convention. */
function isPublicName(name: string): boolean {
  return name.length > 0 && !name.startsWith('_');
}

/** The path segments of a file, in the coordinates the graph was built in. */
function segments(filePath: string): string[] {
  return filePath.split(/[\\/]/).filter((part) => part.length > 0);
}

/**
 * The directories this repository publishes as packages.
 *
 * **A package is a directory with an entry module**, and whether it is published is decided by what is *above* it, not
 * by what is beside it. The first version of this rule asked whether the entry's grandparent was one of `src`, `lib`,
 * `source`, `packages` — which is true of `src/flask/__init__.py` and false of `src/index.ts`, where the package *is*
 * `src`. The measured consequence: on `colinhacks/zod@3.23.8` the published surface came back **empty**, so all 191
 * symbols the package exports were reported as dead — a report that says the library has no API. A layout rule that
 * only holds when the checkout happens to be named like the package is not a rule, it is a coincidence.
 *
 * So the test is the one that survives a different layout: a directory that holds an entry module publishes, unless it
 * or any directory above it is one of the places a repository keeps things that are not the package — `tests`,
 * `examples`, `docs`, `benchmarks`. `src/`, `lib/`, `app/` and `flask/` all pass; `tests/fixtures/` does not.
 */
export function publishedRoots(graph: KnowledgeGraph): ReadonlySet<string> {
  // **Every file the graph mentions, not only the `File` nodes.** A graph without them is an index built without the
  // structure phase, and reading "no `File` nodes" as "nothing is published" turns every public name in the repository
  // into a dead-code finding — the loudest possible way to be wrong.
  const files = new Set<string>();
  for (const node of graph.nodes.values()) if (node.filePath !== null) files.add(node.filePath);
  const published = new Set<string>();
  for (const file of files) {
    if (!PACKAGE_ENTRY_FILE.test(file)) continue;
    const ancestors = segments(file).slice(0, -1);
    // **A root-level entry file names no package.** `segments('/index.ts')` is one part, so there is no directory to
    // publish and the filesystem root is not a package name.
    if (ancestors.length === 0) continue;
    // **Every ancestor, and the directory itself.** `examples/tutorial/flaskr/__init__.py` is a tutorial's package and
    // publishing it would make every name in it public API, which is how the tutorial's own helpers survived the first
    // measurement as "published" while nothing imported them.
    if (ancestors.some((part) => NOT_PUBLISHED.has(part))) continue;
    published.add(ancestors[ancestors.length - 1] as string);
  }
  return published;
}

function inPublishedTree(filePath: string, published: ReadonlySet<string>): boolean {
  if (published.size === 0) return false;
  const parts = segments(filePath);
  return parts.some((part) => published.has(part));
}

/**
 * Whether the manifest of the language says this name is exported.
 *
 * **Python has no export keyword and the field is `false` on every Python node**, which is why the convention carries
 * the answer there: a name without a leading underscore in a published package is reachable by import. TypeScript does
 * have the keyword, and `properties.exported` is where the parser records it.
 */
function declaresExport(node: GraphNode): boolean {
  if (node.properties['exported'] === 'true') return true;
  return node.language !== null && /python/i.test(String(node.language)) && isPublicName(node.name);
}

/** A symbol the graph files under a class, and the class it is filed under. */
interface MemberHome {
  readonly classId: number;
  readonly className: string;
  readonly memberName: string;
}

interface Members {
  /** Class node id → the members the graph files under it. */
  readonly byClass: Map<number, number[]>;
  /** Member node id → the class it belongs to. */
  readonly classOf: Map<number, MemberHome>;
}

function membersOf(graph: KnowledgeGraph): Members {
  const byClass = new Map<number, number[]>();
  const classOf = new Map<number, MemberHome>();
  const add = (owner: GraphNode, member: GraphNode): void => {
    const known = byClass.get(owner.id);
    if (known === undefined) byClass.set(owner.id, [member.id]);
    else known.push(member.id);
    classOf.set(member.id, {
      classId: owner.id,
      className: owner.name,
      memberName: member.name,
    });
  };

  // **Not `MEMBER_OF`.** That edge names a community, not a container — the graph uses it to file every node under
  // the community it was partitioned into — so reading it as "this method belongs to this class" would hang every
  // method of a repository off the first `Community` node and make the published-member rule meaningless.
  //
  // **The container the parsers record is `enclosingClass`, a simple name**, so it is resolved against the classes in
  // the member's own file first and against the unique class of that name second: a repository may declare two
  // classes called `Builder` in two files, and a method in one of them belongs to the one beside it.
  const classesByName = new Map<string, GraphNode[]>();
  for (const node of graph.nodes.values()) {
    if (node.label !== 'Class') continue;
    const known = classesByName.get(node.name);
    if (known === undefined) classesByName.set(node.name, [node]);
    else known.push(node);
  }

  for (const node of graph.nodes.values()) {
    const container = node.properties['enclosingClass'];
    if (typeof container !== 'string') continue;
    const candidates = classesByName.get(container) ?? [];
    const sameFile = candidates.find((candidate) => candidate.filePath === node.filePath);
    const owner = sameFile ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (owner !== undefined) add(owner, node);
  }

  // **`HAS_METHOD` is the other half of the same fact, and it is the half TypeScript uses.**
  //
  // The Python provider writes `enclosingClass` on a method; the TypeScript provider does not, and writes
  // `Cluster --HAS_METHOD--> quit` instead. Reading only the property left every TypeScript method parentless, so the
  // "a published class publishes its public members" rule had nothing to publish: measured on
  // `redis/ioredis@5.4.2`, 51 of 51 findings were methods of `Redis`, `Cluster`, `Pipeline` and `Commander` — four
  // classes the package exports by name.
  for (const edge of graph.edges.values()) {
    if (String(edge.type) !== EDGE_HAS_METHOD) continue;
    const owner = graph.nodes.get(edge.sourceId);
    const member = graph.nodes.get(edge.targetId);
    if (owner === undefined || member === undefined || owner.label !== 'Class') continue;
    if (classOf.has(member.id)) continue;
    add(owner, member);
  }
  return { byClass, classOf };
}

/** A name the interpreter invokes: `__init__`, `__call__`, `__enter__`. */
function isDunder(name: string): boolean {
  return name.length > 4 && name.startsWith('__') && name.endsWith('__');
}

/**
 * The slots virtual dispatch can reach: members that share a name and live in classes joined by inheritance.
 *
 * A group is returned only when it holds more than one member, and **only inside one connected hierarchy** — a
 * union-find over `EXTENDS`/`IMPLEMENTS` is what defines "connected", so two unrelated classes that both declare `get`
 * stay two slots. Joining them by name alone would be the "anything called `get` is alive" rule that keeps recall at
 * zero while looking conservative.
 */
function virtualSlots(graph: KnowledgeGraph, members: Members): number[][] {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const next = parent.get(id);
    if (next === undefined || next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  };

  for (const edge of graph.edges.values()) {
    const type = String(edge.type);
    if (type !== EDGE_EXTENDS && type !== EDGE_IMPLEMENTS) continue;
    union(edge.sourceId, edge.targetId);
  }

  const buckets = new Map<string, number[]>();
  // **The member's own name comes from the record `membersOf` wrote, not from a second lookup.** The map it would look
  // the node up in is the same one the record was built from, so the lookup could only ever fail on a graph that is
  // mutated while it is being read — a branch that can be written and never taken is a branch a test cannot honest-up.
  for (const [memberId, home] of members.classOf) {
    const key = `${String(find(home.classId))}::${home.memberName}`;
    const known = buckets.get(key);
    if (known === undefined) buckets.set(key, [memberId]);
    else known.push(memberId);
  }
  return [...buckets.values()].filter((group) => group.length > 1);
}

/** A file whose contents are code. A `Function` node inside a `README.md` is a code block, not a symbol. */
const CODE_FILE =
  /\.(py|pyi|[cm]?[jt]sx?|java|kt|kts|groovy|swift|scala|sc|go|rs|rb|php|c|h|cc|cpp|hpp|cs|dart|lua|sh|bash|zsh|sql|vue|svelte|ex|exs|erl|clj|fs|fsx|vb|m|mm|r|jl|pl|pm|tcl|vhd|v|sv)$/i;

function isCodeFile(filePath: string): boolean {
  // **A stub declares, it does not implement.** `.pyi` files describe the types of code that lives elsewhere, so their
  // methods have no callers by construction — on `pallets/werkzeug@3.0.3` the stubs alone put 25 declarations into the
  // dead list, which is the language working as designed.
  if (filePath.endsWith('.pyi')) return false;
  return CODE_FILE.test(filePath);
}

function isTestFile(filePath: string): boolean {
  return (
    /(^|\/)(__tests__|tests?)\//.test(filePath) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
  );
}

/**
 * A test file whose tests have no names of their own.
 *
 * **`pytest` collects `test_login`, and Jasmine collects a callback.** In Python the test is a symbol, so rooting the
 * symbols named like tests leaves the helpers beside them answerable — which is the one directory where dead helpers
 * actually accumulate. In JavaScript and TypeScript the test is `it('...', () => { ... })`: an anonymous arrow
 * function, filed under whatever the parser names an unnamed function, so there is no symbol to root and the whole
 * file came back dead. Measured on `colinhacks/zod@3.23.8`, 16 of the 80 findings were helpers in `__tests__` that
 * their own test body calls.
 *
 * So in those two languages **the file is the test**, and every symbol in it is reachable from the runner. The cost is
 * stated rather than hidden: a genuinely unused helper inside a test file is not reported here.
 */
function isAnonymousTestFile(filePath: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath) || /(^|\/)__tests__\//.test(filePath);
}

/** A node the question is asked about, together with the path a reader would open to check the answer. */
interface Subject {
  readonly node: GraphNode;
  readonly filePath: string;
}

/**
 * Whether a symbol can run, and if it can, from which surface.
 *
 * Pure in `graph` and `options`: nothing here reads the filesystem, the clock or the environment, so two runs over the
 * same graph produce the same report and a test can build the graph it wants to ask about.
 */
export function computeReachability(
  graph: KnowledgeGraph,
  options: ReachabilityOptions = {},
): ReachabilityReport {
  const adjacency = new Map<number, number[]>();
  const link = (from: number, to: number): void => {
    const known = adjacency.get(from);
    if (known === undefined) adjacency.set(from, [to]);
    else known.push(to);
  };
  let callEdges = 0;
  for (const edge of graph.edges.values()) {
    const type = String(edge.type);
    if (type === EDGE_CALLS) callEdges++;
    if (!REACHING_EDGES.has(type)) continue;
    link(edge.sourceId, edge.targetId);
    if (BIDIRECTIONAL_EDGES.has(type)) link(edge.targetId, edge.sourceId);
  }

  // **A reachable symbol makes its file reachable, and a reachable file runs its module-level statements.** A file is
  // imported as a unit, so the mention of a name in its top level — `_app_option = click.Option(callback=_set_app)` —
  // is a statement that executes whenever anything the file defines is reached. Without this link the edge from a
  // module-level mention points at a `File` node nothing ever reaches, and the function it keeps alive reads as dead.
  for (const node of graph.nodes.values()) {
    if (node.filePath === null) continue;
    const fileId = graph.fileIndex.get(node.filePath);
    if (fileId !== undefined && fileId !== node.id) link(node.id, fileId);
  }

  // **The symbols the question is asked about, paired with the path they can be opened at.** The pair is built once
  // here rather than recovered with `String(node.filePath ?? '')` in each of the four loops that read it: a node
  // without a file cannot be a finding a reader can open, so it is refused at the door and every loop below reads a
  // string.
  const considered: Subject[] = [];
  for (const node of graph.nodes.values()) {
    if (!isCallable(node.label) && node.label !== 'Class' && node.label !== 'Interface') continue;
    const filePath = node.filePath;
    if (filePath === null) continue;
    // **A heading in a README is not a symbol.** The markdown phase files code blocks and headings as nodes, and a
    // report that carries `src/flask/sansio/README.md: Sansio` as dead code is a report a reader stops trusting.
    if (!isCodeFile(filePath)) continue;
    considered.push({ node, filePath });
  }

  // **The guard that makes the rest honest.** Without a single use edge every symbol is "unreachable" and the report
  // is not a finding but a missing prerequisite, dressed as one. **It counts every edge this pass follows, not only
  // `CALLS`**: a graph of routes and registrations can answer the question without a call in it, and a guard that
  // insisted on calls would refuse to answer a question it could.
  if (adjacency.size === 0) {
    return {
      roots: [],
      considered: considered.length,
      reachableFromEntry: 0,
      reachableFromPublished: 0,
      callEdges: 0,
      dead: [],
      published: [],
      ignored: 0,
    };
  }

  const members = membersOf(graph);

  // **Virtual dispatch, derived from the hierarchy the graph already has.**
  //
  // `scaffold.py` calls `self._check_setup_finished(f_name)`; `App` and `Blueprint` override it, and the base is what
  // the call resolves to. `METHOD_OVERRIDES` exists for exactly this and **the graph contained zero of them on
  // `pallets/flask@3.0.3`** — measured, not assumed — so the overrides read as dead. A reader who trusts the report
  // would delete two methods the framework calls on every request.
  //
  // The relation is available without those edges: `EXTENDS` links the classes (42 of them on flask), `enclosingClass`
  // says which class declares each member, and a method name is **one slot across a connected hierarchy**. So members
  // that share a name and sit in classes joined by inheritance are linked both ways, and the same breadth-first walk
  // that carries liveness from a base to its overrides needed no new code path.
  //
  // **Only within a connected hierarchy.** Two unrelated classes that both declare `get` are two slots, and joining
  // them would be the "everything with this name is alive" rule that destroys recall.
  for (const group of virtualSlots(graph, members)) {
    for (const memberId of group) {
      for (const otherId of group) if (otherId !== memberId) link(memberId, otherId);
    }
  }

  const published = publishedRoots(graph);
  const entryNames = new Set([...ENTRY_NAMES, ...(options.entryNames ?? [])]);
  const entryFiles = [...ENTRY_FILES, ...(options.entryFiles ?? [])];
  const declared = new Set(options.entryPoints ?? []);
  const ignoreNames = new Set(options.ignoreNames ?? []);

  const roots: ReachRoot[] = [];
  const entrySeeds: number[] = [];
  const publishedSeeds: number[] = [];

  for (const { node, filePath } of considered) {
    const isTest = isTestFile(filePath);
    if (isTest && options.includeTests === false) continue;

    if (declared.has(node.qualifiedName) || declared.has(node.name)) {
      roots.push({
        nodeId: node.id,
        kind: 'declared',
        because: 'named as an entry point by the caller',
      });
      entrySeeds.push(node.id);
      continue;
    }
    // **A test is collected by the runner; a helper beside it is not.** Rooting every symbol in a test file keeps the
    // one directory where dead helpers actually accumulate completely silent. **Where the tests are anonymous the file
    // is the test**, and there is no symbol left to be silent about — see `isAnonymousTestFile`.
    if (
      isTest &&
      (node.label === 'Test' || /^test/i.test(node.name) || isAnonymousTestFile(filePath))
    ) {
      roots.push({
        nodeId: node.id,
        kind: 'test',
        because: isAnonymousTestFile(filePath)
          ? 'the runner collects this file, and its tests are anonymous callbacks'
          : 'a test runner collects it, so nothing calls it',
      });
      entrySeeds.push(node.id);
      continue;
    }
    // **A dunder is invoked by the interpreter, not by a call site.** `__init__`, `__call__`, `__getattr__`,
    // `__enter__` and their siblings are all reached by syntax, so a repository that never writes their names is a
    // repository that is working correctly — and a detector that reports them is reporting the language.
    if (isDunder(node.name)) {
      roots.push({
        nodeId: node.id,
        kind: 'entry',
        because: 'the interpreter invokes it by syntax',
      });
      entrySeeds.push(node.id);
      continue;
    }
    // **A decorated definition is invoked by whatever the decorator does.** `@app.route` registers a view,
    // `@pytest.fixture` registers a provider, `@Test` registers a case: the invocation is the decorator's, and there is
    // no call site to find. Treating these as dead was the largest false-positive class in the first measurement.
    if (typeof node.properties['decoratorNames'] === 'string') {
      roots.push({
        nodeId: node.id,
        kind: 'entry',
        because: `a decorator registers it: @${String(node.properties['decoratorNames'])}`,
      });
      entrySeeds.push(node.id);
      continue;
    }
    if (isCallable(node.label) && entryNames.has(node.name) && !members.classOf.has(node.id)) {
      roots.push({ nodeId: node.id, kind: 'entry', because: `the runtime calls \`${node.name}\`` });
      entrySeeds.push(node.id);
      continue;
    }
    if (entryFiles.some((pattern) => pattern.test(filePath))) {
      roots.push({
        nodeId: node.id,
        kind: 'entry',
        because: `${filePath} is executed rather than imported`,
      });
      entrySeeds.push(node.id);
      continue;
    }
    // **A public name in a published package is reachable from outside it**, whatever kind of symbol it is. The first
    // draft applied this to classes only, and the measurement said so immediately: `flask.abort`, `flask.send_file` and
    // `flask.render_template_string` came back as dead code, which is the library's front door being reported as
    // rubble.
    // **A method is published through its class, not on its own.** If every public method were seeded directly, the
    // finding's evidence would read "exported from a published package" for a language that has no export keyword,
    // and the class that actually makes the API — `Order` — would never be named.
    // **An `Interface` is a public name too.** TypeScript erases it, so it cannot be called — but `ZodTypeDef` and
    // `RefinementCtx` are what a consumer of `zod` writes in its own source, and reporting them as dead is reporting
    // the type system. They were 54 of the 80 findings on `colinhacks/zod@3.23.8`.
    if (
      inPublishedTree(filePath, published) &&
      declaresExport(node) &&
      (node.label === 'Class' || node.label === 'Interface' || isCallable(node.label)) &&
      !members.classOf.has(node.id)
    ) {
      roots.push({
        nodeId: node.id,
        kind: 'published',
        because: 'it is exported from a published package',
      });
      publishedSeeds.push(node.id);
    }
  }

  for (const node of graph.nodes.values()) {
    if (node.label !== 'Route') continue;
    roots.push({
      nodeId: node.id,
      kind: 'route',
      because: `a framework dispatches \`${node.name}\``,
    });
    entrySeeds.push(node.id);
  }

  // **A class in a published package publishes its public members**, which is the rule an edge-count cannot express
  // and the reason `Flask.run` is not a finding. A private member is not published by being next to a public one, and
  // **the class does not have to be public itself**: `flask.ctx._AppCtxGlobals` is private and every `g.get(...)` in
  // every Flask application calls one of its methods, so a rule keyed on the class's visibility reports the most used
  // object in the framework as dead.
  for (const node of graph.nodes.values()) {
    if (node.label !== 'Class') continue;
    // **A class with no file is in no package**, so it publishes nothing. The check is here rather than inside
    // `inPublishedTree` because a caller can hand this pass a graph whose nodes were indexed before the structure
    // phase ran, and the answer for such a node is a decision, not a string coercion.
    if (node.filePath === null) continue;
    if (!inPublishedTree(node.filePath, published)) continue;
    for (const memberId of members.byClass.get(node.id) ?? []) {
      const member = graph.nodes.get(memberId);
      if (member === undefined || !isPublicName(member.name)) continue;
      roots.push({
        nodeId: memberId,
        kind: 'published',
        because: `it is a public member of the published class \`${node.name}\``,
      });
      publishedSeeds.push(memberId);
    }
  }

  const fromEntry = breadthFirst(entrySeeds, adjacency);
  const fromPublished = breadthFirst(publishedSeeds, adjacency);
  // **The root each node traces back to**, so a finding can name the thing that keeps it alive instead of the
  // category it fell into. "Reachable from a published name" is a rule; "kept alive by `Flask`, exported from a
  // published package" is something a reader can go and check.
  const rootOf = new Map<number, ReachRoot>();
  for (const root of roots) if (!rootOf.has(root.nodeId)) rootOf.set(root.nodeId, root);

  const dead: DeadSymbol[] = [];
  const publishedOnly: DeadSymbol[] = [];
  let ignored = 0;

  for (const { node, filePath } of considered) {
    if (fromEntry.has(node.id)) continue;
    if (ignoreNames.has(node.name)) {
      ignored++;
      continue;
    }
    const finding: DeadSymbol = {
      nodeId: node.id,
      name: node.name,
      qualifiedName: node.qualifiedName,
      filePath,
      label: node.label,
      startLine: node.startLine,
      because: '',
    };
    if (fromPublished.has(node.id)) {
      publishedOnly.push({
        ...finding,
        because:
          rootOf.get(node.id) === undefined
            ? inPublishedTree(filePath, published)
              ? 'reachable from a published name, so only code outside this repository can call it'
              : 'reachable from a published name'
            : `kept alive because ${String(rootOf.get(node.id)?.because)}`,
      });
      continue;
    }
    const owner = members.classOf.get(node.id);
    dead.push({
      ...finding,
      because:
        owner === undefined
          ? 'no path from an entry point, a test, a route or a published name'
          : `no path from an entry point, a test, a route or a published name, and it is not a public member of \`${owner.className}\``,
    });
  }

  const order = (a: DeadSymbol, b: DeadSymbol): number =>
    a.filePath.localeCompare(b.filePath) || (a.startLine ?? 0) - (b.startLine ?? 0);
  dead.sort(order);
  publishedOnly.sort(order);

  return {
    roots,
    considered: considered.length,
    reachableFromEntry: fromEntry.size,
    reachableFromPublished: fromPublished.size,
    callEdges,
    dead,
    published: publishedOnly,
    ignored,
  };
}

/** Every node reachable from `seeds` along the use edges, seeds included. */
function breadthFirst(
  seeds: readonly number[],
  adjacency: ReadonlyMap<number, number[]>,
): Set<number> {
  // **The same node can be a root for two reasons** — a class that is both exported and named as an entry point — and
  // the set is what makes the walk pay for it once. `new Set` says that in the type system; a hand-written
  // `if (seen.has(seed)) continue` says it in a branch no test can reach, because the seed list is built one arm at a
  // time and each arm leaves.
  const seen = new Set<number>(seeds);
  const queue = [...seen];
  // **An index, not `shift()`**: a queue drained from the front of an array is quadratic, and this pass runs over
  // every node of a twenty-thousand-node graph on the indexing path.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor] as number;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}
