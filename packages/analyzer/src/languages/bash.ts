// @code-analyzer/analyzer — Bash/Shell Provider (tree-sitter AST walker)
// Full tree-sitter AST walker: 15+ node mappings, functions, variables,
// command injection taint sinks, source/include import tracking.

import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { TreeSitterBaseProvider } from './tree-sitter-base.js';
import type { ParsedImport } from './provider.js';
import type { UnifiedCapture } from '@code-analyzer/shared';
import type {
  NodeTypeMapping, TreeSitterLanguage, TreeSitterSyntaxNode,
  TaintSource, TaintSink, TaintSanitizer,
} from './tree-sitter-base.js';

export class BashProvider extends TreeSitterBaseProvider {
  readonly language = 'bash';
  readonly displayName = 'Bash/Shell';
  readonly extensions = ['.sh', '.bash', '.zsh', '.ksh'];
  readonly globs = ['**/*.sh', '**/*.bash', '**/*.zsh', '**/*.ksh'];
  readonly importSemantics = 'named' as const;

  private static readonly SHELL_BUILTINS = new Set([
    'echo', 'cd', 'exit', 'return', 'export', 'local', 'readonly',
    'declare', 'unset', 'alias', 'set', 'shift', 'trap', 'wait',
    'source', '.', 'test', '[', '[[', 'printf', 'read', 'type',
    'if', 'for', 'while', 'case', 'then', 'else', 'elif', 'fi',
    'do', 'done', 'esac', 'in', 'select', 'until', 'function',
  ]);

