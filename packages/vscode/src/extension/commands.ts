// @code-analyzer/vscode — VS Code Extension Commands
// Registers all 14 VS Code commands.

import type { EngineBridge } from '../services/engine-bridge.js';
import type {
  IVSCodeAPI,
  DiagnosticCollection,
} from '../services/vscode-api.js';
import { DiagnosticSeverity } from '../services/vscode-api.js';
import { CommentLogic } from '../providers/comment-provider.js';

export interface RegisteredDisposables {
  disposables: Array<{ dispose(): void }>;
}

/**
 * Register all 14 commands for the Code Analyzer extension.
 */
export function registerCommands(
  api: IVSCodeAPI,
  engine: EngineBridge,
  _configService: unknown,
  commentCollection: DiagnosticCollection,
): RegisteredDisposables {
  const disposables: Array<{ dispose(): void }> = [];

  // =====================================================================
  // Core Commands (5)
  // =====================================================================

  // 1. Show sidebar
  disposables.push(
    api.registerCommand('code-analyzer.showSidebar', () => {
      api.executeCommand('workbench.view.extension.code-analyzer-sidebar');
    }),
  );

  // 2. Analyze codebase
  disposables.push(
    api.registerCommand('code-analyzer.analyze', async () => {
      const folders = api.getWorkspaceFolders();
      const root = folders?.[0]?.uri?.fsPath;
      if (!root) {
        await api.showWarningMessage('No workspace folder found.');
        return;
      }

      await api.withProgress(
        { location: 10, title: 'Analyzing codebase...' },
        async (_progress) => {
          engine.setProjectId(root);
          await engine.initialize();
          await engine.indexWorkspace(root);
          await api.showInformationMessage('Code analysis complete');
        },
      );
    }),
  );

  // 3. Review workspace
  disposables.push(
    api.registerCommand('code-analyzer.review', async () => {
      const comments = await engine.reviewWorkspace();
      if (comments.length === 0) {
        await api.showInformationMessage('No issues found');
        return;
      }

      const commentLogic = new CommentLogic(engine);
      const diagnostics = commentLogic.mapCommentsToDiagnostics(comments);
      const grouped = commentLogic.groupByFile(diagnostics);

      commentCollection.clear();
      for (const [filePath, diags] of grouped) {
        const vsDiags = diags.map((d) => ({
          range: {
            startLine: d.range.startLine,
            startCharacter: d.range.startCharacter,
            endLine: d.range.endLine,
            endCharacter: d.range.endCharacter,
          },
          message: d.message,
          severity: d.severity === 'error'
            ? DiagnosticSeverity.Error
            : d.severity === 'warning'
              ? DiagnosticSeverity.Warning
              : DiagnosticSeverity.Information,
          source: d.source,
        }));
        commentCollection.set({ toString: () => filePath }, vsDiags);
      }

      await api.showInformationMessage(
        `Found ${comments.length} issue(s)`,
      );
    }),
  );

  // 4. Search codebase
  disposables.push(
    api.registerCommand('code-analyzer.search', async () => {
      const query = await api.showInputBox({
        prompt: 'Search codebase (symbols, files, types)',
      });
      if (!query) return;

      const results = await engine.search(query);
      if (results.length === 0) {
        await api.showInformationMessage(
          `No results found for "${query}"`,
        );
        return;
      }

      const items = results.map((r) => ({
        label: r.name,
        description: r.filePath,
        detail: r.label,
      }));
      const selected = await api.showQuickPick(items, {
        placeHolder: 'Select a symbol to navigate',
      });

      if (selected?.description) {
        await api.showInformationMessage(
          `Selected: ${selected.label} in ${selected.description}`,
        );
      }
    }),
  );

  // 5. Show config
  disposables.push(
    api.registerCommand('code-analyzer.showConfig', () => {
      api.executeCommand('code-analyzer.config.focus');
    }),
  );

  // =====================================================================
  // Focus Commands (2) — switch to specific views
  // =====================================================================

  // 6. Focus config view
  disposables.push(
    api.registerCommand('code-analyzer.config.focus', () => {
      api.executeCommand('code-analyzer.config.focus');
    }),
  );

  // 7. Focus graph explorer view
  disposables.push(
    api.registerCommand('code-analyzer.graphExplorer.focus', () => {
      api.executeCommand('code-analyzer.graphExplorer.focus');
    }),
  );

  // =====================================================================
  // Symbol Context Commands (4) — from tree view context menu
  // =====================================================================

  // 8. Find callers of a symbol
  disposables.push(
    api.registerCommand('code-analyzer.findCallers', async (...args: unknown[]) => {
      const symbolName = extractSymbolName(args);
      if (!symbolName) return;

      const callers = await engine.findCallers(symbolName);
      if (callers.length === 0) {
        await api.showInformationMessage(`No callers found for "${symbolName}"`);
        return;
      }

      const items = callers.map((c) => ({
        label: c.name,
        description: c.filePath,
      }));
      const selected = await api.showQuickPick(items, {
        placeHolder: `Callers of "${symbolName}"`,
      });
      if (selected?.description) {
        await api.showInformationMessage(
          `${selected.label} in ${selected.description}`,
        );
      }
    }),
  );

  // 9. Find callees of a symbol
  disposables.push(
    api.registerCommand('code-analyzer.findCallees', async (...args: unknown[]) => {
      const symbolName = extractSymbolName(args);
      if (!symbolName) return;

      const callees = await engine.findCallees(symbolName);
      if (callees.length === 0) {
        await api.showInformationMessage(`No callees found for "${symbolName}"`);
        return;
      }

      const items = callees.map((c) => ({
        label: c.name,
        description: c.filePath,
      }));
      const selected = await api.showQuickPick(items, {
        placeHolder: `Callees of "${symbolName}"`,
      });
      if (selected?.description) {
        await api.showInformationMessage(
          `${selected.label} in ${selected.description}`,
        );
      }
    }),
  );

  // 10. Trace impact of changes to a symbol
  disposables.push(
    api.registerCommand('code-analyzer.traceImpact', async (...args: unknown[]) => {
      const symbolName = extractSymbolName(args);
      if (!symbolName) return;

      const impact = await engine.analyzeImpact(symbolName);
      const message = [
        `Impact analysis for "${symbolName}":`,
        `Risk level: ${impact.riskLevel}`,
        `Affected symbols: ${impact.affectedSymbols}`,
      ].join('\n');
      await api.showInformationMessage(message);
    }),
  );

  // 11. Show symbol detail
  disposables.push(
    api.registerCommand('code-analyzer.showSymbolDetail', async (...args: unknown[]) => {
      const symbolName = extractSymbolName(args);
      if (!symbolName) return;

      const detail = await engine.getSymbolDetail(symbolName);
      if (!detail) {
        await api.showWarningMessage(`Symbol "${symbolName}" not found`);
        return;
      }

      const lines = [
        `Symbol: ${detail.qualifiedName}`,
        `File: ${detail.filePath}`,
        `Exported: ${detail.isExported ? 'Yes' : 'No'}`,
      ];
      if (detail.signature) lines.push(`Signature: ${detail.signature}`);
      if (detail.docstring) lines.push(`\n${detail.docstring}`);

      await api.showInformationMessage(lines.join('\n'));
    }),
  );

  // =====================================================================
  // CodeLens Action Commands (3)
  // =====================================================================

  // 12. Fix issue — navigate to the issue location
  disposables.push(
    api.registerCommand('code-analyzer.fixIssue', async (...args: unknown[]) => {
      const issue = extractFirstArg<{ filePath?: string; startLine?: number }>(args);
      if (!issue?.filePath) return;

      // Navigate to the file at the issue location
      try {
        const uri = api.Uri.file(issue.filePath);
        await api.executeCommand('vscode.open', uri, {
          selection: issue.startLine != null
            ? { startLine: issue.startLine, startCharacter: 0, endLine: issue.startLine, endCharacter: 0 }
            : undefined,
        } as any);
      } catch {
        await api.showErrorMessage(`Could not open file: ${issue.filePath}`);
      }
    }),
  );

  // 13. Ignore issue — clear diagnostic for this issue
  disposables.push(
    api.registerCommand('code-analyzer.ignoreIssue', async (...args: unknown[]) => {
      const issue = extractFirstArg<{ filePath?: string; message?: string }>(args);
      if (!issue?.filePath) return;

      // Remove the matching diagnostic from the collection
      commentCollection.delete({ toString: () => issue.filePath! });
      await api.showInformationMessage(`Issue ignored: ${issue.message ?? 'Unknown'}`);
    }),
  );

  // 14. Explain issue — send to Copilot Chat via /explain
  disposables.push(
    api.registerCommand('code-analyzer.explainIssue', async (...args: unknown[]) => {
      const issue = extractFirstArg<{ message?: string; filePath?: string; startLine?: number }>(args);
      if (!issue) return;

      const detailParts = [issue.message ?? 'Issue'];
      if (issue.filePath) detailParts.push(`in ${issue.filePath}`);
      if (issue.startLine != null) detailParts.push(`at line ${issue.startLine + 1}`);

      const context = detailParts.join(' ');
      await api.showInformationMessage(
        `Use Copilot Chat: /explain ${context}`,
      );
    }),
  );

  return { disposables };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a symbol name from command arguments.
 * Supports:
 *  - args[0] as string (direct)
 *  - args[0] as { label, name, symbolName, symbolId } (tree view item)
 */
function extractSymbolName(args: unknown[]): string | undefined {
  if (args.length === 0) return undefined;
  const arg = args[0];
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object') {
    const obj = arg as Record<string, unknown>;
    return (obj['name'] as string) ?? (obj['label'] as string) ?? (obj['symbolName'] as string) ?? (obj['symbolId'] as string);
  }
  return undefined;
}

/**
 * Extract the first argument typed.
 */
function extractFirstArg<T>(args: unknown[]): T | undefined {
  return (args.length > 0 ? args[0] : undefined) as T | undefined;
}
