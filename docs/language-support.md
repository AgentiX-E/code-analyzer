# Language Support Matrix

Code Analyzer names **33 languages** in `SUPPORTED_LANGUAGES`: **twenty-one with a tree-sitter grammar** and the
symbol-level extraction below, plus twelve that carry the configuration, markup and documents a repository is made of —
**and every one of them is admitted by the scanner**, which is what makes the provider for it reachable. _A provider
that no file ever reaches is dead code, and until 2026-10-25 six of them were._

**Every column below is a promise a test can break.** `packages/analyzer/src/__tests__/language-support-matrix.test.ts`
parses this file, and for each `✅` runs the check that row owns against the fixture the column's language is parsed
from — so a `✅` that stops being true fails the build rather than waiting for a reader to notice. Rows whose evidence is
a call graph rather than a capture are listed in `UNINSTRUMENTED` with the measurement that covers them.

## Feature Matrix

| Feature                      | TypeScript | JavaScript | Python | Go  | Java | Kotlin | C#  | Rust | PHP | Ruby | C/C++ | Swift | Dart | Lua | Scala | Zig | Elixir | ArkTS | Groovy | Bash |  R  |
| ---------------------------- | :--------: | :--------: | :----: | :-: | :--: | :----: | :-: | :--: | :-: | :--: | :---: | :---: | :--: | :-: | :---: | :-: | :----: | :---: | :----: | :--: | :-: |
| **Function Definitions**     |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |  ✅   |   ✅   |  ✅  | ✅  |
| **Method Definitions**       |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  —   | ✅  |  ✅  |   —   |   —   |  —   | N/A |   —   |  —  |  N/A   |  ✅   |   ✅   | N/A  | N/A |
| **Class Definitions**        |     ✅     |     ✅     |   ✅   | N/A |  ✅  |   ✅   | ✅  | N/A  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | N/A |  N/A   |  ✅   |   ✅   | N/A  | N/A |
| **Interface Definitions**    |     ✅     |    N/A     |  N/A   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |  ✅   |   ✅   | N/A  | N/A |
| **Enum Definitions**         |     ✅     |    N/A     |   ✅   | N/A |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  ✅   |  ✅   |  ✅  | N/A |   —   | ✅  |  N/A   |  ✅   |   ✅   | N/A  | N/A |
| **Type Definitions**         |     ✅     |    N/A     |   —    | N/A | N/A  |  N/A   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |  ✅   |  N/A   | N/A  | N/A |
| **Variable Definitions**     |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  —   |  —  |  ✅  |  ✅   |   —   |  —   | ✅  |   —   | ✅  |   —    |  ✅   |   ✅   |  ✅  | ✅  |
| **Constant Definitions**     |     ✅     |     ✅     |   —    | ✅  |  —   |   —    |  —  |  ✅  |  —  |  ✅  |   —   |  ✅   |  —   |  —  |   —   |  —  |   —    |  ✅   |   —    |  —   |  —  |
| **Import Statements**        |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |  ✅   |   ✅   |  —   |  —  |
| **Export Detection**         |     ✅     |     ✅     |  N/A   | N/A |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | ✅  |  N/A   |  ✅   |   ✅   |  —   |  —  |
| **Decorators/Annotations**   |     ✅     |    N/A     |   ✅   | N/A |  ✅  |   ✅   | ✅  |  ✅  | ✅  | N/A  |  N/A  |  N/A  |  ✅  | N/A |  N/A  | N/A |  N/A   |  ✅   |   ✅   | N/A  | N/A |
| **Route Detection**          |     —      |    N/A     |   —    | N/A | N/A  |  N/A   |  —  | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |   —   |  N/A   | N/A  | N/A |
| **Constructor Detection**    |     ✅     |     ✅     |   ✅   | N/A |  ✅  |  N/A   | ✅  | N/A  | ✅  |  ✅  |  ✅   |   —   |  —   | N/A |   —   | N/A |  N/A   |  ✅   |   ✅   | N/A  | N/A |
| **Docstrings/JSDoc**         |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |  ✅   |   ✅   |  ✅  | ✅  |
| **Function Calls**           |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |  ✅   |   ✅   |  ✅  | ✅  |
| **Declared Type Facts**      |     ✅     |     —      |   ✅   |  —  |  ✅  |   ✅   |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   ✅   | N/A  | N/A |
| **Declared Return Types**    |     ✅     |     —      |   ✅   |  —  |  ✅  |   ✅   |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   ✅   | N/A  | N/A |
| **Parameter Arity**          |     ✅     |     —      |   ✅   |  —  |  ✅  |   ✅   |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   ✅   | N/A  | N/A |
| **Package-Qualified Names**  |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Abstract Classes**         |     ✅     |    N/A     |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   ✅   | N/A  | N/A |
| **Class Expressions**        |     ✅     |     —      |   —    |  —  |  —   |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   —    | N/A  | N/A |
| **Type Aliases**             |     ✅     |    N/A     |   —    |  —  |  —   |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   —    | N/A  | N/A |
| **Type-Position References** |     ✅     |     —      |   ✅   |  —  |  ✅  |   ✅   |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   ✅   | N/A  | N/A |
| **Member Alias Bindings**    |     ✅     |     ✅     |   —    |  —  |  —   |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   —    |  —   |  —  |
| **Lexical `this`**           |     ✅     |     ✅     |  N/A   |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |  ✅   |   ✅   |  —   |  —  |
| **Deferred Calls (`::`)**    |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Resource Bindings**        |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Enum Constants**           |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Type Parameter Bounds**    |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Outer Instance `this`**    |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Factory-Call Receiver**    |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Cast Receiver**            |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Argument-Type Dispatch**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Collection Elements**      |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Lambda Parameter Types**   |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Functional Parameters**    |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Stream Receivers**         |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Implicit Construction**    |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Generic Factory Returns**  |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Inherited Member Hops**    |     —      |     —      |   —    |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |   —   |   ✅   |  —   |  —  |
| **Generics**                 |     ✅     |    N/A     |   —    | ✅  |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |  ✅   |   ✅   | N/A  | N/A |
| **Async Detection**          |     ✅     |     ✅     |   ✅   | N/A | N/A  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   |  ✅  | N/A |  N/A  | N/A |  N/A   |  ✅   |  N/A   | N/A  | N/A |
| **Extension Functions**      |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |  N/A  |  N/A   | N/A  | N/A |
| **Struct Detection**         |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |  N/A  |  N/A   | N/A  | N/A |
| **Record Detection**         |    N/A     |    N/A     |  N/A   | N/A |  ✅  |  N/A   | ✅  | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |  N/A  |   ✅   |  —   |  —  |
| **Trait Detection**          |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |  N/A  |  N/A   | N/A  | N/A |
| **Impl Block Detection**     |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |  N/A  |  N/A   |  —   |  —  |
| **Object Detection**         |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |  N/A  |  N/A   | N/A  | N/A |

