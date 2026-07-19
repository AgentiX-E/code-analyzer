// @code-analyzer/core — Internationalization
// Template-based i18n with English as the default locale

export { DEFAULT_MESSAGES } from './en.js';
export {
  DefaultTranslator,
  getTranslator,
  setTranslator,
  resetTranslator,
} from './translator.js';
export type { Translator } from './translator.js';
