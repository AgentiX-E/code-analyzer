#!/usr/bin/env node
// Ground truth for the call graph, read by the TypeScript compiler.
//
// **Why a second oracle exists.** `callgraph-oracle.py` scores the graph on Python and says nothing about the ten
// languages the product is actually written in. The figure that mattered - `pallets/flask` at 94.7 % precision -
// described a corpus in one language, and a TypeScript corpus had no oracle at all: no way to tell an edge that came
// from an import from one that named a method on `this`, and no way to reject a resolution rule except by taste.
//
// This script does not read the product's code. It builds a `ts.Program` over the same checkout, asks the checker
// which declaration each call site resolves to, and only then looks at what the graph claimed. The checker *is* the
// language's own answer, which is the property the Python oracle gets from `ast`.
//
// **What it asserts, and what it refuses to assert.**
//
// - A call resolves to a declaration in the corpus when the checker says so and the declaration has a name. Its
//   identity is `(file, simple name)` because that is the graph's identity; a name declared twice in one file is
//   therefore excluded from the score and counted, since the graph cannot distinguish the two.
// - A call whose callee is a **value** - a parameter, a variable holding a function reference, a property of an
//   object the checker cannot name - is called `variable` and is not scored. A graph that resolves it is guessing.
// - A call into `node_modules` or a lib file is `external` and is not scored in either direction.
// - **Recursion is not an edge in this graph**, deliberately, so it is excluded rather than counted as a miss.
// - A site the checker cannot resolve is `silent`, and **silence is never agreement**.
//
// Usage:
//   node scripts/callgraph-oracle-ts.mjs --root <dir> --graph <dump.json> --name owner/name --out <report.json>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
]);

const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts)$/;

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--')) throw new Error(`bad argument ${key}`);
    out[key.slice(2)] = argv[index + 1];
  }
  return out;
}

function collectFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        walk(join(directory, entry.name));
      } else if (SOURCE_EXTENSIONS.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(join(directory, entry.name));
      }
    }
  };
  walk(root);
  return files.sort();
}

/** The corpus-relative path, in the coordinates the graph dump uses. */
function relativePath(root, file) {
  return relative(root, file).split(sep).join('/');
}

/** The name of the function a node belongs to, or `undefined` when it belongs to none in this file. */
function ownerNameOf(node) {
  let current = node.parent;
  while (current) {
    // **A member of an object literal declares nothing.** `{ get error() { return new ZodError(…) } }` creates a
    // property when the literal is evaluated; it has no name a reader can point at and no node the graph can store,
    // and the product says so on purpose (`Object.defineProperty(exports, "Promise", { get() {…}, set() {…} })` in
    // `redis/ioredis` was two module-scope symbols called `get` and `set`, reported as dead). The call inside such a
    // body belongs to the function that wrote the literal, which is what the rule below returns.
    if (
      (ts.isMethodDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current)) &&
      ts.isObjectLiteralExpression(current.parent)
    ) {
      current = current.parent;
      continue;
    }
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return nameOfDeclaration(current);
    }
    if (ts.isConstructorDeclaration(current)) return 'constructor';
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const bound = nameOfBoundFunction(current);
      if (bound !== undefined) return bound;
    }
    if (ts.isSourceFile(current)) return undefined;
    current = current.parent;
  }
  return undefined;
}

function nameOfDeclaration(declaration) {
  const name = declaration.name;
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  // A computed name - `[Symbol.iterator]()` - is not a name the graph stores.
  return undefined;
}

/**
 * The name of a function expression, which is the name of whatever it is bound to.
 *
 * `const f = () => {}` defines `f`, and `class A { handler = () => {} }` defines a member `handler`; a callback passed
 * straight into a call defines nothing, and the graph emits no node for it.
 *
 * **`{ returnError: (err) => {…} }` defines nothing either, and this rule used to say it defined `returnError`.** That
 * was written when the parser filed an object literal's methods as declarations; it does not any more, because a key in
 * a literal is data and nothing in the source can call it by name. Naming the owner after the key made every call
 * inside such a callback a call *by its own name* — a self-call, which the metric drops as recursion — and then scored
 * the graph's answer, the enclosing constructor, as a claim about an owner that makes no call. The name of a key is not
 * the name of a declaration, so the walk continues to the declaration that does hold the callback.
 */
