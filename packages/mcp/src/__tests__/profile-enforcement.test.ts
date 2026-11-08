// @code-analyzer/mcp — Profile enforcement
//
// **The profile was an advertisement, and this file is the proof that it is now a boundary.**
//
// `listByProfile` filtered what `tools/list` returned and `execute` looked the name up in a map of all fifty-one tools,
// so a client configured as `scout` was shown ten tools and could call any of the other forty-one by name — including
// `delete_project`. Nothing caught it because every test called `registry.execute` directly, which is the caller that
// has no profile, and because a client only learns a name from the list it is shown... unless it reads the README.
//
// The cases below run at two levels on purpose:
//
// 1. **Exhaustively over the registry**, because the invariant is per tool and per profile and there are only 51 × 3 of
//    them: *a tool is callable by a profile if and only if it is advertised to that profile*. A sampled version of this
//    check would pass with one tool leaking.
// 2. **Over a real MCP client and a linked in-memory transport**, because the invariant is worth nothing if the server
//    handler forgets to pass the actor. That is the same class of defect as the parameter that was read by nothing, and
//    the only thing that distinguishes a boundary from a comment is that a request crosses it.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeAnalyzerMCPServer } from '../server/mcp-server.js';
import { createToolRegistry, type ToolRegistry } from '../tools/index.js';
import { ToolContextImpl } from '../tools/tool-context.js';

import type { ToolProfile } from '@code-analyzer/shared';

const PROFILES: readonly ToolProfile[] = ['all', 'analysis', 'scout'];

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close !== undefined) await close();
  }
});

function registry(): ToolRegistry {
  return createToolRegistry();
}

describe('the advertised set and the callable set are the same set', () => {
  it('**holds for all 51 tools under all three profiles**', () => {
    const tools = registry();
    const all = tools.list();
    expect(all).toHaveLength(51);

    const mismatches: string[] = [];
    for (const profile of PROFILES) {
      const advertised = new Set(tools.listByProfile(profile).map((tool) => tool.name));
      for (const tool of all) {
        const callable = tools.authorize({ profile }, tool.name).allowed;
        const visible = advertised.has(tool.name);
        if (callable !== visible) {
          mismatches.push(
            `${profile}: ${tool.name} is ${callable ? 'callable' : 'refused'} but ${
              visible ? 'advertised' : 'hidden'
            }`,
          );
        }
      }
    }
    // Not "no mismatch was found": the list is printed on failure, and an empty list is the assertion.
    expect(mismatches).toEqual([]);
  });

  it('**scout is the narrowest profile, and the gap was 41 tools**', () => {
    const tools = registry();
    const visible = tools.listByProfile('scout').map((tool) => tool.name);
    const callable = tools
      .list()
      .filter((tool) => tools.authorize({ profile: 'scout' }, tool.name).allowed)
      .map((tool) => tool.name);

    // Before this change `callable` was all fifty-one and `visible` was this list, so the gap and the leak were the
    // same number. `analyze_repository` and `delete_project` then left `all` as well, because a profile every client
    // inherits must not carry the two tools that change the store: the number is 43 now, not 41.
    expect(visible).toHaveLength(9);
    expect(callable.sort()).toEqual([...visible].sort());
    expect(51 - visible.length).toBe(42);
  });

  it('**a name that does not exist is refused for a different reason than a name that is not yours**', () => {
    const tools = registry();
    expect(tools.authorize({ profile: 'all' }, 'no_such_tool')).toEqual({
      allowed: false,
      reason: 'unknown-tool',
      message: 'Tool "no_such_tool" not found',
    });
    const denied = tools.authorize({ profile: 'scout' }, 'delete_project');
    expect(denied.allowed).toBe(false);
    expect(denied.allowed === false && denied.reason).toBe('profile');
  });

  it('**the refusal names the profile and points at the list, and does not pretend the tool is missing**', () => {
    const tools = registry();
    const decision = tools.authorize({ profile: 'scout' }, 'delete_project');
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    // A caller told "not found" would retry with another spelling; the sentence has to say why.
    expect(decision.message).toContain('"scout"');
    expect(decision.message).toContain('tools/list');
    expect(decision.message).not.toContain('not found');
  });

  it('**an actor-less call is unrestricted, which is why the server must pass one**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });
    // `list_projects` is `all`, so it proves nothing; `delete_project` is `analysis`, and this is the in-process path
    // the CLI and the harness take. It runs, and it reports an empty delete rather than a refusal.
    const result = await registry().execute('delete_project', { projectId: 'nothing' }, context);
    expect(result.metadata?.['denied']).toBeUndefined();
    expect(result.isError).toBeUndefined();
  });

  it('**an actor is honoured by the registry itself, not only by the server**', async () => {
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });
    const result = await registry().execute('delete_project', { projectId: 'x' }, context, {
      profile: 'scout',
    });
    expect(result.isError).toBe(true);
    expect(result.metadata).toMatchObject({ denied: 'profile', profile: 'scout' });
    expect(result.content[0]?.text).toContain('tools/list');
  });
});

