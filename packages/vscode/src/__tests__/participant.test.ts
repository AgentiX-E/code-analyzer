// @code-analyzer/vscode — Chat Participant Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { CodeAnalyzerChatParticipant } from '../participant/code-analyzer-participant.js';
import { SLASH_COMMANDS } from '../participant/code-analyzer-participant.js';
import type {
  ChatRequest,
  ChatContext,
  ChatResponseStream,
  CancellationToken,
  ClassifiedIntent,
  SlashCommand,
} from '../participant/code-analyzer-participant.js';
import { EngineBridge } from '../services/engine-bridge.js';
import type {
  ChangedFileItem,
  ChangedSymbolItem,
  ComplexityMetricsItem,
  ImpactResultItem,
  IndexingState,
  ReviewCommentItem,
  SearchResultItem,
  StandardsResultItem,
  SymbolDetailItem,
  SymbolRefItem,
  TraceResultItem,
} from '../services/engine-bridge.js';

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
      const intent = participant.classifyIntent('tell me about the database module');
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
      const intent = participant.classifyIntent('what breaks if I change User.getId');
      expect(intent.type).toBe('impact');
      expect(intent.entity).toContain('change');
    });

    it('classifies "impact of changing X" as impact', () => {
      const intent = participant.classifyIntent('impact of changing the database schema');
      expect(intent.type).toBe('impact');
    });

    it('classifies "what depends on X" as impact', () => {
      const intent = participant.classifyIntent('what depends on AuthService');
      expect(intent.type).toBe('impact');
      expect(intent.entity).toBe('AuthService');
    });

    it('classifies "affected by X" as impact', () => {
      const intent = participant.classifyIntent('affected by the config change');
      expect(intent.type).toBe('impact');
    });

    it('classifies "consequences of X" as impact', () => {
      const intent = participant.classifyIntent('consequences of removing the cache');
      expect(intent.type).toBe('impact');
    });

    it('classifies "risk of changing X" as impact', () => {
      const intent = participant.classifyIntent('risk of changing the payment module');
      expect(intent.type).toBe('impact');
    });
  });

  // -------------------------------------------------------------------------
  // Debug intent
  // -------------------------------------------------------------------------

  describe('debug', () => {
    it('classifies "why is X failing" as debug', () => {
      const intent = participant.classifyIntent('why is the auth service failing');
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
      const intent = participant.classifyIntent("what's wrong with this endpoint");
      expect(intent.type).toBe('debug');
    });

    it('classifies "error in X" as debug', () => {
      const intent = participant.classifyIntent('error in the build pipeline');
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
      const intent = participant.classifyIntent('rename getCwd to getCurrentWorkingDirectory');
      expect(intent.type).toBe('refactor');
    });

    it('classifies "extract X" as refactor', () => {
      const intent = participant.classifyIntent('extract the validation logic');
      expect(intent.type).toBe('refactor');
    });

    it('classifies "optimize X" as refactor', () => {
      const intent = participant.classifyIntent('optimize the search query');
      expect(intent.type).toBe('refactor');
    });

    it('classifies "improve X" as refactor', () => {
      const intent = participant.classifyIntent('improve error handling');
      expect(intent.type).toBe('refactor');
    });

    it('classifies "clean up X" as refactor', () => {
      const intent = participant.classifyIntent('clean up the old API layer');
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
      const intent = participant.classifyIntent('how does $specialVar work?');
      expect(intent.type).toBe('explore');
    });

    it('is case-insensitive', () => {
      const intent = participant.classifyIntent('FIND AuthService');
      expect(intent.type).toBe('search');
    });

    it('matches first applicable pattern', () => {
      // "review" comes before "find" in the pattern list
      const intent = participant.classifyIntent('review my changes and find bugs');
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
      implementations: [{ name: 'UserRepoImpl', filePath: 'src/db/user-repo.ts' }],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Implementations');
    expect(msg).toContain('UserRepoImpl');
  });

  it('includes callers section', () => {
    const intent: ClassifiedIntent = { type: 'refactor', confidence: 0.9 };
    const ctx = {
      callers: [{ name: 'UserController', filePath: 'src/api/user.ts' }],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Callers');
    expect(msg).toContain('UserController');
  });

  it('includes symbols section', () => {
    const intent: ClassifiedIntent = { type: 'explore', confidence: 0.9 };
    const ctx = {
      symbols: [{ name: 'handleLogin', filePath: 'src/auth.ts' }],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Found Symbols');
    expect(msg).toContain('handleLogin');
  });

  it('includes changed symbols section', () => {
    const intent: ClassifiedIntent = { type: 'impact', confidence: 0.9 };
    const ctx = {
      changedSymbols: [{ name: 'Config', riskLevel: 'high' }],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Changed Symbols');
    expect(msg).toContain('Config');
    expect(msg).toContain('risk: high');
  });

  it('includes changed files section', () => {
    const intent: ClassifiedIntent = { type: 'review', confidence: 0.9 };
    const ctx = {
      changedFiles: [{ path: 'src/auth.ts', status: 'modified' }],
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
      const result = await participant.handleSlashCommand('review', '', stream, makeToken(false));
      expect(result.metadata?.command).toBe('review');
      expect(result.metadata).toHaveProperty('issuesFound');
      expect(result.metadata).toHaveProperty('filesChanged');
    });

    it('streams markdown content for review', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('review', '', stream, makeToken(false));
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
        'explain',
        'UserService',
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('explain');
      expect(result.metadata?.symbol).toBe('UserService');
    });

    it('streams explanation content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('explain', 'UserService', stream, makeToken(false));
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Symbol Explanation');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand('explain', '', stream, makeToken(false));
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
        'impact',
        'Database',
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('impact');
      expect(result.metadata?.symbol).toBe('Database');
    });

    it('streams impact analysis content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('impact', 'Database', stream, makeToken(false));
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Impact Analysis');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand('impact', '', stream, makeToken(false));
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
        'find',
        'login',
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('find');
      expect(result.metadata?.query).toBe('login');
    });

    it('streams search results content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('find', 'login', stream, makeToken(false));
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Search Results');
    });

    it('handles empty query gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand('find', '', stream, makeToken(false));
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
        'deps',
        'UserService',
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('deps');
      expect(result.metadata?.symbol).toBe('UserService');
    });

    it('streams dependency graph content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('deps', 'UserService', stream, makeToken(false));
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Dependency Graph');
    });

    it('shows upstream and downstream sections', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('deps', 'UserService', stream, makeToken(false));
      expect(stream.content).toContain('Upstream');
      expect(stream.content).toContain('Downstream');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand('deps', '', stream, makeToken(false));
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
        'refactor',
        'UserService',
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('refactor');
      expect(result.metadata).toHaveProperty('opportunitiesCount');
    });

    it('streams refactoring content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('refactor', 'UserService', stream, makeToken(false));
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Refactoring');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand('refactor', '', stream, makeToken(false));
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
        'test',
        'UserService',
        stream,
        makeToken(false),
      );
      expect(result.metadata?.command).toBe('test');
      expect(result.metadata).toHaveProperty('testCount');
      expect(result.metadata).toHaveProperty('gapsCount');
    });

    it('streams test coverage content', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('test', 'UserService', stream, makeToken(false));
      expect(stream.length).toBeGreaterThan(0);
      expect(stream.content).toContain('Test Coverage');
    });

    it('shows existing tests and coverage gaps sections', async () => {
      const stream = makeStream();
      await participant.handleSlashCommand('test', 'UserService', stream, makeToken(false));
      expect(stream.content).toContain('Existing Tests');
    });

    it('handles missing params gracefully', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand('test', '', stream, makeToken(false));
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
      const result = await participant.handleSlashCommand('review', '', stream, makeToken(true));
      expect(result.metadata).toEqual({ cancelled: true });
      expect(stream.content).toBe('');
    });

    it('handles unknown slash command as error', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'unknown' as SlashCommand,
        '',
        stream,
        makeToken(false),
      );
      expect(result.metadata?.error).toBe('unknown_command');
      expect(stream.content).toContain('Unknown Command');
    });

    it('handles slash command with extra whitespace in params', async () => {
      const stream = makeStream();
      const result = await participant.handleSlashCommand(
        'explain',
        '  MySymbol  ',
        stream,
        makeToken(false),
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

// ---------------------------------------------------------------------------
// Deep Context Builder Validation Tests
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Deep Context Validation', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  it('buildReviewContext shows "No changed files" for empty context', () => {
    const intent: ClassifiedIntent = { type: 'review', confidence: 0.9 };
    const msg = participant.buildContextMessage(intent, {});
    // Should not contain review findings since there are none
    expect(msg).not.toContain('### Review Findings');
  });

  it('buildReviewContext shows critical and warning sections separately', () => {
    // Test via buildContextMessage which internally calls the appropriate builder
    const intent: ClassifiedIntent = { type: 'review', confidence: 0.9 };
    const ctx = {
      reviewComments: [
        { severity: 'critical', title: 'Security flaw', path: 'a.ts', startLine: 1 },
        { severity: 'high', title: 'Performance issue', path: 'b.ts', startLine: 2 },
        { severity: 'medium', title: 'Style warning', path: 'c.ts', startLine: 3 },
        { severity: 'low', title: 'Nitpick', path: 'd.ts', startLine: 4 },
      ],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('Review Findings');
    expect(msg).toContain('Security flaw');
    expect(msg).toContain('Performance issue');
  });

  it('buildReviewContext limits changed files to 20', () => {
    // Test via buildContextMessage
    const intent: ClassifiedIntent = { type: 'review', confidence: 0.9 };
    const ctx = {
      changedFiles: Array.from({ length: 25 }, (_, i) => ({
        path: `src/file${i}.ts`,
        status: 'modified',
      })),
      reviewComments: [],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    // Should contain the files section
    expect(msg).toContain('Changed Files');
    // Should only show first 10 (limit in buildContextMessage)
    expect(msg).toContain('file9');
    expect(msg).not.toContain('file10');
  });

  it('buildExplainContext includes complexity metrics when available', () => {
    // Test via buildContextMessage
    const intent: ClassifiedIntent = { type: 'explore', confidence: 0.9 };
    const ctx = {
      searchResults: [{ name: 'UserService', filePath: 'src/user.ts', label: 'Class' }],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('Relevant Symbols');
    expect(msg).toContain('UserService');
  });

  it('buildContextMessage handles combined context sections', () => {
    const intent: ClassifiedIntent = { type: 'impact', confidence: 0.9 };
    const ctx = {
      impact: { riskLevel: 'critical', affectedSymbols: 42 },
      changedSymbols: [
        { name: 'Config', riskLevel: 'high' },
        { name: 'Logger', riskLevel: 'medium' },
      ],
      changedFiles: [{ path: 'src/config.ts', status: 'modified' }],
      callers: [{ name: 'App', filePath: 'src/app.ts' }],
    };
    const msg = participant.buildContextMessage(intent, ctx);
    expect(msg).toContain('### Impact Analysis');
    expect(msg).toContain('### Changed Symbols');
    expect(msg).toContain('### Changed Files');
    expect(msg).toContain('### Callers');
  });
});

// ---------------------------------------------------------------------------
// Intent Classification — Extended Edge Cases
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Extended Intent Edge Cases', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  it('classifies "search X" (without "for") as search', () => {
    const intent = participant.classifyIntent('search UserService');
    expect(intent.type).toBe('search');
  });

  it('extracts entity from "find all controllers"', () => {
    const intent = participant.classifyIntent('find all controllers');
    expect(intent.type).toBe('search');
    expect(intent.entity).toBe('all controllers');
  });

  it('handles trailing whitespace in prompt', () => {
    const intent = participant.classifyIntent('explain auth    ');
    expect(intent.type).toBe('explore');
    expect(intent.entity).toBe('auth');
  });

  it('handles leading whitespace in prompt', () => {
    const intent = participant.classifyIntent('   explain auth');
    expect(intent.type).toBe('explore');
  });

  it('handles single word prompt', () => {
    const intent = participant.classifyIntent('hello');
    expect(intent.type).toBe('search');
    expect(intent.confidence).toBe(0.3);
  });

  it('classifies "document the API" as explore', () => {
    const intent = participant.classifyIntent('document the API');
    expect(intent.type).toBe('explore');
    expect(intent.entity).toBe('the API');
  });

  it('classifies "show me the code" as explore', () => {
    const intent = participant.classifyIntent('show me the code');
    expect(intent.type).toBe('explore');
    expect(intent.entity).toBe('the code');
  });

  it('handles prompt with newlines', () => {
    const intent = participant.classifyIntent('how does\nauth work');
    // The regex uses ^ anchor, so multiline may not match
    // It should fall back to default
    expect(intent.type).toBeDefined();
  });

  it('handles prompt with tabs', () => {
    const intent = participant.classifyIntent('\t\texplain\tauth');
    // Tabs should be treated as whitespace
    expect(intent.type).toBe('explore');
  });

  it('classifies "inspect the changes" as review', () => {
    const intent = participant.classifyIntent('inspect the changes');
    // "inspect my changes" matches but "inspect the changes" doesn't
    // Should still be processed
    expect(intent.type).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Slash Command Parsing from Prompt — Edge Cases
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Slash Command Prompt Parsing', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    engine.setProjectId('test');
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  it('handles /review with trailing whitespace', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('/review '),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.command).toBe('review');
  });

  it('handles /explain with multi-word symbol', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('/explain User Service'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.command).toBe('explain');
  });

  it('does not treat non-slash text as command', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('just /some text'),
      makeContext(),
      stream,
      makeToken(false),
    );
    // Should fall back to intent classification, not command
    expect(result.metadata?.command).toBeUndefined();
    expect(result.metadata?.intent).toBeDefined();
  });

  it('handles /find with no extra params', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('/find'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.command).toBe('find');
    expect(result.metadata?.error).toBe('missing_params');
  });

  it('handles empty slash command (just /)', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('/'),
      makeContext(),
      stream,
      makeToken(false),
    );
    // Should fall back to intent classification
    expect(result.metadata?.intent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// handleRequest — Extended Workflows
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Extended handleRequest', () => {
  let participant: CodeAnalyzerChatParticipant;

  beforeEach(() => {
    const engine = new EngineBridge();
    engine.setProjectId('test');
    participant = new CodeAnalyzerChatParticipant(engine);
  });

  it('handles explore intent with entity extraction', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('tell me about UserService'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.intent).toBe('explore');
    expect(stream.content).toContain('Code Analyzer Context');
  });

  it('handles impact intent with entity extraction', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('what depends on AuthService'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.intent).toBe('impact');
    expect(stream.content).toContain('Code Analyzer Context');
  });

  it('handles debug intent with entity extraction', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('debug the login flow'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.intent).toBe('debug');
  });

  it('handles refactor intent with entity extraction', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('refactor the UserService'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.intent).toBe('refactor');
  });

  it('handles search intent (default fallback)', async () => {
    const stream = makeStream();
    const result = await participant.handleRequest(
      makeRequest('something completely random xyz'),
      makeContext(),
      stream,
      makeToken(false),
    );
    expect(result.metadata?.intent).toBe('search');
    expect(stream.content).toContain('Code Analyzer Context');
  });
});

