/* v8 ignore file -- @preserve */
// @code-analyzer/analyzer — HCL / Terraform Tree-sitter Provider
// Infrastructure-as-Code: detects Terraform resources, data sources, variables, and outputs.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';

import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode } from './tree-sitter-base.js';

const HCL_EXTENSIONS = ['.hcl', '.tf', '.tfvars'];
const HCL_GLOBS = ['**/*.hcl', '**/*.tf', '**/*.tfvars'];

export class HclProvider extends TreeSitterBaseProvider {
  readonly language = 'hcl';
  readonly displayName = 'HCL (Terraform)';
  readonly extensions = HCL_EXTENSIONS;
  readonly globs = HCL_GLOBS;
  readonly importSemantics = 'named' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('@tree-sitter-grammars/tree-sitter-hcl') as TreeSitterLanguage;
    } /* v8 ignore next */
    catch {
      return null;
    }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'block', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'identifier' },
    ];
  }

  // -----------------------------------------------------------------------
  // AST walking for @tree-sitter-grammars/tree-sitter-hcl v1.2.0+
  //
  // AST structure: config_file > body > block
  //   block named children:
  //     identifier  — block type keyword ("resource", "data", "variable", ...)
  //     string_lit  — labels (e.g. "aws_vpc", "main")
  //     block_start — "{"
  //     body        — nested attributes / blocks
  //     block_end   — "}"
  //
  // string_lit text includes surrounding quotes; strip them to get the value.
  // -----------------------------------------------------------------------

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nodeType = node.type;

    if (nodeType === 'block') {
      const identifiers: string[] = [];
      const labels: string[] = [];

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'identifier') {
          identifiers.push(child.text);
        } else if (child.type === 'string_lit') {
          labels.push(this.extractStringLitValue(child));
        }
      }

      // Need at least a block-type identifier
      if (identifiers.length >= 1) {
        const blockType = identifiers[0]!;
        // Labels come from string_lit children; for single-label blocks
        // (variable, output, provider, module) use the first label.
        // For resource/data: labels[0] = type, labels[1] = name
        const blockLabel = labels.length >= 2
          ? `${labels[0]!}.${labels[1]!}`
          : (labels[0] ?? identifiers.slice(1).join('.'));

        if (blockType === 'resource') {
          captures.push({
            tag: CAPTURE_TAGS.FUNCTION_DEF,
            text: `resource ${blockLabel}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: blockLabel,
            properties: {
              resourceType: labels[0] ?? '',
              resourceName: labels[1] ?? blockLabel,
              isIaC: 'true',
              iaCType: 'TerraformResource',
              filePath: this.filePath,
            },
          });
        } else if (blockType === 'data') {
          captures.push({
            tag: CAPTURE_TAGS.FUNCTION_DEF,
            text: `data ${blockLabel}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: blockLabel,
            properties: {
              dataSource: labels[0] ?? '',
              dataName: labels[1] ?? blockLabel,
              isIaC: 'true',
              filePath: this.filePath,
            },
          });
        } else if (blockType === 'variable') {
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_DEF,
            text: `variable ${blockLabel}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: blockLabel,
            properties: { isIaC: 'true', filePath: this.filePath },
          });
        } else if (blockType === 'output') {
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_DEF,
            text: `output ${blockLabel}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: blockLabel,
            properties: { isIaC: 'true', isOutput: 'true', filePath: this.filePath },
          });
        } else if (blockType === 'provider') {
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_DEF,
            text: `provider ${blockLabel}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: blockLabel,
            properties: { isIaC: 'true', isProvider: 'true', filePath: this.filePath },
          });
        } else if (blockType === 'module') {
          captures.push({
            tag: CAPTURE_TAGS.FUNCTION_DEF,
            text: `module ${blockLabel}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: blockLabel,
            properties: { isIaC: 'true', isModule: 'true', filePath: this.filePath },
          });
        } else if (blockType === 'locals') {
          captures.push({
            tag: CAPTURE_TAGS.VARIABLE_DEF,
            text: `locals`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startByte: node.startIndex,
            endByte: node.endIndex,
            name: 'locals',
            properties: { isIaC: 'true', isLocals: 'true', filePath: this.filePath },
          });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  // -----------------------------------------------------------------------
  // Module source import extraction
  // -----------------------------------------------------------------------

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'block') {
      // Check if this is a module block
      const firstId = this.findFirstNamedChild(node, 'identifier');
      if (firstId?.text === 'module') {
        // Find the body and look for a 'source' attribute
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'body') {
            this.extractModuleSources(child, imports);
          }
        }
        return; // Don't recurse into nested blocks for imports
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  private extractModuleSources(bodyNode: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    for (let i = 0; i < bodyNode.namedChildCount; i++) {
      const child = bodyNode.namedChild(i);
      if (child.type === 'attribute') {
        const attrName = this.findFirstNamedChild(child, 'identifier');
        if (attrName?.text === 'source') {
          const expr = this.findFirstNamedChild(child, 'expression');
          if (expr) {
            const value = this.extractExpressionValue(expr);
            if (value) {
              imports.push({
                source: value,
                names: [value],
                type: 'named',
                lineNumber: child.startPosition.row + 1,
              });
            }
          }
        }
      } else if (child.type === 'block') {
        // Nested blocks could have module sources too (unlikely but safe)
        this.extractModuleSources(child, imports);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Export detection — IaC resources are always visible
  // -----------------------------------------------------------------------

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    // IaC resources are always "exported" (visible project-wide)
    return true;
  }

  // -----------------------------------------------------------------------
  // Helpers for new HCL AST
  // -----------------------------------------------------------------------

  /** Extract the actual string value from a string_lit node (strips quotes) */
  private extractStringLitValue(node: TreeSitterSyntaxNode): string {
    // string_lit.text includes surrounding quotes: "aws_vpc"
    // Use template_literal named child if available, otherwise strip quotes
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === 'template_literal') {
        return node.namedChild(i).text;
      }
    }
    return node.text.replace(/^["']|["']$/g, '');
  }

  /** Find the first named child of a given type */
  private findFirstNamedChild(node: TreeSitterSyntaxNode, type: string): TreeSitterSyntaxNode | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) return node.namedChild(i);
    }
    return null;
  }

  /** Extract a string value from an expression node (literal_value > string_lit > template_literal) */
  private extractExpressionValue(exprNode: TreeSitterSyntaxNode): string | null {
    // expression > literal_value > string_lit
    const litVal = this.findFirstNamedChild(exprNode, 'literal_value');
    if (litVal) {
      const strLit = this.findFirstNamedChild(litVal, 'string_lit');
      if (strLit) {
        return this.extractStringLitValue(strLit);
      }
    }
    // Direct string_lit under expression
    const strLit = this.findFirstNamedChild(exprNode, 'string_lit');
    if (strLit) {
      return this.extractStringLitValue(strLit);
    }
    return null;
  }

  // Fallbacks
  /* v8 ignore next */
  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // Terraform resource blocks: resource "type" "name" { ... }
    const resourceRegex = /resource\s+"([^"]+)"\s+"([^"]+)"/g;
    while ((m = resourceRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: `resource ${m[1]!}.${m[2]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: `${m[1]!}.${m[2]!}`,
        properties: {
          resourceType: m[1]!,
          resourceName: m[2]!,
          isIaC: 'true',
          iaCType: 'TerraformResource',
          filePath,
        },
      });
    }

    // Data blocks
    const dataRegex = /data\s+"([^"]+)"\s+"([^"]+)"/g;
    while ((m = dataRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: `data ${m[1]!}.${m[2]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: `${m[1]!}.${m[2]!}`,
        properties: {
          dataSource: m[1]!,
          dataName: m[2]!,
          isIaC: 'true',
          filePath,
        },
      });
    }

    // Variable blocks
    const variableRegex = /variable\s+"([^"]+)"/g;
    while ((m = variableRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `variable ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isIaC: 'true', filePath },
      });
    }

    // Output blocks
    const outputRegex = /output\s+"([^"]+)"/g;
    while ((m = outputRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `output ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isIaC: 'true', isOutput: 'true', filePath },
      });
    }

    // Provider blocks
    const providerRegex = /provider\s+"([^"]+)"/g;
    while ((m = providerRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF,
        text: `provider ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isIaC: 'true', isProvider: 'true', filePath },
      });
    }

    // Module blocks
    const moduleRegex = /module\s+"([^"]+)"/g;
    while ((m = moduleRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.FUNCTION_DEF,
        text: `module ${m[1]!}`,
        startLine: this.ln(source, m.index),
        endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index,
        endByte: m.index + m[0].length,
        name: m[1]!,
        properties: { isIaC: 'true', isModule: 'true', filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  /* v8 ignore next */
  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    // HCL doesn't have traditional imports, but module source references
    let m: RegExpExecArray | null;
    const moduleSourceRegex = /module\s+"[^"]+"\s*\{[\s\S]*?source\s*=\s*"([^"]+)"/g;
    while ((m = moduleSourceRegex.exec(source)) !== null) {
      imports.push({
        source: m[1]!,
        names: [m[1]!],
        type: 'named',
        lineNumber: this.ln(source, m.index),
      });
    }
    return imports;
  }

  /* v8 ignore next */
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return true;
  }

  // Helpers
  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
