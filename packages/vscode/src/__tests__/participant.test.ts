// @code-analyzer/vscode — Chat Participant Tests

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CodeAnalyzerChatParticipant,
} from '../participant/code-analyzer-participant.js';
import type {
  ChatRequest,
  ChatContext,
  ChatResponseStream,
  CancellationToken,
  ClassifiedIntent,
  SlashCommand,
} from '../participant/code-analyzer-participant.js';
import { EngineBridge } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(): ChatResponseStream & { content: string } {
  const state = { content: '' };
  return {
    markdown(value: string) {
      state.content += value;
    },
    get content() {
      return state.content;
    },
    get length() {
      return state.content.length;
    },
  };
}

function makeRequest(prompt: string, command?: string): ChatRequest {
  return { prompt, command };
}

function makeContext(): ChatContext {
  return { history: [] };
}

function makeToken(cancelled = false): CancellationToken {
  return { isCancellationRequested: cancelled };
}

// ---------------------------------------------------------------------------
// Intent Classification
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Intent Classification', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  // -------------------------------------------------------------------------
  // Explore intent
  // -------------------------------------------------------------------------

  describe('explore', () => {
    it('classifies "how does X work" as explore', () => {
      const intent = participant.classifyIntent('how does auth work');
      expect(intent.type).toBe('explore');
      expect(intent.entity).toBe('auth');
    });

    it('classifies "explain X" as explore', () => {
      const intent = participant.classifyIntent('explain the login function');
      expect(intent.type).toBe('explore');
      expect(intent.entity).toBe('the login function');
    });

    it('classifies "what is X" as explore', () => {
      const intent = participant.classifyIntent('what is UserService');
      expect(intent.type).toBe('explore');
      expect(intent.entity).toBe('UserService');
    });

    it('classifies "tell me about X" as explore', () => {
      const intent = participant.classifyIntent(
        'tell me about the database module',
      );
      expect(intent.type).toBe('explore');
      expect(intent.entity).toBe('the database module');
    });

    it('classifies "describe X" as explore', () => {
      const intent = participant.classifyIntent('describe the caching layer');
      expect(intent.type).toBe('explore');
    });

    it('classifies "document X" as explore', () => {
      const intent = participant.classifyIntent('document the API endpoints');
      expect(intent.type).toBe('explore');
      expect(intent.entity).toBe('the API endpoints');
    });

    it('classifies "show me X" as explore', () => {
      const intent = participant.classifyIntent('show me the login flow');
      expect(intent.type).toBe('explore');
      expect(intent.entity).toBe('the login flow');
    });
  });

  // -------------------------------------------------------------------------
  // Search intent
  // -------------------------------------------------------------------------

  describe('search', () => {
    it('classifies "find X" as search', () => {
      const intent = participant.classifyIntent('find all controllers');
      expect(intent.type).toBe('search');
      expect(intent.entity).toBe('all controllers');
    });

    it('classifies "search for X" as search', () => {
      const intent = participant.classifyIntent('search for database models');
      expect(intent.type).toBe('search');
      expect(intent.entity).toBe('database models');
    });

    it('classifies "search X" (no "for") as search', () => {
      const intent = participant.classifyIntent('search UserService');
      expect(intent.type).toBe('search');
    });

    it('classifies "where is X" as search', () => {
      const intent = participant.classifyIntent('where is the config file');
      expect(intent.type).toBe('search');
      expect(intent.entity).toBe('the config file');
    });

    it('classifies "look for X" as search', () => {
      const intent = participant.classifyIntent('look for authentication');
      expect(intent.type).toBe('search');
      expect(intent.entity).toBe('authentication');
    });

    it('classifies "locate X" as search', () => {
      const intent = participant.classifyIntent('locate the main router');
      expect(intent.type).toBe('search');
    });
  });

  // -------------------------------------------------------------------------
  // Review intent
  // -------------------------------------------------------------------------

  describe('review', () => {
    it('classifies "review my changes" as review', () => {
      const intent = participant.classifyIntent('review my changes');
      expect(intent.type).toBe('review');
    });

    it('classifies "review code" as review', () => {
      const intent = participant.classifyIntent('review code');
      expect(intent.type).toBe('review');
    });

    it('classifies "code review" as review', () => {
      const intent = participant.classifyIntent('code review');
      expect(intent.type).toBe('review');
    });

    it('classifies "check this code" as review', () => {
      const intent = participant.classifyIntent('check this code');
      expect(intent.type).toBe('review');
    });

    it('classifies "audit my changes" as review', () => {
      const intent = participant.classifyIntent('audit my changes');
      expect(intent.type).toBe('review');
    });

    it('classifies "inspect my changes" as review', () => {
      const intent = participant.classifyIntent('inspect my changes');
      expect(intent.type).toBe('review');
    });
  });

  // -------------------------------------------------------------------------
  // Impact intent
  // -------------------------------------------------------------------------

  describe('impact', () => {
    it('classifies "what breaks if X" as impact', () => {
      const intent = participant.classifyIntent(
        'what breaks if I change User.getId',
      );
      expect(intent.type).toBe('impact');
      expect(intent.entity).toContain('change');
    });

    it('classifies "impact of changing X" as impact', () => {
      const intent = participant.classifyIntent(
        'impact of changing the database schema',
      );
      expect(intent.type).toBe('impact');
    });

    it('classifies "what depends on X" as impact', () => {
      const intent = participant.classifyIntent(
        'what depends on AuthService',
      );
      expect(intent.type).toBe('impact');
      expect(intent.entity).toBe('AuthService');
    });

    it('classifies "affected by X" as impact', () => {
      const intent = participant.classifyIntent(
        'affected by the config change',
      );
      expect(intent.type).toBe('impact');
    });

    it('classifies "consequences of X" as impact', () => {
      const intent = participant.classifyIntent(
        'consequences of removing the cache',
      );
      expect(intent.type).toBe('impact');
    });

    it('classifies "risk of changing X" as impact', () => {
      const intent = participant.classifyIntent(
        'risk of changing the payment module',
      );
      expect(intent.type).toBe('impact');
    });
  });

  // -------------------------------------------------------------------------
  // Debug intent
  // -------------------------------------------------------------------------

  describe('debug', () => {
    it('classifies "why is X failing" as debug', () => {
      const intent = participant.classifyIntent(
        'why is the auth service failing',
      );
      expect(intent.type).toBe('debug');
      expect(intent.entity).toBe('the auth service');
    });

    it('classifies "debug X" as debug', () => {
      const intent = participant.classifyIntent('debug the login flow');
      expect(intent.type).toBe('debug');
      expect(intent.entity).toBe('the login flow');
    });

    it('classifies "fix X" as debug', () => {
      const intent = participant.classifyIntent('fix the null pointer error');
      expect(intent.type).toBe('debug');
    });

    it('classifies "what\'s wrong with X" as debug', () => {
      const intent = participant.classifyIntent(
        "what's wrong with this endpoint",
      );
      expect(intent.type).toBe('debug');
    });

    it('classifies "error in X" as debug', () => {
      const intent = participant.classifyIntent(
        'error in the build pipeline',
      );
      expect(intent.type).toBe('debug');
    });

    it('classifies "bug in X" as debug', () => {
      const intent = participant.classifyIntent('bug in the login handler');
      expect(intent.type).toBe('debug');
    });
  });

  // -------------------------------------------------------------------------
  // Refactor intent
  // -------------------------------------------------------------------------

  describe('refactor', () => {
    it('classifies "refactor X" as refactor', () => {
      const intent = participant.classifyIntent('refactor the UserService');
      expect(intent.type).toBe('refactor');
      expect(intent.entity).toBe('the UserService');
    });

    it('classifies "rename X to Y" as refactor', () => {
      const intent = participant.classifyIntent(
        'rename getCwd to getCurrentWorkingDirectory',
      );
      expect(intent.type).toBe('refactor');
    });

    it('classifies "extract X" as refactor', () => {
      const intent = participant.classifyIntent(
        'extract the validation logic',
      );
      expect(intent.type).toBe('refactor');
    });

    it('classifies "optimize X" as refactor', () => {
      const intent = participant.classifyIntent('optimize the search query');
      expect(intent.type).toBe('refactor');
    });

    it('classifies "improve X" as refactor', () => {
      const intent = participant.classifyIntent(
        'improve error handling',
      );
      expect(intent.type).toBe('refactor');
    });

    it('classifies "clean up X" as refactor', () => {
      const intent = participant.classifyIntent(
        'clean up the old API layer',
      );
      expect(intent.type).toBe('refactor');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty prompt', () => {
      const intent = participant.classifyIntent('');
      expect(intent.type).toBe('search');
      expect(intent.confidence).toBe(0);
    });

    it('handles whitespace-only prompt', () => {
      const intent = participant.classifyIntent('   ');
      expect(intent.type).toBe('search');
      expect(intent.confidence).toBe(0);
    });

    it('defaults to search for unrecognized prompts', () => {
      const intent = participant.classifyIntent('some random text here');
      expect(intent.type).toBe('search');
      expect(intent.confidence).toBe(0.3);
    });

    it('sets query for default search intent', () => {
      const intent = participant.classifyIntent('just browsing');
      expect(intent.query).toBe('just browsing');
    });

    it('has high confidence for matched patterns', () => {
      const intent = participant.classifyIntent('how does auth work');
      expect(intent.confidence).toBe(0.9);
    });

    it('handles very long prompts', () => {
      const longPrompt = 'explain ' + 'the '.repeat(100) + 'UserService';
      const intent = participant.classifyIntent(longPrompt);
      expect(intent.type).toBe('explore');
    });

    it('handles prompt with special characters', () => {
      const intent = participant.classifyIntent(
        'how does $specialVar work?',
      );
      expect(intent.type).toBe('explore');
    });

    it('is case-insensitive', () => {
      const intent = participant.classifyIntent('FIND AuthService');
      expect(intent.type).toBe('search');
    });

    it('matches first applicable pattern', () => {
      // "review" comes before "find" in the pattern list
      const intent = participant.classifyIntent(
        'review my changes and find bugs',
      );
      expect(intent.type).toBe('review');
    });
  });
});