describe('the boundary holds over the protocol, not only in the registry', () => {
  /** A server and a client that speak to each other through a linked pair of in-memory transports. */
  async function connected(profile: ToolProfile): Promise<Client> {
    const server = new CodeAnalyzerMCPServer({ toolProfile: profile });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.getServer().connect(serverSide);
    const client = new Client({ name: 'profile-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientSide);
    closers.push(async () => {
      await client.close();
      await server.shutdown();
    });
    return client;
  }

  it('**tools/list shows a scout client nine tools, all of them read-only**', async () => {
    const client = await connected('scout');
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(9);
    const names = listed.tools.map((tool) => tool.name);
    expect(names).not.toContain('delete_project');
    // **The two that left `all` are the two that change the store.** A profile every client inherits cannot carry
    // them: `analyze_repository` takes a filesystem path, so a discovery client with access to it can read any
    // directory the server can.
    expect(names).not.toContain('analyze_repository');
  });

  it('**tools/call refuses a tool the same client was not shown, and says so as an error**', async () => {
    const client = await connected('scout');
    const result = await client.callTool({ name: 'delete_project', arguments: { projectId: 'x' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toContain('"scout"');
    // The corpus of the refusal is not the point; that the call did not reach the handler is.
    expect(text).not.toContain('deletedNodes');
  });

  it('**the same call succeeds under the `all` profile, so the refusal is the profile and not the tool**', async () => {
    const client = await connected('all');
    const result = await client.callTool({ name: 'delete_project', arguments: { projectId: 'x' } });
    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toContain('deletedNodes');
  });

  it('**every tool the wire advertises is callable over the wire, for a scout client**', async () => {
    const client = await connected('scout');
    const listed = await client.listTools();
    const refused: string[] = [];
    for (const tool of listed.tools) {
      // Arguments are deliberately empty: a call the handler rejects for its arguments is still a call that reached
      // the handler, and "reached the handler" is what this case is about. A profile refusal arrives before validation
      // and carries the profile sentence, which is why the text is what distinguishes them.
      const result = await client.callTool({ name: tool.name, arguments: {} });
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
      if (text.includes('is not available to a client with')) refused.push(tool.name);
    }
    expect(refused).toEqual([]);
  });
});

describe('what a call changes is a second axis, and the catalog declares it', () => {
  it('**all 51 product tools declare an effect, so none is silently `unclassified`**', () => {
    const tools = registry();
    const undeclared = tools
      .list()
      .filter((tool) => tool.effect === 'unclassified')
      .map((tool) => tool.name);
    expect(undeclared).toEqual([]);
  });

  it('**no tool in the `all` profile writes or destroys, because `all` is what every profile inherits**', () => {
    const offending = registry()
      .list()
      .filter((tool) => tool.profile === 'all' && tool.effect !== 'read')
      .map((tool) => `${tool.name} (${tool.effect})`);
    // `analyze_repository` and `delete_project` were both here. The first takes a filesystem path, so its visibility to
    // every client was an arbitrary-read grant; the second is the destruction the whole axis exists for.
    expect(offending).toEqual([]);
  });

  it('**exactly one tool destroys, and it is named for what it does**', () => {
    const destroyers = registry()
      .list()
      .filter((tool) => tool.effect === 'destroy')
      .map((tool) => tool.name);
    expect(destroyers).toEqual(['delete_project']);
  });

  it('**the six writers are the six the handlers prove**', () => {
    const writers = registry()
      .list()
      .filter((tool) => tool.effect === 'write')
      .map((tool) => tool.name)
      .sort();
    // Each of these was checked against its handler: the store, `standardsStore`, `adrStore`, the group manager and
    // the filesystem. `sync_contracts` is not among them even though its name says otherwise — it computes and reports.
    expect(writers).toEqual([
      'analyze_repository',
      'create_standard',
      'export_report',
      'install_skills',
      'manage_adr',
      'manage_repo_group',
    ]);
  });

  it('**a read-only client is refused a write and a destroy, and given every read**', async () => {
    const tools = registry();
    const store = new InMemoryGraphStore();
    const context = new ToolContextImpl(store, { llm: null });
    const actor = { profile: 'analysis', readOnly: true } as const;

    const write = await tools.execute('create_standard', { category: 'naming' }, context, actor);
    expect(write.isError).toBe(true);
    expect(write.metadata).toMatchObject({ denied: 'read-only', tool: 'create_standard' });

    const destroy = await tools.execute('delete_project', { projectId: 'x' }, context, actor);
    expect(destroy.isError).toBe(true);
    expect(destroy.metadata).toMatchObject({ denied: 'read-only', tool: 'delete_project' });
    expect(destroy.content[0]?.text).toContain('destructive');

    const read = await tools.execute('list_projects', {}, context, actor);
    expect(read.metadata?.['denied']).toBeUndefined();
    expect(read.isError).toBeUndefined();
  });

  it('**an unclassified tool is refused to a read-only client and allowed to a writable one**', async () => {
    const tools = registry();
    tools.register('mystery', 'a tool whose registration forgot its effect', {}, async () => ({
      content: [{ type: 'text', text: '{"ok":true}' }],
    }));

    const readOnly = tools.authorize({ profile: 'all', readOnly: true }, 'mystery');
    expect(readOnly.allowed).toBe(false);
    expect(readOnly.allowed === false && readOnly.reason).toBe('unclassified');

    // Fail-closed where the caller asked for a guarantee, and unchanged where it did not: a client that never claimed
    // to be read-only is not given a new failure by a tool that predates the field.
    expect(tools.authorize({ profile: 'all' }, 'mystery').allowed).toBe(true);
  });
});

describe('the read-only role holds over the protocol', () => {
  async function connectedReadOnly(): Promise<Client> {
    const server = new CodeAnalyzerMCPServer({ toolProfile: 'analysis', readOnly: true });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.getServer().connect(serverSide);
    const client = new Client({ name: 'ro-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientSide);
    closers.push(async () => {
      await client.close();
      await server.shutdown();
    });
    return client;
  }

  it('**advertises the write tools it will refuse, so the list is not a promise it breaks silently**', async () => {
    const client = await connectedReadOnly();
    const listed = await client.listTools();
    // The profile governs visibility and the flag governs effect: `analysis` still *shows* `delete_project`. Filtering
    // the list would hide that a deployment has a capability it does not grant, and the refusal is what a caller needs
    // to read; this case pins the current answer rather than assuming one.
    expect(listed.tools.map((tool) => tool.name)).toContain('delete_project');
  });

  it('**refuses the destructive call and allows the read, over the wire**', async () => {
    const client = await connectedReadOnly();

    const denied = await client.callTool({
      name: 'delete_project',
      arguments: { projectId: 'x' },
    });
    expect(denied.isError).toBe(true);
    expect((denied.content as Array<{ text?: string }>)[0]?.text).toContain('read-only');

    const allowed = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(allowed.isError).toBeUndefined();
  });
});
