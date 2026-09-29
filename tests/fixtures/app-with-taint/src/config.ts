// A helper that returns configuration, which the handler then concatenates into a command.

export function readConfig(): { prefix: string } {
  const prefix: string = process.env.SEARCH_PREFIX ?? 'grep';
  return { prefix };
}