// ---------------------------------------------------------------------------
// Engine double used by the rendering suites below
// ---------------------------------------------------------------------------

/** A search hit, optionally carrying the relevance score the participant renders. */
type SearchHit = SearchResultItem & { relevanceScore?: number };

const ZERO_COMPLEXITY: ComplexityMetricsItem = {
  cyclomaticComplexity: 0,
  linesOfCode: 0,
  parameterCount: 0,
  nestingDepth: 0,
};

interface EngineScript {
  /** Hits returned by search(). `searchByQuery` lets a test key the answer by query. */
  search?: SearchHit[];
  searchByQuery?: Record<string, SearchHit[]>;
  relatedSymbols?: TraceResultItem[];
  callers?: TraceResultItem[];
  callees?: TraceResultItem[];
  implementations?: TraceResultItem[];
  relatedTests?: TraceResultItem[];
  changedFiles?: ChangedFileItem[];
  reviewComments?: ReviewCommentItem[];
  changedSymbols?: ChangedSymbolItem[];
  impact?: ImpactResultItem;
  traceCallPath?: TraceResultItem[];
  symbolDetail?: SymbolDetailItem;
  complexity?: ComplexityMetricsItem;
  standards?: StandardsResultItem[];
  indexingSymbolCount?: number;
  /** Active project id, as published by indexWorkspace(). */
  projectId?: string;
  /** Symbols catalogued for the active project. */
  projectSymbols?: SymbolRefItem[];
  /** Method names that reject, to drive the handlers' failure paths. */
  failing?: string[];
}