**Four providers read a declared type**, and that row is the reason the call graph can resolve a receiver at all:
`fieldTypes`, `localTypes` and `parameterOwner`/`parameterType` are emitted by **TypeScript**, **Python**, **Java** and —
since iteration 85 — **Kotlin** (TypeScript and Java file fields, locals and parameters; Python and Kotlin file fields
and parameters). Those are also exactly the four languages with an independent accuracy oracle, which is not a
coincidence: a language whose declarations are not facts has nothing for an oracle to disagree with. The other thirteen
parse every declaration the matrix rows above record and resolve no receiver, so `widget.draw(…)` in C# or
`value.render()` in Rust is an unclaimed edge — **stated here rather than claimed as support.** Java spent four
iterations "supported" at **50 `CALLS` edges** on a Spring application because nobody had asked whether the arm that
reads a type had anything to read (iteration 56; the same checkout now yields 285, of which 235 come from that arm).
**Kotlin was the second instance of the same mistake and a worse one**: it emitted no call sites at all, which the
`Function Calls` row claimed it did — see the Kotlin section below.

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
| TypeScript |    Fast     |       ~5MB        | **100.0 % / 89.9 %** zod · **100.0 % / 92.2 %** ioredis             |
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

### TypeScript: the declarations a class writes and the walk did not file

