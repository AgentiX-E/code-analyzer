# Language Support Matrix

Code Analyzer supports 20 programming languages and configuration formats with varying levels of analysis depth, covering both traditional programming languages and Infrastructure-as-Code (IaC) formats.

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
| **Generics**               |     ✅     |    N/A     |   ✅   | ✅  |  ✅  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Async Detection**        |     ✅     |     ✅     |   ✅   | N/A | N/A  |   ✅   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   |  ✅  | N/A |  N/A  | N/A |  N/A   |
| **Extension Functions**    |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Struct Detection**       |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | ✅  |  ✅  | N/A | N/A  |  N/A  |  ✅   | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Record Detection**       |    N/A     |    N/A     |  N/A   | N/A |  ✅  |  N/A   | ✅  | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Trait Detection**        |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Impl Block Detection**   |    N/A     |    N/A     |  N/A   | N/A | N/A  |  N/A   | N/A |  ✅  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |
| **Object Detection**       |    N/A     |    N/A     |  N/A   | N/A | N/A  |   ✅   | N/A | N/A  | N/A | N/A  |  N/A  |  N/A  | N/A  | N/A |  N/A  | N/A |  N/A   |

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

| Language   | Parse Speed | Memory per 1K LOC | Accuracy |
| ---------- | :---------: | :---------------: | :------: |
| TypeScript |    Fast     |       ~5MB        |   99%+   |
| JavaScript |    Fast     |       ~4MB        |   99%+   |
| Python     |   Medium    |       ~3MB        |   97%+   |
| Go         |    Fast     |       ~3MB        |   98%+   |
| Java       |    Fast     |       ~5MB        |   97%+   |
| Kotlin     |   Medium    |       ~4MB        |   95%+   |
| C#         |    Fast     |       ~5MB        |   97%+   |
| Rust       |   Medium    |       ~4MB        |   96%+   |
| PHP        |    Fast     |       ~4MB        |   95%+   |
| Ruby       |   Medium    |       ~4MB        |   95%+   |
| C/C++      |    Fast     |       ~3MB        |   97%+   |
| Swift      |   Medium    |       ~4MB        |   96%+   |
| Dart       |    Fast     |       ~4MB        |   95%+   |
| Lua        |    Fast     |       ~2MB        |   94%+   |
| Scala      |   Medium    |       ~5MB        |   95%+   |
| Zig        |   Medium    |       ~3MB        |   94%+   |
| Elixir     |   Medium    |       ~3MB        |   94%+   |

## Adding a New Language

Language providers implement the `LanguageProvider` interface. You can extend `TreeSitterBaseProvider` for full AST-based parsing (recommended for languages with a tree-sitter grammar) or implement the interface directly for simpler formats like Dockerfile and YAML.

See the [Language Provider Contributing Guide](/contributing/language-provider) for a step-by-step walkthrough covering:

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
