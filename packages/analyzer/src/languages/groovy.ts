// @code-analyzer/analyzer — Groovy Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, classes, methods, traits,
// closures, GStrings, metaprogramming injection sinks.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class GroovyProvider extends TreeSitterBaseProvider {
  readonly language = 'groovy';
  readonly displayName = 'Groovy';
  readonly extensions = ['.groovy', '.gvy', '.gy', '.gsh'];
  readonly globs = ['**/*.groovy', '**/*.gvy', '**/*.gy', '**/*.gsh'];
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('tree-sitter-groovy') as TreeSitterLanguage;
      return m;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'class_declaration', captureTag: CAPTURE_TAGS.CLASS_DEF, nameChildType: 'identifier' },
      { nodeType: 'method_declaration', captureTag: CAPTURE_TAGS.METHOD_DEF, nameChildType: 'identifier' },
      { nodeType: 'trait_declaration', captureTag: CAPTURE_TAGS.TRAIT_DEF, nameChildType: 'identifier' },
      { nodeType: 'enum_declaration', captureTag: CAPTURE_TAGS.ENUM_DEF, nameChildType: 'identifier' },
      { nodeType: 'field_declaration', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'variable_declaration', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'variable_declarator', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'import_declaration', captureTag: CAPTURE_TAGS.IMPORT, useFirstNamedChild: true },
      { nodeType: 'method_invocation', captureTag: CAPTURE_TAGS.METHOD_CALL, useFirstNamedChild: true },
      { nodeType: 'call_expression', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
      { nodeType: 'gstring', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'string_interpolation', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'closure_expression', captureTag: CAPTURE_TAGS.FUNCTION_DEF, useFirstNamedChild: true },
      { nodeType: 'superclass', captureTag: CAPTURE_TAGS.TYPE_REFERENCE, useFirstNamedChild: true },
      { nodeType: 'super_interfaces', captureTag: CAPTURE_TAGS.TYPE_REFERENCE, useFirstNamedChild: true },
      { nodeType: 'annotation', captureTag: CAPTURE_TAGS.ANNOTATION, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.COMMENT, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'class_declaration') {
      const nameNode = this.findIdent(node);
      if (nameNode) {
        const baseClasses = this.extractGroovyBases(node);
        captures.push(this.makeCapture(node, CAPTURE_TAGS.CLASS_DEF, nameNode.text,
          `class ${nameNode.text}`, { baseClasses }));
      }
    } else if (nt === 'trait_declaration') {
      const nameNode = this.findIdent(node);
      if (nameNode) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.TRAIT_DEF, nameNode.text, `trait ${nameNode.text}`));
      }
    } else if (nt === 'enum_declaration') {
      const nameNode = this.findIdent(node);
      if (nameNode) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.ENUM_DEF, nameNode.text, `enum ${nameNode.text}`));
      }
    } else if (nt === 'method_declaration') {
      const nameNode = this.findIdent(node);
      if (nameNode) {
        let containerName: string | undefined;
        const container = this.findContainerNode(node);
        if (container) containerName = this.extractContainerName(container);
        const isConstructor = containerName === nameNode.text;
        captures.push(this.makeCapture(node,
          isConstructor ? CAPTURE_TAGS.CONSTRUCTOR_DEF : CAPTURE_TAGS.METHOD_DEF,
          nameNode.text, nameNode.text, { containerName: containerName ?? '', isConstructor: String(isConstructor) }));
      }
    } else if (nt === 'field_declaration' || nt === 'variable_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'variable_declarator') {
          const idNode = this.findFirstIdent(child);
          if (idNode) {
            captures.push(this.makeCapture(child, CAPTURE_TAGS.VARIABLE_DEF, idNode.text, idNode.text));
          }
        }
      }
    } else if (nt === 'import_declaration') {
      const importPath = node.text.replace(/^import\s+/i, '').replace(/;?\s*$/, '').trim();
      captures.push(this.makeCapture(node, CAPTURE_TAGS.IMPORT, importPath, importPath, { importType: 'named' }));
    } else if (nt === 'method_invocation' || nt === 'call_expression') {
      const callName = this.extractCallName(node);
      if (callName) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.METHOD_CALL, callName, callName));
      }
    } else if (nt === 'closure_expression') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_DEF,
        `closure_${node.startPosition.row + 1}`, '{ ... }', { isClosure: 'true' }));
    } else if (nt === 'gstring' || nt === 'string_interpolation') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        `gstring_${node.startPosition.row + 1}`, node.text, { isGString: 'true' }));
    } else if (nt === 'annotation') {
      const nameNode = this.findIdent(node);
      captures.push(this.makeCapture(node, CAPTURE_TAGS.ANNOTATION,
        nameNode?.text ?? node.text, node.text, { isAnnotation: 'true' }));
    } else if (nt === 'comment') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', node.text.trim(), { isComment: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'method_invocation' || node.type === 'call_expression') {
      const name = this.extractCallName(node);
      const fullName = this.extractFullCallName(node) ?? name;
      if (!name && !fullName) { return; }
      const line = node.startPosition.row + 1;
      // Groovy-specific taint sources
      if (name === 'System.console' || name === 'System.in' || name === 'args' ||
          name === 'binding' || (name !== null && name.includes('request')) || (name !== null && name.includes('params'))) {
        sources.push({ name: name!, sourceType: 'user_input', line, text: node.text, properties: {} });
        return;
      }
      if (fullName === 'Eval.me' || fullName === 'Eval.x') {
        sources.push({ name: fullName, sourceType: 'code_injection', line, text: node.text, properties: {} });
        return;
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    if (node.type === 'method_invocation' || node.type === 'call_expression') {
      const name = this.extractCallName(node);
      const fullName = this.extractFullCallName(node) ?? name;
      if (!name && !fullName) { return; }
      const line = node.startPosition.row + 1;
      // Groovy metaprogramming sinks
      if (fullName === 'Eval.me' || fullName === 'Eval.x' || name === 'GroovyShell' ||
          name === 'GroovyScriptEngine' || name === 'evaluate') {
        sinks.push({ name: fullName ?? name!, sinkType: 'code_injection', line, text: node.text, properties: {} });
        return;
      }
      // SQL sinks in Groovy
      if (name && (name.includes('execute') || name.includes('executeUpdate') || name.includes('Sql'))) {
        sinks.push({ name, sinkType: 'sql_exec', line, text: node.text, properties: {} });
      }
      // File write sinks
      if (name && (name.includes('write') || name.includes('withWriter') || name.includes('withOutputStream'))) {
        sinks.push({ name, sinkType: 'file_write', line, text: node.text, properties: {} });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    if (node.type === 'method_invocation' || node.type === 'call_expression') {
      const name = this.extractCallName(node);
      const fullName = this.extractFullCallName(node) ?? name;
      if (!name && !fullName) { return; }
      const line = node.startPosition.row + 1;
      // Groovy sanitizers
      if (fullName === 'encodeAsHTML' || fullName === 'encodeAsJavaScript' || fullName === 'encodeAsURL' ||
          name === 'escape' || name === 'stripIndent' || name === 'replaceAll') {
        sanitizers.push({ name: fullName ?? name!, sanitizerType: 'encoding', line, text: node.text, properties: {} });
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
    // For member expressions like Eval.me
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'member_expression') {
        const parts: string[] = [];
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'identifier' || sub.type === 'type_identifier' ||
              sub.type === 'property_identifier') {
            parts.push(sub.text);
          }
        }
        if (parts.length > 1) return parts.join('.');
      }
    }
    // For tree-sitter-groovy: identifiers are direct children of method_invocation
    // separated by dots, e.g., Eval.me(userScript)
    const parts: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'identifier' || child.type === 'type_identifier' ||
          child.type === 'property_identifier') {
        parts.push(child.text);
      }
    }
    if (parts.length > 1) return parts.join('.');
    return null;
  }

  private findIdent(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'identifier' || child.type === 'type_identifier') return child;
    }
    return null;
  }

  private findFirstIdent(node: TreeSitterSyntaxNode): TreeSitterSyntaxNode | null {
    if (node.type === 'identifier' || node.type === 'type_identifier') return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const result = this.findFirstIdent(node.namedChild(i));
      if (result) return result;
    }
    return null;
  }

  private extractGroovyBases(node: TreeSitterSyntaxNode): string {
    const parts: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'superclass' || child.type === 'super_interfaces') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'identifier' || sub.type === 'type_identifier') parts.push(sub.text);
        }
      }
    }
    return parts.join(',');
  }

  private makeCapture(
    node: TreeSitterSyntaxNode, tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, text: string, extra: Record<string, string> = {},
  ): UnifiedCapture {
    return { tag, text,
      startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      startByte: node.startIndex, endByte: node.endIndex,
      name, properties: { filePath: this.filePath, ...extra } };
  }

  // ---- Import Extraction ----

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'import_declaration') {
      const text = node.text.replace(/^import\s+/i, '').replace(/;?\s*$/, '').trim();
      const parts = text.split('.');
      imports.push({ source: text, names: [parts[parts.length - 1]!], type: 'named',
        lineNumber: node.startPosition.row + 1 });
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
      captures.push({ tag: CAPTURE_TAGS.CLASS_DEF, text: `class ${m[1]!}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const traitRx = /trait\s+(\w+)/g;
    while ((m = traitRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.TRAIT_DEF, text: `trait ${m[1]!}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const enumRx = /enum\s+(\w+)/g;
    while ((m = enumRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.ENUM_DEF, text: `enum ${m[1]!}`, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const funcRx = /(?:def\s+|(?:void|int|String|boolean|def|Object)\s+)(\w+)\s*\(/g;
    while ((m = funcRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const impRx = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRx.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'named', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const impRx = /import\s+(?:static\s+)?(\w+(?:\.\w+)*)/g;
    while ((m = impRx.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!.split('.').pop()!], type: 'named', lineNumber: ln(m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return true; }

  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /\b(Eval\.me|Eval\.x|System\.console|request|params)\b/g;
    while ((m = rx.exec(source)) !== null) {
      sources.push({ name: m[1]!, sourceType: 'user_input', line: ln(m.index), text: m[0], properties: {} });
    }
    return sources;
  }

  protected override fallbackExtractTaintSinks(source: string): TaintSink[] {
    const sinks: TaintSink[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const rx = /\b(Eval\.me|Eval\.x|GroovyShell|GroovyScriptEngine|evaluate|executeUpdate|\.execute\()\b/g;
    while ((m = rx.exec(source)) !== null) {
      const st = m[1]!.includes('eval') || m[1]!.includes('Groovy') ? 'code_injection' : 'sql_exec';
      sinks.push({ name: m[1]!, sinkType: st, line: ln(m.index), text: m[0], properties: {} });
    }
    return sinks;
  }

  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }
}