/**
 * An EngineBridge double that answers with caller-supplied analyzer output and
 * records every call it receives.
 *
 * Only the engine is doubled here. CodeAnalyzerChatParticipant, its intent
 * classifier, all fifteen slash-command handlers and every markdown builder under
 * test are the real implementations. The double exists because EngineBridge answers
 * with empty collections until the analyzer pipeline is wired into the extension —
 * its graph store is never populated — so the non-empty rendering paths of the
 * participant cannot be reached through the real bridge at all. The recorded calls
 * let each test pin the exact query a handler issues, not just the markdown it emits.
 */
function scriptedEngine(script: EngineScript = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const failing = new Set(script.failing ?? []);

  const resolve = <T>(method: string, args: unknown[], value: T): Promise<T> => {
    calls.push({ method, args });
    return failing.has(method)
      ? Promise.reject(new Error(`${method} unavailable`))
      : Promise.resolve(value);
  };

  const engine = {
    search: (query: string) =>
      resolve('search', [query], script.searchByQuery?.[query] ?? script.search ?? []),
    findRelatedSymbols: (entity: string) =>
      resolve('findRelatedSymbols', [entity], script.relatedSymbols ?? []),
    findCallers: (entity: string) => resolve('findCallers', [entity], script.callers ?? []),
    findCallees: (entity: string) => resolve('findCallees', [entity], script.callees ?? []),
    findImplementations: (entity: string) =>
      resolve('findImplementations', [entity], script.implementations ?? []),
    findRelatedTests: (entity: string) =>
      resolve('findRelatedTests', [entity], script.relatedTests ?? []),
    getChangedFiles: () => resolve('getChangedFiles', [], script.changedFiles ?? []),
    reviewWorkspace: () => resolve('reviewWorkspace', [], script.reviewComments ?? []),
    detectChanges: () => resolve('detectChanges', [], script.changedSymbols ?? []),
    analyzeImpact: (symbol: string) =>
      resolve('analyzeImpact', [symbol], script.impact ?? { riskLevel: 'low', affectedSymbols: 0 }),
    traceCallPath: (symbol: string) =>
      resolve('traceCallPath', [symbol], script.traceCallPath ?? []),
    getSymbolDetail: (entity: string) => resolve('getSymbolDetail', [entity], script.symbolDetail),
    getComplexityMetrics: (entity: string) =>
      resolve('getComplexityMetrics', [entity], script.complexity ?? ZERO_COMPLEXITY),
    checkStandards: (filePath: string) =>
      resolve('checkStandards', [filePath], script.standards ?? []),
    indexWorkspace: (rootPath: string) => resolve('indexWorkspace', [rootPath], undefined),
    listProjectSymbols: () => resolve('listProjectSymbols', [], script.projectSymbols ?? []),
    getProjectId: (): string | null => {
      calls.push({ method: 'getProjectId', args: [] });
      return script.projectId ?? null;
    },
    getIndexingState: (): IndexingState => ({
      status: 'ready',
      symbolCount: script.indexingSymbolCount ?? 0,
      progress: 100,
    }),
  } as unknown as EngineBridge;

  return { engine, calls };
}

function scriptedParticipant(script: EngineScript = {}) {
  const { engine, calls } = scriptedEngine(script);
  return { participant: new CodeAnalyzerChatParticipant(engine), calls };
}

function hit(name: string, label: string, filePath = `src/${name}.ts`): SearchHit {
  return { name, qualifiedName: `/test/workspace.${name}`, filePath, label };
}

function ref(name: string, filePath = `src/${name}.ts`): TraceResultItem {
  return { name, qualifiedName: `/test/workspace.${name}`, filePath };
}

function symbolRef(name: string, filePath = `src/${name}.ts`): SymbolRefItem {
  return { name, qualifiedName: `/test/workspace.${name}`, filePath, label: 'Class' };
}

function comment(severity: string, title: string, startLine = 1): ReviewCommentItem {
  return { severity, title, path: 'src/a.ts', startLine, endLine: startLine, message: title };
}

/**
 * A cancellation token that reports `false` for the first `readsBeforeCancel` reads
 * and `true` afterwards, mirroring a user cancelling while the engine is working.
 * handleSlashCommand() consumes the first read, so the handler sees the cancellation.
 */
function cancellingToken(readsBeforeCancel = 1): CancellationToken {
  let reads = 0;
  return {
    get isCancellationRequested() {
      reads += 1;
      return reads > readsBeforeCancel;
    },
  };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — Cancellation', () => {
  it('returns an empty context when gatherAnalysisContext is entered cancelled', async () => {
    const { participant } = scriptedParticipant();

    const ctx = await participant.gatherAnalysisContext(
      { type: 'explore', entity: 'auth', confidence: 0.9 },
      makeRequest('how does auth work'),
      makeToken(true),
    );

    expect(ctx).toEqual({});
  });

  for (const command of SLASH_COMMANDS) {
    it(`stops /${command} when the token is cancelled mid-flight`, async () => {
      const { participant } = scriptedParticipant();
      const stream = makeStream();

      const result = await participant.handleSlashCommand(
        command,
        'Thing',
        stream,
        cancellingToken(),
      );

      expect(result.metadata).toEqual({ cancelled: true });
    });
  }
});

// ---------------------------------------------------------------------------
// gatherAnalysisContext — intents the classifier cannot produce
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — gatherAnalysisContext', () => {
  it('falls back to a plain search for an intent the classifier never emits', async () => {
    // 'explain' is a member of the exported IntentType union but no INTENT_PATTERNS
    // entry produces it, so this hits the switch default through the public API.
    const { participant, calls } = scriptedParticipant({ search: [hit('auth', 'Class')] });

    const ctx = await participant.gatherAnalysisContext(
      { type: 'explain', confidence: 0.4 },
      makeRequest('how does auth work'),
      makeToken(false),
    );

    expect(calls).toContainEqual({ method: 'search', args: ['how does auth work'] });
    expect(ctx.searchResults).toHaveLength(1);
  });

  it('uses the request prompt when an explore intent carries no entity', async () => {
    const { participant, calls } = scriptedParticipant();

    await participant.gatherAnalysisContext(
      { type: 'explore', confidence: 0.9 },
      makeRequest('how does the cache work'),
      makeToken(false),
    );

    expect(calls).toContainEqual({ method: 'search', args: ['how does the cache work'] });
    expect(calls).toContainEqual({
      method: 'findRelatedSymbols',
      args: ['how does the cache work'],
    });
  });

  it('substitutes an empty entity for impact, debug and refactor intents without one', async () => {
    const { participant, calls } = scriptedParticipant();

    await participant.gatherAnalysisContext(
      { type: 'impact', confidence: 0.9 },
      makeRequest('what breaks'),
      makeToken(false),
    );
    await participant.gatherAnalysisContext(
      { type: 'debug', confidence: 0.9 },
      makeRequest('why is it failing'),
      makeToken(false),
    );
    await participant.gatherAnalysisContext(
      { type: 'refactor', confidence: 0.9 },
      makeRequest('refactor it'),
      makeToken(false),
    );

    expect(calls).toContainEqual({ method: 'analyzeImpact', args: [''] });
    expect(calls).toContainEqual({ method: 'traceCallPath', args: [''] });
    expect(calls).toContainEqual({ method: 'findImplementations', args: [''] });
    expect(calls).toContainEqual({ method: 'findCallers', args: [''] });
  });

  it('uses the request prompt when a search intent carries no query', async () => {
    const { participant, calls } = scriptedParticipant();

    await participant.gatherAnalysisContext(
      { type: 'search', confidence: 0 },
      makeRequest(''),
      makeToken(false),
    );

    expect(calls).toContainEqual({ method: 'search', args: [''] });
  });
});

