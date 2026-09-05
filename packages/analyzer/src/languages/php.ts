// @code-analyzer/analyzer — PHP Tree-sitter Provider (with regex fallback)

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping,
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
} from './tree-sitter-base.js';

const PHP_EXTENSIONS = ['.php', '.phtml'];
const PHP_GLOBS = ['**/*.php', '**/*.phtml'];

export class PhpProvider extends TreeSitterBaseProvider {
  readonly language = 'php';
  readonly displayName = 'PHP';
  readonly extensions = PHP_EXTENSIONS;
  readonly globs = PHP_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const php = require('tree-sitter-php') as {
        php: TreeSitterLanguage;
        php_only: TreeSitterLanguage;
      };
      // tree-sitter-php always exports both grammars; `.php` is the primary.
      return php.php;
    } catch {
      /* v8 ignore next -- @preserve -- native module load failure is untestable */
      return null;
    }
  }

  override parse(source: string, filePath: string): UnifiedCapture[] {
    return super.parse(this.ensurePhpTag(source), filePath);
  }

  override extractImports(source: string): ParsedImport[] {
    return super.extractImports(this.ensurePhpTag(source));
  }

  override isExported(source: string, symbolName: string): boolean {
    return super.isExported(this.ensurePhpTag(source), symbolName);
  }

  /**
   * tree-sitter-php only parses code inside `<?php` / `<?=` tags. Most PHP
   * snippets omit the opening tag, so prepend one when it is absent.
   */
  private ensurePhpTag(source: string): string {
    return /^\s*<\?(php|=)/i.test(source) ? source : `<?php ${source}`;
  }

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    // use statements are imports: emit IMPORT captures so downstream graph
    // edges form (walkForImports covers extractImports; parse mirrors it).
    if (node.type === 'namespace_use_declaration') {
      const imports: ParsedImport[] = [];
      this.extractPhpUseImport(node, imports);
      for (const imp of imports) {
        captures.push({
          tag: CAPTURE_TAGS.IMPORT,
          text: imp.source,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startByte: node.startIndex,
          endByte: node.endIndex,
          name: imp.source,
          properties: { names: imp.names.join(','), importType: imp.type, filePath: this.filePath },
        });
      }
    }

    super.walkAndCapture(node, captures);
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      {
        nodeType: 'function_definition',
        captureTag: CAPTURE_TAGS.FUNCTION_DEF,
        nameChildType: 'name',
      },
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'name' },
      {
        nodeType: 'interface_declaration',
        captureTag: CAPTURE_TAGS.INTERFACE_DEF,
        nameChildType: 'name',
      },
      { nodeType: 'trait_declaration', captureTag: CAPTURE_TAGS.TRAIT_DEF, nameChildType: 'name' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'name' },
      {
        nodeType: 'method_declaration',
        captureTag: CAPTURE_TAGS.METHOD_DEF,
        nameChildType: 'name',
      },
    ];
  }

  // ---- Import extraction (tree-sitter AST) ----

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    // Handle namespace_use_declaration (use statements)
    if (node.type === 'namespace_use_declaration') {
      this.extractPhpUseImport(node, imports);
      return; // Don't recurse into use children
    }

    // Handle require/include expressions
    if (this.isPhpIncludeNode(node)) {
      this.extractPhpIncludeImport(node, imports);
      return; // Don't recurse into include children
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  private extractPhpUseImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    const lineNumber = node.startPosition.row + 1;

    // Grouped imports: use Namespace\{A, B as C, D}.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type !== 'namespace_use_group') continue;

      // The base namespace precedes the group as a qualified_name/namespace_name
      // sibling.
      let baseNamespace = '';
      for (let j = i - 1; j >= 0; j--) {
        const prev = node.child(j);
        if (
          prev.type === 'qualified_name' ||
          prev.type === 'name' ||
          prev.type === 'namespace_name'
        ) {
          baseNamespace = prev.text;
          break;
        }
      }

      for (let j = 0; j < child.childCount; j++) {
        const clause = child.child(j);
        if (clause.type !== 'namespace_use_clause') continue;
        const { name, alias } = this.parseUseClause(clause);
        if (!name) continue;
        // Invariant: a namespace_use_group is always preceded by its base
        // namespace sibling, so baseNamespace is non-empty here.
        imports.push({
          source: `${baseNamespace}\\${name}`,
          names: [alias ?? name],
          type: 'named',
          lineNumber,
        });
      }
      return; // Handled grouped import
    }

    // Single / multiple clauses: use Namespace\Class; use Namespace\Class as
    // Alias; use A\B, C\D; use function Namespace\func; use const Namespace\C.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type !== 'namespace_use_clause') continue;
      const { name, alias } = this.parseUseClause(child);
      if (!name) continue;
      const parts = name.split('\\');
      imports.push({
        source: name,
        names: [alias ?? parts[parts.length - 1]!],
        type: 'named',
        lineNumber,
      });
    }
  }

  /**
   * Read the imported name and optional alias out of a namespace_use_clause.
   * The clause holds either a single qualified_name (no alias) or a
   * qualified_name/name followed by an `as` keyword and a trailing name alias.
   */
  private parseUseClause(clause: TreeSitterSyntaxNode): {
    name: string;
    alias: string | undefined;
  } {
    let name = '';
    let alias: string | undefined;
    for (let i = 0; i < clause.childCount; i++) {
      const sub = clause.child(i);
      if (sub.type === 'qualified_name' || sub.type === 'namespace_name') {
        // A clause holds at most one qualified/namespace name, so it is always
        // the first name; only a trailing `name` after `as` is an alias.
        name = sub.text;
      } else if (sub.type === 'name') {
        if (name === '') name = sub.text;
        else alias = sub.text;
      }
    }
    return { name, alias };
  }

  private extractPhpIncludeImport(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    const lineNumber = node.startPosition.row + 1;

    // Find the string argument (the file path). tree-sitter-php emits `string`
    // for single-quoted literals and `encapsed_string` for double-quoted ones.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);

      if (child.type === 'string' || child.type === 'encapsed_string') {
        this.pushIncludeImport(child.text, lineNumber, imports);
        return;
      }

      // Parenthesized includes (require('x.php')) wrap the literal in a
      // parenthesized_expression node.
      if (child.type === 'parenthesized_expression') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'string' || sub.type === 'encapsed_string') {
            this.pushIncludeImport(sub.text, lineNumber, imports);
            return;
          }
        }
      }
    }
  }

  private pushIncludeImport(raw: string, lineNumber: number, imports: ParsedImport[]): void {
    const path = raw.slice(1, -1); // Remove surrounding quotes
    imports.push({
      source: path,
      names: [path],
      type: 'default',
      lineNumber,
    });
  }

  private isPhpIncludeNode(node: TreeSitterSyntaxNode): boolean {
    const includeType = node.type;
    return (
      includeType === 'require_once_expression' ||
      includeType === 'include_expression' ||
      includeType === 'require_expression' ||
      includeType === 'include_once_expression'
    );
  }

  protected override checkExported(node: TreeSitterSyntaxNode, symbolName: string): boolean {
    const nt = node.type;

    if (
      nt === 'method_declaration' ||
      nt === 'function_definition' ||
      nt === 'class_declaration' ||
      nt === 'interface_declaration' ||
      nt === 'trait_declaration' ||
      nt === 'enum_declaration'
    ) {
      const nameNode = this.findPhpName(node);
      if (nameNode && nameNode.text === symbolName) {
        // private/protected members are not exported; public (the default) is.
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (
            c.type === 'visibility_modifier' &&
            (c.text === 'private' || c.text === 'protected')
          ) {
            return false;
          }
        }
        return true;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.checkExported(node.child(i), symbolName)) return true;
    }
    return false;
  }

  private findPhpName(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === 'name') return node.namedChild(i);
    }
    return null;
  }

  // Fallbacks (primary since tree-sitter-php may not be available)
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Functions
    const funcRegex = /function\s+(\w+)\s*\(/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Classes
    const clRegex = /(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/g;
    while ((m = clRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Interfaces
    const ifRegex = /interface\s+(\w+)/g;
    while ((m = ifRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.INTERFACE_DEF,
        text: `interface ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Traits
    const trRegex = /trait\s+(\w+)/g;
    while ((m = trRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.TRAIT_DEF,
        text: `trait ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Enums (PHP 8.1+)
    const enumRegex = /enum\s+(\w+)/g;
    while ((m = enumRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }

    // Variables
    const varRegex = /\$(this|\w+)/g;
    const seen = new Set<string>();
    while ((m = varRegex.exec(source)) !== null) {
      const name = m[1]!;
      if (name === 'this' || seen.has(name)) continue;
      seen.add(name);
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: name,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name,
        properties: { filePath },
      });
    }

    // Imports
    const imps = this.fallbackExtractImports(source);
    for (const imp of imps) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: imp.source,
        startLine: imp.lineNumber,
        endLine: imp.lineNumber,
        startByte: 0,
        endByte: 0,
        name: imp.source,
        properties: { names: imp.names.join(','), importType: imp.type, filePath },
      });
    }

    // Doc comments
    const docRegex = /\/\*\*([\s\S]*?)\*\//g;
    while ((m = docRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.DOCSTRING,
        text: m[0],
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        properties: { filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    let m: RegExpExecArray | null;

    // use statements: use Namespace\Class;
    // use Namespace\Class as Alias;
    // use function Namespace\func;
    // use const Namespace\CONST;
    const useRegex = /use\s+(?:function\s+|const\s+)?([\w\\]+)(?:\s+as\s+(\w+))?\s*;/g;
    while ((m = useRegex.exec(source)) !== null) {
      const fullPath = m[1]!;
      const alias = m[2];
      const parts = fullPath.split('\\');
      const name = alias ?? parts[parts.length - 1]!;
      imports.push({
        source: fullPath,
        names: [name],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }

    // Grouped imports: use Namespace\{A, B, C as D} — the opening brace is
    // backslash-escaped, but the closing brace is a bare `}` in PHP syntax.
    const groupRegex = /use\s+([\w\\]+)\\{([^}]+)\}/g;
    while ((m = groupRegex.exec(source)) !== null) {
      const basePath = m[1]!;
      const namesStr = m[2]!;
      const nameRegex = /(\w+)(?:\s+as\s+(\w+))?/g;
      let nm: RegExpExecArray | null;
      while ((nm = nameRegex.exec(namesStr)) !== null) {
        const name = nm[2] ?? nm[1]!;
        imports.push({
          source: `${basePath}\\${nm[1]!}`,
          names: [name],
          type: 'named',
          lineNumber: this.ln(source, m.index),
        });
      }
    }

    // require/include
    const reqRegex =
      /(?:require|require_once|include|include_once)\s*(?:\(?\s*['"]([^'"]+)['"]\s*\)?)\s*;/g;
    while ((m = reqRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'default',
        lineNumber: this.ln(source, m.index),
      });
    }

    return imports;
  }

  protected override fallbackIsExported(source: string, symbolName: string): boolean {
    // PHP: public (explicit or default) functions and class-like declarations are
    // exported; private/protected members are not.
    const s = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declared = new RegExp(
      `function\\s+${s}\\b|class\\s+${s}\\b|interface\\s+${s}\\b|trait\\s+${s}\\b`,
    ).test(source);
    if (!declared) return false;
    return !new RegExp(`(?:private|protected)\\s+function\\s+${s}\\b`).test(source);
  }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
