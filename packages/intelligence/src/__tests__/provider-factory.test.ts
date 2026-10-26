// The provider factory: a name from the environment, a factory per vendor, and an absence that is an answer.
//
// **The test does not touch the network and does not read a key.** Every case injects its own factory table, which is
// the same seam a deployment uses to register a vendor - so what is asserted here is the selection rule, not a wiring
// detail.

import { describe, expect, it } from 'vitest';

import {
  createLLMProvider,
  isLLMProviderName,
  knownLLMProviders,
} from '../review/llm/provider-factory.js';

import type { LLMProvider } from '../review/llm/provider.js';

const fake = (name: string): LLMProvider =>
  ({ name, complete: async () => ({ content: '', model: name }) }) as unknown as LLMProvider;

describe('the provider registry', () => {
  it('knows DeepSeek, because that is what this build ships', () => {
    expect(knownLLMProviders()).toContain('deepseek');
    expect(isLLMProviderName('deepseek')).toBe(true);
    expect(isLLMProviderName('gemini')).toBe(false);
    expect(isLLMProviderName(undefined)).toBe(false);
    // **An inherited property is not a provider**: `toString` is on every object, and a factory table is an object.
    expect(isLLMProviderName('toString')).toBe(false);
  });

  it('uses the provider the environment names, when it names a known one', () => {
    const provider = createLLMProvider('deepseek', { deepseek: () => fake('deepseek') });
    expect(provider?.name).toBe('deepseek');
  });

  it('falls through to the first factory that can run when the name is unknown', () => {
    const provider = createLLMProvider('gemini', {
      deepseek: () => fake('deepseek'),
      other: () => fake('other'),
    });
    expect(provider?.name).toBe('deepseek');
  });

  it('reports an absence rather than an exception, which is what a caller without a key needs', () => {
    // **A named provider that throws is the DeepSeek-without-a-key case**, and a caller that had to know that would be
    // back to importing one vendor's error class.
    expect(
      createLLMProvider('deepseek', {
        deepseek: () => {
          throw new Error('no key');
        },
      }),
    ).toBeNull();
  });

  it('skips a factory that cannot run and takes the next one', () => {
    const provider = createLLMProvider(undefined, {
      first: () => {
        throw new Error('no key');
      },
      second: () => fake('second'),
    });
    expect(provider?.name).toBe('second');
  });

  it('is null when every factory refuses', () => {
    expect(
      createLLMProvider(undefined, {
        only: () => {
          throw new Error('no key');
        },
      }),
    ).toBeNull();
  });
});
