/** The five buckets, in the order they are decided. */
export declare const GOLDEN_BUCKETS: readonly [
  'hit',
  'noPath',
  'fileNotReviewed',
  'noFindingOnPath',
  'findingOnPathRejected',
];

export type GoldenBucket = (typeof GOLDEN_BUCKETS)[number];

/** The four shapes a `findingOnPathRejected` golden can take, decided by line distance to the nearest finding. */
export declare const REJECTION_SHAPES: readonly ['sameLine', 'within10', 'beyond50', 'noLine'];

export type RejectionShape = (typeof REJECTION_SHAPES)[number];

export interface GoldenInput {
  path?: string;
  note?: string;
  startLine?: number | null;
  endLine?: number | null;
}

/** The finding a rejection was measured against, and the gate's verdict on it. */
export interface NearestFinding {
  /** Its position in the ranked list the bench script emitted, so a reader can join it to the ranker's own rows. */
  at: number;
  startLine: number | null;
  endLine: number | null;
  /** Whether the actionability gate kept it - the field that separates a wording defect from a gate defect. */
  actionable: boolean;
  why: string[];
  text: string;
}

export interface GoldenAttribution {
  index: number;
  bucket: GoldenBucket;
  path: string;
  note: string;
  matchedFindings: number[];
  /** Lines from the golden to the nearest finding on its own path, or `null` when it is not a rejection. */
  proximity: number | null;
  /** The finding that distance was measured to, or `null` when there is no rejection to explain. */
  nearestFinding: NearestFinding | null;
}

export interface Attribution {
  counts: Record<GoldenBucket, number>;
  perGolden: GoldenAttribution[];
  total: number;
}

export declare function normalisePath(raw: unknown): string;

export declare function rejectionShapeOf(distance: number | null | undefined): RejectionShape;

export declare function nearestOnPath(
  goldenLine: number | null | undefined,
  findings: Array<
    | { path?: string; startLine?: number | null; endLine?: number | null }
    | {
        finding?: {
          startLine?: number | null;
          endLine?: number | null;
          title?: string;
          description?: string;
        } | null;
        score?: { actionable?: boolean; why?: string[] } | null;
      }
    | undefined
  >,
): {
  at: number;
  distance: number | null;
  startLine: number | null;
  endLine: number | null;
  finding: unknown;
} | null;

export declare function nearestFindingDistance(
  goldenLine: number | null | undefined,
  findings: Array<
    | { path?: string; startLine?: number | null; endLine?: number | null }
    | { finding?: { startLine?: number | null; endLine?: number | null } | null }
    | undefined
  >,
): number | null;

export declare function attributeGoldens(input: {
  goldens: GoldenInput[];
  reviewedPaths: Array<string | undefined>;
  findings: Array<
    | { path?: string; startLine?: number | null; endLine?: number | null }
    | {
        path?: string;
        finding?: {
          startLine?: number | null;
          endLine?: number | null;
          title?: string;
          description?: string;
        } | null;
        score?: { actionable?: boolean; why?: string[] } | null;
      }
    | undefined
  >;
  matches: number[][];
}): Attribution;

/** One golden, in full - the layer a follow-up analysis reads where `examples` is the layer a person skims. */
export interface AttributionRecord {
  pr: string | null;
  goldenIndex: number;
  bucket: GoldenBucket;
  path: string;
  note: string;
  proximity: number | null;
  matchedFindings: number[];
  /** The finding the rejection is about, carried so that the artifact can be read without buying the run again. */
  nearestFinding: NearestFinding | null;
}

export declare function mergeAttributions(
  entries: Array<Attribution & { pr?: string | null }>,
  options?: { examplesPerBucket?: number; noteCharsInExamples?: number },
): {
  counts: Record<GoldenBucket, number>;
  examples: Record<GoldenBucket, Array<{ pr: string | null; path: string; note: string }>>;
  total: number;
  rejectionShape: Record<RejectionShape, number>;
  /** Every golden, in corpus order - `records.length === total` or the function throws. */
  records: AttributionRecord[];
};

export declare function largestBucket(
  counts: Partial<Record<GoldenBucket, number>>,
): { bucket: GoldenBucket; count: number } | null;

export declare function dominantRejectionShape(
  rejectionShape: Partial<Record<RejectionShape, number>>,
): { shape: RejectionShape; count: number } | null;
