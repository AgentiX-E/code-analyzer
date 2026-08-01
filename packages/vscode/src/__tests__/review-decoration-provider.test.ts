// @code-analyzer/vscode — Review Decoration Provider Tests

import { describe, it, expect } from 'vitest';
import {
  ReviewDecorationLogic,
} from '../providers/review-decoration-provider.js';
import type {
  DecorationSeverity,
  DecorationConfig,
  HoverContent,
  CodeLensAction,
  FileDecorationGroup,
} from '../providers/review-decoration-provider.js';
import type { ReviewCommentItem } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<ReviewCommentItem> = {}): ReviewCommentItem {
  return {
    severity: 'medium',
    title: 'Test issue',
    path: 'src/test.ts',
    startLine: 10,
    endLine: 12,
    message: 'This is a test issue with medium severity',
    ...overrides,
  };
}

describe('ReviewDecorationLogic', () => {
  const logic = new ReviewDecorationLogic();

  // -------------------------------------------------------------------------
  // getDecorationConfig
  // -------------------------------------------------------------------------

  describe('getDecorationConfig', () => {
    it('returns correct config for critical severity', () => {
      const config = logic.getDecorationConfig('critical');
      expect(config.severity).toBe('critical');
      expect(config.overviewRulerColor).toBe('#f44747');
      expect(config.overviewRulerLane).toBe(7);
      expect(config.backgroundColor).toContain('rgba(244, 71, 71');
      expect(config.borderColor).toBe('#f44747');
      expect(config.borderStyle).toBe('solid');
    });

    it('returns correct config for high severity', () => {
      const config = logic.getDecorationConfig('high');
      expect(config.severity).toBe('high');
      expect(config.overviewRulerColor).toBe('#e2a23b');
      expect(config.overviewRulerLane).toBe(5);
      expect(config.backgroundColor).toContain('rgba(226, 162, 59');
      expect(config.borderColor).toBe('#e2a23b');
      expect(config.borderStyle).toBe('solid');
    });

    it('returns correct config for medium severity', () => {
      const config = logic.getDecorationConfig('medium');
      expect(config.severity).toBe('medium');
      expect(config.overviewRulerColor).toBe('#4ec9b0');
      expect(config.overviewRulerLane).toBe(3);
      expect(config.backgroundColor).toContain('rgba(78, 201, 176');
      expect(config.borderColor).toBe('#4ec9b0');
      expect(config.borderStyle).toBe('solid');
    });

    it('returns correct config for low severity', () => {
      const config = logic.getDecorationConfig('low');
      expect(config.severity).toBe('low');
      expect(config.overviewRulerColor).toBe('#569cd6');
      expect(config.overviewRulerLane).toBe(1);
      expect(config.backgroundColor).toContain('rgba(86, 156, 214');
      expect(config.borderColor).toBe('#569cd6');
      expect(config.borderStyle).toBe('dashed');
    });

    it('returns correct config for info severity', () => {
      const config = logic.getDecorationConfig('info');
      expect(config.severity).toBe('info');
      expect(config.overviewRulerColor).toBe('#808080');
      expect(config.overviewRulerLane).toBe(1);
      expect(config.backgroundColor).toContain('rgba(128, 128, 128');
      expect(config.borderColor).toBe('#808080');
      expect(config.borderStyle).toBe('dotted');
    });

    it('returns info config for unknown severity', () => {
      const config = logic.getDecorationConfig('unknown' as DecorationSeverity);
      expect(config.severity).toBe('info');
      expect(config.overviewRulerColor).toBe('#808080');
    });
  });

  // -------------------------------------------------------------------------
  // buildHoverContent
  // -------------------------------------------------------------------------

  describe('buildHoverContent', () => {
    it('builds hover content from a review comment', () => {
      const comment = makeComment();
      const content = logic.buildHoverContent(comment);
      expect(content.title).toContain('[MEDIUM]');
      expect(content.message).toBe(comment.message);
      expect(content.severity).toBe('medium');
      expect(content.category).toBeDefined();
    });

    it('includes severity prefix in title', () => {
      const comment = makeComment({ severity: 'critical' });
      const content = logic.buildHoverContent(comment);
      expect(content.title).toContain('[CRITICAL]');
    });

    it('uses title as fallback when title is empty', () => {
      const comment = makeComment({ title: '', message: 'only message' });
      const content = logic.buildHoverContent(comment);
      expect(content.title).toContain('only message');
    });

    it('categorizes complexity issues as maintainability', () => {
      const comment = makeComment({ message: 'High cyclomatic complexity detected' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('maintainability');
    });

    it('categorizes security issues as security', () => {
      const comment = makeComment({ message: 'Potential SQL injection vulnerability' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('security');
    });

    it('categorizes performance issues as performance', () => {
      const comment = makeComment({ message: 'Performance bottleneck in loop' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('performance');
    });

    it('categorizes naming issues as code-style', () => {
      const comment = makeComment({ message: 'Variable naming convention violation' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('code-style');
    });

    it('categorizes error handling issues as reliability', () => {
      const comment = makeComment({ message: 'Unhandled exception possible' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('reliability');
    });

    it('categorizes coupling issues as architecture', () => {
      const comment = makeComment({ message: 'High coupling between modules' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('architecture');
    });

    it('categorizes test issues as testing', () => {
      const comment = makeComment({ message: 'Missing test coverage for edge case' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('testing');
    });

    it('categorizes unknown issues as general', () => {
      const comment = makeComment({ message: 'Some random message' });
      const content = logic.buildHoverContent(comment);
      expect(content.category).toBe('general');
    });

    it('derives suggestion for complexity issues', () => {
      const comment = makeComment({ message: 'High cyclomatic complexity' });
      const content = logic.buildHoverContent(comment);
      expect(content.suggestion).toContain('smaller functions');
    });

    it('derives suggestion for security issues', () => {
      const comment = makeComment({ message: 'SQL injection risk' });
      const content = logic.buildHoverContent(comment);
      expect(content.suggestion).toContain('sanitization');
    });

    it('derives suggestion for naming issues', () => {
      const comment = makeComment({ message: 'Naming convention' });
      const content = logic.buildHoverContent(comment);
      expect(content.suggestion).toContain('naming convention');
    });

    it('derives suggestion for performance issues', () => {
      const comment = makeComment({ message: 'Performance optimize' });
      const content = logic.buildHoverContent(comment);
      expect(content.suggestion).toContain('Profile');
    });

    it('derives suggestion for coupling issues', () => {
      const comment = makeComment({ message: 'Tight coupling dependency' });
      const content = logic.buildHoverContent(comment);
      expect(content.suggestion).toContain('dependency injection');
    });

    it('derives suggestion for error handling issues', () => {
      const comment = makeComment({ message: 'Error exception unhandled' });
      const content = logic.buildHoverContent(comment);
      expect(content.suggestion).toContain('error handling');
    });

    it('returns no suggestion for unrecognized patterns', () => {
      const comment = makeComment({ message: 'blah blah blah' });
      const content = logic.buildHoverContent(comment);
      expect(content.suggestion).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getCodeLensActions
  // -------------------------------------------------------------------------

  describe('getCodeLensActions', () => {
    it('includes Fix action for critical severity', () => {
      const comment = makeComment({ severity: 'critical' });
      const actions = logic.getCodeLensActions(comment);
      expect(actions.some((a) => a.title.includes('Fix'))).toBe(true);
    });

    it('includes Fix action for high severity', () => {
      const comment = makeComment({ severity: 'high' });
      const actions = logic.getCodeLensActions(comment);
      expect(actions.some((a) => a.title.includes('Fix'))).toBe(true);
    });

    it('does NOT include Fix action for medium severity', () => {
      const comment = makeComment({ severity: 'medium' });
      const actions = logic.getCodeLensActions(comment);
      expect(actions.some((a) => a.title.includes('Fix'))).toBe(false);
    });

    it('includes Ignore action for medium severity', () => {
      const comment = makeComment({ severity: 'medium' });
      const actions = logic.getCodeLensActions(comment);
      expect(actions.some((a) => a.title.includes('Ignore'))).toBe(true);
    });

    it('includes Ignore action for low severity', () => {
      const comment = makeComment({ severity: 'low' });
      const actions = logic.getCodeLensActions(comment);
      expect(actions.some((a) => a.title.includes('Ignore'))).toBe(true);
    });

    it('includes Ignore action for info severity', () => {
      const comment = makeComment({ severity: 'info' });
      const actions = logic.getCodeLensActions(comment);
      expect(actions.some((a) => a.title.includes('Ignore'))).toBe(true);
    });

    it('includes Explain action for all severities', () => {
      const severities: DecorationSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
      for (const sev of severities) {
        const comment = makeComment({ severity: sev });
        const actions = logic.getCodeLensActions(comment);
        expect(actions.some((a) => a.title.includes('Explain'))).toBe(true);
      }
    });

    it('uses correct command identifiers', () => {
      const comment = makeComment({ severity: 'critical' });
      const actions = logic.getCodeLensActions(comment);
      for (const action of actions) {
        expect(action.command).toMatch(/^code-analyzer\./);
        expect(action.tooltip).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // filterByMinSeverity
  // -------------------------------------------------------------------------

  describe('filterByMinSeverity', () => {
    const comments = [
      makeComment({ severity: 'critical', title: 'c1' }),
      makeComment({ severity: 'high', title: 'c2' }),
      makeComment({ severity: 'medium', title: 'c3' }),
      makeComment({ severity: 'low', title: 'c4' }),
      makeComment({ severity: 'info', title: 'c5' }),
    ];

    it('filters by critical — keeps only critical', () => {
      const filtered = logic.filterByMinSeverity(comments, 'critical');
      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('c1');
    });

    it('filters by high — keeps critical and high', () => {
      const filtered = logic.filterByMinSeverity(comments, 'high');
      expect(filtered.length).toBe(2);
    });

    it('filters by medium — keeps critical, high, medium', () => {
      const filtered = logic.filterByMinSeverity(comments, 'medium');
      expect(filtered.length).toBe(3);
    });

    it('filters by low — keeps 4', () => {
      const filtered = logic.filterByMinSeverity(comments, 'low');
      expect(filtered.length).toBe(4);
    });

    it('filters by info — keeps all', () => {
      const filtered = logic.filterByMinSeverity(comments, 'info');
      expect(filtered.length).toBe(5);
    });

    it('returns empty array for empty input', () => {
      const filtered = logic.filterByMinSeverity([], 'medium');
      expect(filtered).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getSeverityBadgeSvg
  // -------------------------------------------------------------------------

  describe('getSeverityBadgeSvg', () => {
    it('returns valid SVG string for critical', () => {
      const svg = logic.getSeverityBadgeSvg('critical');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('#f44747');
    });

    it('returns valid SVG string for high', () => {
      const svg = logic.getSeverityBadgeSvg('high');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('#e2a23b');
    });

    it('returns valid SVG string for medium', () => {
      const svg = logic.getSeverityBadgeSvg('medium');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('#4ec9b0');
    });

    it('returns valid SVG string for low', () => {
      const svg = logic.getSeverityBadgeSvg('low');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('returns valid SVG string for info', () => {
      const svg = logic.getSeverityBadgeSvg('info');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('badge contains severity text', () => {
      const svg = logic.getSeverityBadgeSvg('critical');
      expect(svg.toUpperCase()).toContain('CRITICAL');
    });

    it('is consistent across calls', () => {
      const svg1 = logic.getSeverityBadgeSvg('high');
      const svg2 = logic.getSeverityBadgeSvg('high');
      expect(svg1).toBe(svg2);
    });
  });

  // -------------------------------------------------------------------------
  // getGutterIconSvg
  // -------------------------------------------------------------------------

  describe('getGutterIconSvg', () => {
    it('returns valid SVG for all severities', () => {
      const severities: DecorationSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
      for (const sev of severities) {
        const svg = logic.getGutterIconSvg(sev);
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
        expect(svg).toContain('<circle');
      }
    });

    it('uses severity-specific colors', () => {
      const criticalSvg = logic.getGutterIconSvg('critical');
      const infoSvg = logic.getGutterIconSvg('info');
      expect(criticalSvg).toContain('#f44747');
      expect(infoSvg).toContain('#808080');
    });

    it('is consistent across calls', () => {
      const svg1 = logic.getGutterIconSvg('medium');
      const svg2 = logic.getGutterIconSvg('medium');
      expect(svg1).toBe(svg2);
    });
  });

  // -------------------------------------------------------------------------
  // groupDecorationsByFile
  // -------------------------------------------------------------------------

  describe('groupDecorationsByFile', () => {
    it('groups comments by file path', () => {
      const comments = [
        makeComment({ path: 'src/a.ts', startLine: 10 }),
        makeComment({ path: 'src/a.ts', startLine: 20 }),
        makeComment({ path: 'src/b.ts', startLine: 5 }),
      ];
      const groups = logic.groupDecorationsByFile(comments);
      expect(groups.size).toBe(2);
      expect(groups.get('src/a.ts')?.length).toBe(2);
      expect(groups.get('src/b.ts')?.length).toBe(1);
    });

    it('returns empty map for empty array', () => {
      const groups = logic.groupDecorationsByFile([]);
      expect(groups.size).toBe(0);
    });

    it('includes correct line numbers (0-based)', () => {
      const comments = [makeComment({ path: 'src/x.ts', startLine: 42 })];
      const groups = logic.groupDecorationsByFile(comments);
      const group = groups.get('src/x.ts');
      expect(group?.[0].line).toBe(41); // startLine - 1
    });

    it('each group entry has config and comment', () => {
      const comments = [makeComment({ path: 'src/x.ts' })];
      const groups = logic.groupDecorationsByFile(comments);
      const group = groups.get('src/x.ts');
      expect(group?.[0]).toHaveProperty('config');
      expect(group?.[0]).toHaveProperty('comment');
    });

    it('handles missing severity gracefully', () => {
      const comments = [makeComment({ severity: undefined as any })];
      const groups = logic.groupDecorationsByFile(comments);
      expect(groups.size).toBe(1);
      const group = groups.get('src/test.ts');
      expect(group?.[0].config.severity).toBe('info');
    });
  });

  // -------------------------------------------------------------------------
  // buildHoverMarkdown
  // -------------------------------------------------------------------------

  describe('buildHoverMarkdown', () => {
    it('returns a markdown string', () => {
      const content: HoverContent = {
        title: 'Test',
        message: 'A test message',
        severity: 'medium',
        category: 'testing',
      };
      const md = logic.buildHoverMarkdown(content);
      expect(md).toContain('Test');
      expect(md).toContain('A test message');
      expect(md).toContain('testing');
    });

    it('includes suggestion when provided', () => {
      const content: HoverContent = {
        title: 'Test',
        message: 'message',
        severity: 'high',
        category: 'security',
        suggestion: 'Use parameterized queries',
      };
      const md = logic.buildHoverMarkdown(content);
      expect(md).toContain('parameterized queries');
      expect(md).toContain('💡');
    });

    it('does not include suggestion section when absent', () => {
      const content: HoverContent = {
        title: 'Test',
        message: 'message',
        severity: 'low',
        category: 'general',
      };
      const md = logic.buildHoverMarkdown(content);
      expect(md).not.toContain('💡');
    });

    it('includes severity badge as base64 data URI', () => {
      const content: HoverContent = {
        title: 'Test',
        message: 'message',
        severity: 'critical',
        category: 'security',
      };
      const md = logic.buildHoverMarkdown(content);
      expect(md).toContain('data:image/svg+xml;base64,');
    });
  });
});
