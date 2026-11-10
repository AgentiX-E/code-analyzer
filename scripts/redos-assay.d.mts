// Types for `scripts/redos-assay.mjs`.
//
// **Not generated, and deliberately narrow.** A test that imported this module and read its exports as `any` would compile
// against any shape at all - which is the defect this repository already recorded once for the ablation script: *an
// untyped subject is a test that cannot be wrong*. The declarations below name every export the tests use, so renaming
// one breaks the test at compile time rather than at run time.

export const SIZES: readonly [number, number];
export const SLOW_MS: number;
export const QUADRATIC_GROWTH: number;
export const KILL_MS: number;
export const REDOS_RULES: readonly string[];

export interface RegexLiteral {
  pattern: string;
  flags: string;
  startLine: number;
  endLine: number;
  assignedTo: string | null;
}

export interface Finding {
  rule: string;
  file: string;
  line: number;
  message: string;
}

export interface AssayedFinding extends Finding {
  pattern: string | null;
  flags: string | null;
  locatedBy: string | null;
  outcome: 'quadratic' | 'linear' | 'unmeasured' | 'unlocated' | 'no-claim' | 'error';
  ms: number | null;
  growth: number | null;
  error?: string | null;
  killed?: boolean;
}

export function regexLiteralsIn(source: string): RegexLiteral[];
export function assignmentTarget(source: string, offset: number): string | null;
export function regexConsumers(line: string): string[];
export function locateLiteral(
  finding: { line: number },
  literals: readonly RegexLiteral[],
  source: string,
): { literal: RegexLiteral | null; locatedBy: string | null };
export function pumpFromMessage(message: string): { prefix: string; pump: string } | null;
export function adversarialString(claim: { prefix: string; pump: string }, size: number): string;
export function measureOnce(
  literal: { pattern: string; flags: string },
  input: string,
  options?: { killMs?: number },
): { ms: number | null; killed: boolean; error: string | null };
export function verdictOf(measured: {
  ms: number | null;
  growth: number | null;
  killed: boolean;
  slowMs?: number;
  growthLine?: number;
}): 'quadratic' | 'linear' | 'unmeasured';
export function assay(
  findings: readonly Finding[],
  readSource: (file: string) => string,
  options?: { sizes?: readonly number[]; killMs?: number; slowMs?: number; growthLine?: number },
): AssayedFinding[];
