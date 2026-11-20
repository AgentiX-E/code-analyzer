export declare function buildJudgeMessages(
  golden: string,
  comments: readonly string[],
): { system: string; user: string };

export declare function parseJudgeBatch(text: unknown, count: number): boolean[] | null;

export declare function chunkIndices(count: number, size: number): number[][];
