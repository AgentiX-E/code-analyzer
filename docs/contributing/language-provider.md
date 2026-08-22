# Language Provider Guide

This guide explains how to contribute a new language provider to Code Analyzer. Language providers are responsible for parsing source code, extracting code structure (functions, classes, imports, etc.), and emitting **UnifiedCaptures** that feed into the analysis pipeline and knowledge graph.

---

## Architecture Overview

```
Source File (.ts, .py, .go, ...)
        │
        ▼
┌─────────────────────────────────┐
│   LanguageProvider.parse()      │
│   ┌─────────────────────────┐   │
│   │  Tree-sitter AST parse   │   │  ← Primary: full AST accuracy
│   │  (TreeSitterBaseProvider)│   │
│   └──────────┬──────────────┘   │
│              │ fallback on error │
│   ┌──────────▼──────────────┐   │
│   │  Regex fallback parse    │   │  ← Fallback: no native dependency
│   └─────────────────────────┘   │
└─────────────────────────────────┘
        │
        ▼
  UnifiedCapture[]  →  Knowledge Graph Nodes & Edges
```

Every language provider implements the `LanguageProvider` interface. For languages with a tree-sitter grammar available, extend `TreeSitterBaseProvider` for full AST-based parsing. For simpler formats or languages without a grammar, implement the interface directly with regex-based parsing.

---

## The LanguageProvider Interface

```typescript
// From @code-analyzer/analyzer
export interface LanguageProvider {
  /** Machine-readable language identifier (e.g., "typescript", "python") */
  readonly language: string;

  /** Human-readable display name (e.g., "TypeScript", "Python") */
  readonly displayName: string;

  /** File extensions handled by this provider (e.g., [".ts", ".tsx"]) */
  readonly extensions: string[];

  /** Glob patterns for file discovery (e.g., ["**/*.ts", "**/*.tsx"]) */
  readonly globs: string[];

  /** Parse source code and return unified captures */
  parse(source: string, filePath: string): UnifiedCapture[];

  /** Extract import statements from source code */
  extractImports(source: string): ParsedImport[];

  /** Check if a named symbol is exported from this source */
  isExported(source: string, symbolName: string): boolean;

  /** Import semantics for this language (named, wildcard, namespace, etc.) */
  readonly importSemantics: ImportSemantics;
}
```

### UnifiedCapture

```typescript
export interface UnifiedCapture {
  /** The capture tag (e.g., FUNCTION_DEFINITION, CLASS_DEFINITION) */
  tag: CaptureTag;

  /** Full text of the captured node */
  text: string;

  /** 1-based start line number */
  startLine: number;

  /** 1-based end line number */
  endLine: number;

  /** Start byte offset in the source */
  startByte: number;

  /** End byte offset in the source */
  endByte: number;

  /** Extracted symbol name */
  name?: string;

  /** Containing class/interface/enum name (if applicable) */
  containerName?: string;

  /** Additional properties (filePath, baseClasses, interfaces, etc.) */
  properties: Record<string, string>;
}
```

### Capture Tags

| Tag                    | Node Type                      | Example Keywords            |
| ---------------------- | ------------------------------ | --------------------------- |
| `FUNCTION_DEFINITION`  | Top-level or member function   | `function`, `def`, `func`   |
| `METHOD_DEFINITION`    | Class/interface member method  | method inside a class       |
| `CLASS_DEFINITION`     | Class declaration              | `class`, `class` keyword    |
| `INTERFACE_DEFINITION` | Interface declaration          | `interface`, `protocol`     |
| `ENUM_DEFINITION`      | Enum declaration               | `enum`, `enum class`        |
| `TYPE_DEFINITION`      | Type alias                     | `type`, `typedef`           |
| `VARIABLE_DEFINITION`  | Variable declaration           | `let`, `var`, `val`         |
| `CONSTANT_DEFINITION`  | Constant declaration           | `const`, `final`            |
| `FUNCTION_CALL`        | Function/method invocation     | `foo()`, `bar.baz()`        |
| `METHOD_CALL`          | Method invocation on an object | `obj.method()`              |
| `IMPORT_STATEMENT`     | Import/require statement       | `import`, `require`         |
| `DECORATOR`            | Decorator/annotation           | `@decorator`, `@Annotation` |