  protected override loadGrammar(): TreeSitterLanguage | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('tree-sitter-bash') as TreeSitterLanguage;
      return m;
    } catch { return null; }
  }

  protected override getNodeMappings(): NodeTypeMapping[] {
    return [
      { nodeType: 'function_definition', captureTag: CAPTURE_TAGS.FUNCTION_DEF, nameChildType: 'word' },
      { nodeType: 'variable_assignment', captureTag: CAPTURE_TAGS.VARIABLE_DEF, nameChildType: 'variable_name' },
      { nodeType: 'command', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
      { nodeType: 'command_name', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
      { nodeType: 'word', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'variable_name', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'string', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'raw_string', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'expansion', captureTag: CAPTURE_TAGS.VARIABLE_ACCESS, useFirstNamedChild: true },
      { nodeType: 'simple_expansion', captureTag: CAPTURE_TAGS.VARIABLE_ACCESS, useFirstNamedChild: true },
      { nodeType: 'command_substitution', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
      { nodeType: 'if_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'for_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'while_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'case_statement', captureTag: CAPTURE_TAGS.VARIABLE_DEF, useFirstNamedChild: true },
      { nodeType: 'heredoc_body', captureTag: CAPTURE_TAGS.DOCSTRING, useFirstNamedChild: true },
      { nodeType: 'comment', captureTag: CAPTURE_TAGS.COMMENT, useFirstNamedChild: true },
      { nodeType: 'pipeline', captureTag: CAPTURE_TAGS.FUNCTION_CALL, useFirstNamedChild: true },
    ];
  }

  // ---- AST Walking ----

  protected override walkAndCapture(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const nt = node.type;

    if (nt === 'function_definition') {
      let funcName = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'word') { funcName = child.text; break; }
      }
      if (funcName) {
        captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_DEF, funcName, funcName));
      }
    } else if (nt === 'variable_assignment') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'variable_name') {
          captures.push(this.makeCapture(child, CAPTURE_TAGS.VARIABLE_DEF, child.text, child.text));
        }
      }
    } else if (nt === 'command') {
      this.captureCommand(node, captures);
    } else if (nt === 'command_substitution') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_CALL, '$(...))', node.text, { isSubshell: 'true' }));
    } else if (nt === 'expansion' || nt === 'simple_expansion') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.VARIABLE_ACCESS, node.text, node.text, { isExpansion: 'true' }));
    } else if (nt === 'comment') {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.COMMENT, '[comment]', node.text.trim(), { isComment: 'true' }));
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkAndCapture(node.child(i), captures);
    }
  }

  private captureCommand(node: TreeSitterSyntaxNode, captures: UnifiedCapture[]): void {
    const cmdName = this.getCommandName(node);
    if (!cmdName) return;

    // Source/include detection
    if (cmdName === 'source' || cmdName === '.') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'word' && child.text !== 'source' && child.text !== '.') {
          captures.push(this.makeCapture(child, CAPTURE_TAGS.IMPORT, child.text, `source ${child.text}`,
            { importType: 'source' }));
        }
      }
      return;
    }

    // Regular command (skip builtins)
    if (!BashProvider.SHELL_BUILTINS.has(cmdName)) {
      captures.push(this.makeCapture(node, CAPTURE_TAGS.FUNCTION_CALL, cmdName, cmdName));
    }
  }

  private getCommandName(node: TreeSitterSyntaxNode): string | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === 'command_name') {
        for (let j = 0; j < child.childCount; j++) {
          const sub = child.child(j);
          if (sub.type === 'word') return sub.text;
        }
        return child.text;
      }
      if (child.type === 'word') return child.text;
    }
    return undefined;
  }

  // ---- Taint Analysis ----

  protected override walkForTaintSources(node: TreeSitterSyntaxNode, sources: TaintSource[]): void {
    // $1, $2, etc. (script arguments), $@, $*
    if (node.type === 'expansion' || node.type === 'simple_expansion' ||
        node.type === 'special_variable_name') {
      const text = node.text;
      if (text === '$@' || text === '$*' || text === '$1' || text === '$2' ||
          text === '$3' || text === '$4' || text === '$5') {
        sources.push({ name: text, sourceType: 'script_argument',
          line: node.startPosition.row + 1, text, properties: {} });
      }
      if (text.includes('USER') || text.includes('INPUT') || text.includes('ARG') ||
          text === '$0') {
        sources.push({ name: text, sourceType: 'external_input',
          line: node.startPosition.row + 1, text, properties: {} });
      }
      return;
    }

    // read command is a taint source
    if (node.type === 'command') {
      const cmdName = this.getCommandName(node);
      if (cmdName === 'read') {
        sources.push({ name: 'read_input', sourceType: 'user_input',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }
      // curl/wget are taint sources
      if (cmdName === 'curl' || cmdName === 'wget' || cmdName === 'nc') {
        sources.push({ name: cmdName, sourceType: 'network',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSources(node.child(i), sources);
    }
  }

  protected override walkForTaintSinks(node: TreeSitterSyntaxNode, sinks: TaintSink[]): void {
    if (node.type === 'command') {
      const cmdName = this.getCommandName(node);
      if (!cmdName) return;

      // Command injection sinks
      if (cmdName === 'eval' || cmdName === 'exec' || cmdName === 'bash' ||
          cmdName === 'sh' || cmdName === 'zsh' || cmdName === 'ksh') {
        sinks.push({ name: cmdName, sinkType: 'os_command',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }

      // Filesystem sinks
      if (cmdName === 'rm' || cmdName === 'mv' || cmdName === 'cp' || cmdName === 'dd' ||
          cmdName === 'chmod' || cmdName === 'chown') {
        sinks.push({ name: cmdName, sinkType: 'file_write',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }

      // Network sinks
      if (cmdName === 'nc' || cmdName === 'telnet' || cmdName === 'ssh') {
        sinks.push({ name: cmdName, sinkType: 'network',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForTaintSinks(node.child(i), sinks);
    }
  }

  protected override walkForSanitizers(node: TreeSitterSyntaxNode, sanitizers: TaintSanitizer[]): void {
    if (node.type === 'command') {
      const cmdName = this.getCommandName(node);
      if (cmdName === 'printf') {
        sanitizers.push({ name: 'printf_sanitize', sanitizerType: 'output_encoding',
          line: node.startPosition.row + 1, text: node.text, properties: {} });
        return;
      }
    }

    // Parameter expansion with default values
    if (node.type === 'expansion') {
      const text = node.text;
      if (text.includes(':-') || text.includes(':=?')) {
        sanitizers.push({ name: text, sanitizerType: 'parameter_validation',
          line: node.startPosition.row + 1, text, properties: {} });
        return;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkForSanitizers(node.child(i), sanitizers);
    }
  }

  // ---- Import Extraction ----

  protected override walkForImports(node: TreeSitterSyntaxNode, imports: ParsedImport[]): void {
    if (node.type === 'command') {
      const cmdName = this.getCommandName(node);
      if (cmdName === 'source' || cmdName === '.') {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'word' && child.text !== 'source' && child.text !== '.') {
            imports.push({ source: child.text, names: [child.text], type: 'named',
              lineNumber: node.startPosition.row + 1 });
          }
        }
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkForImports(node.child(i), imports);
    }
  }

  protected override checkExported(_node: TreeSitterSyntaxNode, _symbolName: string): boolean {
    return true; // Shell functions are globally visible
  }

  // ---- Helpers ----

  private makeCapture(
    node: TreeSitterSyntaxNode, tag: typeof CAPTURE_TAGS[keyof typeof CAPTURE_TAGS],
    name: string, text: string, extra: Record<string, string> = {},
  ): UnifiedCapture {
    return { tag, text,
      startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      startByte: node.startIndex, endByte: node.endIndex,
      name, properties: { filePath: this.filePath, ...extra } };
  }

  // ---- Fallback ----

  protected override fallbackParse(source: string, filePath: string): UnifiedCapture[] {
    const captures: UnifiedCapture[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const funcRegex = /(?:function\s+)?(\w+)\s*\(\s*\)\s*\{/g;
    while ((m = funcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const varRegex = /(?:export\s+|local\s+|readonly\s+)?(\w+)=/g;
    while ((m = varRegex.exec(source)) !== null) {
      if (['if', 'for', 'while', 'case', 'select', 'do', 'done', 'then', 'else', 'fi'].includes(m[1]!)) continue;
      captures.push({ tag: CAPTURE_TAGS.VARIABLE_DEF, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { filePath } });
    }
    const srcRegex = /(?:source|\.)\s+["']?([\w./-]+)["']?/g;
    while ((m = srcRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.IMPORT, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { importType: 'source', filePath } });
    }
    const pipeRegex = /(\S+)\s*\|\s*\S+/g;
    while ((m = pipeRegex.exec(source)) !== null) {
      captures.push({ tag: CAPTURE_TAGS.FUNCTION_CALL, text: m[1]!, startLine: ln(m.index), endLine: ln(m.index + m[0].length), startByte: m.index, endByte: m.index + m[0].length, name: m[1]!, properties: { pipeCommand: 'true', filePath } });
    }
    return captures.sort((a, b) => a.startLine - b.startLine || a.startByte - b.startByte);
  }

  protected override fallbackExtractImports(source: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const srcRegex = /(?:source|\.)\s+["']?([\w./-]+)["']?/g;
    while ((m = srcRegex.exec(source)) !== null) {
      imports.push({ source: m[1]!, names: [m[1]!], type: 'named', lineNumber: ln(m.index) });
    }
    return imports;
  }

  protected override fallbackIsExported(_source: string, _symbolName: string): boolean { return true; }

  protected override fallbackExtractTaintSources(source: string): TaintSource[] {
    const sources: TaintSource[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const readRx = /\bread\b\s+/g;
    while ((m = readRx.exec(source)) !== null) {
      sources.push({ name: 'read_input', sourceType: 'user_input', line: ln(m.index), text: m[0], properties: {} });
    }
    return sources;
  }

  protected override fallbackExtractTaintSinks(source: string): TaintSink[] {
    const sinks: TaintSink[] = [];
    const ln = (off: number) => source.slice(0, off).split('\n').length;
    let m: RegExpExecArray | null;
    const patterns = [/\beval\b/g, /\bexec\b/g, /\brm\s+-rf\b/g];
    for (const p of patterns) {
      while ((m = p.exec(source)) !== null) {
        sinks.push({ name: m[0], sinkType: 'os_command', line: ln(m.index), text: m[0], properties: {} });
      }
    }
    return sinks;
  }

  protected override fallbackExtractSanitizers(_source: string): TaintSanitizer[] { return []; }
}
