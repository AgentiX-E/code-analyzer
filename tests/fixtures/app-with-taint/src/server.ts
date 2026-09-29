// A service that reads a request and hands part of it to a shell - the shape this tool exists to find.

import { runCommand } from './shell.js';
import { readConfig } from './config.js';

export function handleSearch(request: { query: { term: string } }): string {
  const term = request.query.term;
  const config = readConfig();
  return runCommand(`${config.prefix} ${term}`);
}

export function handleExport(request: { query: { path: string } }): string {
  const target = request.query.path;
  return runCommand(`tar -cf - ${target}`);
}