Full tag list: `UnifiedCapture` and `CAPTURE_TAGS` are exported from `@code-analyzer/shared`.

---

## Option 1: Extending TreeSitterBaseProvider (Recommended)

For languages with an existing tree-sitter grammar, the simplest path is to extend the `TreeSitterBaseProvider` abstract class.

### Step-by-Step: Create a New Tree-sitter Provider

#### 1. Create the provider file

```
packages/analyzer/src/languages/mylang.ts
```

#### 2. Implement the class

```typescript
import { TreeSitterBaseProvider, type NodeTypeMapping } from './tree-sitter-base.js';
import type { ImportSemantics, UnifiedCapture, ParsedImport } from '@code-analyzer/shared';
import type { TreeSitterLanguage } from './tree-sitter-base.js';

export class MyLanguageProvider extends TreeSitterBaseProvider {
  readonly language = 'mylang';
  readonly displayName = 'My Language';
  readonly extensions = ['.ml', '.mylang'];
  readonly globs = ['**/*.ml', '**/*.mylang'];
  readonly importSemantics: ImportSemantics = {
    supportsNamedImports: true,
    supportsDefaultImports: false,
    supportsWildcardImports: true,
    supportsNamespaceImports: false,
  };

  protected loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const grammar = require('tree-sitter-mylang') as { grammar: unknown; name: string };
      return { name: grammar.name, language: grammar.grammar };
    } catch {
      return null; // Falls back to regex parsing
    }
  }

  protected getNodeMappings(): NodeTypeMapping[] {
    return [
      {
        nodeType: 'function_definition',
        captureTag: CAPTURE_TAGS.FUNCTION_DEFINITION,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'class_definition',
        captureTag: CAPTURE_TAGS.CLASS_DEFINITION,
        nameChildType: 'identifier',
      },
      {
        nodeType: 'variable_declaration',
        captureTag: CAPTURE_TAGS.VARIABLE_DEFINITION,
        useFirstNamedChild: true,
      },
    ];
  }

  // Optional: Override import extraction for language-specific AST types
  protected override getImportNodeTypes(): string[] {
    return ['import_statement', 'import_from_statement'];
  }

  // Implement fallback methods
  protected fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    return regexFallbackParse(source, filePath);
  }

  protected fallbackExtractImports(source: string): ParsedImport[] {
    return regexFallbackExtractImports(source);
  }

  protected fallbackIsExported(source: string, symbolName: string): boolean {
    return regexFallbackIsExported(source, symbolName);
  }
}
```

#### 3. Node Type Mappings

The `getNodeMappings()` method maps tree-sitter AST node types to capture tags. Each mapping specifies:

| Field                | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `nodeType`           | The tree-sitter node type string to match                    |
| `captureTag`         | The `UnifiedCapture` tag to emit                             |
| `nameChildType`      | (optional) The child node type that contains the symbol name |
| `useFirstNamedChild` | (optional) Use the first named child as the name             |

**Naming convention**: The AST walks recursively, so you only need to map the top-level syntactic forms — imports, calls, and container relationships are handled by the base class automatically.

#### 4. Import Semantics

Configure `importSemantics` to reflect how imports work in your language:

```typescript
readonly importSemantics: ImportSemantics = {
  supportsNamedImports: true,    // import { foo } from ...
  supportsDefaultImports: true,  // import foo from ...
  supportsWildcardImports: true, // import * as foo from ...
  supportsNamespaceImports: false,
};
```

---

## Option 2: Implementing Directly (Pure Regex)

For tree-sitter-less languages, implement the `LanguageProvider` interface directly with regex patterns.

### Regex Fallback Pattern

Each regex-based provider should implement three core methods:

```typescript
import type { LanguageProvider, ParsedImport } from './provider.js';
import type { UnifiedCapture, ImportSemantics } from '@code-analyzer/shared';

export class SimpleLanguageProvider implements LanguageProvider {
  readonly language = 'simple';
  readonly displayName = 'Simple Format';
  readonly extensions = ['.sm'];
  readonly globs = ['**/*.sm'];
  readonly importSemantics: ImportSemantics = {
    supportsNamedImports: false,
    supportsDefaultImports: false,
    supportsWildcardImports: false,
    supportsNamespaceImports: false,
  };

  parse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];

    // Regex for function definitions
    const funcRegex = /func\s+(\w+)\s*\(/g;
    for (const match of source.matchAll(funcRegex)) {
      const lineNum = source.substring(0, match.index!).split('\n').length;
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEFINITION,
        text: match[0],
        name: match[1],
        startLine: lineNum,
        endLine: lineNum,
        startByte: match.index!,
        endByte: match.index! + match[0].length,
        properties: { filePath },
      });
    }

    return captures;
  }

  extractImports(source: string): ParsedImport[] {
    // Implement import regex matching
    return [];
  }

  isExported(source: string, symbolName: string): boolean {
    // Check for export keyword patterns
    return /export/.test(source);
  }
}
```

### Regex Best Practices

- Use **named capture groups** for readability: `/(?<name>\w+)/`
- Anchor patterns carefully to avoid false positives inside strings/comments
- Calculate line numbers from `source.substring(0, match.index!).split('\n').length`
- Always set the `filePath` in the `properties` record
- Sort captures by `startLine` before returning

---

## Registering the Provider

After creating your provider, register it in the analyzer package's export barrel:

**File**: `packages/analyzer/src/index.ts`

```typescript
// Add your provider to the exports
export { MyLanguageProvider } from './languages/mylang.js';
```

If your language uses a new tree-sitter grammar, add it as a dependency:

```bash
pnpm --filter @code-analyzer/analyzer add tree-sitter-mylang
```

Then add the package to `pnpm.onlyBuiltDependencies` in `package.json` if it needs native compilation.

---

## Testing Requirements

Every language provider **must** have comprehensive tests. Create the test file alongside the provider:

```
packages/analyzer/src/languages/__tests__/mylang.test.ts
```

### Required Test Categories

#### 1. Basic Parsing

```typescript
it('should parse a simple function definition', () => {
  const source = 'func hello(): void {}';
  const captures = provider.parse(source, 'test.mylang');
  expect(captures).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        tag: CAPTURE_TAGS.FUNCTION_DEFINITION,
        name: 'hello',
      }),
    ]),
  );
});
```

#### 2. All Capture Types

Test every capture tag emitted by your node mappings:

- Function/method definitions
- Class/interface/enum definitions
- Variable/constant declarations
- Import statements
- Function/method calls
- Decorators/annotations (if applicable)

#### 3. Edge Cases

- Empty files
- Files with only comments
- Nested structures (class inside class)
- Multi-line declarations
- Unicode identifiers (if supported by the language)
- Files without any recognized constructs

#### 4. Import Extraction

```typescript
it('should extract named imports', () => {
  const source = 'import { foo, bar } from "module"';
  const imports = provider.extractImports(source);
  expect(imports).toEqual([
    expect.objectContaining({
      source: 'module',
      names: ['foo', 'bar'],
      type: 'named',
    }),
  ]);
});
```

#### 5. Export Detection

```typescript
it('should detect exported symbols', () => {
  const source = 'export func myFunc() {}';
  expect(provider.isExported(source, 'myFunc')).toBe(true);
  expect(provider.isExported(source, 'otherFunc')).toBe(false);
});
```

#### 6. Fallback Coverage

If using `TreeSitterBaseProvider`, test the regex fallback path by mocking the `loadGrammar()` method to return `null`, ensuring that parsing still works without tree-sitter.

### Coverage Requirements

- **Lines**: ≥ 95%
- **Branches**: ≥ 90%
- **Functions**: ≥ 95%

---

## Infrastructure-as-Code (IaC) Providers

For configuration and infrastructure files (Dockerfile, HCL/Terraform, YAML, etc.), create a simpler `LanguageProvider` implementation. These typically do not use tree-sitter but rely on structured regex or key-value parsing.

