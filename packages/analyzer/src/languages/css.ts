// @code-analyzer/analyzer — CSS Provider (regex fallback)
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type { NodeTypeMapping, TreeSitterLanguage } from './tree-sitter-base.js';

export class CssProvider extends TreeSitterBaseProvider {
  readonly language = 'css';
  readonly displayName = 'CSS';
  readonly extensions = ['.css', '.scss', '.less'];
  readonly globs = ['**/*.css', '**/*.scss', '**/*.less'];
  readonly importSemantics = 'none' as const;

  protected override loadGrammar(): TreeSitterLanguage | null {
    try { return require('tree-sitter-css') as TreeSitterLanguage; }
    catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'rule_set', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'selectors' },
    ];
  }

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    let m: RegExpExecArray | null;

    // CSS rules: selector { ... }
    const ruleRegex = /([.#]?[\w\s,.:#>~+[\]="'-]+?)\s*\{/g;
    while ((m = ruleRegex.exec(source)) !== null) {
      const selector = m[1]!.trim();
      if (selector.length === 0) continue;
      captures.push({
        tag: CAPTURE_TAGS.VARIABLE_DEF, text: selector,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: selector, properties: { filePath },
      });
    }

    // @import declarations
    const importRegex = /@import\s+(?:url\(["']?)?([^"')]+)(?:["']?\))?/g;
    while ((m = importRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.IMPORT, text: m[1]!,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { importType: 'css', filePath },
      });
    }

    // @keyframes, @media, @font-face at-rules
    const atRuleRegex = /@(keyframes|media|font-face|supports|container)\s+(.+?)\s*\{/g;
    while ((m = atRuleRegex.exec(source)) !== null) {
      captures.push({
        tag: CAPTURE_TAGS.CLASS_DEF, text: `@${m[1]!} ${m[2]?.trim()}`,
        startLine: this.ln(source, m.index), endLine: this.ln(source, m.index + m[0].length),
        startByte: m.index, endByte: m.index + m[0].length,
        name: m[1]!, properties: { atRuleType: m[1]!, filePath },
      });
    }

    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(_source: string): ParsedImport[] { return []; }
  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return false; }

  private ln(source: string, offset: number): number {
    return source.slice(0, offset).split('\n').length;
  }
}
