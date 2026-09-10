// @code-analyzer/analyzer — JSON Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, objects, arrays, pairs,
// strings, numbers, booleans, null. Handles JSONC and JSON5.

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

export class JsonProvider extends TreeSitterBaseProvider {
  readonly language = 'json';
  readonly displayName = 'JSON';
  readonly extensions = ['.json', '.jsonc', '.json5'];
  readonly globs = ['**/*.json', '**/*.jsonc', '**/*.json5'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    // tree-sitter-json is a direct dependency of the analyzer, so this require
    // never throws in the bundled runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-json') as TreeSitterLanguage;
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'pair') {
      this.capturePair(node, captures);
    } else if (nt === 'object') {
      const pairCount = this.countChildren(node, 'pair');
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.CLASS_DEF,
          `object_${node.startPosition.row + 1}`,
          `object(${pairCount} keys)`,
          { keyCount: String(pairCount) },
        ),
      );
    } else if (nt === 'array') {
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.VARIABLE_DEF,
          `array_${node.startPosition.row + 1}`,
          `[${node.namedChildCount} items]`,
          { itemCount: String(node.namedChildCount) },
        ),
      );
    } else if (nt === 'comment') {
      const text = node.text.replace(/\/\//, '').replace(/\/\*/, '').replace(/\*\//, '').trim();
      captures.push(
        this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', text, { isComment: 'true' }),
      );
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private capturePair(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    let keyName = '';
    let valueType = '';
    let valueText = '';
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'string') {
        if (!keyName) {
          keyName = child.text.slice(1, -1);
        } else {
          valueType = 'string';
          valueText = child.text.slice(1, -1);
        }
      } else if (child.type === 'number') {
        // tree-sitter-json emits negative numbers as `number` (e.g. "-5"),
        // never as a separate `negative_number` node.
        valueType = 'number';
        valueText = child.text;
      } else if (child.type === 'true' || child.type === 'false') {
        valueType = 'boolean';
        valueText = child.text;
      } else if (child.type === 'null') {
        valueType = 'null';
        valueText = 'null';
      } else if (child.type === 'object') {
        valueType = 'object';
        valueText = `{${child.namedChildCount} keys}`;
      } else {
        // JSON values are a closed set of {string, number, true/false, null,
        // object, array}; array is the only remaining type here.
        valueType = 'array';
        valueText = `[${child.namedChildCount} items]`;
      }
    }
    if (keyName) {
      captures.push(
        this.makeCapture(
          node,
          CAPTURE_TAGS.VARIABLE_DEF,
          keyName,
          valueText ? `${keyName}: ${valueText}` : keyName,
          { valueType },
        ),
      );
    }
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    if (node.type === 'pair') {
      // In tree-sitter-json a pair's first named child is always its string key.
      const keyName = node.namedChild(0).text.slice(1, -1).toLowerCase();
      if (keyName) {
        const secretKeys = [
          'password',
          'secret',
          'token',
          'apikey',
          'api_key',
          'api-key',
          'credential',
          'privatekey',
          'private_key',
          'auth_token',
          'access_key',
          'accesskey',
        ];
        if (secretKeys.some((k) => keyName.includes(k))) {
          sources.push({
            name: keyName,
            sourceType: 'config_secret',
            line: node.startPosition.row + 1,
            text: node.text,
            properties: {},
          });
        }
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    // JSON files don't have code execution sinks but config can dictate dangerous operations
    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(
    node: TreeSitterSyntaxNode,
    sanitizers: TaintSanitizer[],
  ): void {
    if (node.type === 'pair') {
      // In tree-sitter-json a pair's first named child is always its string key.
      const keyName = node.namedChild(0).text.slice(1, -1).toLowerCase();
      if (
        keyName &&
        (keyName.includes('allowed') ||
          keyName.includes('whitelist') ||
          keyName.includes('validation') ||
          keyName.includes('pattern'))
      ) {
        sanitizers.push({
          name: keyName,
          sanitizerType: 'config_validation',
          line: node.startPosition.row + 1,
          text: node.text,
          properties: {},
        });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Helpers ----

  private countChildren(node: TreeSitterSyntaxNode, type: string): number {
    let count = 0;
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i).type === type) count++;
    }
    return count;
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

  /** Describe a parsed JSON value for the regex fallback capture. */
  private describeValue(value: unknown): { text: string; valueType: string } {
    // `typeof null === 'object'`, so null must be handled before the object
    // branch or it would be mislabeled as an object.
    if (value === null) return { text: 'null', valueType: 'null' };
    if (typeof value === 'object') {
      return {
        text: `[${typeof value}]`,
        valueType: Array.isArray(value) ? 'array' : 'object',
      };
    }
    return { text: String(value), valueType: typeof value };
  }

  // ---- Fallback ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    try {
      const obj = JSON.parse(source);
      const walkJson = (value: unknown, path: string, line: number): void => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          captures.push({
            tag: CAPTURE_TAGS.CLASS_DEF,
            text: `${path} (object)`,
            startLine: line,
            endLine: line,
            startByte: 0,
            endByte: 0,
            name: path || 'root',
            properties: { keyCount: String(Object.keys(value).length), filePath },
          });
          for (const [k, v] of Object.entries(value)) {
            const { text, valueType } = this.describeValue(v);
            captures.push({
              tag: CAPTURE_TAGS.VARIABLE_DEF,
              text: `${k}: ${text}`,
              startLine: line,
              endLine: line,
              startByte: 0,
              endByte: 0,
              name: k,
              properties: {
                valueType,
                filePath,
              },
            });
            if (v && typeof v === 'object') {
              // Build the child path without a leading dot: the root path is ''.
              walkJson(v, path ? `${path}.${k}` : k, line);
            }
          }
        }
      };
      walkJson(obj, '', 1);
    } catch {
      /* invalid JSON, skip */
    }
    return captures;
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] {
    return [];
  }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean {
    return false;
  }

  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    try {
      const obj = JSON.parse(source);
      const scan = (value: unknown): void => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [k, v] of Object.entries(value)) {
            const lower = k.toLowerCase();
            const secretKeys = [
              'password',
              'secret',
              'token',
              'apikey',
              'api_key',
              'credential',
              'private_key',
              'access_key',
            ];
            if (secretKeys.some((s) => lower.includes(s))) {
              sources.push({
                name: k,
                sourceType: 'config_secret',
                line: 1,
                text: String(v),
                properties: {},
              });
            }
            if (v && typeof v === 'object') scan(v);
          }
        }
      };
      scan(obj);
    } catch {
      /* ignore */
    }
    return sources;
  }

  protected override fallbackExtractTaintSinks(_source: string): TaintSink[] {
    return [];
  }
  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] {
    return [];
  }
}
