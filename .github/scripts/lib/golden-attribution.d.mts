/** The five buckets, in the order they are decided. */
export declare const GOLDEN_BUCKETS: readonly [
  'hit',
  'noPath',
  'fileNotReviewed',
  'noFindingOnPath',
  'findingOnPathRejected',
];

export type GoldenBucket = (typeof GOLDEN_BUCKETS)[number];

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
}

export interface Attribution {
  counts: Record<GoldenBucket, number>;
  perGolden: GoldenAttribution[];
  total: number;
}

export declare function normalisePath(raw: unknown): string;

export declare function attributeGoldens(input: {
  goldens: GoldenInput[];
  reviewedPaths: Array<string | undefined>;
  findings: Array<{ path?: string } | undefined>;
  matches: number[][];
}): Attribution;

export declare function mergeAttributions(
  entries: Array<Attribution & { pr?: string | null }>,
  options?: { examplesPerBucket?: number },
): {
  counts: Record<GoldenBucket, number>;
  examples: Record<GoldenBucket, Array<{ pr: string | null; path: string; note: string }>>;
  total: number;
};

export declare function largestBucket(
  counts: Partial<Record<GoldenBucket, number>>,
): { bucket: GoldenBucket; count: number } | null;