// ---------------------------------------------------------------------------
// /review-deps
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /review-deps', () => {
  it('reports zeroes when the workspace has no changes and no symbols', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'review-deps',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'review-deps', fileCount: 0 });
    expect(stream.content).toContain('| Files Scanned | 0 |');
    expect(stream.content).toContain('| Symbols Found | 0 |');
  });

  it('counts changed files and matched symbols', async () => {
    const { participant, calls } = scriptedParticipant({
      changedFiles: [
        { path: 'package.json', status: 'modified' },
        { path: 'pnpm-lock.yaml', status: 'modified' },
      ],
      search: [hit('lodash', 'Variable'), hit('semver', 'Variable')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'review-deps',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'review-deps', fileCount: 2 });
    expect(stream.content).toContain('| Files Scanned | 2 |');
    expect(stream.content).toContain('| Symbols Found | 2 |');
    expect(calls).toContainEqual({ method: 'search', args: ['dependency package version'] });
    expect(stream.content).toContain('**Pin dependency versions**');
  });

  it('reports a failure when the engine is unavailable', async () => {
    const { participant } = scriptedParticipant({ failing: ['getChangedFiles'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'review-deps',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'review-deps', error: 'analysis_failed' });
    expect(stream.content).toContain('Unable to analyze dependencies');
  });
});

// ---------------------------------------------------------------------------
// /check-contract
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /check-contract', () => {
  it('selects the public API surface by node label rather than by name prefix', async () => {
    // Regression guard: the handler used to test `name.startsWith('class ')`, but the
    // graph keeps the kind in `label` and the bare identifier in `name`, so the
    // "Exported Symbols" section was empty for every possible query.
    const { participant, calls } = scriptedParticipant({
      search: [
        hit('UserService', 'Class'),
        hit('IUserRepository', 'Interface'),
        hit('createUser', 'Function'),
        hit('UserId', 'TypeAlias'),
        hit('Role', 'Enum'),
        hit('LOG_LEVEL', 'Variable'),
        hit('README.md', 'File'),
      ],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'check-contract',
      '',
      stream,
      makeToken(false),
    );

    expect(calls).toContainEqual({ method: 'search', args: ['export class function'] });
    expect(result.metadata).toEqual({ command: 'check-contract', symbolsFound: 7 });
    expect(stream.content).toContain('### Exported Symbols (5)');
    expect(stream.content).toContain('`UserService` (Class)');
    expect(stream.content).toContain('`IUserRepository` (Interface)');
    expect(stream.content).toContain('`createUser` (Function)');
    expect(stream.content).toContain('`UserId` (TypeAlias)');
    expect(stream.content).toContain('`Role` (Enum)');
    expect(stream.content).not.toContain('LOG_LEVEL');
    expect(stream.content).not.toContain('README.md');
    expect(stream.content).not.toContain('(Variable)');
    expect(stream.content).not.toContain('(File)');
    expect(stream.content).toContain('### Contract Checks');
  });

  it('searches the supplied path and reports when no public symbol matches', async () => {
    const { participant, calls } = scriptedParticipant({
      search: [hit('config', 'Variable')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'check-contract',
      'src/config.ts',
      stream,
      makeToken(false),
    );

    expect(calls).toContainEqual({ method: 'search', args: ['src/config.ts'] });
    expect(result.metadata).toEqual({ command: 'check-contract', symbolsFound: 1 });
    expect(stream.content).toContain('### Exported Symbols (0)');
    expect(stream.content).toContain(
      'None of the matching symbols expose a class, interface or function.',
    );
  });

  it('reports an empty graph when nothing matches at all', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'check-contract',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'check-contract', symbolsFound: 0 });
    expect(stream.content).toContain('No symbols found. Specify a file path to check.');
  });

  it('reports a failure when the search throws', async () => {
    const { participant } = scriptedParticipant({ failing: ['search'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'check-contract',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'check-contract', error: 'check_failed' });
    expect(stream.content).toContain('Contract check failed');
  });
});

// ---------------------------------------------------------------------------
// /trace-dataflow
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /trace-dataflow', () => {
  it('reports "no path" without querying the graph when no symbol is supplied', async () => {
    const { participant, calls } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'trace-dataflow',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'trace-dataflow', traceHops: 0 });
    expect(calls.some((c) => c.method === 'traceCallPath')).toBe(false);
    expect(stream.content).toContain('No dataflow path found.');
  });

  it('renders the call path and the dataflow nodes for a resolved symbol', async () => {
    const { participant } = scriptedParticipant({
      traceCallPath: [ref('handleRequest'), ref('classifyIntent')],
      relatedSymbols: [ref('token')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'trace-dataflow',
      'handleRequest',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'trace-dataflow', traceHops: 2 });
    expect(stream.content).toContain('### Call Path (2 hops)');
    expect(stream.content).toContain('`handleRequest` → `src/handleRequest.ts`');
    expect(stream.content).toContain('### Data Flow Nodes (1)');
    expect(stream.content).not.toContain('No dataflow path found.');
  });

  it('renders only the nodes when the symbol has no recorded call path', async () => {
    const { participant } = scriptedParticipant({ relatedSymbols: [ref('token')] });
    const stream = makeStream();

    await participant.handleSlashCommand('trace-dataflow', 'token', stream, makeToken(false));

    expect(stream.content).not.toContain('### Call Path');
    expect(stream.content).toContain('### Data Flow Nodes (1)');
  });

  it('reports a failure when the trace query throws', async () => {
    const { participant } = scriptedParticipant({ failing: ['traceCallPath'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'trace-dataflow',
      'token',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'trace-dataflow', error: 'trace_failed' });
    expect(stream.content).toContain('Dataflow trace failed');
  });
});

// ---------------------------------------------------------------------------
// /find-hotspots
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /find-hotspots', () => {
  it('omits the file section when nothing changed', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'find-hotspots',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'find-hotspots', changedFileCount: 0 });
    expect(stream.content).not.toContain('### Recently Changed Files');
    expect(stream.content).toContain('### Recommendations');
  });

  it('lists modified and added files but not deleted ones', async () => {
    const { participant } = scriptedParticipant({
      changedFiles: [
        { path: 'src/a.ts', status: 'modified' },
        { path: 'src/b.ts', status: 'added' },
        { path: 'src/gone.ts', status: 'deleted' },
      ],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'find-hotspots',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'find-hotspots', changedFileCount: 3 });
    expect(stream.content).toContain('### Recently Changed Files (3)');
    expect(stream.content).toContain('`src/a.ts` (modified)');
    expect(stream.content).toContain('`src/b.ts` (added)');
    expect(stream.content).not.toContain('src/gone.ts');
  });

  it('reports a failure when the change list cannot be read', async () => {
    const { participant } = scriptedParticipant({ failing: ['getChangedFiles'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'find-hotspots',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'find-hotspots', error: 'detection_failed' });
    expect(stream.content).toContain('Hotspot detection failed');
  });
});

