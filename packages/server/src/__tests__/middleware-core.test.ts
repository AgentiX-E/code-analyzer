import { describe, it, expect } from 'vitest';

describe('Core middleware', () => {
  it('CORS module exports functions', async () => {
    const m = await import('../middleware/cors.js');
    const keys = Object.keys(m);
    expect(keys.length).toBeGreaterThan(0);
  });
  it('Error handler exports functions', async () => {
    const m = await import('../middleware/error-handler.js');
    expect(Object.keys(m).length).toBeGreaterThan(0);
  });
  it('Logging middleware exports functions', async () => {
    const m = await import('../middleware/logging.js');
    expect(Object.keys(m).length).toBeGreaterThan(0);
  });
});
