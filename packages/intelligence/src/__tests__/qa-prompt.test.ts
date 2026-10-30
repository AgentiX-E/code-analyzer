// The prompt and the block rendering — unit tests.
//
// **A prompt is an interface with a model**, and the parts that can be wrong are the ones a model is sensitive to:
// whether a block says where it is, whether a structural block says why it is there, and whether the instruction to
// abstain is actually in the text. Testing the whole string would fail on every wording change; testing these three
// properties fails only when the contract does.

import { describe, expect, it } from 'vitest';

import { answerPrompt, renderBlock } from '../qa/prompt.js';
import { ABSTAIN_REASONS } from '../qa/types.js';

import type { ContextBlock } from '../qa/types.js';

function block(overrides: Partial<ContextBlock> = {}): ContextBlock {
  return {
    id: 1,
    nodeId: 11,
    name: 'parse_token',
    qualifiedName: 'app.auth.parse_token',
    label: 'Function',
    filePath: 'app/auth.py',
    startLine: 10,
    endLine: 14,
    language: 'python',
    signature: 'def parse_token(raw):',
    body: 'def parse_token(raw):\n    return raw.split(".")[0]',
    origin: 'retrieved',
    reachedBy: null,
    score: 1,
    ...overrides,
  };
}

describe('renderBlock', () => {
  it('leads with the citation number and the place', () => {
    const text = renderBlock(block());
    expect(text.split('\n')[0]).toBe('[1] app.auth.parse_token (Function) — app/auth.py:10');
  });

  it('omits the line when the provider recorded none, rather than printing null', () => {
    const text = renderBlock(block({ startLine: null }));
    expect(text).toContain('— app/auth.py\n');
    expect(text).not.toContain('null');
  });

  it('includes the signature', () => {
    expect(renderBlock(block())).toContain('signature: def parse_token(raw):');
  });

  it('says which edge reached a structural block, by citation number', () => {
    const text = renderBlock(
      block({ id: 4, origin: 'graph', reachedBy: { relation: 'CALLS', from: 2 } }),
    );
    // **`[2]`, not a node id**: the model was shown numbers, so the reason it was given a block has to use one.
    expect(text).toContain('reached by: CALLS from block [2]');
  });

  it('omits the reached-by line for a retrieved block', () => {
    expect(renderBlock(block())).not.toContain('reached by');
  });

  it('indents the body, so the model can tell code from metadata', () => {
    const lines = renderBlock(block()).split('\n');
    expect(lines.slice(2).every((line) => line.startsWith('    '))).toBe(true);
  });

  it('renders a block with no body without a phantom blank line', () => {
    const text = renderBlock(block({ body: null, signature: null }));
    expect(text.split('\n')).toHaveLength(1);
  });
});

describe('answerPrompt', () => {
  const blocks = [
    block(),
    block({ id: 2, qualifiedName: 'app.views.login', filePath: 'app/views.py' }),
  ];

  it('carries the question verbatim', () => {
    expect(answerPrompt('where is the token parsed?', blocks)).toContain(
      'Question: where is the token parsed?',
    );
  });

  it('renders every block it was given, and says how many there are', () => {
    const prompt = answerPrompt('q', blocks);
    expect(prompt).toContain('[1] app.auth.parse_token');
    expect(prompt).toContain('[2] app.views.login');
    // **The count is what the model checks its own answer against**, so it is stated rather than inferred.
    expect(prompt).toContain('There are 2 blocks.');
  });

  it('asks for abstention explicitly', () => {
    // **The one instruction an unconstrained model will not follow on its own**, because producing an answer is what
    // it is for. Its absence is invisible in a green suite and visible only as confident nonsense.
    const prompt = answerPrompt('q', blocks);
    expect(prompt).toContain('The indexed code does not answer');
    expect(prompt).toContain('Do not use knowledge of similar projects');
  });

  it('states the citation contract', () => {
    const prompt = answerPrompt('q', blocks);
    expect(prompt).toContain('Every factual claim must cite the block it came from');
    expect(prompt).toContain('Cite only numbers that appear above');
  });

  it('ends on the answer marker, because a completion continues it', () => {
    expect(answerPrompt('q', blocks).trimEnd().endsWith('Answer:')).toBe(true);
  });
});

describe('ABSTAIN_REASONS', () => {
  it('is the closed set the orchestrator reports', () => {
    // **A tuple rather than a union**, so a tool can enumerate the reasons and a test can assert the orchestrator
    // never invents one. The membership check is the invariant; the list itself is allowed to grow.
    expect(ABSTAIN_REASONS.length).toBeGreaterThan(0);
    expect(new Set(ABSTAIN_REASONS).size).toBe(ABSTAIN_REASONS.length);
    expect(ABSTAIN_REASONS).toContain('no-provider');
    expect(ABSTAIN_REASONS).toContain('no-grounded-claim');
  });
});
