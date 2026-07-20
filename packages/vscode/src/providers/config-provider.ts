// @code-analyzer/vscode — Configuration Provider
// Webview-based configuration UI for the extension settings.

import { ConfigService } from '../services/config-service.js';
import type { CodeAnalyzerConfig } from '../services/config-service.js';

// ---------------------------------------------------------------------------
// Config logic — testable pure functions
// ---------------------------------------------------------------------------

export class ConfigLogic {
  constructor(private configService: ConfigService) {}

  /**
   * Get current configuration settings.
   */
  getConfig(): CodeAnalyzerConfig {
    return this.configService.getAll();
  }

  /**
   * Validate a partial configuration.
   */
  validate(partial: Partial<CodeAnalyzerConfig>): string[] {
    return ConfigService.validate(partial);
  }

  /**
   * Get default configuration values.
   */
  getDefaults(): CodeAnalyzerConfig {
    return ConfigService.getDefaults();
  }
}

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

/**
 * Generate the HTML for the configuration webview.
 */
export function generateConfigHtml(config: CodeAnalyzerConfig): string {
  const formatted = formatBytes(config.maxFileSize);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Analyzer Configuration</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-editor-background, #1e1e1e);
      padding: 20px;
    }
    h2 { font-size: 18px; margin-bottom: 16px; }
    .field { margin-bottom: 16px; }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--vscode-foreground, #ccc);
    }
    .description {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      margin-bottom: 6px;
    }
    input[type="text"], input[type="number"], select {
      width: 100%;
      padding: 6px 8px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      font-size: 13px;
    }
    input[type="checkbox"] { margin-right: 8px; }
    .checkbox-label {
      display: flex;
      align-items: center;
      font-weight: normal;
    }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
      margin-right: 8px;
    }
    button:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    .status { margin-top: 12px; font-size: 12px; }
    .status.error { color: var(--vscode-errorForeground, #f48771); }
    .status.success { color: var(--vscode-terminal-ansiGreen, #4ec9b0); }
    .current-value { font-size: 11px; color: var(--vscode-descriptionForeground, #999); }
  </style>
</head>
<body>
  <h2>Code Analyzer Settings</h2>
  <form id="config-form">
    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" id="autoIndex" ${config.autoIndex ? 'checked' : ''} />
        Auto-index on project open
      </label>
      <div class="description">Automatically index the codebase when opening a project.</div>
    </div>

    <div class="field">
      <label for="indexMode">Index Mode</label>
      <div class="description">Depth of analysis. "full" includes all symbols and relationships.</div>
      <select id="indexMode">
        <option value="full" ${config.indexMode === 'full' ? 'selected' : ''}>Full</option>
        <option value="moderate" ${config.indexMode === 'moderate' ? 'selected' : ''}>Moderate</option>
        <option value="fast" ${config.indexMode === 'fast' ? 'selected' : ''}>Fast</option>
      </select>
    </div>

    <div class="field">
      <label for="maxFileSize">Max File Size (bytes)</label>
      <div class="description">Files larger than this will be skipped during analysis.</div>
      <input type="number" id="maxFileSize" value="${config.maxFileSize}" min="1" />
      <div class="current-value">Current: ${formatted}</div>
    </div>

    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" id="reviewOnSave" ${config.reviewOnSave ? 'checked' : ''} />
        Review on save
      </label>
      <div class="description">Run code review automatically when saving a file.</div>
    </div>

    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" id="showInlineDecorations" ${config.showInlineDecorations ? 'checked' : ''} />
        Show inline decorations
      </label>
      <div class="description">Display review comments as inline annotations in the editor.</div>
    </div>

    <div class="field">
      <label for="maxSearchResults">Max Search Results</label>
      <div class="description">Maximum number of results to return in searches.</div>
      <input type="number" id="maxSearchResults" value="${config.maxSearchResults}" min="1" max="100" />
    </div>

    <button type="button" onclick="saveConfig()">Save</button>
    <button type="button" onclick="resetConfig()">Reset to Defaults</button>
    <div class="status" id="status"></div>
  </form>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();

      window.saveConfig = function() {
        var config = {
          autoIndex: document.getElementById('autoIndex').checked,
          indexMode: document.getElementById('indexMode').value,
          maxFileSize: parseInt(document.getElementById('maxFileSize').value, 10),
          reviewOnSave: document.getElementById('reviewOnSave').checked,
          showInlineDecorations: document.getElementById('showInlineDecorations').checked,
          maxSearchResults: parseInt(document.getElementById('maxSearchResults').value, 10),
        };
        vscode.postMessage({ command: 'saveConfig', config: config });
      };

      window.resetConfig = function() {
        vscode.postMessage({ command: 'resetConfig' });
      };

      window.addEventListener('message', function(e) {
        var data = e.data;
        var statusEl = document.getElementById('status');
        if (data.command === 'configSaved') {
          statusEl.textContent = 'Configuration saved successfully.';
          statusEl.className = 'status success';
        } else if (data.command === 'configError') {
          statusEl.textContent = 'Error: ' + data.message;
          statusEl.className = 'status error';
        } else if (data.command === 'configDefaults') {
          document.getElementById('autoIndex').checked = data.config.autoIndex;
          document.getElementById('indexMode').value = data.config.indexMode;
          document.getElementById('maxFileSize').value = data.config.maxFileSize;
          document.getElementById('reviewOnSave').checked = data.config.reviewOnSave;
          document.getElementById('showInlineDecorations').checked = data.config.showInlineDecorations;
          document.getElementById('maxSearchResults').value = data.config.maxSearchResults;
          statusEl.textContent = 'Reset to defaults.';
          statusEl.className = 'status success';
        }
      });
    })();

    function formatBytes(bytes) {
      if (bytes === 0) return '0 Bytes';
      var k = 1024;
      var sizes = ['Bytes', 'KB', 'MB', 'GB'];
      var i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