**Four of the eight rules below exist because a class can be declared in a way that is not `class Name {`.** The other
four are about a **name that stands for a member**: a field holding a function, a field holding a construction, a local
bound to a static member, and a type alias. All eight were found the same way — reading a missed pair in
`benchmarks/callgraph-ts-quality.json` rather than reading the provider — and each was ablated alone:

| rule disabled alone                                                    | what the language states                                                                                                                                                                                                                                             | `colinhacks/zod` | `redis/ioredis` |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------- |
| **`abstract class` is a class**                                        | zod declares its whole type system on `export abstract class ZodType<…>`, ioredis its `AbstractConnector`. The node type is `abstract_class_declaration`, not `class_declaration`, so **no member of either belonged to anything** and `this.nullable()` had no host | **-11**          | **-3**          |
| **A named class expression is a class**                                | `this.Command = class CustomScriptCommand extends Command { … }` — ioredis writes `Script` this way inside a constructor. The node type is `class`, which the `class` **keyword token also uses**, so what makes it a declaration is a `name` field and not a type   | **0**            | **-1**          |
| **An arrow keeps `this`, a `function` expression rebinds it**          | the scope chain that answers "which class does this `this` refer to" walked every enclosing declaration as if it kept the receiver. It has to stop at a `function` expression, and only at one                                                                       | **-3**           | **-2**          |
| **A field initialised by a construction states its type**              | `index = new Index()` is a type fact the annotation would have stated; without it the field is a name with no evidence behind it                                                                                                                                     | **0**            | **0**           |
| **A field arrow's declared return type is the property's type**        | `static create: (params?: RawCreateParams) => ZodString` states the type on the _property_, which is where a `.d.ts`-shaped const writes it, not on the arrow                                                                                                        | **-4**           | **0**           |
| **A name bound to a class's static member is that member**             | `const stringType = ZodString.create` binds a name to a member, not to a class. Calling it is a call on the member, so the receiver arm needs the binding and the member's return type together                                                                      | **-3**           | **0**           |
| **Module-level bindings are visible to every declaration in the file** | the same `stringType`, declared at the top of a test file and used inside three `it(…)` callbacks, was scoped to the file and answered only because the first callable happened to precede it                                                                        | **-3**           | **0**           |
| **A type alias names a type**                                          | `type ZodTypeAny = ZodType<any, any, any>` is how zod's own test helpers type their parameters; the parameter's annotation names a `TypeAlias`, and the class it stands for is one hop away                                                                          | **-4**           | **0**           |

**The rows do not add up to the total, and that is the finding rather than an accounting error.** They sum to **28** on
zod against a measured gain of **12** (104 → 116 edges, 80.6 % → 89.9 %), because the families are **conjunctions**: a
parameter annotated `type: ZodTypeAny` needs the evidence the annotation gives _and_ the reader that follows the alias,
so ablating either rule loses the same edges. ioredis's six rows sum to its six edges exactly, because every rule that
fires there is a rule about a class body. **Every row is the delta of removing that one rule from the full build**, which
is the only reading under which an ablation table can be published at all.

**Precision is 100 % on both corpora after the eight rules**, so the floors moved to where a single wrong edge trips
them, and the per-arm floors moved with them: `import`, `inherited`, `namespace`, `sameFile` and `receiverType` are each
held at 99 %. **The 34 pairs still missing are named in `missedSamples`**, and the two groups they fall into are zod's
own `__tests__` helpers (`bad`, `checkErrors`) and ioredis's `cluster/index.ts`, which calls `disconnect`, `on`, `quit`
and `cluster` on a receiver whose type is a namespace rather than a class.

### A name a type position writes: TypeScript, Java, Kotlin, Python

