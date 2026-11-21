/** The three fields the figure reads, typed where the generator is imported rather than cast at each use. */
export interface RecallCeilingStage {
  readonly name: string;
  readonly goldens: number;
  readonly note: string;
}

export interface RecallCeilingData {
  readonly provenance: {
    readonly runId: string;
    readonly sha: string;
    readonly prs: number;
    readonly datasetRows: number;
    readonly slice: { readonly skip: number; readonly requested: number };
    readonly goldens: number;
    readonly goldensAre: string;
    readonly judge: string;
    readonly laneSet: string;
    readonly emissionRule: string;
  };
  readonly stages: readonly RecallCeilingStage[];
  readonly budgetCurve: ReadonlyArray<{
    readonly budgetPerPullRequest: number;
    readonly k: number;
    readonly truePositives: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
  }>;
}

/** **Throws when the stages do not sum to the corpus**, and returns the sum when they do. */
export function checkStages(data: RecallCeilingData): number;
