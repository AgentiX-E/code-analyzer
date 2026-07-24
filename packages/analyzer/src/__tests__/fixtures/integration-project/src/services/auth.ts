/**
 * Auth service — handles password validation.
 * Demonstrates a simple utility service pattern.
 */

const MIN_PASSWORD_LENGTH = 8;

/** Validate a password hash meets minimum requirements */
export function validatePassword(hash: string): boolean {
  return hash.length >= MIN_PASSWORD_LENGTH && hash.length > 0;
}

/** Check if a password looks like a hash (contains algorithm prefix) */
export function isPasswordHash(hash: string): boolean {
  return hash.startsWith('$2b$') || hash.startsWith('$2a$') || hash.startsWith('sha256:');
}