**A reference kind with a mapping and no producer is a classification, not a feature.** `captureTagToReferenceKind` maps
the capture tag `type.reference` to the reference kind `type`, and until iteration 83 nothing emitted it: `zod`'s
`src/types.ts` — a real file, counted — holds **3,479 references and zero of them type references**. The consequence
was not invisible. `abstract class Class` in `colinhacks/zod@3.23.8` is named exactly once, inside
`<T extends typeof Class>`, and the dead-code pass — which reads call edges and mention edges — reported it as dead on a
library that publishes every name it declares. Iteration 84 gave the same producer to the three languages where the
position is the _only_ place a dependency is written: `private final Registry registry;`, `val policy: RetryPolicy` and
`def send(p: RetryPolicy)` are how constructor injection is spelled in each, and the class named there is read through
the annotation and never mentioned again.

**Each language asks the question its own grammar makes answerable, and none of them reads text to decide.** The four
walks differ because the four grammars differ:

| Language   | What decides "this is a type position"                                                                                                | What is deliberately not filed                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| TypeScript | Three anchors: `type_annotation`, `type_alias_declaration`, `type_parameters`                                                         | `predefined_type` as a subtree; the first named child of a binder production; `T` a file declares, by name |
| Java       | The node type: every `type_identifier` / `scoped_type_identifier` outside a `type_parameter`                                          | primitives (they are `integral_type` / `void_type`); `var`; the member's own name in `a.b.C`               |
| Kotlin     | The `user_type` boundary: every type a declaration writes is inside one, every `type_identifier` outside one is a name being declared | the packages in `kotlinx.coroutines.Flow`; `R` a file declares, by name                                    |
| Python     | Four productions: `typed_parameter`, `typed_default_parameter`, `function_definition.return_type`, `assignment`                       | the module in `typing.List`; a string forward reference (`"Later"` is text, not code)                      |

**Java is the clearest case of a boundary the grammar already drew.** `int` is an `integral_type` node and `void` a
`void_type`, so the primitives fall out structurally rather than by a list of words; every remaining type position —
a field, a local, a parameter, a return, a cast, an `instanceof`, a `catch`, a `new` — holds a `type_identifier`. Only
one declaration is spelled with the node type a use has: `type_parameter`, whose name is suppressed by name, because
`<T extends Widget> T pick(T a)` declares `T` once and writes it twice at three different offsets. **Kotlin is the
cleanest**: `user_type` is the wall, `class Widget` and `typealias Alias` are outside it, and a qualified type is
_three_ sibling `type_identifier` nodes, so a walk that collected identifiers would file `kotlinx` and `coroutines` as
types. **Python is the only one that needs an anchor list**, because it spells a type with the same nodes an expression
has — `identifier`, `subscript`, `attribute` — and nothing in a type's own shape says it is one.

**A qualified name reads as its member.** `java.util.List` names `List`, `kotlinx.coroutines.Flow` names `Flow`,
`typing.List` names `List` — the same split TypeScript makes for `z.ZodTypeAny`. A package is not a symbol in any
graph, and filing it would make every `java` or `kotlinx` token in a checkout a mention of anything that happened to
share the name.

**What the reference becomes is a dependency and not a call.** Scope resolution turns a resolved `type` reference into a
`USES_TYPE` edge carrying `resolution: 'type-mention'`, and `reachability` counts that edge among the ones along which
"this can run" implies "the target can run". Recording it as a `CALLS` edge would have inflated the call graph with
sites the oracle scores as wrong; recording it as nothing is what produced the finding. Measured on the four dead-code
corpora: `colinhacks/zod` **1 finding → 0** (its ceiling is 0), `redis/ioredis` 0, `pallets/flask` 3, `pallets/werkzeug`
2 — `dead-code-gate: 4 corpora held to their floors`.

**The end-to-end test is one checkout in three languages**, because the question a user asks is about their repository:
`tests/e2e/a-name-in-a-type-position-java-python-kotlin.test.ts` asserts the edge for `Registry`, `_RetryPolicy` and
`Outcome`, asserts that none of the three reaches the dead report, and asserts that the two decoys — `Orphan` and
`_Orphan`, named by nothing — stay in it. Reverting the three providers makes it fail on `expected 0 to be greater than
0`; that is what keeps it from being a test of the fixtures.

