// @code-analyzer/analyzer — YAML Provider (tree-sitter AST walker)
// Full tree-sitter AST walker for YAML documents with 15+ node type mappings,
// taint source/sink/sanitizer detection, anchor & alias tracking.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class YamlProvider extends TreeSitterBaseProvider {
  readonly language = 'yaml';
  readonly displayName = 'YAML';
  readonly extensions = ['.yaml', '.yml'];
  readonly globs = ['**/*.yaml', '**/*.yml'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('tree-sitter-yaml') as TreeSitterLanguage;
      return mod;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'block_mapping_pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'flow_node' },
      { nodeType: 'flow_pair', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'flow_node' },
      { nodeType: 'block_sequence_item', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'flow_sequence', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'block_mapping', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'flow_mapping', captureTag: CAPTURE_TAGS.CLASS_DEF, useFirstNamedChild: true },
      { nodeType: 'plain_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'double_quote_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'single_quote_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'block_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'integer_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'float_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'boolean_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'null_scalar', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'anchor', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'alias', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'tag', captureTag: CAPTURE_TAGS.ANNOTATION, useFirstNamedChild: true },
      { nodeType: 'yaml_directive', captureTag: CAPTURE_TAGS.DOCSTRING, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.COMMENT, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'block_mapping_pair' || nt === 'flow_pair') {
      this.captureMappingPair(node, captures);
    } else if (nt === 'block_sequence_item') {
      this.captureSequenceItem(node, captures);
    } else if (nt === 'anchor') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        node.text.slice(1), `&${node.text.slice(1)}`, { anchor: 'true' }));
    } else if (nt === 'alias') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
        node.text.slice(1), `*${node.text.slice(1)}`, { alias: 'true' }));
    } else if (nt === 'tag') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.ANNOTATION,
        node.text, node.text, { tag: 'true' }));
    } else if (nt === 'yaml_directive') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.DOCSTRING,
        'directive', node.text, { isDirective: 'true' }));
    } else if (nt === 'comment') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.COMMENT,
        '[comment]', node.text.trim(), { isComment: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private captureMappingPair(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    let keyName = '';
    let valueText = '';
    let anchorName: string | undefined;
    let aliasTarget: string | undefined;
    let tagName: string | undefined;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'flow_node') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          const ct = sub.type;
          if (ct === 'plain_scalar' || ct === 'double_quote_scalar' ||
              ct === 'single_quote_scalar' || ct === 'block_scalar') {
            if (!keyName) {
              keyName = (ct === 'double_quote_scalar' || ct === 'single_quote_scalar')
                ? sub.text.slice(1, -1) : sub.text;
            } else {
              valueText = sub.text;
            }
          } else if (ct === 'integer_scalar' || ct === 'float_scalar' ||
                     ct === 'boolean_scalar' || ct === 'null_scalar') {
            valueText = sub.text;
          } else if (ct === 'block_sequence' || ct === 'flow_sequence') {
            valueText = `[${sub.namedChildCount} items]`;
          } else if (ct === 'block_mapping' || ct === 'flow_mapping') {
            valueText = `{${sub.namedChildCount} pairs}`;
          } else if (ct === 'anchor') {
            anchorName = sub.text;
          } else if (ct === 'alias') {
            aliasTarget = sub.text.slice(1);
          } else if (ct === 'tag') {
            tagName = sub.text;
          }
        }
      }
    }

    if (!keyName) {
      keyName = node.text.split(':')[0]?.trim() ?? 'unknown';
    }

    captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
      keyName, valueText ? `${keyName}: ${valueText}` : keyName, {
        key: keyName,
        value: valueText ?? '',
        anchor: anchorName ?? '',
        alias: aliasTarget ?? '',
        tag: tagName ?? '',
      }));
  }

  private captureSequenceItem(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'flow_node') {
        const text = child.text.trim();
        captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_DEF,
          text, `- ${text}`, { isListItem: 'true' }));
      }
    }
  }

  // ---- Taint Analysis ----

  protected override getTaintSourceType(nodeType: string, _node: TreeSitterSyntaxNode): string | null {
    // YAML files used as configuration can be taint sources for CI/CD pipelines
    if (nodeType === 'block_mapping_pair' || nodeType === 'flow_pair') {
      return 'config_value';
    }
    return null;
  }

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    // Scan for CI/CD taint sources: environment variables, secrets, external config references
    if (node.type === 'block_mapping_pair' || node.type === 'flow_pair') {
      const text = node.text.toLowerCase();
      const line = node.startPosition.row + 1;
      if (text.includes('secret') || text.includes('token') || text.includes('password') ||
          text.includes('api_key') || text.includes('credential')) {
        sources.push({ name: 'secret_config', sourceType: 'config_secret', line, text: node.text, properties: {} });
      } else if (text.includes('env:') || text.includes('environment')) {
        sources.push({ name: 'env_config', sourceType: 'environment_config', line, text: node.text, properties: {} });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    // YAML files don't have code-level sinks, but can reference dangerous operations
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    // YAML anchors can serve as sanitization templates
    if (node.type === 'anchor') {
      sanitizers.push({ name: node.text.slice(1), sanitizerType: 'reusable_template',
        line: node.startPosition.row + 1, text: node.text, properties: {} });
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Helpers ----

  private makeCapture(
    node: TreeSitterSyntaxNode, tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, text: string, extra: Record<string, string> = {},
  ): UnifiedCapture {
    return {
      tag, text,
      startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      startByte: node.startIndex, endByte: node.endIndex,
      name,
      properties: { filePath: this.filePath, ...extra },
    };
  }

  // ---- Fallback ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const lines = source.split('\n');
    let inBlockScalar = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') continue;
      if (trimmed === '|' || trimmed === '>' || trimmed === '|-' || trimmed === '>-') { inBlockScalar = true; continue; }
      if (inBlockScalar) { if (line.startsWith(' ') || line.startsWith('\t')) continue; inBlockScalar = false; }
      const anchorMatch = trimmed.match(/^\s*&(\w+)/);
      if (anchorMatch) {
        captures.push(this.makeFallbackCapture(CAPTURE_TAGS.VARIABLE_DEF, anchorMatch[1]!, i + 1, filePath, { anchor: 'true' }));
      }
      const aliasMatch = trimmed.match(/^\s*\*(\w+)/);
      if (aliasMatch && !anchorMatch) {
        captures.push(this.makeFallbackCapture(CAPTURE_TAGS.VARIABLE_DEF, aliasMatch[1]!, i + 1, filePath, { alias: 'true' }));
      }
      const kvMatch = trimmed.match(/^(\s*)([\w.\-]+)\s*:\s*(.*)/);
      if (kvMatch) {
        captures.push(this.makeFallbackCapture(CAPTURE_TAGS.VARIABLE_DEF, kvMatch[2]!, i + 1, filePath, { indent: String(kvMatch[1]!.length) }));
      }
      const seqMatch = trimmed.match(/^\s*-\s+(.+)/);
      if (seqMatch) {
        captures.push(this.makeFallbackCapture(CAPTURE_TAGS.VARIABLE_DEF, seqMatch[1]!, i + 1, filePath, { isListItem: 'true' }));
      }
    }
    return captures;
  }

  private makeFallbackCapture(tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, line: number, filePath: string, extra: Record<string, string> = {}): UnifiedCapture {
    return { tag, text: name, startLine: line, endLine: line, startByte: 0, endByte: 0, name, properties: { filePath, ...extra } };
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }
  protected override fallbackExtractTaintSources(_source: string): TaintSource[] { return []; }
  protected override fallbackExtractTaintSinks(_source: string): TaintSink[] { return []; }
  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }
}
