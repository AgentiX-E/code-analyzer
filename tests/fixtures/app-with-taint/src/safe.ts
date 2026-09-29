// The same shape with the value sanitized before it reaches the sink, which must not be reported.

import { runCommand } from './shell.js';

export function handleList(request: { query: { term: string } }): string {
  const term = request.query.term;
  const safe: string = encodeURIComponent(term);
  return runCommand(`ls ${safe}`);
}
