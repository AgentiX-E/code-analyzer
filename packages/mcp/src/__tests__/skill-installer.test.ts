// @ts-nocheck
// @code-analyzer/mcp — Skill Installer Tests

import { describe, it, expect } from 'vitest';
import { SkillInstaller } from '../skills/installer.js';

describe('SkillInstaller', () => {
  let installer: SkillInstaller;

  beforeEach(() => {
    installer = new SkillInstaller();
  });

  describe('detectAgents', () => {
    it('should detect supported agents', () => {
      const agents = installer.detectAgents();

      expect(agents.length).toBeGreaterThan(0);
      expect(agents.some((a) => a.name === 'claude-code')).toBe(true);
      expect(agents.some((a) => a.name === 'codebuddy')).toBe(true);
      expect(agents.some((a) => a.name === 'cursor')).toBe(true);
    });

    it('should not include custom agent', () => {
      const agents = installer.detectAgents();
      expect(agents.some((a) => a.name === 'custom')).toBe(false);
    });

    it('should include valid types', () => {
      const agents = installer.detectAgents();
      const validTypes = [
        'claude-code',
        'cursor',
        'codex',
        'windsurf',
        'codebuddy',
        'aider',
        'continue',
      ];
      expect(agents.every((a) => validTypes.includes(a.type))).toBe(true);
    });

    it('should provide install paths', () => {
      const agents = installer.detectAgents();
      expect(agents.every((a) => a.installPath.length > 0)).toBe(true);
    });
  });

  describe('installSkills', () => {
    it('should install skills for agents', () => {
      const agents = installer.detectAgents().slice(0, 2);
      const results = installer.installSkills(agents, ['exploration']);

      expect(results).toHaveLength(2);
      expect(results[0].skill).toBe('exploration');
      expect(results[0].success).toBe(true);
      expect(results[0].path).toContain('code-analyzer-exploration.md');
    });

    it('should return error for unknown agent', () => {
      const result = installer.installSkills([
        { name: 'unknown-agent', type: 'custom', installPath: '/tmp', skillFormat: 'markdown' },
      ]);

      expect(result[0].success).toBe(false);
      expect(result[0].error).toContain('Unknown agent');
    });

    it('should return error for unknown skill', () => {
      const agents = installer.detectAgents().slice(0, 1);
      const results = installer.installSkills(agents, ['nonexistent-skill']);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Unknown skill');
    });

    it('should install all skills when no filter is given', () => {
      const agents = installer.detectAgents().slice(0, 1);
      const results = installer.installSkills(agents);

      expect(results.length).toBeGreaterThan(5);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should generate correct paths for different agents', () => {
      const claudeAgent = { name: 'claude-code', type: 'claude-code' as const, installPath: '.claude/skills/', skillFormat: 'markdown' as const };
      const cursorAgent = { name: 'cursor', type: 'cursor' as const, installPath: '.cursor/skills/', skillFormat: 'markdown' as const };

      const claudeResults = installer.installSkills([claudeAgent], ['exploration']);
      const cursorResults = installer.installSkills([cursorAgent], ['exploration']);

      expect(claudeResults[0].path).toBe('.claude/skills/code-analyzer-exploration.md');
      expect(cursorResults[0].path).toBe('.cursor/skills/code-analyzer-exploration.md');
    });
  });

  describe('generateRepoSKills', () => {
    it('should generate skills for a project', () => {
      const skills = installer.generateRepoSKills('test-project');

      expect(skills.length).toBeGreaterThan(0);
      expect(skills[0].name).toContain('code-analyzer');
    });

    it('should include project ID in content', () => {
      const skills = installer.generateRepoSKills('my-project');
      const explorationSkill = skills.find((s) => s.name === 'code-analyzer-exploration');

      expect(explorationSkill).toBeDefined();
      expect(explorationSkill!.content).toContain('my-project');
    });

    it('should assign correct categories', () => {
      const skills = installer.generateRepoSKills('test');
      const exploration = skills.find((s) => s.name === 'code-analyzer-exploration');
      const security = skills.find((s) => s.name === 'code-analyzer-security');
      const refactoring = skills.find((s) => s.name === 'code-analyzer-refactoring');

      expect(exploration!.category).toBe('exploration');
      expect(security!.category).toBe('security');
      expect(refactoring!.category).toBe('refactoring');
    });

    it('should include relevant tools for each skill', () => {
      const skills = installer.generateRepoSKills('test');
      const exploration = skills.find((s) => s.name === 'code-analyzer-exploration');

      expect(exploration!.tools.length).toBeGreaterThan(0);
      expect(exploration!.tools).toContain('get_architecture');
      expect(exploration!.tools).toContain('explore_symbol');
    });

    it('should generate all 10 skills', () => {
      const skills = installer.generateRepoSKills('test');
      const skillNames = skills.map((s) => s.name);

      expect(skillNames).toContain('code-analyzer-exploration');
      expect(skillNames).toContain('code-analyzer-debugging');
      expect(skillNames).toContain('code-analyzer-impact');
      expect(skillNames).toContain('code-analyzer-refactoring');
      expect(skillNames).toContain('code-analyzer-review');
      expect(skillNames).toContain('code-analyzer-pr-review');
      expect(skillNames).toContain('code-analyzer-architecture');
      expect(skillNames).toContain('code-analyzer-cross-repo');
      expect(skillNames).toContain('code-analyzer-security');
      expect(skillNames).toContain('code-analyzer-tool-reference');
    });
  });

  describe('getSkillNames', () => {
    it('should return all 10 skill names', () => {
      const names = installer.getSkillNames();
      expect(names).toHaveLength(10);
      expect(names).toContain('exploration');
      expect(names).toContain('debugging');
      expect(names).toContain('tool-reference');
    });
  });

  describe('getSkillContent', () => {
    it('should generate skill content with project ID', () => {
      const content = installer.getSkillContent('exploration', 'my-proj');
      expect(content).toContain('my-proj');
      expect(content).toContain('get_architecture');
    });

    it('should return fallback for unknown skill', () => {
      const content = installer.getSkillContent('unknown', 'test');
      expect(content).toContain('Skill template for unknown');
    });
  });
});
