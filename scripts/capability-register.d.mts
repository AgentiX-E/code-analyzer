// Types for `capability-register.mjs`, which is a script rather than a package module.
//
// **It is JavaScript because the thing it reads is Markdown and the thing it writes is a string.** A build step for a
// renderer that runs once per push would be a second toolchain for one template literal; the declarations are here so the
// suite that measures it is checked like every other test in the repository.

/** One row of the register, as the table actually spells it. */
export interface RegisterRow {
  id: string;
  capability: string;
  surface: string;
  who: string;
  unit: string;
  e2e: string;
  status: string;
  section: string;
}

/** What the register contains, counted rather than asserted. */
export interface Tally {
  total: number;
  DONE: number;
  PART: number;
  NONE: number;
  O: number;
  C: number;
  P: number;
  e2e: number;
  unit: number;
}

export declare const plain: (text: string) => string;
export declare function parseRows(markdown: string): RegisterRow[];
export declare function provenance(who: string): 'O' | 'C' | 'P';
export declare function state(status: string): 'DONE' | 'PART' | 'NONE';
export declare function count(rows: readonly RegisterRow[]): Tally;
export declare function page(rows: readonly RegisterRow[]): string;
export declare function render(source?: string, target?: string): { rows: number; bytes: number };
export declare function main(
  argv: readonly string[],
  renderPage?: (source?: string, target?: string) => { rows: number; bytes: number },
  log?: { log: (message: string) => void; error: (message: string) => void },
): number;