// ---------------------------------------------------------------------------
// Context Message Building
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Context Building', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  it('includes intent type in message', () => {
    const intent: ClassifiedIntent = { type: 'explore', confidence: 0.9 };
    const msg = participant.buildContextMessage(intent, {});
    expect(msg).toContain('## Code Analyzer Context');
    expect(msg).toContain('**Intent:** explore');
  });

  it('includes search results section', () => {
    const intent: ClassifiedIntent = { type: 'search', confidence: 0.9 };
    const ctx = {
      searchResults: [
        { name: 'UserService', filePath: 'src/services/user.ts', label: 'Class' },
        { name: 'login', filePath: 'src/auth/login.ts', label: 'Function' },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Relevant Symbols');
    expect(msg).toContain('UserService');
    expect(msg).toContain('src/services/user.ts');
    expect(msg).toContain('login');
  });

  it('includes review comments section', () => {
    const intent: ClassifiedIntent = { type: 'review', confidence: 0.9 };
    const ctx = {
      reviewComments: [
        {
          severity: 'high',
          title: 'Missing error handling',
          path: 'src/auth.ts',
          startLine: 42,
        },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Review Findings');
    expect(msg).toContain('high');
    expect(msg).toContain('Missing error handling');
    expect(msg).toContain('src/auth.ts:42');
  });

  it('limits search results to 10', () => {
    const intent: ClassifiedIntent = { type: 'search', confidence: 0.9 };
    const ctx = {
      searchResults: Array.from({ length: 20 }, (_, i) => ({
        name: `Symbol${i}`,
        filePath: `src/file${i}.ts`,
        label: 'Function',
      })),
    };
    const msg = participant.buildContextMessage(intent, ctx);
    // Should only show first 10
    expect(msg).toContain('Symbol9');
    expect(msg).not.toContain('Symbol10');
  });

  it('includes impact analysis section', () => {
    const intent: ClassifiedIntent = { type: 'impact', confidence: 0.9 };
    const ctx = {
      impact: { riskLevel: 'high', affectedSymbols: 15 },
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Impact Analysis');
    expect(msg).toContain('Risk Level: high');
    expect(msg).toContain('Affected Symbols: 15');
  });

  it('includes call trace section', () => {
    const intent: ClassifiedIntent = { type: 'debug', confidence: 0.9 };
    const ctx = {
      traceResults: [
        { name: 'login', filePath: 'src/auth/login.ts' },
        { name: 'verifyToken', filePath: 'src/auth/tokens.ts' },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Call Trace');
    expect(msg).toContain('login');
    expect(msg).toContain('verifyToken');
  });

  it('includes implementations section', () => {
    const intent: ClassifiedIntent = { type: 'refactor', confidence: 0.9 };
    const ctx = {
      implementations: [
        { name: 'UserRepoImpl', filePath: 'src/db/user-repo.ts' },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Implementations');
    expect(msg).toContain('UserRepoImpl');
  });

  it('includes callers section', () => {
    const intent: ClassifiedIntent = { type: 'refactor', confidence: 0.9 };
    const ctx = {
      callers: [
        { name: 'UserController', filePath: 'src/api/user.ts' },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Callers');
    expect(msg).toContain('UserController');
  });

  it('includes symbols section', () => {
    const intent: ClassifiedIntent = { type: 'explore', confidence: 0.9 };
    const ctx = {
      symbols: [
        { name: 'handleLogin', filePath: 'src/auth.ts' },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Found Symbols');
    expect(msg).toContain('handleLogin');
  });

  it('includes changed symbols section', () => {
    const intent: ClassifiedIntent = { type: 'impact', confidence: 0.9 };
    const ctx = {
      changedSymbols: [
        { name: 'Config', riskLevel: 'high' },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Changed Symbols');
    expect(msg).toContain('Config');
    expect(msg).toContain('risk: high');
  });

  it('includes changed files section', () => {
    const intent: ClassifiedIntent = { type: 'review', confidence: 0.9 };
    const ctx = {
      changedFiles: [
        { path: 'src/auth.ts', status: 'modified' },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Changed Files');
    expect(msg).toContain('src/auth.ts');
    expect(msg).toContain('modified');
  });

  it('handles empty context gracefully', () => {
    const intent: ClassifiedIntent = { type: 'search', confidence: 0.9 };
    const msg = participant.buildContextMessage(intent, {});
    expect(msg).toContain('## Code Analyzer Context');
    // Should not have empty sections
    expect(msg.split('###').length).toBe(1); // Only header, no subsections
  });
});

// ---------------------------------------------------------------------------
// handleRequest
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — handleRequest', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    engine.setProjectId('test');
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  it('returns cancelled result when token is cancelled', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('find login'),
      makeContext(),
      stream,
      makeToken(true),
    );
    expect(result.metadata).toEqual({ cancelled: true });
    expect(stream.content).toBe('');
  });

  it('streams markdown content for valid request', async () => {
    const stream = makeStream();
    await participant.handleRequest(
      makeRequest('find login'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(stream.length).toBeGreaterThan(0);
  });

  it('includes intent metadata in result', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('how does auth work'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata).toHaveProperty('intent');
    expect(result.metadata?.intent).toBe('explore');
  });

  it('handles review request', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('review my changes'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.intent).toBe('review');
    expect(stream.length).toBeGreaterThan(0);
  });

  it('handles debug request', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('why is login failing'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.intent).toBe('debug');
  });
});

// ---------------------------------------------------------------------------
// Slash Command Tests
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Slash Commands', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    engine.setProjectId('test');
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  // -------------------------------------------------------------------------
  // /review
  // -------------------------------------------------------------------------

  describe('/review', () => {
    it('returns metadata for review command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'review', '', stream, makeToken(false),
      );
      expect(result.metadata?.command).toBe('review');
      expect(result.metadata).toHaveProperty('issuesFound');
      expect(result.metadata).toHaveProperty('filesChanged');
    });

    it('streams markdown content for review', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'review', '', stream, makeToken(false),
      );
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Code Review');
    });

    it('handles review via handleRequest with command field', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('', 'review'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('review');
    });

    it('handles review from prompt text "/review"', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/review'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('review');
    });
  });

  // -------------------------------------------------------------------------
  // /explain
  // -------------------------------------------------------------------------

  describe('/explain', () => {
    it('returns metadata for explain command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'explain', 'UserService', stream, makeToken(false),
      );
      expect(result.metadata?.command).toBe('explain');
      expect(result.metadata?.symbol).toBe('UserService');
    });

    it('streams explanation content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'explain', 'UserService', stream, makeToken(false),
      );
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Symbol Explanation');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'explain', '', stream, makeToken(false),
      );
      expect(result.metadata?.error).toBe('missing_params');
      expect(stream.content).toContain('Usage');
    });

    it('handles explain from prompt text "/explain auth"', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/explain auth'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('explain');
    });
  });

  // -------------------------------------------------------------------------
  // /impact
  // -------------------------------------------------------------------------

  describe('/impact', () => {
    it('returns metadata for impact command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'impact', 'Database', stream, makeToken(false),
      );
      expect(result.metadata?.command).toBe('impact');
      expect(result.metadata?.symbol).toBe('Database');
    });

    it('streams impact analysis content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'impact', 'Database', stream, makeToken(false),
      );
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Impact Analysis');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'impact', '', stream, makeToken(false),
      );
      expect(result.metadata?.error).toBe('missing_params');
      expect(stream.content).toContain('Usage');
    });

    it('handles impact from prompt "/impact CacheService"', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/impact CacheService'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('impact');
    });
  });

  // -------------------------------------------------------------------------
  // /find
  // -------------------------------------------------------------------------

  describe('/find', () => {
    it('returns metadata for find command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'find', 'login', stream, makeToken(false),
      );
      expect(result.metadata?.command).toBe('find');
      expect(result.metadata?.query).toBe('login');
    });

    it('streams search results content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'find', 'login', stream, makeToken(false),
      );
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Search Results');
    });

    it('handles empty query gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'find', '', stream, makeToken(false),
      );
      expect(result.metadata?.error).toBe('missing_params');
    });

    it('handles find from prompt "/find UserService"', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/find UserService'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('find');
    });
  });

  // -------------------------------------------------------------------------
  // /deps
  // -------------------------------------------------------------------------

  describe('/deps', () => {
    it('returns metadata for deps command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'deps', 'UserService', stream, makeToken(false),
      );
      expect(result.metadata?.command).toBe('deps');
      expect(result.metadata?.symbol).toBe('UserService');
    });

    it('streams dependency graph content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'deps', 'UserService', stream, makeToken(false),
      );
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Dependency Graph');
    });

    it('shows upstream and downstream sections', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'deps', 'UserService', stream, makeToken(false),
      );
      expect(stream.content).toContain('Upstream');
      expect(stream.content).toContain('Downstream');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'deps', '', stream, makeToken(false),
      );
      expect(result.metadata?.error).toBe('missing_params');
    });

    it('handles deps from prompt "/deps AuthService"', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/deps AuthService'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('deps');
    });
  });

  // -------------------------------------------------------------------------
  // /refactor
  // -------------------------------------------------------------------------

  describe('/refactor', () => {
    it('returns metadata for refactor command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'refactor', 'UserService', stream, makeToken(false),
      );
      expect(result.metadata?.command).toBe('refactor');
      expect(result.metadata).toHaveProperty('opportunitiesCount');
    });

    it('streams refactoring content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'refactor', 'UserService', stream, makeToken(false),
      );
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Refactoring');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'refactor', '', stream, makeToken(false),
      );
      expect(result.metadata?.error).toBe('missing_params');
    });

    it('handles refactor from prompt "/refactor BigFunction"', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/refactor BigFunction'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('refactor');
    });
  });

  // -------------------------------------------------------------------------
  // /test
  // -------------------------------------------------------------------------

  describe('/test', () => {
    it('returns metadata for test command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'test', 'UserService', stream, makeToken(false),
      );
      expect(result.metadata?.command).toBe('test');
      expect(result.metadata).toHaveProperty('testCount');
      expect(result.metadata).toHaveProperty('gapsCount');
    });

    it('streams test coverage content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'test', 'UserService', stream, makeToken(false),
      );
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Test Coverage');
    });

    it('shows existing tests and coverage gaps sections', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand(
        'test', 'UserService', stream, makeToken(false),
      );
      expect(stream.content).toContain('Existing Tests');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'test', '', stream, makeToken(false),
      );
      expect(result.metadata?.error).toBe('missing_params');
    });

    it('handles test from prompt "/test AuthService"', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/test AuthService'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('test');
    });
  });

  // -------------------------------------------------------------------------
  // Slash Command Edge Cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles cancelled token for slash command', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'review', '', stream, makeToken(true),
      );
      expect(result.metadata).toEqual({ cancelled: true });
      expect(stream.content).toBe('');
    });

    it('handles unknown slash command as error', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'unknown' as SlashCommand, '', stream, makeToken(false),
      );
      expect(result.metadata?.error).toBe('unknown_command');
      expect(stream.content).toContain('Unknown Command');
    });

    it('handles slash command with extra whitespace in params', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'explain', '  MySymbol  ', stream, makeToken(false),
      );
      expect(result.metadata?.symbol).toBe('MySymbol');
    });

    it('respects cancellation during slash command execution', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('/review'),
        makeContext(),
        stream,
        makeToken(true),
      );
      expect(result.metadata).toEqual({ cancelled: true });
    });

    it('handleRequest falls back to intent classification for non-slash prompts', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('how does auth work'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.intent).toBe('explore');
    });

    it('handleRequest falls back to intent classification for random text', async () => {
      const stream = makeStream();
      const result = await participant.handleRequest(
        makeRequest('just some text here'),
        makeContext(),
        stream,
        makeToken(false),
      );
      expect(result.metadata?.intent).toBeDefined();
    });
  });
});
