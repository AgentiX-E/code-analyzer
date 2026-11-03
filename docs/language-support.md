# Language Support Matrix

Code Analyzer names **33 languages** in `SUPPORTED_LANGUAGES`: **seventeen with a tree-sitter grammar** and the
symbol-level extraction below, plus sixteen that carry the configuration, markup and documents a repository is made of —
**and every one of them is admitted by the scanner**, which is what makes the provider for it reachable. _A provider
that no file ever reaches is dead code, and until 2026-10-25 six of them were._

## Feature Matrix

| Feature                     | TypeScript | JavaScript | Python | Go  | Java | Kotlin | C#  | Rust | PHP | Ruby | C/C++ | Swift | Dart | Lua | Scala | Zig | Elixir |
| --------------------------- | :--------: | :--------: | :----: | :-: | :--: | :----: | :-: | :--: | :-: | :--: | :---: | :---: | :--: | :-: | :---: | :-: | :----: |
| **Function Definitions**    |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Method Definitions**      |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | ✅  |  N/A   |
| **Class Definitions**       |     ✅     |     ✅     |   ✅   | N/A |  ✅  |   ✅   | ✅  | N/A  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | N/A |  N/A   |
| **Interface Definitions**   |     ✅     |    N/A     |  N/A   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Enum Definitions**        |     ✅     |    N/A     |   ✅   | N/A |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | ✅  |  N/A   |
| **Type Definitions**        |     ✅     |    N/A     |   ✅   | N/A | N/A  |  N/A   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Variable Definitions**    |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Constant Definitions**    |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Import Statements**       |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Export Detection**        |     ✅     |     ✅     |  N/A   | N/A |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | ✅  |  N/A   |
| **Decorators/Annotations**  |     ✅     |    N/A     |   ✅   | N/A |  ✅  |   ✅   | ✅  |  ✅  | ✅  | N/A  |  N/A  |  N/A  |  ✅  | N/A |  N/A  | N/A |  N/A   |
| **Route Detection**         |     ✅     |    N/A     |   ✅   | N/A | N/A  |  N/A   | ✅  | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Constructor Detection**   |     ✅     |     ✅     |   ✅   | N/A |  ✅  |  N/A   | ✅  | N/A  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | N/A |  N/A   |
| **Docstrings/JSDoc**        |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Function Calls**          |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Declared Type Facts**     |     ✅     |     —      |   ✅   |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Declared Return Types**   |     ✅     |     —      |   ✅   |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Parameter Arity**         |     ✅     |     —      |   ✅   |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Package-Qualified Names** |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Deferred Calls (`::`)**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Resource Bindings**       |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Enum Constants**          |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Type Parameter Bounds**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Outer Instance `this`**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Factory-Call Receiver**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Cast Receiver**           |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Argument-Type Dispatch**  |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Collection Elements**     |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Lambda Parameter Types**  |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Functional Parameters**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Stream Receivers**        |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Implicit Construction**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Generic Factory Returns** |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Inherited Member Hops**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Generics**                |     ✅     |    N/A     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Async Detection**         |     ✅     |     ✅     |   ✅   | N/A | N/A  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   |  ✅  | N/A |  N/A  | N/A |  N/A   |
| **Extension Functions**     |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Struct Detection**        |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Record Detection**        |    N/A     |    N/A     |  N/A   | N/A |  ✅  |  N/A   | ✅  | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Trait Detection**         |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Impl Block Detection**    |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Object Detection**        |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |

**Only three providers read a declared type**, and that row is the reason the call graph can resolve a receiver at
all: `fieldTypes`, `localTypes` and `parameterOwner`/`parameterType` are emitted by **TypeScript**, **Python** and
**Java** — TypeScript and Java file fields, locals and parameters, Python files fields and parameters. Those are also
exactly the three languages with an independent accuracy oracle, which is not a coincidence: a language whose
declarations are not facts has nothing for an oracle to disagree with. The other fourteen parse every declaration the
matrix rows above record and resolve no receiver, so `this.builder.append(…)` in Kotlin or `widget.draw(…)` in C# is an
unclaimed edge — **stated here rather than claimed as support.** Java spent four iterations "supported" at **50 `CALLS`
edges** on a Spring application because nobody had asked whether the arm that reads a type had anything to read
(iteration 56; the same checkout now yields 285, of which 235 come from that arm).

