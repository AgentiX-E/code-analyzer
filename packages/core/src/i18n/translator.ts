import { DEFAULT_MESSAGES } from './en.js';

/**
 * A translator for internationalization with template interpolation.
 * Variables in messages use the `{variable}` syntax.
 */
export interface Translator {
  /**
   * Translate a message key to the target language.
   *
   * @param key - The message key (e.g., 'config.loading').
   * @param params - Optional template parameters for interpolation.
   * @returns The translated string, or the key itself if no translation exists.
   */
  t(key: string, params?: Record<string, string | number>): string;

  /**
   * Check if a translation key exists.
   */
  hasKey(key: string): boolean;

  /**
   * Get the current locale identifier.
   */
  locale: string;
}

/**
 * Default translator implementation.
 * Loads messages from locale-specific message bundles and supports
 * template interpolation with `{variable}` placeholders.
 */
export class DefaultTranslator implements Translator {
  private messages: Record<string, string | number> = {};

  constructor(private localeId = 'en') {
    this.loadLocale(localeId);
  }

  get locale(): string {
    return this.localeId;
  }

  /**
   * Load messages for a specific locale.
   * Currently only 'en' is supported.
   */
  loadLocale(localeId: string): void {
    this.localeId = localeId;
    switch (localeId) {
      case 'en':
      default:
        this.messages = { ...(DEFAULT_MESSAGES) };
        break;
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    const raw = this.messages[key];
    const template = raw !== undefined ? String(raw) : key;

    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (_match, paramName: string) => {
      const value = params[paramName];
      return value !== undefined ? String(value) : `{${paramName}}`;
    });
  }

  hasKey(key: string): boolean {
    return key in this.messages;
  }

  /**
   * Get all available message keys for the current locale.
   */
  getKeys(): string[] {
    return Object.keys(this.messages);
  }
}

/**
 * Shared singleton translator for convenience.
 */
let sharedTranslator: Translator | undefined;

/**
 * Get or create the shared translator instance.
 */
export function getTranslator(): Translator {
  if (!sharedTranslator) {
    sharedTranslator = new DefaultTranslator('en');
  }
  return sharedTranslator;
}

/**
 * Set a custom translator instance (useful for testing with mock translations).
 */
export function setTranslator(translator: Translator): void {
  sharedTranslator = translator;
}

/**
 * Reset the shared translator (useful for testing).
 */
export function resetTranslator(): void {
  sharedTranslator = undefined;
}