**What is still not covered** is stated rather than implied: no other provider emits type references, so a class named
only in a type position is still reported dead in C#, Rust, Go, Swift, Scala and the rest. The corpora that hold the
dead-code gate are Python and TypeScript, which is why the gate is green; the JVM and Python providers closing it is a
claim about those four languages and this table's other thirteen columns say `—` for exactly that reason.

## Kotlin: the calls and the signatures one walk forgot

**`Function Calls` was `✅` for Kotlin and the graph held zero of them.** `KotlinProvider` overrides `walkAndCapture`,
and that override handled classes, objects, functions and imports: a `call_expression` reached no branch, so
`p.refresh()` was parsed, matched nothing, and was dropped. The matrix said otherwise because the row was written from
the language's capabilities rather than from the provider's emissions — **the same defect class as the reference kind
nobody wrote, one level up: a row in a table is a promise, and a promise needs a producer.**

**What it cost.** The Long Code Arena sample reads **0.3934** on Kotlin against **0.5405** on Python and **0.5156** on
Java, and the gap is not the retriever: with no `CALLS` edges a Kotlin checkout has no call graph, so retrieval can only
match names. A language with no call graph is a language the rest of the product cannot reason about — reachability,
change impact and dead code all read edges that did not exist.

**One node type spells every call.** `p.refresh()`, `refresh()` and `Builder()` are all `call_expression`, and the first
named child is the callee — which is what the base implementation already takes the _text_ from (`p.refresh`). Three
small overrides make the rest Kotlin's own:

| What               | Kotlin's answer                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| the reference name | the **last segment** of the callee: `p.refresh` → `refresh`, because a dotted name resolves to nothing                           |
| method or function | the callee is a `navigation_expression` (or a `call_expression`, for `Builder().build()`) — the tag is what carries the receiver |
| the argument count | `call_suffix > value_arguments`, not an `arguments` field; a `*spread` states no count rather than a wrong one                   |

**The walk does not stop at a call**, because the callee of `Builder().build()` is itself a call and an argument list can
hold calls: both are visited, so the constructor and the callback are recorded as the sites they are.

**The declarations published nothing either, and the grammar had two surprises.** `returnType`, `parameterCount`,
`requiredParameters`, `parameterTypes`, `fieldTypes` and the `parameterOwner`/`parameterType` pair are emitted now. Two
facts about tree-sitter-kotlin are worth stating because both are counter-intuitive:

1. **There is no `return_type` field.** The return type is a `user_type` (or `nullable_type`, or `function_type`) sitting
   between `function_value_parameters` and `function_body`, so its _position_ is the fact and the body is where the
   search stops — a `user_type` inside the body is a local's type.
2. **A default value and a `vararg` are siblings of the parameter, not children of it.**
   `fun send(p: RetryPolicy = TODO(), vararg rest: Widget)` parses as `parameter`, `"="`, `call_expression`,
   `parameter_modifiers`, `parameter` — so a walk that read a `parameter` node and nothing else reported `p` as
   _required_, which is a call the type checker refuses. The `=` to the right and the modifiers to the left are the
   whole of that fact.

**A property is only a property when it says `val` or `var`.** `class Service(val policy: RetryPolicy)` declares a field
and a parameter at once, and `class Service(registry: Registry)` declares only an argument; the `binding_pattern_kind`
child is what separates them. `fun run() { val x: Widget = … }` is a local, and the upward walk stops at a
`function_declaration` so it is not filed as a field of the class.

**The end-to-end test is the call the parameter type answers**:
`tests/e2e/a-kotlin-parameter-type-resolves-the-call.test.ts` declares **two** classes with a `refresh` of their own —
the wrong one first — and asserts that `p.refresh()` inside `fun send(p: RetryPolicy)` resolves to
`RetryPolicy.refresh` and not to the other. A name-only resolver picks the first and fails; reverting `kotlin.ts` makes
it fail by finding no edge at all.

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