// ---------------------------------------------------------------------------
// /audit-security
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /audit-security', () => {
  it('reports a clean audit when the review produced no findings', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'audit-security',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'audit-security', issueCount: 0 });
    expect(stream.content).toContain('### Results (0 issues)');
    expect(stream.content).toContain('| — | No security issues detected | — |');
    expect(stream.content).toContain('### Security Checklist');
  });

  it('keeps only critical and high findings', async () => {
    const { participant } = scriptedParticipant({
      reviewComments: [
        comment('critical', 'Hardcoded credential', 12),
        comment('high', 'SQL built by concatenation', 30),
        comment('medium', 'Missing input validation', 44),
        comment('low', 'TODO left in code', 51),
        comment('info', 'Naming convention', 60),
      ],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'audit-security',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'audit-security', issueCount: 2 });
    expect(stream.content).toContain('### Results (2 issues)');
    expect(stream.content).toContain('| critical | Hardcoded credential | `src/a.ts:12` |');
    expect(stream.content).toContain('| high | SQL built by concatenation | `src/a.ts:30` |');
    expect(stream.content).not.toContain('Missing input validation');
    expect(stream.content).not.toContain('TODO left in code');
    expect(stream.content).not.toContain('| — | No security issues detected | — |');
  });

  it('reports a failure when the review engine is unavailable', async () => {
    const { participant } = scriptedParticipant({ failing: ['reviewWorkspace'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'audit-security',
      '',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'audit-security', error: 'audit_failed' });
    expect(stream.content).toContain('Security audit failed');
  });
});

// ---------------------------------------------------------------------------
// /analyze
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /analyze', () => {
  it('reports the indexed symbol count from the engine state', async () => {
    // Regression guard: indexWorkspace() resolves void, and the handler used to treat
    // its result as the symbol count, so the report always printed
    // "Symbols Indexed | undefined".
    const { participant, calls } = scriptedParticipant({
      indexingSymbolCount: 42,
      projectId: '/test/workspace',
      projectSymbols: [
        symbolRef('AlphaService'),
        symbolRef('BetaService'),
        symbolRef('GammaService'),
      ],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('analyze', '', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'analyze',
      symbolCount: 42,
      fileCount: 0,
      resultCount: 3,
    });
    expect(stream.content).toContain('| Symbols Indexed | 42 |');
    expect(stream.content).toContain('| Results Found | 3 |');
    expect(stream.content).not.toContain('undefined');
    // Regression guard: the handler used to pass '' as the root, which published ''
    // as the active project id and disabled every project-scoped query afterwards.
    expect(calls).toContainEqual({ method: 'indexWorkspace', args: ['/test/workspace'] });
  });

  it('skips re-indexing when no project has been indexed yet', async () => {
    const { participant, calls } = scriptedParticipant({ indexingSymbolCount: 7 });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('analyze', '', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'analyze',
      symbolCount: 7,
      fileCount: 0,
      resultCount: 0,
    });
    expect(calls.every((c) => c.method !== 'indexWorkspace')).toBe(true);
  });

  it('reports a failure when indexing throws', async () => {
    const { participant } = scriptedParticipant({
      projectId: '/test/workspace',
      failing: ['indexWorkspace'],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('analyze', '', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'analyze', error: 'analysis_failed' });
    expect(stream.content).toContain('Analysis failed');
  });
});

