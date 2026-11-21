// **Declarations for the factorial readback**, because the type-check gate refuses an implicit any rather than
// recording one and the test imports this module directly.

/** One arm as it arrives from its artifact. `configuration` is the only field the factor detection reads. */
export interface GridArm {
  readonly label: string;
  readonly configuration?: Record<string, unknown>;
  readonly f1?: number;
  readonly precision?: number;
  readonly recall?: number;
  readonly truePositives?: number;
  readonly falsePositives?: number;
  readonly spend?: Record<string, unknown>;
}

/** One factor: a configuration key that is not the same in every arm, and the levels it takes in order first seen. */
export interface GridFactor {
  readonly key: string;
  readonly levels: string[];
}

/** One arm's figures, flattened. `null` where the artifact carried no number. */
export interface GridRow {
  readonly label: string;
  readonly f1: number | null;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly k: number;
  readonly cacheNeutralUsd: number | null;
  readonly configurations: Record<string, string>;
}

/** A factor's per-level means, its effect as `from` minus `to`, and whether the levels are equal-sized. */
export interface GridEffect {
  readonly key: string;
  readonly levels: string[];
  readonly summary: Record<string, Record<string, number | null>>;
  readonly effect: Record<string, number | string | null>;
  readonly balance: { readonly balanced: boolean; readonly sizes: number[]; readonly note: string };
}

/** The whole report. `kind` is `'incomplete'` for a set that is not `2^k` arms over `k` factors. */
export interface GridReport {
  readonly kind: 'single' | 'replicates' | 'grid' | 'incomplete';
  readonly arms: number;
  readonly design: {
    readonly factors: number;
    readonly expectedArms: number;
    readonly readArms: number;
    readonly complete: boolean;
  };
  readonly factors: GridEffect[];
  readonly rows: GridRow[];
  readonly best: {
    readonly byF1: GridRow | null;
    readonly byPrecision: GridRow | null;
    readonly byEfficiency: { readonly label: string; readonly f1PerUsd: number } | null;
  };
  readonly consensus: string | null;
}

/** Every configuration key whose value is not the same across the arms. */
export function factorsOf(arms: readonly GridArm[]): GridFactor[];

/** A factor's main effect: the mean of one level minus the mean of the others. */
export function mainEffect(arms: readonly GridArm[], factor: GridFactor): GridEffect;

/** Every arm of a factorial, with the best one named under three different questions. */
export function analyseGrid(arms: readonly GridArm[]): GridReport;

/** The arithmetic, on a grid whose answer was written down before the numbers were. Returns a line or throws. */
export function selfTest(): string;
