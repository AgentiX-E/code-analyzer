// @code-analyzer/analyzer — Groovy Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: classes, methods, traits, closures, GStrings,
// metaprogramming injection sinks.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  TreeSitterLanguage,
  TreeSitterSyntaxNode,
  TaintSource,
  TaintSink,
  TaintSanitizer,
} from './tree-sitter-base.js';

export class GroovyProvider extends TreeSitterBaseProvider {
  readonly language = 'groovy';
  readonly displayName = 'Groovy';
  readonly extensions = ['.groovy', '.gvy', '.gy', '.gsh'];
  readonly globs = ['**/*.groovy', '**/*.gvy', '**/*.gy', '**/*.gsh'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-groovy is a direct dependency of the analyzer, so this require
    // never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('tree-sitter-groovy') as TreeSitterLanguage;
    return m;
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'class_declaration') {
      // A class_declaration always carries an `identifier` named child in a valid
      // parse; walkAndCapture only runs on error-free trees.
      const nameNode = this.findIdent(node);
      const baseClasses = this.extractGroovyBases(node);
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, nameNode.text, `class ${nameNode.text}`, {
          baseClasses,
        }),
      );
    } else if (nt === 'juxt_function_call' && this.findIdent(node).text === 'trait') {
      // tree-sitter-groovy parses `trait Name {}` as a juxt_function_call whose
      // first identifier is 'trait' and whose argument_list holds the trait name.
      const nameNode = this.findIdent(node.namedChild(1));
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.TRAIT_DEF, nameNode.text, `trait ${nameNode.text}`),
      );
    } else if (nt === 'enum_declaration') {
      const nameNode = this.findIdent(node);
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.ENUM_DEF, nameNode.text, `enum ${nameNode.text}`),
      );
    } else if (nt === 'method_declaration') {
      const nameNode = this.findIdent(node);
      let containerName: string | undefined;
      const container = this.findContainerNode(node);
      if (container) containerName = this.extractContainerName(container);
      const isConstructor = containerName === nameNode.text;
      captures.push(
        this.makeCapture(
          node,
          isConstructor ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF,
          nameNode.text,
          nameNode.text,
          { containerName: containerName ?? '', isConstructor: String(isConstructor) },
        ),
      );
    } else if (nt === 'constructor_declaration') {
      const nameNode = this.findIdent(node);
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.CONSTRUCTOR_DEF, nameNode.text, nameNode.text),
      );
    } else if (nt === 'field_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'variable_declarator') {
          const idNode = this.findIdent(child);
          captures.push(
            this.makeCapture(child, CAPTURE_TAGS.VARIABLE_DEF, idNode.text, idNode.text),
          );
        }
      }
    } else if (nt === 'import_declaration') {
      const importPath = node.text
        .replace(/^import\s+/i, '')
        .replace(/;?\s*$/, '')
        .trim();
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.IMPORT, importPath, importPath, {
          importType: 'named',
        }),
      );
    } else if (nt === 'method_invocation') {
      const callName = this.extractCallName(node);
      captures.push(this.makeCapture(node, CAPTURE_TAGS.METHOD_CALL, callName, callName));
    } else if (nt === 'closure') {
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.FUNCTION_DEF,
          `closure_${node.startPosition.row + 1}`,
          '{ ... }',
          { isClosure: 'true' },
        ),
      );
    } else if (nt === 'string_literal' && node.text.includes('${')) {
      // tree-sitter-groovy does not emit a dedicated GString node: `${name}` is
      // parsed as a literal string_fragment, so detect GStrings by scanning the
      // raw text for the interpolation marker.
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.VARIABLE_DEF,
          `gstring_${node.startPosition.row + 1}`,
          node.text,
          { isGString: 'true' },
        ),
      );
    } else if (nt === 'annotation') {
      const nameNode = this.findIdent(node);
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.ANNOTATION, nameNode.text, node.text, {
          isAnnotation: 'true',
        }),
      );
    } else if (nt === 'line_comment' || nt === 'block_comment') {
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', node.text.trim(), {
          isComment: 'true',
        }),
      );
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'method_invocation') {
      const name = this.extractCallName(node);
      const fullName = this.extractFullCallName(node) ?? name;
      const line = node.startPosition.row + 1;
      // Groovy-specific taint sources. `System.console` / `System.in` are nested
      // receivers (field_access), so they are matched via the full call name; the
      // remaining sources are leading identifiers exposed directly by
      // extractCallName.
      if (
        fullName.startsWith('System.console.') ||
        fullName.startsWith('System.in.') ||
        name === 'args' ||
        name === 'binding' ||
        name.includes('request') ||
        name.includes('params')
      ) {
        sources.push({
          name: fullName,
          sourceType: 'user_input',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      if (fullName === 'Eval.me' || fullName === 'Eval.x') {
        sources.push({
          name: fullName,
          sourceType: 'code_injection',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    if (node.type === 'method_invocation') {
      const name = this.extractCallName(node);
      const fullName = this.extractFullCallName(node) ?? name;
      const line = node.startPosition.row + 1;
      // Groovy metaprogramming sinks. GroovyShell / GroovyScriptEngine are object
      // receivers (object_creation_expression), so they are matched via the full
      // call name.
      if (
        fullName === 'Eval.me' ||
        fullName === 'Eval.x' ||
        fullName.includes('GroovyShell') ||
        fullName.includes('GroovyScriptEngine') ||
        name === 'evaluate'
      ) {
        sinks.push({
          name: fullName,
          sinkType: 'code_injection',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      // SQL sinks in Groovy — match the full call name (receiver.method)
      if (fullName.includes('execute') || fullName.includes('Sql')) {
        sinks.push({ name: fullName, sinkType: 'sql_exec', line, text: node.text, properties: {} });
      }
      // File write sinks — match the full call name (receiver.method)
      if (
        fullName.includes('write') ||
        fullName.includes('withWriter') ||
        fullName.includes('withOutputStream')
      ) {
        sinks.push({
          name: fullName,
          sinkType: 'file_write',
          line,
          text: node.text,
          properties: {},
        });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(
    node: TreeSitterSyntaxNode,
    sanitizers: TaintSanitizer[],
  ): void {
    if (node.type === 'method_invocation') {
      const name = this.extractCallName(node);
      const fullName = this.extractFullCallName(node) ?? name;
      const line = node.startPosition.row + 1;
      // Groovy sanitizers — the sanitizer is the trailing method name.
      const methodName = fullName.split('.').pop();
      if (
        methodName === 'encodeAsHTML' ||
        methodName === 'encodeAsJavaScript' ||
        methodName === 'encodeAsURL' ||
        methodName === 'escape' ||
        methodName === 'stripIndent' ||
        methodName === 'replaceAll'
      ) {
        sanitizers.push({
          name: fullName,
          sanitizerType: 'encoding',
          line,
          text: node.text,
          properties: {},
        });
        return;
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Helpers ----

  private extractFullCallName(node: TreeSitterSyntaxNode): string | null {
    // Reconstruct the full dotted call path. tree-sitter-groovy flattens a
    // two-part receiver into direct identifier children (Eval.me(script) →
    // "Eval" + "me") but nests deeper receivers: System.console.readLine() →
    // field_access "System.console" + identifier "readLine", and
    // new GroovyShell().evaluate() → object_creation_expression + identifier
    // "evaluate". Collect every identifier in document order and join with '.';
    // a bare call (foo()) has no receiver, so return null.
    const parts: string[] = [];
    const collect = (n: TreeSitterSyntaxNode): void => {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (
          child.type === 'identifier' ||
          child.type === 'type_identifier' ||
          child.type === 'property_identifier'
        ) {
          parts.push(child.text);
        } else if (child.type === 'field_access' || child.type === 'object_creation_expression') {
          collect(child);
        }
      }
    };
    collect(node);
    return parts.length > 1 ? parts.join('.') : null;
  }

  private findIdent(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode {
    // The declared name is always an `identifier` named child. A method_declaration
    // also carries a leading type_identifier ("def"/return-type keyword), which is
    // skipped here. Every call site passes a declaration node that carries an
    // `identifier` in an error-free parse, so this loop always returns.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'identifier') return child;
    }
  }

  private extractGroovyBases(node: TreeSitterSyntaxNode): string {
    const parts: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'superclass' || child.type === 'super_interfaces') {
        // super_interfaces wraps its types in a type_list node (implements A, B),
        // so collect identifiers recursively rather than only reading direct children.
        this.collectIdentifiers(child, parts);
      }
    }
    return parts.join(',');
  }

  private makeCapture(
    node: TreeSitterSyntaxNode,
    tag: (typeof CAPTURE_TAGS)[keyof typeof CAPTURE_TAGS],
    name: string,
    text: string,
    extra: Record<string, string> = {},
  ): UnifiedCapture {
    return {
      tag,
      text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startByte: node.startIndex,
      endByte: node.endIndex,
      name,
      properties: { filePath: this.filePath, ...extra },
    };
  }

  // ---- Import Extraction ----

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const text = node.text
        .replace(/^import\s+/i, '')
        .replace(/;?\s*$/, '')
        .trim();
      const parts = text.split('.');
      imports.push({
        source: text,
        names: [parts[parts.length - 1]!],
        type: 'named',
        lineNumber: node.startPosition.row + 1,
      });
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    return true; // Groovy defs are visible by default
  }

  // ---- Fallback ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const classRx = /(?:abstract\s+)?class\s+(\w+)/g;
    while ((m = classRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF,
        text: `class ${m[1]!}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const traitRx = /trait\s+(\w+)/g;
    while ((m = traitRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.TRAIT_DEF,
        text: `trait ${m[1]!}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const enumRx = /enum\s+(\w+)/g;
    while ((m = enumRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.ENUM_DEF,
        text: `enum ${m[1]!}`,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const funcRx = /(?:def\s+|(?:void|int|String|boolean|def|Object)\s+)(\w+)\s*\(/g;
    while ((m = funcRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { filePath },
      });
    }
    const impRx = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRx.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT,
        text: m[1]!,
        startLine: ln(m.index),
        endLine: ln(m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { importType: 'named', filePath },
      });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const impRx = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRx.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!.split('.').pop()!],
        type: 'named',
        lineNumber: ln(m.index),
      });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true;
  }

  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /\b(Eval\.me|Eval\.x|System\.console|request|params)\b/g;
    while ((m = rx.exec(source)) !== null) {
      const isCodeInjection = m[1] === 'Eval.me' || m[1] === 'Eval.x';
      sources.push({
        name: m[1]!,
        sourceType: isCodeInjection ? 'code_injection' : 'user_input',
        line: ln(m.index),
        text: m[0],
        properties: {},
      });
    }
    return sources;
  }

  protected override fallbackExtractTaintSinks(source: string): TaintSink[] {
    const sinks: TaintSink[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx =
      /\b(Eval\.me|Eval\.x|GroovyShell|GroovyScriptEngine|evaluate|executeUpdate|\.execute\()\b/g;
    while ((m = rx.exec(source)) !== null) {
      const isCodeInjection = m[1].toLowerCase().includes('eval') || m[1].includes('Groovy');
      sinks.push({
        name: m[1]!,
        sinkType: isCodeInjection ? 'code_injection' : 'sql_exec',
        line: ln(m.index),
        text: m[0],
        properties: {},
      });
    }
    return sinks;
  }

  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }
}