**A declaration states a signature, and the call graph reads it as a fact rather than as a hint.** `parameterCount`,
`requiredParameters` and `variadic` are what a declaration writes; `argumentCount` is what a call site passes. A name
declared once is answered without either; a name declared several times — the case every resolution arm used to refuse
— is answered by the declaration whose signature admits the call. **The counts are per declaration rather than per
name**, because folding a class's arities into a range answers `reset()` with the declaration that takes two arguments:
`reset()` and `reset(byte[], int)` are two declarations under one key, and neither admits a call passing one argument.
Measured alone, with everything else this iteration changed held still, the rule takes `apache/commons-lang` from
**2174 correct edges to 2194** (claimed 2176 → 2194, precision 99.91 % → **100.0 %**) and `commons-io` from **1550 to
1571** (recall 92.8 % → 94.0 %). Two of the twenty edges it gained on `commons-lang` were edges the graph had been
claiming against the wrong overload, which is why the correct count rises by more than the claimed one.

**A package-qualified type name is read as the package it names.** `java.io.ByteArrayOutputStream` and this
repository's `org.apache.commons.io.output.ByteArrayOutputStream` are different classes with the same last segment, and
the resolver used to strip the qualifier and answer whichever one the checkout declared — so `outputStream.writeTo(…)`
in `IOUtils.copy` claimed an edge into a class the JDK owns. It now keeps a lowercase qualifier (`java.io.X`) and
matches it against the file's directory path, while `Map.Entry` and `Zod.ZodString` keep the old reading because a
nested name is not a package. **Ablated, this rule adds no correct edge and removes one wrong one** (1603 claimed with 3
wrong, against 1602 with 2), which is what a precision rule is supposed to look like.

**An `interface I extends J` is a base type, and the seam it closes is worth a whole file of edges.** `IOFileFilter
extends FileFilter, FilenameFilter`: a lambda handed to `listFiles` calls the `accept(File, String)` that
`FilenameFilter` declares and `IOFileFilter` never repeats, and the class chain followed `extends` on classes only.
Reading `extends_interfaces` as a base is **29 edges on `commons-io`, all 29 correct** — recall 94.0 % → 95.8 % — and
nothing on `commons-lang`, where no interface in the corpus inherits a member it calls.

