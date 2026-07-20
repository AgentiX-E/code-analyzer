# Language Support Matrix

Code Analyzer supports 8 programming languages with varying levels of analysis depth.

## Feature Matrix

| Feature | TypeScript | JavaScript | Python | Go | Java | Kotlin | C# | Rust |
|---------|:----------:|:----------:|:------:|:--:|:----:|:------:|:--:|:----:|
| **Function Definitions** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Method Definitions** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Class Definitions** | ✅ | ✅ | ✅ | N/A | ✅ | ✅ | ✅ | N/A |
| **Interface Definitions** | ✅ | N/A | N/A | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Enum Definitions** | ✅ | N/A | ✅ | N/A | ✅ | ✅ | ✅ | ✅ |
| **Type Definitions** | ✅ | N/A | ✅ | N/A | N/A | N/A | N/A | N/A |
| **Variable Definitions** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Constant Definitions** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Import Statements** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Export Detection** | ✅ | ✅ | N/A | N/A | ✅ | ✅ | ✅ | ✅ |
| **Decorators/Annotations** | ✅ | N/A | ✅ | N/A | ✅ | ✅ | ✅ | ✅ |
| **Route Detection** | ✅ | N/A | ✅ | N/A | N/A | N/A | ✅ | N/A |
| **Constructor Detection** | ✅ | ✅ | ✅ | N/A | ✅ | N/A | ✅ | N/A |
| **Docstrings/JSDoc** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Function Calls** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Generics** | ✅ | N/A | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Async Detection** | ✅ | ✅ | ✅ | N/A | N/A | ✅ | ✅ | ✅ |
| **Extension Functions** | N/A | N/A | N/A | N/A | N/A | ✅ | N/A | N/A |
| **Struct Detection** | N/A | N/A | N/A | N/A | N/A | N/A | ✅ | ✅ |
| **Record Detection** | N/A | N/A | N/A | N/A | ✅ | N/A | ✅ | N/A |
| **Trait Detection** | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ✅ |
| **Impl Block Detection** | N/A | N/A | N/A | N/A | N/A | N/A | N/A | ✅ |
| **Object Detection** | N/A | N/A | N/A | N/A | N/A | ✅ | N/A | N/A |

## File Extensions

| Language | Extensions |
|----------|-----------|
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `.py`, `.pyw`, `.pyi` |
| Go | `.go` |
| Java | `.java` |
| Kotlin | `.kt`, `.kts` |
| C# | `.cs` |
| Rust | `.rs` |

## Cross-Language Analysis

Code Analyzer supports **cross-language analysis** within a single project. For example, a TypeScript frontend calling a Python backend API, or a Rust library with C# bindings.

### Import Resolution

| From → To | TypeScript | Python | Go | Java | Rust |
|-----------|:----------:|:------:|:--:|:----:|:----:|
| TypeScript | ✅ named/namespace | — | — | — | — |
| Python | — | ✅ named/namespace | — | — | — |
| Go | — | — | ✅ named/wildcard | — | — |
| Java | — | — | — | ✅ named/wildcard | — |
| Kotlin | — | — | — | — | — |
| C# | — | — | — | — | — |
| Rust | — | — | — | — | ✅ named/wildcard |

> **Note**: Cross-language edges (e.g., TypeScript calling Python) are represented as `CROSS_REPO_*` edges in the knowledge graph.

## Performance Characteristics

| Language | Parse Speed | Memory per 1K LOC | Accuracy |
|----------|:-----------:|:-----------------:|:--------:|
| TypeScript | Fast | ~5MB | 99%+ |
| JavaScript | Fast | ~4MB | 99%+ |
| Python | Medium | ~3MB | 97%+ |
| Go | Fast | ~3MB | 98%+ |
| Java | Fast | ~5MB | 97%+ |
| Kotlin | Medium | ~4MB | 95%+ |
| C# | Fast | ~5MB | 97%+ |
| Rust | Medium | ~4MB | 96%+ |

## Adding a New Language

Language providers implement the `LanguageProvider` interface:

```typescript
interface LanguageProvider {
  readonly language: string;
  readonly displayName: string;
  readonly extensions: string[];
  readonly globs: string[];
  parse(source: string, filePath: string): UnifiedCapture[];
  extractImports(source: string): ParsedImport[];
  isExported(source: string, symbolName: string): boolean;
  readonly importSemantics: ImportSemantics;
}
```

See [Contributing Guide](../CONTRIBUTING.md) for details on adding new language support.
