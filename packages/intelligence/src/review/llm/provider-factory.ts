// @code-analyzer/intelligence — which LLM provider a deployment runs
//
// **A registry of one, written so that it is a registry.** Every LLM-dependent component in this repository takes an
// `LLMProvider`; the one thing that was hard-coded was the *choice* - `new DeepSeekProvider()` at the call site - which
// is the single point of lock-in the abstraction was supposed to remove. **A registry keyed by name turns "switch
// vendor" into "register a factory", and turns "which vendor is configured" into a fact a caller can read** instead of
// an `if` buried somewhere.
//
// **Nothing here reads a key.** A factory decides whether it can run, and `availableLLMProviderName` reports the
// configured name or `null`; the caller decides what to do with the absence, which is the same rule the embedding
// backends follow.

import { DeepSeekProvider } from './provider.js';

import type { LLMProvider } from './provider.js';

/** The providers this build knows how to construct. **Adding a vendor adds a name here and a factory below.** */
export type LLMProviderName = 'deepseek';

type ProviderFactory = () => LLMProvider;

/**
 * The factories, keyed by name.
 *
 * **A function rather than a `Map` at module scope**, so a test can register a provider without leaving it registered
 * for every later test in the same file — the seam is explicit and the state is per call.
 */
const FACTORIES: Record<LLMProviderName, ProviderFactory> = {
  deepseek: () => new DeepSeekProvider(),
};

/** The environment variable that names the provider, when a deployment names one. */
const PROVIDER_ENV = 'LLM_PROVIDER';

/** Every provider this build can construct. */
export function knownLLMProviders(): LLMProviderName[] {
  return Object.keys(FACTORIES) as LLMProviderName[];
}

/** Whether a name is one this build knows. **A string from the environment is not trusted to be one.** */
export function isLLMProviderName(value: string | undefined | null): value is LLMProviderName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FACTORIES, value);
}

/**
 * The provider to use, or `null` when none can be built.
 *
 * **`LLM_PROVIDER` wins when it names a known provider**; otherwise the first factory that can run is used, and
 * `null` means none could - which is an answer, not an error, because every caller of this function has a behaviour
 * that does not need a model.
 */
export function createLLMProvider(
  requested: string | undefined = process.env[PROVIDER_ENV],
  factories: Record<string, ProviderFactory> = FACTORIES,
): LLMProvider | null {
  if (isLLMProviderName(requested)) {
    try {
      return factories[requested]!();
    } catch {
      // **A named provider that cannot run is still an absence**: `DeepSeekProvider` throws when the key is missing, and
      // a caller that got an exception here would have to know which vendor throws what.
      return null;
    }
  }
  for (const name of Object.keys(factories)) {
    try {
      return factories[name]!();
    } catch {
      continue;
    }
  }
  return null;
}