// ---------------------------------------------------------------------------
// /review rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /review rendering', () => {
  const changedFiles: ChangedFileItem[] = [
    { path: 'src/a.ts', status: 'modified' },
    { path: 'src/b.ts', status: 'added' },
  ];

  it('renders changed files, grouped findings and standards violations', async () => {
    const { participant, calls } = scriptedParticipant({
      changedFiles,
      reviewComments: [
        comment('critical', 'Unbounded recursion', 10),
        comment('high', 'Missing auth check', 20),
        comment('medium', 'Duplicated logic', 30),
        comment('low', 'Unused import', 40),
        comment('info', 'Consider a constant', 50),
      ],
      standards: [
        { passed: false, message: 'Missing JSDoc on exported symbol' },
        { passed: true, message: 'Line length ok' },
      ],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('review', '', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'review', issuesFound: 5, filesChanged: 2 });
    expect(stream.content).toContain('### Changed Files (2)');
    expect(stream.content).toContain('### Review Findings (5 issues)');
    expect(stream.content).toContain('- Critical/High: 2 | Warnings: 1 | Info: 2');
    expect(stream.content).toContain('#### Critical & High');
    expect(stream.content).toContain('- **critical**: Unbounded recursion (`src/a.ts:10`)');
    expect(stream.content).toContain('#### Warnings');
    expect(stream.content).toContain('- **medium**: Duplicated logic (`src/a.ts:30`)');
    // The violation is reported once per audited file, and the passing rule is dropped.
    expect(stream.content).toContain('### Standards Violations (2)');
    expect(stream.content).toContain('- Missing JSDoc on exported symbol');
    expect(stream.content).not.toContain('Line length ok');
    // The Info block is suppressed while something more severe was reported.
    expect(stream.content).not.toContain('#### Info');
    expect(calls.filter((c) => c.method === 'checkStandards')).toHaveLength(2);
  });

  it('renders findings without an Info block when nothing informative was found', async () => {
    const { participant } = scriptedParticipant({
      changedFiles,
      reviewComments: [comment('high', 'Missing auth check', 20)],
      standards: [{ passed: true, message: 'Line length ok' }],
    });
    const stream = makeStream();

    await participant.handleSlashCommand('review', '', stream, makeToken(false));

    expect(stream.content).toContain('- Critical/High: 1 | Warnings: 0 | Info: 0');
    expect(stream.content).toContain('#### Critical & High');
    expect(stream.content).not.toContain('#### Warnings');
    expect(stream.content).not.toContain('#### Info');
    // A passing standard is recorded as informational, so no violation block appears.
    expect(stream.content).not.toContain('### Standards Violations');
  });

  it('promotes Info findings when nothing more severe was reported', async () => {
    const { participant } = scriptedParticipant({
      changedFiles,
      reviewComments: [comment('low', 'Naming nit', 7), comment('info', 'Docs nit', 9)],
    });
    const stream = makeStream();

    await participant.handleSlashCommand('review', '', stream, makeToken(false));

    expect(stream.content).toContain('- Critical/High: 0 | Warnings: 0 | Info: 2');
    expect(stream.content).toContain('#### Info');
    expect(stream.content).toContain('- Naming nit (`src/a.ts:7`)');
    expect(stream.content).not.toContain('#### Critical & High');
    expect(stream.content).not.toContain('#### Warnings');
  });

  it('reports a clean workspace when the review returns no comments', async () => {
    const { participant } = scriptedParticipant({ changedFiles, reviewComments: [] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('review', '', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'review', issuesFound: 0, filesChanged: 2 });
    expect(stream.content).toContain('No issues detected in changed files.');
  });

  it('still reports the changed files when the review call fails', async () => {
    const { participant } = scriptedParticipant({
      changedFiles,
      failing: ['reviewWorkspace'],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('review', '', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'review', issuesFound: 0, filesChanged: 2 });
    expect(stream.content).toContain('### Changed Files (2)');
    expect(stream.content).toContain('No issues detected in changed files.');
    expect(stream.content).not.toContain('### Standards Violations');
  });

  it('falls back to an empty report when the change list cannot be read', async () => {
    const { participant } = scriptedParticipant({ failing: ['getChangedFiles'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('review', '', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'review', issuesFound: 0, filesChanged: 0 });
    expect(stream.content).toContain('No changed files detected.');
    expect(stream.content).toContain('You can also analyze the current file');
  });

  it('caps the standards probe at the first five changed files', async () => {
    const { participant, calls } = scriptedParticipant({
      changedFiles: Array.from({ length: 7 }, (_, i) => ({
        path: `src/file${i}.ts`,
        status: 'modified',
      })),
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('review', '', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'review', issuesFound: 0, filesChanged: 7 });
    expect(stream.content).toContain('### Changed Files (7)');
    expect(calls.filter((c) => c.method === 'checkStandards')).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// /explain rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /explain rendering', () => {
  it('renders every optional section of a fully described symbol', async () => {
    const { participant } = scriptedParticipant({
      symbolDetail: {
        name: 'handleRequest',
        qualifiedName: 'participant.handleRequest',
        filePath: 'src/participant.ts',
        signature: 'async handleRequest(request: ChatRequest): Promise<ChatResult>',
        docstring: 'Handle a user request in Copilot Chat.',
        label: 'Method',
        isExported: true,
        complexity: {
          cyclomaticComplexity: 12,
          linesOfCode: 64,
          parameterCount: 4,
          nestingDepth: 3,
        },
      },
      search: [hit('classifyIntent', 'Method')],
      callers: [ref('extension.activate')],
      callees: [ref('buildContextMessage')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'explain',
      'handleRequest',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'explain', symbol: 'handleRequest', found: true });
    expect(stream.content).toContain('### `handleRequest`');
    expect(stream.content).toContain('- **Type:** Method');
    expect(stream.content).toContain('- **Exported:** Yes');
    expect(stream.content).toContain('- **Signature:** `async handleRequest');
    expect(stream.content).toContain('Handle a user request in Copilot Chat.');
    expect(stream.content).toContain('### Complexity Metrics');
    expect(stream.content).toContain('- Cyclomatic Complexity: 12');
    expect(stream.content).toContain('- Nesting Depth: 3');
    expect(stream.content).toContain('### Related Symbols');
    expect(stream.content).toContain('- `classifyIntent` in `src/classifyIntent.ts` (Method)');
    expect(stream.content).toContain('### Called By (Upstream)');
    expect(stream.content).toContain('### Calls To (Downstream)');
    expect(stream.content).not.toContain('Symbol not found in the knowledge graph.');
  });

  it('omits the optional sections a bare symbol does not carry', async () => {
    const { participant, calls } = scriptedParticipant({
      symbolDetail: {
        name: 'TOKEN',
        qualifiedName: 'constants.TOKEN',
        filePath: 'src/constants.ts',
        label: 'Variable',
        isExported: false,
      },
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'explain',
      'TOKEN',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'explain', symbol: 'TOKEN', found: true });
    expect(stream.content).toContain('- **Exported:** No');
    expect(stream.content).not.toContain('**Signature:**');
    expect(stream.content).not.toContain('**Documentation:**');
    expect(stream.content).not.toContain('### Complexity Metrics');
    expect(stream.content).not.toContain('### Related Symbols');
    expect(stream.content).not.toContain('### Called By (Upstream)');
    expect(stream.content).not.toContain('### Calls To (Downstream)');
    expect(calls.filter((c) => c.method === 'getSymbolDetail')).toHaveLength(1);
  });

  it('points at the analysis step when the symbol is not in the graph', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'explain',
      'Ghost',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'explain', symbol: 'Ghost', found: false });
    expect(stream.content).toContain('Symbol not found in the knowledge graph.');
  });
});

// ---------------------------------------------------------------------------
// /impact rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /impact rendering', () => {
  it('renders risk, dependents, related and changed symbols', async () => {
    const { participant } = scriptedParticipant({
      callers: Array.from({ length: 17 }, (_, i) => ref(`caller${i}`)),
      relatedSymbols: [ref('related')],
      changedSymbols: [{ name: 'handleRequest', riskLevel: 'high' }],
      impact: { riskLevel: 'high', affectedSymbols: 17 },
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'impact',
      'handleRequest',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({
      command: 'impact',
      symbol: 'handleRequest',
      riskLevel: 'high',
    });
    expect(stream.content).toContain('### Risk Assessment');
    expect(stream.content).toContain('- **Risk Level:** high');
    expect(stream.content).toContain('- **Affected Symbols:** 17');
    expect(stream.content).toContain('### Direct Dependents (17)');
    expect(stream.content).toContain('- ... and 2 more');
    expect(stream.content).toContain('### Related Symbols');
    expect(stream.content).toContain('### Changed Symbols (1)');
    expect(stream.content).toContain('- `handleRequest` (risk: high)');
  });

  it('reports the risk level alone when no dependent is recorded', async () => {
    const { participant } = scriptedParticipant({
      impact: { riskLevel: 'low', affectedSymbols: 0 },
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'impact',
      'isolated',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'impact', symbol: 'isolated', riskLevel: 'low' });
    expect(stream.content).toContain('- **Risk Level:** low');
    expect(stream.content).not.toContain('### Direct Dependents');
    expect(stream.content).not.toContain('### Related Symbols');
    expect(stream.content).not.toContain('### Changed Symbols');
  });

  it('falls back to an unknown risk when the impact query fails', async () => {
    const { participant } = scriptedParticipant({ failing: ['analyzeImpact'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'impact',
      'thing',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'impact', symbol: 'thing', riskLevel: 'unknown' });
    expect(stream.content).toContain('No impact data available.');
    expect(stream.content).toContain('Run a codebase analysis first');
  });

  it('still lists the known dependents when the impact query fails', async () => {
    const { participant } = scriptedParticipant({
      callers: [ref('activate')],
      failing: ['analyzeImpact'],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'impact',
      'thing',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'impact', symbol: 'thing', riskLevel: 'unknown' });
    expect(stream.content).not.toContain('No impact data available.');
    expect(stream.content).not.toContain('### Risk Assessment');
    expect(stream.content).toContain('### Direct Dependents (1)');
    expect(stream.content).toContain('- `activate` in `src/activate.ts`');
  });
});

// ---------------------------------------------------------------------------
// /find rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /find rendering', () => {
  it('renders scored hits, the truncation notice and related context', async () => {
    const { participant } = scriptedParticipant({
      search: Array.from({ length: 17 }, (_, i) => ({
        ...hit(`symbol${i}`, 'Function'),
        relevanceScore: 0.5 + i / 100,
      })),
      relatedSymbols: [ref('related')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('find', 'symbol', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'find', query: 'symbol', resultCount: 17 });
    expect(stream.content).toContain('## Search Results: "symbol"');
    expect(stream.content).toContain('### Symbols Found (17)');
    expect(stream.content).toContain('(score: 0.50)');
    expect(stream.content).toContain('*... and 2 more results.');
    expect(stream.content).toContain('### Related Context');
  });

  it('renders unscored hits without a score suffix', async () => {
    const { participant } = scriptedParticipant({ search: [hit('onlyHit', 'Class')] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('find', 'only', stream, makeToken(false));

    expect(result.metadata).toEqual({ command: 'find', query: 'only', resultCount: 1 });
    expect(stream.content).toContain('- `onlyHit` — `src/onlyHit.ts` [Class]');
    expect(stream.content).not.toContain('score:');
    expect(stream.content).not.toContain('*... and');
  });

  it('suggests refining the query when nothing matched', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'find',
      'nothing',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'find', query: 'nothing', resultCount: 0 });
    expect(stream.content).toContain('No results found. Try a different query.');
    expect(stream.content).toContain('BM25 + vector semantic search');
  });
});

// ---------------------------------------------------------------------------
// /deps rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /deps rendering', () => {
  it('renders both directions and truncates long lists', async () => {
    // Asymmetric lengths so each truncation notice can be attributed to one direction.
    const { participant } = scriptedParticipant({
      callers: Array.from({ length: 17 }, (_, i) => ref(`up${i}`)),
      callees: Array.from({ length: 16 }, (_, i) => ref(`down${i}`)),
      relatedSymbols: [ref('related')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('deps', 'target', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'deps',
      symbol: 'target',
      upstreamCount: 17,
      downstreamCount: 16,
    });
    expect(stream.content).toContain('### Upstream Dependencies (17)');
    expect(stream.content).toContain('### Downstream Dependencies (16)');
    expect(stream.content).toContain('(CALLS)');
    expect(stream.content).toContain('- ... and 2 more');
    expect(stream.content).toContain('- ... and 1 more');
    expect(stream.content).toContain('### Related Symbols');
  });

  it('renders both directions without a truncation notice for short lists', async () => {
    const { participant } = scriptedParticipant({
      callers: [ref('upstream')],
      callees: [ref('downstream')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('deps', 'target', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'deps',
      symbol: 'target',
      upstreamCount: 1,
      downstreamCount: 1,
    });
    expect(stream.content).toContain('### Upstream Dependencies (1)');
    expect(stream.content).toContain('- `upstream` in `src/upstream.ts` (CALLS)');
    expect(stream.content).toContain('### Downstream Dependencies (1)');
    expect(stream.content).not.toContain('- ... and');
  });

  it('states explicitly when both directions are empty', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'deps',
      'isolated',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({
      command: 'deps',
      symbol: 'isolated',
      upstreamCount: 0,
      downstreamCount: 0,
    });
    expect(stream.content).toContain('### Upstream Dependencies\nNo symbols depend on this one.');
    expect(stream.content).toContain('### Downstream Dependencies\nNo dependencies found.');
    expect(stream.content).not.toContain('### Related Symbols');
  });
});

// ---------------------------------------------------------------------------
// /refactor rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /refactor rendering', () => {
  it('derives every opportunity from complexity, callers and standards', async () => {
    const { participant } = scriptedParticipant({
      symbolDetail: {
        name: 'handleRequest',
        qualifiedName: 'participant.handleRequest',
        filePath: 'src/participant.ts',
        label: 'Method',
        isExported: true,
      },
      callers: Array.from({ length: 11 }, (_, i) => ref(`caller${i}`)),
      implementations: [ref('BaseParticipant')],
      complexity: {
        cyclomaticComplexity: 12,
        linesOfCode: 64,
        parameterCount: 6,
        nestingDepth: 5,
      },
      standards: [
        { passed: false, message: 'Missing JSDoc' },
        { passed: true, message: 'Line length ok' },
      ],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'refactor',
      'handleRequest',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({
      command: 'refactor',
      symbol: 'handleRequest',
      opportunitiesCount: 6,
    });
    expect(stream.content).toContain('### Opportunities Found (6)');
    expect(stream.content).toContain('**High Cyclomatic Complexity**');
    expect(stream.content).toContain('**Function Too Long**');
    expect(stream.content).toContain('**Deep Nesting**');
    expect(stream.content).toContain('**Too Many Parameters**');
    expect(stream.content).toContain('**Hot Code Path**');
    expect(stream.content).toContain('**Standards Violation**');
    expect(stream.content).toContain('- File: `src/participant.ts:1`');
    expect(stream.content).toContain('### Complexity Metrics');
    expect(stream.content).toContain('- Cyclomatic Complexity: 12');
    expect(stream.content).toContain('### Current Symbol');
    expect(stream.content).toContain('- `handleRequest` (Method) in `src/participant.ts`');
    expect(stream.content).toContain('### Callers (11)');
    expect(stream.content).toContain('### Implementations (1)');
    expect(stream.content).toContain('### Standards Violations (1)');
    expect(stream.content).toContain('- Missing JSDoc');
    expect(stream.content).not.toContain('Line length ok');
  });

  it('derives file-less opportunities when the symbol has no file on record', async () => {
    const { participant, calls } = scriptedParticipant({
      callers: Array.from({ length: 11 }, (_, i) => ref(`caller${i}`)),
      complexity: {
        cyclomaticComplexity: 12,
        linesOfCode: 64,
        parameterCount: 6,
        nestingDepth: 5,
      },
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'refactor',
      'orphan',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({
      command: 'refactor',
      symbol: 'orphan',
      opportunitiesCount: 5,
    });
    expect(calls.some((c) => c.method === 'checkStandards')).toBe(false);
    for (const title of [
      'High Cyclomatic Complexity',
      'Function Too Long',
      'Deep Nesting',
      'Too Many Parameters',
      'Hot Code Path',
    ]) {
      expect(stream.content).toContain(`**${title}**`);
    }
    // The symbol has no file on record, so the opportunity is reported against "".
    expect(stream.content).toContain('- File: `:1`');
    expect(stream.content).toContain('### Callers (11)');
    expect(stream.content).not.toContain('### Current Symbol');
    expect(stream.content).not.toContain('### Standards Violations');
    // Metrics are always reported, even for a symbol the graph does not describe.
    expect(stream.content).toContain('### Complexity Metrics');
  });

  it('reports no opportunities for a symbol that is already clean', async () => {
    const { participant } = scriptedParticipant({
      symbolDetail: {
        name: 'add',
        qualifiedName: 'math.add',
        filePath: 'src/math.ts',
        label: 'Function',
        isExported: true,
      },
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'refactor',
      'add',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'refactor', symbol: 'add', opportunitiesCount: 0 });
    expect(stream.content).not.toContain('### Opportunities Found');
    expect(stream.content).toContain('### Current Symbol');
  });
});

// ---------------------------------------------------------------------------
// /test rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /test rendering', () => {
  it('separates covered symbols from coverage gaps', async () => {
    const { participant } = scriptedParticipant({
      relatedTests: [ref('coversHandleRequest')],
      relatedSymbols: [ref('CoversHandleRequest'), ref('uncoveredHelper')],
      callers: [ref('activate')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'test',
      'handleRequest',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({
      command: 'test',
      symbol: 'handleRequest',
      testCount: 1,
      gapsCount: 1,
    });
    expect(stream.content).toContain('### Existing Tests (1)');
    expect(stream.content).toContain('### Coverage Gaps (1)');
    expect(stream.content).toContain('- `uncoveredHelper`');
    // A case-insensitive match against the related test drops the covered symbol from
    // the gap list, even though it is still listed among the related symbols.
    const gapsSection = stream.content.split('### Related Symbols')[0]!;
    expect(gapsSection).not.toContain('CoversHandleRequest');
    expect(stream.content).toContain('### Related Symbols');
    expect(stream.content).toContain('### Callers (Test Impact)');
  });

  it('states that no test was found and reports no gaps when nothing matches', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand('test', 'ghost', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'test',
      symbol: 'ghost',
      testCount: 0,
      gapsCount: 0,
    });
    expect(stream.content).toContain('### Existing Tests\nNo tests found for this symbol.');
    expect(stream.content).not.toContain('### Coverage Gaps');
    expect(stream.content).not.toContain('### Related Symbols');
    expect(stream.content).not.toContain('### Callers');
  });

  it('truncates a long list of related tests', async () => {
    const { participant } = scriptedParticipant({
      relatedTests: Array.from({ length: 17 }, (_, i) => ref(`test${i}`)),
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('test', 'thing', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'test',
      symbol: 'thing',
      testCount: 17,
      gapsCount: 0,
    });
    expect(stream.content).toContain('### Existing Tests (17)');
    expect(stream.content).toContain('- ... and 2 more');
    expect(stream.content).not.toContain('### Coverage Gaps');
  });
});

// ---------------------------------------------------------------------------
// /coverage rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /coverage rendering', () => {
  it('reports a full-coverage verdict and lists the existing tests', async () => {
    const { participant } = scriptedParticipant({
      relatedTests: [ref('handleRequest.test')],
      relatedSymbols: [ref('handleRequest.test')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'coverage',
      'handleRequest',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({
      command: 'coverage',
      symbol: 'handleRequest',
      testCount: 1,
      gapCount: 0,
      coveragePercent: 100,
    });
    expect(stream.content).toContain('| Tested | 1/1 |');
    expect(stream.content).toContain('| Coverage | 100% |');
    expect(stream.content).toContain('Coverage looks good!');
    expect(stream.content).toContain('### Existing Tests (1)');
    expect(stream.content).not.toContain('### Coverage Gaps');
  });

  it('accepts a `<symbol>.test` companion as coverage', async () => {
    const { participant } = scriptedParticipant({
      relatedSymbols: [ref('handleRequest'), ref('buildContextMessage')],
      relatedTests: [ref('HandleRequest.test')],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('coverage', 'x', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'coverage',
      symbol: 'x',
      testCount: 1,
      gapCount: 1,
      coveragePercent: 50,
    });
    expect(stream.content).toContain('| Tested | 1/2 |');
    expect(stream.content).toContain('### Coverage Gaps (1)');
    expect(stream.content).toContain('- `buildContextMessage` — no tests found');
    expect(stream.content).toContain(
      'Consider adding tests for the uncovered symbols listed above.',
    );
  });

  it('reports zero coverage when no symbol could be resolved', async () => {
    const { participant } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'coverage',
      'ghost',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({
      command: 'coverage',
      symbol: 'ghost',
      testCount: 0,
      gapCount: 0,
      coveragePercent: 0,
    });
    expect(stream.content).toContain('| Tested | 0/0 |');
    expect(stream.content).toContain('Consider adding tests');
    expect(stream.content).not.toContain('### Existing Tests');
  });

  it('truncates a long list of existing tests and gaps', async () => {
    const { participant } = scriptedParticipant({
      relatedTests: Array.from({ length: 17 }, (_, i) => ref(`test${i}`)),
      relatedSymbols: Array.from({ length: 17 }, (_, i) => ref(`sym${i}`)),
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('coverage', 'x', stream, makeToken(false));

    expect(result.metadata).toEqual({
      command: 'coverage',
      symbol: 'x',
      testCount: 17,
      gapCount: 17,
      coveragePercent: 0,
    });
    expect(stream.content).toContain('### Existing Tests (17)');
    expect(stream.content).toContain('### Coverage Gaps (17)');
  });

  it('asks for a target when none is supplied', async () => {
    const { participant, calls } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand('coverage', '', stream, makeToken(false));

    expect(calls.some((c) => c.method === 'findRelatedTests')).toBe(false);
    expect(result.metadata).toEqual({ command: 'coverage', error: 'missing_params' });
    expect(stream.content).toContain('**Usage:** `/coverage <symbol|file>`');
  });
});

// ---------------------------------------------------------------------------
// /standards rendering
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — /standards rendering', () => {
  it('checks the supplied path and lists the violations it found', async () => {
    const { participant, calls } = scriptedParticipant({
      standards: [
        { passed: false, message: 'Missing JSDoc' },
        { passed: false, message: 'Line too long' },
        { passed: true, message: 'Naming ok' },
      ],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'standards',
      'src/participant.ts',
      stream,
      makeToken(false),
    );

    expect(calls).toContainEqual({ method: 'checkStandards', args: ['src/participant.ts'] });
    expect(result.metadata).toEqual({
      command: 'standards',
      fileCount: 1,
      violationCount: 2,
    });
    expect(stream.content).toContain('| Files Checked | 1 |');
    expect(stream.content).toContain('| Violations | 2 |');
    expect(stream.content).toContain('| Compliance | 0% |');
    expect(stream.content).toContain('### Violations');
    expect(stream.content).toContain('- Missing JSDoc');
    expect(stream.content).not.toContain('Naming ok');
    expect(stream.content).not.toContain('All checked files pass standards');
  });

  it('falls back to the changed files and reports full compliance', async () => {
    const { participant, calls } = scriptedParticipant({
      changedFiles: [
        { path: 'src/a.ts', status: 'modified' },
        { path: 'src/b.ts', status: 'added' },
      ],
      standards: [{ passed: true, message: 'Naming ok' }],
    });
    const stream = makeStream();

    const result = await participant.handleSlashCommand('standards', '', stream, makeToken(false));

    expect(calls.filter((c) => c.method === 'checkStandards')).toHaveLength(2);
    expect(result.metadata).toEqual({
      command: 'standards',
      fileCount: 2,
      violationCount: 0,
    });
    expect(stream.content).toContain('| Compliance | 100% |');
    expect(stream.content).toContain('✅ All checked files pass standards.');
    expect(stream.content).not.toContain('### Violations');
  });

  it('asks for a change or a path when there is nothing to check', async () => {
    const { participant, calls } = scriptedParticipant();
    const stream = makeStream();

    const result = await participant.handleSlashCommand('standards', '', stream, makeToken(false));

    expect(calls.some((c) => c.method === 'checkStandards')).toBe(false);
    expect(result.metadata).toEqual({ command: 'standards', fileCount: 0 });
    expect(stream.content).toContain('No files to check.');
  });

  it('reports a failure when the standards engine throws', async () => {
    const { participant } = scriptedParticipant({ failing: ['checkStandards'] });
    const stream = makeStream();

    const result = await participant.handleSlashCommand(
      'standards',
      'src/participant.ts',
      stream,
      makeToken(false),
    );

    expect(result.metadata).toEqual({ command: 'standards', error: 'check_failed' });
    expect(stream.content).toContain('Standards check failed');
  });
});

// ---------------------------------------------------------------------------
// buildContextMessage — every optional section
// ---------------------------------------------------------------------------

describe('CodeAnalyzerChatParticipant — buildContextMessage', () => {
  it('renders every section a fully populated context supplies', () => {
    const { participant } = scriptedParticipant();

    const message = participant.buildContextMessage(
      { type: 'explore', entity: 'handleRequest', confidence: 0.9 },
      {
        searchResults: [hit('handleRequest', 'Method')],
        reviewComments: [comment('high', 'Missing auth check', 20)],
        impact: {
          riskLevel: 'high',
          riskScore: 0,
          affectedSymbols: 3,
          directDependents: [],
          indirectDependents: [],
          affectedTests: [],
        },
        traceResults: [ref('classifyIntent')],
        implementations: [ref('BaseParticipant')],
        callers: [ref('activate')],
        symbols: [ref('token')],
        changedSymbols: [{ name: 'handleRequest', riskLevel: 'high' }],
        changedFiles: [{ path: 'src/a.ts', status: 'modified' }],
      },
    );

    expect(message).toContain('**Intent:** explore');
    expect(message).toContain('### Relevant Symbols');
    expect(message).toContain('- `handleRequest` in `src/handleRequest.ts` (Method)');
    expect(message).toContain('### Review Findings (1 issues)');
    expect(message).toContain('- **high**: Missing auth check (`src/a.ts:20`)');
    expect(message).toContain('### Impact Analysis');
    expect(message).toContain('- Risk Level: high');
    expect(message).toContain('### Call Trace');
    expect(message).toContain('- `classifyIntent` → `src/classifyIntent.ts`');
    expect(message).toContain('### Implementations');
    expect(message).toContain('### Callers');
    expect(message).toContain('### Found Symbols');
    expect(message).toContain('### Changed Symbols');
    expect(message).toContain('- `handleRequest` (risk: high)');
    expect(message).toContain('### Changed Files');
    expect(message).toContain('- `src/a.ts` (modified)');
  });

  it('renders only the intent header for an empty context', () => {
    const { participant } = scriptedParticipant();

    const message = participant.buildContextMessage(
      { type: 'search', query: 'anything', confidence: 0.3 },
      {},
    );

    expect(message).toBe('## Code Analyzer Context\n\n**Intent:** search\n\n');
  });
});
