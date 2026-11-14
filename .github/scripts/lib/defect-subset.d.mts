/** The per-category cell the benchmark produces, narrowed to what this protocol reads. */
export interface DefectSubsetRow {
  /** The category the row is about. Only `bug` and `security` are read. */
  readonly category: string;
  /** How many findings in that category the emission rule kept. */
  readonly emitted: number;
  /** How many of them a judge matched to at least one expert-confirmed issue. */
  readonly truePositives: number;
}

/** What a defect-only comparison can and cannot say about one run. */
export interface DefectSubset {
  /** The protocol's name, so an artifact carrying several scorings can say which one a field belongs to. */
  readonly protocol: 'defect-subset-v1';
  /** The categories the protocol reads. */
  readonly categories: string[];
  /** **Which of them emitted anything**, because a subset that shrank to one category is a different measurement. */
  readonly measuredCategories: string[];
  /** Findings emitted in those categories. */
  readonly emitted: number;
  /** Of those, the ones that carried a golden. */
  readonly truePositives: number;
  /** `emitted - truePositives`. */
  readonly falsePositives: number;
  /** `truePositives / emitted`, or `null` when nothing was emitted and therefore nothing is known. */
  readonly precision: number | null;
  /** The headline precision, carried beside it so the pair can be read as a pair. */
  readonly wholeEmissionPrecision: number | null;
  /** Why no defect recall is reported, in the artifact rather than in a report about the artifact. */
  readonly recallWithheld: string;
}

/** The categories a defect detector claims, and the whole of the protocol's definition. */
export declare const DEFECT_CATEGORIES: readonly string[];

/**
 * **The precision of the defect categories, beside the precision of everything.**
 *
 * `null` precision rather than `0` when the subset emitted nothing, because a zero would say the reviewer was wrong
 * everywhere rather than that it said nothing there.
 */
export declare function scoreDefectSubset(input: {
  readonly rows: readonly DefectSubsetRow[];
  readonly wholeEmissionPrecision?: number | null;
}): DefectSubset;
