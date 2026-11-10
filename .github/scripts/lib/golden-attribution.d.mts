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

export interface GoldenAttribution {
  index: number;
  bucket: GoldenBucket;
  path: string;
  note: string;
  matchedFindings: number[];
  /** Lines from the golden to the nearest finding on its own path, or `null` when it is not a rejection. */
  proximity: number | null;
}

export interface Attribution {
  counts: Record<GoldenBucket, number>;
  perGolden: GoldenAttribution[];
  total: number;
}

export declare function normalisePath(raw: unknown): string;

export declare function rejectionShapeOf(distance: number | null | undefined): RejectionShape;

export declare function nearestFindingDistance(
  goldenLine: number | null | undefined,
  findings: Array<{ startLine?: number | null; endLine?: number | null } | undefined>,
): number | null;

export declare function attributeGoldens(input: {
  goldens: GoldenInput[];
  reviewedPaths: Array<string | undefined>;
  findings: Array<{ path?: string; startLine?: number | null; endLine?: number | null } | undefined>;
  matches: number[][];
}): Attribution;

export declare function mergeAttributions(
  entries: Array<Attribution & { pr?: string | null }>,
  options?: { examplesPerBucket?: number },
): {
  counts: Record<GoldenBucket, number>;
  examples: Record<GoldenBucket, Array<{ pr: string | null; path: string; note: string }>>;
  total: number;
  rejectionShape: Record<RejectionShape, number>;
};

export declare function largestBucket(
  counts: Partial<Record<GoldenBucket, number>>,
): { bucket: GoldenBucket; count: number } | null;

export declare function dominantRejectionShape(
  rejectionShape: Partial<Record<RejectionShape, number>>,
): { shape: RejectionShape; count: number } | null;
