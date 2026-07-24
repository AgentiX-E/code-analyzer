/**
 * Formatting utilities — string manipulation helpers.
 * Demonstrates a pure utility module with exported functions.
 */

/** Format an email address to lowercase and trim whitespace */
export function formatEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Truncate a string to a maximum length with ellipsis */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/** Slugify a string for URL-safe usage */
export function slugify(text: string): string {
  const normalized = text.toLowerCase().trim();
  return normalized.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