### Dockerfile Example Pattern

```typescript
parse(source: string, filePath: string): UnifiedCapture[] {
  const captures: UnifiedCapture[] = [];
  const lines = source.split('\n');

  for (const [idx, line] of lines.entries()) {
    const stageMatch = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\w+))?/i);
    if (stageMatch) {
      captures.push({
        tag: CAPTURE_TAGS.STAGE_DEFINITION,
        text: line,
        name: stageMatch[2] || stageMatch[1],
        startLine: idx + 1,
        endLine: idx + 1,
        startByte: source.indexOf(line),
        endByte: source.indexOf(line) + line.length,
        properties: { filePath, baseImage: stageMatch[1] },
      });
    }
  }

  return captures;
}
```

### HCL/Terraform Example Pattern

Parse `resource`, `module`, `variable`, `output`, and `provider` blocks as structured captures with relevant metadata (resource type, provider name, etc.).

---

## Supported Language Matrix (Current)

| Language      | Provider Class       | Type        | Tree-sitter Grammar      |
| ------------- | -------------------- | ----------- | ------------------------ |
| TypeScript    | `TypeScriptProvider` | Tree-sitter | `tree-sitter-typescript` |
| JavaScript    | `JavaScriptProvider` | Tree-sitter | `tree-sitter-javascript` |
| Python        | `PythonProvider`     | Tree-sitter | `tree-sitter-python`     |
| Go            | `GoProvider`         | Tree-sitter | `tree-sitter-go`         |
| Java          | `JavaProvider`       | Tree-sitter | `tree-sitter-java`       |
| Kotlin        | `KotlinProvider`     | Tree-sitter | `tree-sitter-kotlin`     |
| C#            | `CSharpProvider`     | Tree-sitter | `tree-sitter-c-sharp`    |
| Rust          | `RustProvider`       | Tree-sitter | `tree-sitter-rust`       |
| Ruby          | `RubyProvider`       | Tree-sitter | `tree-sitter-ruby`       |
| PHP           | `PhpProvider`        | Tree-sitter | `tree-sitter-php`        |
| Swift         | `SwiftProvider`      | Tree-sitter | `tree-sitter-swift`      |
| C             | `CProvider`          | Tree-sitter | `tree-sitter-c`          |
| C++           | `CppProvider`        | Tree-sitter | `tree-sitter-cpp`        |
| Dart          | `DartProvider`       | Tree-sitter | `tree-sitter-dart`       |
| Lua           | `LuaProvider`        | Tree-sitter | `tree-sitter-lua`        |
| Scala         | `ScalaProvider`      | Tree-sitter | `tree-sitter-scala`      |
| Zig           | `ZigProvider`        | Tree-sitter | `tree-sitter-zig`        |
| Elixir        | `ElixirProvider`     | Tree-sitter | `tree-sitter-elixir`     |
| HCL/Terraform | `HclProvider`        | Tree-sitter | `tree-sitter-hcl`        |
| Dockerfile    | `DockerfileProvider` | Regex       | N/A                      |

---

## Pull Request Checklist

When submitting a new language provider:

- [ ] Provider class implements `LanguageProvider` (or extends `TreeSitterBaseProvider`)
- [ ] All required abstract methods are implemented
- [ ] `fallbackParse`, `fallbackExtractImports`, and `fallbackIsExported` are provided (for tree-sitter providers)
- [ ] Provider is exported from `packages/analyzer/src/index.ts`
- [ ] Tests cover all capture types, edge cases, imports, and exports
- [ ] Fallback coverage is tested (mock grammar loading failure)
- [ ] Coverage thresholds are met (≥95% lines, ≥90% branches)
- [ ] `pnpm build` succeeds without errors
- [ ] `pnpm typecheck` passes
- [ ] New tree-sitter dependency is added to `package.json` (if applicable)

---

## Questions?

Open a [GitHub Discussion](https://github.com/AgentiX-E/code-analyzer/discussions) or submit a draft PR for early feedback.
