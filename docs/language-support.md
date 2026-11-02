# Language Support Matrix

Code Analyzer names **33 languages** in `SUPPORTED_LANGUAGES`: **seventeen with a tree-sitter grammar** and the
symbol-level extraction below, plus sixteen that carry the configuration, markup and documents a repository is made of —
**and every one of them is admitted by the scanner**, which is what makes the provider for it reachable. _A provider
that no file ever reaches is dead code, and until 2026-10-25 six of them were._

## Feature Matrix

| Feature                    | TypeScript | JavaScript | Python | Go  | Java | Kotlin | C#  | Rust | PHP | Ruby | C/C++ | Swift | Dart | Lua | Scala | Zig | Elixir |
| -------------------------- | :--------: | :--------: | :----: | :-: | :--: | :----: | :-: | :--: | :-: | :--: | :---: | :---: | :--: | :-: | :---: | :-: | :----: |
| **Function Definitions**   |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Method Definitions**     |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | ✅  |  N/A   |
| **Class Definitions**      |     ✅     |     ✅     |   ✅   | N/A |  ✅  |   ✅   | ✅  | N/A  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | N/A |  N/A   |
| **Interface Definitions**  |     ✅     |    N/A     |  N/A   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Enum Definitions**       |     ✅     |    N/A     |   ✅   | N/A |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | ✅  |  N/A   |
| **Type Definitions**       |     ✅     |    N/A     |   ✅   | N/A | N/A  |  N/A   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Variable Definitions**   |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Constant Definitions**   |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Import Statements**      |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Export Detection**       |     ✅     |     ✅     |  N/A   | N/A |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | ✅  |  N/A   |
| **Decorators/Annotations** |     ✅     |    N/A     |   ✅   | N/A |  ✅  |   ✅   | ✅  |  ✅  | ✅  | N/A  |  N/A  |  N/A  |  ✅  | N/A |  N/A  | N/A |  N/A   |
| **Route Detection**        |     ✅     |    N/A     |   ✅   | N/A | N/A  |  N/A   | ✅  | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Constructor Detection**  |     ✅     |     ✅     |   ✅   | N/A |  ✅  |  N/A   | ✅  | N/A  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | N/A |  ✅   | N/A |  N/A   |
| **Docstrings/JSDoc**       |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Function Calls**         |     ✅     |     ✅     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | ✅  |  ✅  |  ✅   |  ✅   |  ✅  | ✅  |  ✅   | ✅  |   ✅   |
| **Declared Type Facts**    |     ✅     |     —      |   ✅   |  —  |  ✅  |   —    |  —  |  —   |  —  |  —   |   —   |   —   |  —   |  —  |   —   |  —  |   —    |
| **Generics**               |     ✅     |    N/A     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Async Detection**        |     ✅     |     ✅     |   ✅   | N/A | N/A  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   |  ✅  | N/A |  N/A  | N/A |  N/A   |
| **Extension Functions**    |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Struct Detection**       |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Record Detection**       |    N/A     |    N/A     |  N/A   | N/A |  ✅  |  N/A   | ✅  | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Trait Detection**        |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Impl Block Detection**   |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Object Detection**       |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |

**Only three providers read a declared type**, and that row is the reason the call graph can resolve a receiver at
all: `fieldTypes`, `localTypes` and `parameterOwner`/`parameterType` are emitted by **TypeScript**, **Python** and
**Java** — TypeScript and Java file fields, locals and parameters, Python files fields and parameters. Those are also
exactly the three languages with an independent accuracy oracle, which is not a coincidence: a language whose
declarations are not facts has nothing for an oracle to disagree with. The other fourteen parse every declaration the
matrix rows above record and resolve no receiver, so `this.builder.append(…)` in Kotlin or `widget.draw(…)` in C# is an
unclaimed edge — **stated here rather than claimed as support.** Java spent four iterations "supported" at **50 `CALLS`
edges** on a Spring application because nobody had asked whether the arm that reads a type had anything to read
(iteration 56; the same checkout now yields 285, of which 235 come from that arm).

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

| Language   | Parse Speed | Memory per 1K LOC | Call-graph precision / recall (measured)                          |
| ---------- | :---------: | :---------------: | :---------------------------------------------------------------- |
| TypeScript |    Fast     |       ~5MB        | **100.0 % / 80.6 %** zod · **100.0 % / 90.0 %** ioredis           |
| Python     |   Medium    |       ~3MB        | **97.9 % / 97.9 %** flask · **98.0 % / 96.7 %** werkzeug          |
| Java       |    Fast     |       ~5MB        | **99.1 % / 86.9 %** commons-lang · **99.9 % / 80.2 %** commons-io |
| JavaScript |    Fast     |       ~4MB        | not measured                                                      |
| Go         |    Fast     |       ~3MB        | not measured                                                      |
| Kotlin     |   Medium    |       ~4MB        | not measured                                                      |
| C#         |    Fast     |       ~5MB        | not measured                                                      |
| Rust       |   Medium    |       ~4MB        | not measured                                                      |
| PHP        |    Fast     |       ~4MB        | not measured                                                      |
| Ruby       |   Medium    |       ~4MB        | not measured                                                      |
| C/C++      |    Fast     |       ~3MB        | not measured                                                      |
| Swift      |   Medium    |       ~4MB        | not measured                                                      |
| Dart       |    Fast     |       ~4MB        | not measured                                                      |
| Lua        |    Fast     |       ~2MB        | not measured                                                      |
| Scala      |   Medium    |       ~5MB        | not measured                                                      |
| Zig        |   Medium    |       ~3MB        | not measured                                                      |
| Elixir     |   Medium    |       ~3MB        | not measured                                                      |

**This column used to read `99%+`, `97%+`, `95%+` for every language**, and none of those numbers had an instrument
behind it — they were read off a parse success rate and repeated. What replaced them is a call-graph figure per corpus,
produced by `scripts/callgraph-quality.ts` against an oracle that is not this codebase (`CPython ast`, the TypeScript
checker, and `javac`'s own attribution), gated per arm by `scripts/callgraph-gate.js` and re-run on every push by
`.github/workflows/callgraph-quality.yml`. **The recall column is the honest one**: Java's 80.2 % on `commons-io` is
what "97%+" was hiding.

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
