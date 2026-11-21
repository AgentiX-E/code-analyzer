// @code-analyzer/intelligence — which LLM provider a deployment runs
//
// **A registry of one, written so that it is a registry.** Every LLM-dependent component in this repository takes an
// `LLMProvider`; the one thing that was hard-coded was the *choice* - `new DeepSeekProvider()` at the call site - which
// is the single point of lock-in the abstraction was supposed to remove. **A registry keyed by name turns "switch
// vendor" into "register a factory", and turns "which vendor is configured" into a fact a caller can read** instead of
// an `if` buried somewhere.
//
// **It is a registry of two now, and the second entry was added by a measurement rather than by a preference.** §125
// read three studies agreeing that *the defects one model finds are not the defects another finds* - 56.8 % of defects
// caught by exactly one model, cross-family Jaccard 0.29 - so a recall figure measured on one family is that family's
// blind spots wearing the corpus's name. **A registry with one entry cannot test that claim**, which is what made the
// second vendor a requirement rather than an option.
//
// **Nothing here reads a key.** A factory decides whether it can run, and `availableLLMProviderName` reports the
// configured name or `null`; the caller decides what to do with the absence, which is the same rule the embedding
// backends follow.

import { DeepSeekProvider, ZhipuProvider } from './provider.js';

import type { LLMProvider, ProviderOptions } from './provider.js';

/** The providers this build knows how to construct. **Adding a vendor adds a name here and a factory below.** */
export type LLMProviderName = 'deepseek' | 'zhipu';

type ProviderFactory = (options?: ProviderOptions) => LLMProvider;

/**
 * The factories, keyed by name.
 *
 * **A function rather than a `Map` at module scope**, so a test can register a provider without leaving it registered
 * for every later test in the same file — the seam is explicit and the state is per call.
 *
 * **Insertion order is the fallback order, and `deepseek` is first on purpose.** The fallback below takes the first
 * factory that can run, so **the order is a measurement decision**: every figure in `docs/EVAL-CONTRACT.md` was measured
 * on DeepSeek, and a deployment holding both keys that named neither must keep running the family those figures
 * describe. **Growing the registry therefore appends and never reorders** - a sixth vendor inserted at the top would
 * silently re-price every published number while every test that asserts a name still passed.
 *
 * **What the second entry does change**: a deployment holding only `ZHIPU_API_KEY`, which used to build no provider at
 * all, now builds GLM. That is a deliberate consequence and it is stated here rather than discovered - the alternative is
 * a registry whose second entry is unreachable without a variable nobody sets, which is a registry of one with extra
 * lines. **A caller that must not spend on an unnamed vendor names one**, and `LLM_PROVIDER` is that name.
 */
const FACTORIES: Record<LLMProviderName, ProviderFactory> = {
  deepseek: (options) => new DeepSeekProvider(options),
  zhipu: (options) => new ZhipuProvider(options),
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
 *
 * **`options` are the vendor's, and they exist because a second caller needed them.** A factory that could only build
 * an unconfigured provider was enough for the MCP tools, and **the benchmark job - the one caller that spends money -
 * needs a ledger and a ceiling on every call it makes**, so a registry that could not be given them was a registry the
 * one spending caller had to bypass. The pass-through is the difference between a registry that is used and one that is
 * documented.
 */
export function createLLMProvider(
  requested: string | undefined = process.env[PROVIDER_ENV],
  factories: Record<string, ProviderFactory> = FACTORIES,
  options?: ProviderOptions,
): LLMProvider | null {
  if (isLLMProviderName(requested)) {
    try {
      return factories[requested]!(options);
    } catch {
      // **A named provider that cannot run is still an absence**: `DeepSeekProvider` throws when the key is missing, and
      // a caller that got an exception here would have to know which vendor throws what.
      return null;
    }
  }
  for (const name of Object.keys(factories)) {
    try {
      return factories[name]!(options);
    } catch {
      continue;
    }
  }
  return null;
}