function nameOfBoundFunction(fn) {
  if (fn.name !== undefined) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent)) return undefined;
  if (parent && ts.isPropertyDeclaration(parent)) return nameOfDeclaration({ name: parent.name });
  // **`this.reject = (err) => { … }` defines `reject`**, and the graph files the arrow's body under that name. The
  // checker sees an arrow assigned to a property and gives it no name at all, so without this rule every call inside
  // such a handler is scored against the enclosing method's name and the edge looks wrong when it is not.
  if (
    parent &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const left = parent.left;
    if (ts.isPropertyAccessExpression(left)) return left.name.text;
    if (ts.isIdentifier(left)) return left.text;
  }
  return undefined;
}

/** The name of the class a member belongs to, which is how a construction site is named on both sides. */
function nameOfClass(declaration) {
  let current = declaration.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      if (current.name !== undefined) return current.name.text;
      // An anonymous class has no name to resolve against, and neither does the node the graph would emit for it.
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/** The declaration a resolved signature points at, named the way the graph names it. */
function calleeOf(declaration) {
  // **`new X()` is a call to the class, in this graph and in the checker.** The graph's `NEW_EXPRESSION` capture names
  // the class, so a constructor's own name - `constructor` - would score every construction site as a wrong edge.
  if (ts.isConstructorDeclaration(declaration)) {
    return { name: nameOfClass(declaration), declaration };
  }
  if (
    ts.isMethodDeclaration(declaration) ||
    ts.isMethodSignature(declaration) ||
    ts.isGetAccessorDeclaration(declaration) ||
    ts.isSetAccessorDeclaration(declaration)
  ) {
    return { name: nameOfDeclaration(declaration), declaration };
  }
  if (ts.isFunctionDeclaration(declaration))
    return { name: nameOfDeclaration(declaration), declaration };
  if (ts.isVariableDeclaration(declaration)) {
    return {
      name: ts.isIdentifier(declaration.name) ? declaration.name.text : undefined,
      declaration,
    };
  }
  if (ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) {
    return { name: nameOfBoundFunction(declaration), declaration };
  }
  return { name: undefined, declaration };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const files = collectFiles(root);
  const corpora = new Set(files.map((file) => relativePath(root, file)));

  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    experimentalDecorators: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
  });
  const checker = program.getTypeChecker();

  /** Every callable name a file declares, for the duplicate exclusion. */
  const namesPerFile = new Map();
  const countName = (file, name) => {
    if (name === undefined) return;
    let counts = namesPerFile.get(file);
    if (counts === undefined) {
      counts = new Map();
      namesPerFile.set(file, counts);
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };

  /**
   * The functions a class installs on its own prototype: `Pipeline.prototype.exec = function (…) {…}`.
   *
   * **`TypeScript.prototype.m = function` is a declaration of `m`, and it is the one that runs.** The checker answers
   * `pipeline.exec(…)` with the *interface* signature the class inherits, because that is what the type says - and an
   * interface signature has no body, so nothing runs there. `redis/ioredis` replaces `multi`, `exec`, `execBuffer` and
   * every command on `Pipeline.prototype`, and this oracle scored each call to them against a declaration with nothing
   * behind it.
   *
   * Reading the assignment is not a concession to the graph: it is the same rule the language has, stated where the
   * checker does not state it. Nothing is recorded for a class this run does not analyse, and nothing is recorded when
   * the right-hand side is not a function this file declares.
   */
  const prototypeMembers = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!corpora.has(relativePath(root, sourceFile.fileName))) continue;
    const visit = (node) => {
      const target = prototypeAssignmentOf(node);
      if (target !== undefined) prototypeMembers.set(target.key, target.member);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  function prototypeAssignmentOf(node) {
    if (!ts.isBinaryExpression(node)) return undefined;
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
    const left = node.left;
    if (!ts.isPropertyAccessExpression(left)) return undefined;
    const owner = left.expression;
    if (!ts.isPropertyAccessExpression(owner) || owner.name.text !== 'prototype') return undefined;
    if (!ts.isFunctionExpression(node.right) && !ts.isArrowFunction(node.right)) return undefined;
    const constructed = classOf(owner.expression);
    if (constructed === undefined) return undefined;
    return {
      key: `${relativePath(root, constructed.declaration.getSourceFile().fileName)}\u0000${constructed.name}\u0000${left.name.text}`,
      member: { name: left.name.text, declaration: node.right },
    };
  }

  /**
   * The member a `this.` call reaches when the `this` is bound from outside: `function () { this.close() }.bind(this)`.
   *
   * **TypeScript types `this` inside a plain function expression as `any`**, so the checker has no answer for a call
   * written there - and `.bind(this)` is the standard way of making that call correct. `redis/ioredis`'s
   * `Cluster.quit` defers its own teardown through exactly this shape, and the site was scored `silent` while the
   * graph's edge to `Cluster.handleCloseEvent` was scored a false claim. The rule is mechanical: the function is bound
   * to the object that wrote it, so the member is the one its class declares.
   */
  function boundThisMemberOf(access) {
    if (access.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
    let owner = access.parent;
    while (owner && !ts.isFunctionExpression(owner) && !ts.isArrowFunction(owner)) owner = owner.parent;
    if (!owner) return undefined;
    const bind = owner.parent;
    if (!bind || !ts.isPropertyAccessExpression(bind) || bind.name.text !== 'bind') return undefined;
    if (bind.expression !== owner) return undefined;
    const call = bind.parent;
    if (!ts.isCallExpression(call)) return undefined;
    if (call.arguments.length === 0) return undefined;
    if (call.arguments[0].kind !== ts.SyntaxKind.ThisKeyword) return undefined;
    let host = call.parent;
    while (host && !ts.isClassDeclaration(host) && !ts.isClassExpression(host)) host = host.parent;
    if (!host) return undefined;
    const member = (host.members ?? []).find(
      (entry) => entry.name !== undefined && entry.name.text === access.name.text,
    );
    return member === undefined
      ? undefined
      : { name: access.name.text, declaration: member };
  }

  /** The prototype assignment a call's receiver type makes for the member being called, if there is one. */
  function prototypeTargetOf(access) {
    let symbol;
    try {
      symbol = checker.getTypeAtLocation(access.expression).getSymbol();
    } catch {
      symbol = undefined;
    }
    const declared = (symbol?.declarations ?? []).find(
      (entry) => ts.isClassDeclaration(entry) || ts.isClassExpression(entry),
    );
    if (declared === undefined || declared.name === undefined) return undefined;
    return prototypeMembers.get(
      `${relativePath(root, declared.getSourceFile().fileName)}\u0000${declared.name.text}\u0000${access.name.text}`,
    );
  }

  const sites = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const file = relativePath(root, sourceFile.fileName);
    if (!corpora.has(file)) continue;
    const visit = (node) => {
      const named =
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node);
      if (named)
        countName(
          file,
          ts.isConstructorDeclaration(node) ? 'constructor' : nameOfDeclaration(node),
        );
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const file = relativePath(root, sourceFile.fileName);
    if (!corpora.has(file)) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        sites.push(classify(node, file));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  function classify(node, file) {
    const owner = ownerNameOf(node);
    const site = {
      file,
      owner: owner ?? '',
      line: sourceFileLine(node),
      verdict: 'silent',
      targetFile: undefined,
      callee: undefined,
    };
    if (owner === undefined) {
      site.verdict = 'unknown';
      return site;
    }
    // **A call through a value is not statically resolvable**, and the graph has no name to resolve it to.
    let signature;
    try {
      signature = checker.getResolvedSignature(node);
    } catch {
      signature = undefined;
    }
    /** The class a `new` expression constructs, which is not always the class the signature is declared on. */
    const constructed = ts.isNewExpression(node) ? classOf(node.expression) : undefined;
    /** The function a class installs on its own prototype, which is the declaration that runs. */
    const assigned = ts.isPropertyAccessExpression(node.expression)
      ? prototypeTargetOf(node.expression)
      : undefined;
    /** The member a `this.` call reaches through a function the caller bound to itself. */
    const boundThis = ts.isPropertyAccessExpression(node.expression)
      ? boundThisMemberOf(node.expression)
      : undefined;
    // **`new X()` names `X` whether or not `X` writes a constructor.** An implicit constructor has no declaration to
    // carry a signature, so this site was scored `silent` and the graph's edge to the class was scored a false claim -
    // three times on `redis/ioredis`, where `new MixedBuffers()`, `new Command(...)` and `new SubscriptionSet()` are
    // exactly as decidable as any other construction.
    if (
      constructed === undefined &&
      assigned === undefined &&
      boundThis === undefined &&
      (signature === undefined || signature.declaration === undefined)
    ) {
      return site;
    }
    const { name, declaration } =
      constructed !== undefined
        ? { name: constructed.name, declaration: constructed.declaration }
        : assigned !== undefined
          ? assigned
          : boundThis !== undefined
            ? boundThis
            : calleeOf(signature.declaration);
    if (name === undefined) {
      site.verdict = 'unknown';
      return site;
    }
    const targetFile = relativePath(root, declaration.getSourceFile().fileName);
    if (!corpora.has(targetFile)) {
      site.verdict = 'external';
      return site;
    }
    // **A construction site names a class, and a class is never "a value holding a function reference".** The check
    // below compares the callee's symbol against the resolved declaration, which for `new X()` is the constructor
    // while the symbol declares the class - so running it here marked every construction in the corpus undecidable.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      const resolved =
        symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      // **An arrow bound to a variable is declared by the variable, and the signature points at the arrow.**
      // `export const getParsedType = (data) => …` is the shape most of `colinhacks/zod` is written in, and comparing
      // only the signature's own node marked every call to such a function as a call through a value.
      const declaresIt =
        resolved !== undefined &&
        (resolved.declarations ?? []).some(
          (entry) => entry === declaration || declaration.parent === entry,
        );
      if (!declaresIt) {
        // `const f = obj.method; f()` - the checker followed the value, the graph cannot.
        site.verdict = 'variable';
        return site;
      }
    }
    site.verdict = 'internal';
    site.targetFile = targetFile;
    site.callee = name;
    return site;
  }

  /**
   * The class a construction site constructs.
   *
   * **`new Derived()` is a call to `Derived`, and the checker's signature belongs to whoever declared the
   * constructor** - which, for a subclass that declares none, is the base class. Reading the signature alone scored
   * every `new ZodString({…})` in `colinhacks/zod` against `ZodType`, and the graph was right while the oracle was
   * wrong. The symbol at the callee is the class that was written.
   */
  function classOf(expression) {
    if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression))
      return undefined;
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = (symbol?.declarations ?? []).find(
      (entry) => ts.isClassDeclaration(entry) || ts.isClassExpression(entry),
    );
    if (declaration === undefined) return undefined;
    const name =
      ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)
        ? declaration.name?.text
        : undefined;
    return name === undefined ? undefined : { name, declaration };
  }

  function sourceFileLine(node) {
    const source = node.getSourceFile();
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  if (process.env.ORACLE_DEBUG) {
    const [wantedFile, wantedOwner] = process.env.ORACLE_DEBUG.split('|');
    for (const site of sites) {
      if (!site.file.includes(wantedFile)) continue;
      if (wantedOwner && site.owner !== wantedOwner) continue;
      process.stderr.write(
        `SITE ${site.file}|${site.owner} L${site.line} ${site.verdict} -> ${site.targetFile ?? ''}|${site.callee ?? ''}\n`,
      );
    }
  }

  const verdicts = {};
  const expected = new Set();
  let excluded = 0;
  const ambiguous = (file, name) => (namesPerFile.get(file)?.get(name) ?? 0) > 1;
  for (const site of sites) {
    verdicts[site.verdict] = (verdicts[site.verdict] ?? 0) + 1;
    if (site.verdict !== 'internal') continue;
    if (site.file === site.targetFile && site.owner === site.callee) {
      verdicts.internalRecursion = (verdicts.internalRecursion ?? 0) + 1;
      continue;
    }
    if (ambiguous(site.file, site.owner) || ambiguous(site.targetFile, site.callee)) {
      excluded++;
      continue;
    }
    expected.add(`${site.file}\u0000${site.owner}\u0000${site.targetFile}\u0000${site.callee}`);
  }

  const dump = JSON.parse(readFileSync(args.graph, 'utf8'));
  const nodes = new Map(dump.nodes.map((node) => [node.id, node]));
  const claimed = new Set();
  /** Edges that name one declaration twice: recursion, which neither side scores. */
  let recursion = 0;
  const armOf = new Map();
  const perArm = new Map();
  for (const edge of dump.edges) {
    const source = nodes.get(edge.s);
    const target = nodes.get(edge.t);
    if (!source?.file || !target?.file) continue;
    if (ambiguous(source.file, source.name) || ambiguous(target.file, target.name)) continue;
    // **A pair that names one declaration twice is a recursive call, and the expected set drops it for the same
    // reason** - `site.file === targetFile && owner === callee` is excluded above as `internalRecursion`. The key here
    // is a (file, name) pair, so a local function and a class member that share a name collapse into one, and scoring
    // the claim while refusing the expectation asks the graph to be wrong about being right.
    if (source.file === target.file && source.name === target.name) {
      recursion++;
      continue;
    }
    const key = `${source.file}\u0000${source.name}\u0000${target.file}\u0000${target.name}`;
    const arm = edge.properties?.resolution ?? 'unlabelled';
    claimed.add(key);
    if (!armOf.has(key)) armOf.set(key, arm);
    const bucket = perArm.get(arm) ?? { tp: 0, fp: 0 };
    if (expected.has(key)) bucket.tp++;
    else bucket.fp++;
    perArm.set(arm, bucket);
  }

  /** Sites grouped by their owner, so a wrong edge can be asked what the checker said about that name. */
  const sitesByOwner = new Map();
  for (const site of sites) {
    const key = `${site.file}\u0000${site.owner}`;
    const bucket = sitesByOwner.get(key) ?? [];
    bucket.push(site);
    sitesByOwner.set(key, bucket);
  }
  const causeOf = (source, owner, callee) => {
    const bucket = sitesByOwner.get(`${source}\u0000${owner}`) ?? [];
    const matching = bucket.filter((site) => site.callee === callee || callee === undefined);
    if (matching.length === 0) {
      // The graph attributed the edge to a function that holds no call to that name at all.
      const anySite = bucket.find((site) => site.verdict === 'internal');
      return anySite === undefined ? 'ownerHasNoCall' : 'calleeNotCalledHere';
    }
    if (matching.some((site) => site.verdict === 'internal' && site.targetFile === undefined))
      return 'internalUnnamed';
    if (matching.some((site) => site.verdict === 'variable')) return 'throughValue';
    if (matching.some((site) => site.verdict === 'external')) return 'externalTarget';
    if (matching.some((site) => site.verdict === 'silent')) return 'checkerSilent';
    return 'differentTarget';
  };

  const correct = [...claimed].filter((key) => expected.has(key));
  /**
   * **An edge the oracle cannot decide is not an edge the oracle disagrees with.**
   *
   * The conservative rule - every claim not in the expected set is a false positive - reads the oracle's *silence* as
   * evidence against the graph, and in TypeScript silence is common: a call on a value the checker cannot name, a
   * callback whose parameter is untyped, a `this.x.y()` whose `x` has no annotation. `provablyWrong` is the set where
   * the oracle had an internal site with that name and the graph pointed somewhere else, and that is the figure a
   * resolution rule should be judged by. The conservative figure is published beside it rather than replaced,
   * because a rule that only ever sees a kinder denominator is a rule nobody can check.
   */
  const cause = new Map();
  for (const key of claimed) {
    if (expected.has(key)) continue;
    const [source, owner, , callee] = key.split('\u0000');
    cause.set(key, causeOf(source, owner, callee));
  }
  const wrong = [...claimed].filter((key) => !expected.has(key));
  const missed = [...expected].filter((key) => !claimed.has(key));
  // **The stored report samples the misses; the diagnosis needs all of them.** Fifteen samples tell a reader what
  // the shape looks like, and they told this iteration nothing about how many misses shared a cause. The full list
  // is opt-in so the benchmark file stays readable.
  if (process.env.ORACLE_MISSED) {
    for (const key of missed) process.stderr.write(`MISSED ${key.split('\u0000').join('|')}\n`);
  }
  // **A pair names a callee, not the line it was written on.** Diagnosing a class of miss needs the site, and the
  // site is what `ORACLE_DEBUG` prints one owner at a time; this prints every resolved site at once, keyed by the
  // pair, so a hundred misses can be classified by shape instead of read one at a time.
  if (process.env.ORACLE_SITES) {
    for (const site of sites) {
      if (site.verdict !== 'internal') continue;
      const key = `${site.file}\u0000${site.owner}\u0000${site.targetFile ?? ''}\u0000${site.callee ?? ''}`;
      process.stderr.write(`SITE ${key.split('\u0000').join('|')}|${site.line}\n`);
    }
  }
  const ratio = (part, whole) => (whole === 0 ? null : Math.round((part / whole) * 10000) / 10000);
  const byArm = {};
  for (const [arm, value] of [...perArm].sort((a, b) => a[0].localeCompare(b[0]))) {
    byArm[arm] = {
      claimed: value.tp + value.fp,
      correct: value.tp,
      precision: ratio(value.tp, value.tp + value.fp),
    };
  }

  const ownersWithCalls = new Set(
    sites
      .filter((s) => s.verdict === 'internal' || s.verdict === 'external')
      .map((s) => `${s.file}|${s.owner}`),
  );
  const oracleCallers = new Set(
    sites.filter((s) => s.verdict === 'internal').map((s) => `${s.file}|${s.owner}`),
  );
  const graphCallers = new Set(
    [...claimed].map((key) => key.split('\u0000').slice(0, 2).join('|')),
  );

  const report = {
    generatedBy: 'scripts/callgraph-oracle-ts.mjs',
    corpus: args.name,
    files: files.length,
    definitions: {
      simpleNameCollisionsPerFile: [...namesPerFile.values()].reduce(
        (sum, counts) => sum + [...counts.values()].filter((count) => count > 1).length,
        0,
      ),
    },
    sites: {
      total: sites.length,
      ...Object.fromEntries(
        ['internal', 'internalRecursion', 'external', 'variable', 'unknown', 'silent'].map(
          (key) => [key, verdicts[key] ?? 0],
        ),
      ),
      excludedForDuplicateName: excluded,
      graphRecursion: recursion,
    },
    expectedPairs: expected.size,
    claimedPairs: claimed.size,
    precision: {
      correct: correct.length,
      wrong: wrong.length,
      value: ratio(correct.length, claimed.size),
    },
    recall: {
      found: correct.length,
      missed: missed.length,
      value: ratio(correct.length, expected.size),
    },
    byArm,
    callers: {
      oracle: oracleCallers.size,
      graph: [...graphCallers].filter((key) => oracleCallers.has(key)).length,
      graphOnly: [...graphCallers].filter((key) => !oracleCallers.has(key)).length,
      ownersWithAnyCall: ownersWithCalls.size,
    },
    wrongCauses: [...wrong].reduce((counts, key) => {
      const [source, owner, , callee] = key.split('\u0000');
      const cause = causeOf(source, owner, callee);
      counts[cause] = (counts[cause] ?? 0) + 1;
      return counts;
    }, {}),
    wrongSamples: wrong
      .slice(0, 40)
      .map((key) => {
        const [s, o, t, n] = key.split('\u0000');
        return `[${armOf.get(key)}] ${s}|${o} -> ${t}|${n}`;
      })
      .sort(),
    missedSamples: missed
      .slice(0, 15)
      .map((key) => key.split('\u0000').join('|'))
      .sort(),
  };

  if (args.out) writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
