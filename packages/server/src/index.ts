// @code-analyzer/server — HTTP REST API (Stub)

export async function createServer(): Promise<{ start: (port: number) => Promise<void>; shutdown: () => Promise<void> }> {
  return {
    start: async (_port: number) => { /* stub */ },
    shutdown: async () => { /* stub */ },
  };
}
