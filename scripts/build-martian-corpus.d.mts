/** The corpus builder, typed for the test tree that reads it. */
export declare const PROFILES: {
  readonly strict: readonly string[];
  readonly core: readonly string[];
  readonly all: null;
};

/** One golden, in the harness's row shape. */
export interface MartianComment {
  readonly note: string;
  readonly category: string;
  readonly severity: string;
  readonly path: null;
  readonly from_line: null;
  readonly to_line: null;
}

/** One pull request's answer key. */
export interface MartianRow {
  readonly githubPrUrl: string;
  readonly prTitle: string;
  readonly comments: readonly MartianComment[];
}

export declare function martianRows(files: ReadonlyMap<string, string>): MartianRow[];

export declare function profileCount(
  rows: readonly MartianRow[],
  profile: keyof typeof PROFILES,
): number;
