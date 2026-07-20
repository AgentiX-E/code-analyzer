// @code-analyzer/vscode — Sidebar Provider
// WebviewView provider that renders a message-based sidebar UI.
// VS Code integration is handled by extension.ts through DI.

import type { EngineBridge } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// SidebarLogic — testable pure logic
// ---------------------------------------------------------------------------

export interface SidebarMessage {
  command: string;
  [key: string]: unknown;
}

export interface SidebarResponse {
  command: string;
  [key: string]: unknown;
}

export class SidebarLogic {
  constructor(private engine: EngineBridge) {}

  /**
   * Handle a message from the webview and return the response.
   */
  async handleMessage(message: SidebarMessage): Promise<SidebarResponse> {
    switch (message.command) {
      case 'search': {
        const query = (message['query'] as string) ?? '';
        const results = await this.engine.search(query);
        return { command: 'searchResults', results };
      }
      case 'review': {
        const comments = await this.engine.reviewWorkspace();
        return { command: 'reviewResults', comments };
      }
      case 'checkStandards': {
        const filePath = (message['filePath'] as string) ?? '';
        const results = await this.engine.checkStandards(filePath);
        return { command: 'standardsResults', results };
      }
      case 'getChangedFiles': {
        const files = await this.engine.getChangedFiles();
        return { command: 'changedFilesResults', files };
      }
      case 'getProjectInfo': {
        return {
          command: 'projectInfo',
          projectId: this.engine.getProjectId(),
        };
      }
      default:
        return { command: 'error', message: `Unknown command: ${message.command}` };
    }
  }
}

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

/**
 * Generate the HTML for the sidebar webview.
 * Uses a simple message-based architecture (no React dependency).
 */
export function generateSidebarHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Analyzer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-sideBar-background, #252526);
      padding: 12px;
    }
    h2 {
      font-size: 16px;
      margin-bottom: 12px;
      font-weight: 600;
    }
    input {
      width: 100%;
      padding: 6px 8px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      margin-bottom: 8px;
      font-size: 13px;
    }
    input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, #007acc);
    }
    button {
      padding: 6px 12px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .results {
      margin-top: 12px;
      max-height: 400px;
      overflow-y: auto;
    }
    .result-item {
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-sideBar-border, #333);
      cursor: pointer;
    }
    .result-item:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .result-name {
      font-weight: 600;
    }
    .result-detail {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      margin-top: 2px;
    }
    .button-row {
      margin-bottom: 12px;
    }
    .status {
      margin-top: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
    }
  </style>
</head>
<body>
  <div id="root">
    <h2>Code Analyzer</h2>
    <div class="button-row">
      <button id="btn-review" onclick="runReview()">Review Changes</button>
      <button id="btn-files" onclick="getChangedFiles()">Changed Files</button>
    </div>
    <input id="q" type="text" placeholder="Search symbols..." onkeydown="if(event.key==='Enter')runSearch()" />
    <div class="button-row">
      <button onclick="runSearch()">Search</button>
      <button onclick="getProjectInfo()">Project Info</button>
    </div>
    <div class="status" id="status"></div>
    <div class="results" id="results"></div>
  </div>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();

      window.runSearch = function() {
        var q = document.getElementById('q').value;
        if (!q) return;
        document.getElementById('status').textContent = 'Searching...';
        vscode.postMessage({ command: 'search', query: q });
      };

      window.runReview = function() {
        document.getElementById('btn-review').disabled = true;
        document.getElementById('status').textContent = 'Reviewing...';
        vscode.postMessage({ command: 'review' });
      };

      window.getChangedFiles = function() {
        document.getElementById('status').textContent = 'Getting changed files...';
        vscode.postMessage({ command: 'getChangedFiles' });
      };

      window.getProjectInfo = function() {
        vscode.postMessage({ command: 'getProjectInfo' });
      };

      window.addEventListener('message', function(e) {
        var data = e.data;
        document.getElementById('btn-review').disabled = false;

        if (data.command === 'searchResults') {
          var html = '';
          if (data.results && data.results.length > 0) {
            for (var i = 0; i < data.results.length; i++) {
              var r = data.results[i];
              html += '<div class="result-item"><div class="result-name">' + escapeHtml(r.name) + '</div><div class="result-detail">' + escapeHtml(r.filePath) + ' (' + escapeHtml(r.label) + ')</div></div>';
            }
          } else {
            html = '<div class="result-detail">No results found.</div>';
          }
          document.getElementById('results').innerHTML = html;
          document.getElementById('status').textContent = 'Found ' + (data.results ? data.results.length : 0) + ' result(s)';
        } else if (data.command === 'reviewResults') {
          var html = '';
          if (data.comments && data.comments.length > 0) {
            html = '<h3>Review Findings (' + data.comments.length + ')</h3>';
            for (var i = 0; i < data.comments.length; i++) {
              var c = data.comments[i];
              html += '<div class="result-item"><div class="result-name"><span style="color: var(--vscode-errorForeground)">' + escapeHtml(c.severity) + '</span></div><div class="result-detail">' + escapeHtml(c.title) + '<br/>' + escapeHtml(c.path) + ':' + c.startLine + '</div></div>';
            }
          } else {
            html = '<div class="result-detail">No issues found.</div>';
          }
          document.getElementById('results').innerHTML = html;
          document.getElementById('status').textContent = 'Found ' + (data.comments ? data.comments.length : 0) + ' issue(s)';
        } else if (data.command === 'changedFilesResults') {
          var html = '';
          if (data.files && data.files.length > 0) {
            html = '<h3>Changed Files (' + data.files.length + ')</h3>';
            for (var i = 0; i < data.files.length; i++) {
              var f = data.files[i];
              html += '<div class="result-item"><div class="result-name">' + escapeHtml(f.path) + '</div><div class="result-detail">' + escapeHtml(f.status) + '</div></div>';
            }
          } else {
            html = '<div class="result-detail">No changed files.</div>';
          }
          document.getElementById('results').innerHTML = html;
          document.getElementById('status').textContent = '';
        } else if (data.command === 'projectInfo') {
          var info = 'Project ID: ' + (data.projectId || 'Not set');
          document.getElementById('status').textContent = info;
        }
      });

      function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
    })();
  </script>
</body>
</html>`;
}