**A call in the middle of a receiver is a hop, and the hop's type is what the callee declares it returns.** Reading
only what a _name_ holds left every fluent chain ending at its first call — `QueueInputStream.builder().get()`,
`Archive.store.find(key).next()`, `DiffBuilder.append(…).build()` — and iteration 58 made the return type a fact of the
declaration (`returnType`, read from `return_type:` in the TypeScript and Python grammars and from `type:` in Java's).
On `apache/commons-lang@3.14.0` that took recall from **88.1 % to 96.2 %** together with the package rule described
below; the arm that reads a receiver's type is now **357 claims, 100 % precise**.

**A type name is read in the file it was written in, not the file the call sits in.** `Reader.builder()` declares its
return type as `Builder`, and that name means the `Builder` of the file that declares `builder` — the nested class —
rather than whichever `Builder` the checkout is ambiguous about. Resolving it at the call site answers nothing, and
**five calls that follow the factory on `apache/commons-io` were unanswered for it** (`setByteArray`, `setOffset`,
`setLength` and the `get()` that ends the chain).

**`Foo::bar` is a call that happens later, and Java writes them by the hundred.** The production is a
`method_reference`, not a `method_invocation` with a receiver, so every branch of the walk stepped past it: measured
against `javac`'s own attribution, the two Java corpora hold **254 member references**, of which **63 reach a
declaration the checkout holds** — `this::helper`, `super::helper`, `Type::method` and `Type::new`. The keyword or the
type is carried as the receiver and the resolver's existing arms answer it, so a deferred call is scored by the same
rules as an immediate one and `Type::new` is filed as the construction it is.

**A Java name is answered by its own package before any other file, and that is the language's rule rather than a
heuristic.** A package is a directory: `Streams.java` calling `Functions.asPredicate(…)` reaches
`lang3/Functions.java` even though the same checkout declares a second `Functions` in `lang3/function/`, and
`new SerializationException(…)` reaches a class three files away in the same directory with no import between them.
The edge is labelled `package`, so its precision is measured on its own — **69 of 69 on `commons-lang` and 83 of 83 on
`commons-io`**. The rule is restricted to `java`, `kotlin` and `groovy`, the languages where a simple name resolves
through a package; a TypeScript or Python file that names a sibling without importing it still reaches nothing.

## File Extensions

| Language   | Extensions                            |
| ---------- | ------------------------------------- |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts`         |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs`         |
| Python     | `.py`, `.pyw`, `.pyi`                 |
| Go         | `.go`                                 |
| Java       | `.java`                               |
| Kotlin     | `.kt`, `.kts`                         |
| C#         | `.cs`                                 |
| Rust       | `.rs`                                 |
| PHP        | `.php`, `.phtml`                      |
| Ruby       | `.rb`, `.rake`, `.gemspec`            |
| C          | `.c`, `.h`                            |
| C++        | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx` |
| Swift      | `.swift`                              |
| Dart       | `.dart`                               |
| Lua        | `.lua`                                |
| Scala      | `.scala`, `.sc`                       |
| Zig        | `.zig`, `.zon`                        |
| Elixir     | `.ex`, `.exs`                         |

## Configuration, Markup and Document Formats

These carry no functions and no call graph, and they are what a change actually touches in most commits. The
extensions are the ones `getLanguageFromFilename` maps, and the scanner admits them:

| Language         | Extensions                      | What the index does with it                                                         |
| ---------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| XML              | `.xml`, `.xsd`, `.xsl`, `.xslt` | Spring/Pom/Maven build and bean wiring; element and attribute capture               |
| HTML             | `.html`, `.htm`                 | Templates and their links; **a template links to a route, it does not declare one** |
| YAML             | `.yaml`, `.yml`                 | CI workflows, Kubernetes manifests, application configuration                       |
| JSON             | `.json`, `.jsonc`               | `package.json`, tsconfig, framework configuration                                   |
| TOML             | `.toml`                         | `Cargo.toml`, `pyproject.toml`                                                      |
| HCL              | `.tf`, `.tfvars`                | Terraform resources and variables                                                   |
| CSS              | `.css`                          | Stylesheets, **including one a repository re-includes from its own `.gitignore`**   |
| Groovy           | `.groovy`, `.gradle`            | Gradle build scripts and DSLs                                                       |
| Markdown         | `.md`, `.markdown`              | Documentation, and the doc-wide reference search                                    |
| Dockerfile       | `Dockerfile`, `*.dockerfile`    | Image build stages                                                                  |
| SQL              | `.sql`                          | Schema and migrations                                                               |
| Shell            | `.sh`, `.bash`                  | Scripts                                                                             |
| Lua / R / Svelte | `.lua` / `.r` / `.svelte`       | Symbols, where the provider extracts them                                           |
| PDF              | `.pdf`                          | Extracted text; a container rather than a language                                  |

## Cross-Language Analysis

Code Analyzer supports **cross-language analysis** within a single project. For example, a TypeScript frontend calling a Python backend API, or a Rust library with C# bindings.

### Import Resolution

| From → To  |     TypeScript     |       Python       |        Go         |       Java        |       Rust        |       Swift       |       Dart        |
| ---------- | :----------------: | :----------------: | :---------------: | :---------------: | :---------------: | :---------------: | :---------------: |
| TypeScript | ✅ named/namespace |         —          |         —         |         —         |         —         |         —         |         —         |
| Python     |         —          | ✅ named/namespace |         —         |         —         |         —         |         —         |         —         |
| Go         |         —          |         —          | ✅ named/wildcard |         —         |         —         |         —         |         —         |
| Java       |         —          |         —          |         —         | ✅ named/wildcard |         —         |         —         |         —         |
| Kotlin     |         —          |         —          |         —         |         —         |         —         |         —         |         —         |
| C#         |         —          |         —          |         —         |         —         |         —         |         —         |         —         |
| Rust       |         —          |         —          |         —         |         —         | ✅ named/wildcard |         —         |         —         |
| Swift      |         —          |         —          |         —         |         —         |         —         | ✅ named/wildcard |         —         |
| Dart       |         —          |         —          |         —         |         —         |         —         |         —         | ✅ named/wildcard |

> **Note**: Cross-language edges (e.g., TypeScript calling Python) are represented as `CROSS_REPO_*` edges in the knowledge graph.

## Performance Characteristics

| Language   | Parse Speed | Memory per 1K LOC | Call-graph precision / recall (measured)                            |
| ---------- | :---------: | :---------------: | :------------------------------------------------------------------ |
| TypeScript |    Fast     |       ~5MB        | **100.0 % / 80.6 %** zod · **100.0 % / 90.0 %** ioredis             |
| Python     |   Medium    |       ~3MB        | **97.9 % / 97.9 %** flask · **98.0 % / 96.7 %** werkzeug            |
| Java       |    Fast     |       ~5MB        | **100.0 % / 99.3 %** commons-lang · **100.0 % / 99.8 %** commons-io |
| JavaScript |    Fast     |       ~4MB        | not measured                                                        |
| Go         |    Fast     |       ~3MB        | not measured                                                        |
| Kotlin     |   Medium    |       ~4MB        | not measured                                                        |
| C#         |    Fast     |       ~5MB        | not measured                                                        |
| Rust       |   Medium    |       ~4MB        | not measured                                                        |
| PHP        |    Fast     |       ~4MB        | not measured                                                        |
| Ruby       |   Medium    |       ~4MB        | not measured                                                        |
| C/C++      |    Fast     |       ~3MB        | not measured                                                        |
| Swift      |   Medium    |       ~4MB        | not measured                                                        |
| Dart       |    Fast     |       ~4MB        | not measured                                                        |
| Lua        |    Fast     |       ~2MB        | not measured                                                        |
| Scala      |   Medium    |       ~5MB        | not measured                                                        |
| Zig        |   Medium    |       ~3MB        | not measured                                                        |
| Elixir     |   Medium    |       ~3MB        | not measured                                                        |

**This column used to read `99%+`, `97%+`, `95%+` for every language**, and none of those numbers had an instrument
behind it — they were read off a parse success rate and repeated. What replaced them is a call-graph figure per corpus,
produced by `scripts/callgraph-quality.ts` against an oracle that is not this codebase (`CPython ast`, the TypeScript
checker, and `javac`'s own attribution), gated per arm by `scripts/callgraph-gate.js` and re-run on every push by
`.github/workflows/callgraph-quality.yml`. **The recall column is the honest one**: `commons-io` read 60.9 % when the
instrument was first pointed at it, 80.2 % after the receiver arm learned to read a declared type, 95.8 % after the
interface `extends` clause became a base, 97.9 % after four declarations the provider stepped past were read, and
**99.8 % now** — and that number is a claim about the graph, not about Java. Its 3 unanswered pairs are named in
`benchmarks/callgraph-java-quality.json` under `missedSamples`, which is the
only reason the figure can be worked on rather than argued about.

**Four declarations Java writes and this product stepped past, and one shape a receiver may take.** Each was found by
reading a missed pair rather than by reading the code, and each is worth the edges its ablation costs when it is removed:

| rule                                                | what the language states                                                                                                                                                                                                                                                                          | edges, measured alone                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **A `resource` is a declaration**                   | `try (CloseableURLConnection urlConnection = open(url))` parses as `resource_specification > resource > (type, name, value)` and is not a `local_variable_declaration`, so the walk recognised nothing: `commons-io` writes **35** of these headers and every call on the resource was unanswered | **10** on `commons-io`                          |
| **A constant of an enum is a value of it**          | `enum IOCase { SYSTEM("System") }` declares `SYSTEM` of type `IOCase` and writes no field anywhere. `IOCase.SYSTEM.checkEquals(…)` names a receiver through it, and the walk asked for a field called `SYSTEM` in the _calling_ class                                                             | **8** on `commons-io`                           |
| **A type parameter's bound is the class it may be** | `UncheckedIOBaseStream<T, S extends IOBaseStream<T, S, B>>` declares `private final S delegate` and calls `delegate.close()`. Without the bound the resolver asked for a class named `S`, which no file declares                                                                                  | **13** on `commons-io`                          |
| **`Outer.this` is the enclosing instance**          | an inner class writes the qualifier because its own `this` is a different object; reading `.this` as a member name asked `StrBuilder` for a field called `this`                                                                                                                                   | **7** on `commons-lang`                         |
| **A receiver may be rooted at a call**              | `is(a).greaterThanOrEqualTo(b)` writes a factory where a name would go, and the member belongs to the class the factory's declaration says it returns                                                                                                                                             | **12** on `commons-lang`, **4** on `commons-io` |

**And one rule that removed a claim rather than adding one.** `Tailer.java` writes
`import java.io.ByteArrayOutputStream;` and `try (ByteArrayOutputStream lineBuf = new ByteArrayOutputStream(64))`; the
checkout declares a _different_ `ByteArrayOutputStream` two packages away, and the whole-graph fallback answered the
resource's type with it — **three wrong edges, and the first wrong edges this iteration produced.** A file that writes a
single-type import has said which class the name means, so the lookup now checks that the class it found lives in the
module the import names — **ablation: three more claims and none of them right.** The check is on the _module_ rather
than a flag, because the same shape also binds a name the checkout _does_ declare:
`org.apache.commons.io.file.Counters.PathCounters` names a class inside `Counters.java`, and treating every unresolved
import as external cost **14 correct edges**.

**The type a call passes is a fact, and it decides which declaration answers it.** A declaration states
`parameterTypes` and a call site states the names it passes, each resolved in the file it was written in; where several
declarations answer one name, the one whose parameters the call can fill is the one the call runs. Four rules were added
together and ablated one at a time, and the two corpora decompose exactly — **23 new correct edges, and the wrong edges
go to zero on both**:

| rule disabled alone                                | what the language states                                                                                                                                                                                                                                                                                                                     | `commons-lang` | `commons-io`         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------- |
| **A cast names the class it casts to**             | `((DefaultCodec) decoder).read(…)` writes the type in parentheses; read as an expression, the receiver's first token was a bracket and the walk answered nothing                                                                                                                                                                             | **-5**         | **-3**               |
| **A call is answered by the types it passes**      | `accept(dir, attrs)` fits `IOFileFilter.accept(Path, BasicFileAttributes)` and not `FileFilter.accept(File)`; the inherited arm was answering the wrong one                                                                                                                                                                                  | **0**          | **-3, and +2 wrong** |
| **A container's one type argument is its element** | `List<FileAlterationListener> listeners` states an element, which is what iteration hands out; `Map<K, V>` states none, because nothing iterates a map as its values                                                                                                                                                                         | **-4**         | **-8**               |
| **A lambda parameter is bound to that element**    | `listeners.forEach(listener -> listener.onStart(file))` binds `listener` to the element of the receiver. **The last two rows are one rule read from two ends** — the lambda rule records the element expression and the element rule resolves it — so disabling either half loses the same twelve edges and neither half is sufficient alone | **-4**         | **-8**               |

5 + 4 is `commons-lang`'s nine and 3 + 3 + 8 is `commons-io`'s fourteen, which is how a per-rule claim is meant to be
checkable. **The signature pass adds nothing on `commons-lang` and repairs `commons-io`**: without it the graph still
claims 1648 edges, two of which are wrong — the same `AbstractFileFilter.preVisitDirectory` pair iteration 60 could not
fix and iteration 61 named. That repair is what moves both precision floors to **100.0 %**, where a single wrong edge
trips the gate.

**A tie between two declarations the arguments both fit is read as an absence of evidence, not as a coin toss.** The
typed pass runs first over the chain a class _is_ — its bases and the contracts it implements — and answers only a
declaration with a body whose parameter types the call fills; a tie, or no answer at all, falls through to the arity pass
that ran before types existed. The order is the whole of the design: **the typed pass can add an answer and can never
withdraw one.** Reporting a tie as "ambiguous" instead cost **46 edges** on the first measurement — `ToStringStyle` and
every subclass that repeats its `appendDetail` — which is what an abstention looks like when the previous rule was the
one answering.

**Then five facts about code nobody wrote, which is where the last of the recall was.** A declaration describes more
than the body it holds: a class with no constructor has one anyway, a lambda's parameter is typed by whatever consumes
it, a generic factory names its result by naming its argument, and a hop is a member of the class _or of a base_. Each
rule was ablated alone, and the two corpora decompose again — **18 new correct edges on `commons-lang`, 13 on
`commons-io`, every one of them correct**:

| rule disabled alone                                               | what the language states                                                                                                                                                                                                                                                                                                                                                                 | `commons-lang` | `commons-io` |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ |
| **A class that writes no constructor still has one**              | `class CsvEscaper extends CharSequenceTranslator { }` declares no constructor and `javac` still names one, whose first act is `super()`. Every other arm of the walk is keyed on a declaration being written, so the call every instance makes was invisible — the four `Builder`s of the concurrent initializers, both comparators, `CsvEscaper`, `CsvUnescaper`, `StateStrategyClosed` | **-15**        | **-3**       |
| **A stream has the element of the collection it was opened from** | `ranges.stream().anyMatch(range -> …)` is a loop written as a call: the stream is a view of one collection and holds no element of its own                                                                                                                                                                                                                                               | **-1**         | **-2**       |
| **A functional parameter types the lambda passed to it**          | `forEachObserver(observer -> …)` names no container; the element is on the callee's parameter, a `FailableConsumer<Observer, IOException>`, and the interface's single abstract method says _which_ of its two type arguments the lambda is handed                                                                                                                                       | **0**          | **-3**       |
| **A hop reads a member of the class or of a base**                | `this.getStyle().getNullText()` — `getStyle` is the base's, and the hop asked only the class the call was written in                                                                                                                                                                                                                                                                     | **-2**         | **0**        |
| **A generic result is bound by the argument that fills it**       | `<T extends PathVisitor> T visitFileTree(T visitor, Path path)` states its result twice, and `visitFileTree(CountingPathVisitor.withLongCounters(), dir).getPathCounters()` is a call on `CountingPathVisitor`                                                                                                                                                                           | **0**          | **-5**       |

15 + 1 + 2 is the first column and 3 + 2 + 3 + 5 the second. **The zeros are reported as zeros**: a rule one corpus
never asks for is a rule the other one measured, and a table that dropped it would be a table whose sum only appears to
close. The last row of the previous section's table — a lambda parameter bound to a container's element — is now the
general case of the third row here: the container path and the callee's parameter are two spellings of one question, so
the list of blessed method names iteration 62 shipped is gone and the declaration answers instead.

**One rule had to be narrowed rather than widened, and the corpus said so before a test did.** The synthesized
constructor was first given the class's own span, which made it the enclosing declaration of every field initialiser in
the body: `DEFAULT_COMPARATOR = new ReverseFileComparator()` inside `DirectoryFileComparator` moved from no caller at all
to a constructor that calls it, **5 wrong edges on `commons-io`** and 2 on `commons-lang` (`FailableConsumer.nop`,
`FailableSupplier.nul`). A constructor is written on the class's first line and that is the line it spans; the wrong
edges went to zero and the correct ones stayed.

**Then the scopes a name is written in, which are more than the class.** A name is answered by the code that
surrounds it, and this walk knew two of the surrounding scopes: the class it was written in, and that class's bases.
Java has four — the class, its bases, the classes that lexically contain it, and the values a declaration states it
returns — and three of them were missing. Each rule was ablated alone, and the two corpora decompose again — **3 new
correct edges on `commons-lang`, 6 on `commons-io`**:

| rule disabled alone                                          | what the language states                                                                                                                                                                                                                                                                             | `commons-lang` | `commons-io` |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ |
| **A field a class does not declare is still its field**      | `PeekableInputStream.peek` calls `buffer.getCurrentNumberOfBytes()`, and `buffer` is `protected final CircularByteBuffer` on `CircularBufferInputStream`. The chain walk existed for a _hop_ and not for a bare name, so the call on it was answered by nothing — twice in one method                | **0**          | **-2**       |
| **A class written inside a class is written inside a scope** | `Builder.setDirectory` calls `toPath(directory, null)`, which is `DeferredFileOutputStream`'s private static method; `StrategyParser.letterPattern` calls `FastDateParser.getStrategy`. Neither is a base of the class the call sits in, and Java resolves a simple name in the enclosing type first | **-2**         | **-2**       |
| **An enum writes `values()` and `valueOf(String)`**          | the source names neither, and `javac` attributes both: `IOCase.forName` filters its own `values()`. A graph that files only what is spelled has no declaration to point at                                                                                                                           | **0**          | **-2**       |
| **`Stream.of(x)` is a stream of `x`'s elements**             | `Stream.of(tokens).anyMatch(token -> token.getValue() …)` is the second spelling of `list.stream()`, and `Stream.of(Color.values())` names the element of what `values()` returns                                                                                                                    | **-1**         | **-1**       |

0 + 2 + 0 + 1 is the first column and 2 + 2 + 2 + 1 the second, **one more than the six the corpus moved, because one
edge needs two rules at once**: `IOCase.forName`'s `ioCase.getName()` is answered only when `values()` has a declaration
to return an array _and_ the argument of `Stream.of` is read as a path — so ablating either rule loses it, and a table
that added the rows would claim seven edges for six. That is the first time in this sequence that two rules were
prerequisites of one edge, and it is worth stating rather than smoothing over: **an ablation table adds up only if each
row is the delta of removing that rule from the full build**, which is what these are.

**And the arm that answers it is new, so it is floored like the others.** `enclosing` claimed 2 edges on
`commons-lang` and 4 on `commons-io`, all correct, and `scripts/callgraph-gate.js` now holds it at 100 % beside the
six arms that were already there. A rule that is only measured inside an aggregate is a rule whose precision nobody
knows.

## Adding a New Language

Language providers implement the `LanguageProvider` interface. You can extend `TreeSitterBaseProvider` for full AST-based parsing (recommended for languages with a tree-sitter grammar) or implement the interface directly for simpler formats like Dockerfile and YAML.

See the [Language Provider Contributing Guide](./contributing/language-provider.md) for a step-by-step walkthrough covering:

- The `LanguageProvider` interface overview
- Extending `TreeSitterBaseProvider` with node type mappings
- Regex fallback patterns for resilience
- Testing requirements and coverage thresholds
- Registering new providers in the analyzer package

### IaC Providers

Code Analyzer also supports Infrastructure-as-Code formats:

| Format        | Provider             | Parsing Method                            |
| ------------- | -------------------- | ----------------------------------------- |
| Dockerfile    | `DockerfileProvider` | Regex (FROM, RUN, COPY, ENV instructions) |
| HCL/Terraform | `HclProvider`        | Tree-sitter (`tree-sitter-hcl`)           |
| YAML          | Built-in             | Structured key-value parsing              |
| JSON          | Built-in             | Standard JSON parse                       |
| Markdown      | Built-in             | Content extraction                        |
| Shell         | Built-in             | Command parsing                           |
| SQL           | Built-in             | Statement parsing                         |
