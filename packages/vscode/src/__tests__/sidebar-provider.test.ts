// @code-analyzer/vscode — Sidebar Provider Tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SidebarLogic,
  generateSidebarHtml,
} from '../providers/sidebar-provider.js';
import { EngineBridge } from '../services/engine-bridge.js';

describe('SidebarLogic', () => {
  let engine: EngineBridge;
  let logic: SidebarLogic;

  beforeEach(() => {
    engine = new EngineBridge();
    engine.setProjectId('test-project');
    logic = new SidebarLogic(engine);
  });

  // -------------------------------------------------------------------------
  // Search messages
  // -------------------------------------------------------------------------

  describe('search', () => {
    it('returns searchResults for valid search command', async () => {
      const response = await logic.handleMessage({
        command: 'search',
        query: 'login',
      });
      expect(response.command).toBe('searchResults');
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });

    it('handles empty query', async () => {
      const response = await logic.handleMessage({
        command: 'search',
        query: '',
      });
      expect(response.command).toBe('searchResults');
    });

    it('handles missing query field', async () => {
      const response = await logic.handleMessage({
        command: 'search',
      });
      expect(response.command).toBe('searchResults');
    });
  });

  // -------------------------------------------------------------------------
  // Review messages
  // -------------------------------------------------------------------------

  describe('review', () => {
    it('returns reviewResults for review command', async () => {
      const response = await logic.handleMessage({
        command: 'review',
      });
      expect(response.command).toBe('reviewResults');
      expect(response.comments).toBeDefined();
      expect(Array.isArray(response.comments)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Standards messages
  // -------------------------------------------------------------------------

  describe('checkStandards', () => {
    it('returns standardsResults with valid filePath', async () => {
      const response = await logic.handleMessage({
        command: 'checkStandards',
        filePath: 'src/test.ts',
      });
      expect(response.command).toBe('standardsResults');
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });

    it('handles empty filePath', async () => {
      const response = await logic.handleMessage({
        command: 'checkStandards',
        filePath: '',
      });
      expect(response.command).toBe('standardsResults');
    });

    it('handles missing filePath', async () => {
      const response = await logic.handleMessage({
        command: 'checkStandards',
      });
      expect(response.command).toBe('standardsResults');
    });
  });

  // -------------------------------------------------------------------------
  // Get changed files
  // -------------------------------------------------------------------------

  describe('getChangedFiles', () => {
    it('returns changedFilesResults', async () => {
      const response = await logic.handleMessage({
        command: 'getChangedFiles',
      });
      expect(response.command).toBe('changedFilesResults');
      expect(response.files).toBeDefined();
      expect(Array.isArray(response.files)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Project info
  // -------------------------------------------------------------------------

  describe('getProjectInfo', () => {
    it('returns project info', async () => {
      const response = await logic.handleMessage({
        command: 'getProjectInfo',
      });
      expect(response.command).toBe('projectInfo');
      expect(response.projectId).toBe('test-project');
    });

    it('returns null project when not set', async () => {
      const emptyEngine = new EngineBridge();
      const emptyLogic = new SidebarLogic(emptyEngine);
      const response = await emptyLogic.handleMessage({
        command: 'getProjectInfo',
      });
      expect(response.command).toBe('projectInfo');
      expect(response.projectId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Unknown commands
  // -------------------------------------------------------------------------

  describe('unknown commands', () => {
    it('returns error for unknown command', async () => {
      const response = await logic.handleMessage({
        command: 'nonexistent',
      });
      expect(response.command).toBe('error');
      expect(response.message).toContain('Unknown command');
    });

    it('returns error for empty command', async () => {
      const response = await logic.handleMessage({
        command: '',
      });
      expect(response.command).toBe('error');
    });
  });
});

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

describe('generateSidebarHtml', () => {
  it('returns a string', () => {
    const html = generateSidebarHtml();
    expect(typeof html).toBe('string');
  });

  it('contains DOCTYPE declaration', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('contains the search input', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="q"');
    expect(html).toContain('Search symbols');
  });

  it('contains review button', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('runReview');
  });

  it('contains results container', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('id="results"');
  });

  it('contains acquireVsCodeApi call', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('acquireVsCodeApi');
  });

  it('contains message handler for searchResults', () => {
    const html = generateSidebarHtml();
    expect(html).toContain("'searchResults'");
    expect(html).toContain("'reviewResults'");
  });

  it('contains escapeHtml helper', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('function escapeHtml');
  });

  it('has valid HTML structure with closing tags', () => {
    const html = generateSidebarHtml();
    expect(html).toContain('</html>');
    expect(html).toContain('</body>');
    expect(html).toContain('</head>');
  });

  it('is consistent across multiple calls', () => {
    const html1 = generateSidebarHtml();
    const html2 = generateSidebarHtml();
    expect(html1).toBe(html2);
    expect(html1.length).toBe(html2.length);
  });
});
