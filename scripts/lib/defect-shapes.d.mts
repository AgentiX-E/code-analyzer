export interface DefectShapeCell {
  hit: number;
  miss: number;
  /** Miss rate, rounded to three decimals; zero when the shape matched no golden. */
  rate: number;
}

export interface DefectShapePartition {
  /** Every golden record in the artifact, of every category. */
  allRecords: number;
  /** Records whose own corpus category is not `Code Defect` - the rows the unfiltered §178.3 table counted by mistake. */
  contamination: number;
  codeDefect: {
    total: number;
    buckets: Record<string, number>;
    rejected: number;
    shapes: Record<'error_path' | 'boundary' | 'counterpart' | 'state', DefectShapeCell>;
    /** Notes matching more than one shape; counted in each. */
    multi: number;
    /** Notes matching no shape; left unclassified rather than invented. */
    none: number;
    /** Whether every Code Defect record landed in a shape or in `none`. */
    reconciled: boolean;
  };
}

export declare const DEFECT_SHAPES: Readonly<Record<string, readonly string[]>>;

export declare function classifyDefectShapes(options: {
  artifact: unknown;
  corpus: unknown;
}): DefectShapePartition;

export declare function describeDefectShapes(result: DefectShapePartition): string;
