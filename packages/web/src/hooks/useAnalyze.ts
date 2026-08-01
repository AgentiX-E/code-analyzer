// @code-analyzer/web — useAnalyze hook
import { useState, useCallback } from 'react';
import { analyzeRepository, type AnalyzeResult } from '../api/client';

export interface UseAnalyzeResult {
  data: AnalyzeResult | null;
  loading: boolean;
  error: string | null;
  /** Trigger a repository analysis. Returns the result. */
  analyze: (path: string, projectName?: string) => Promise<AnalyzeResult | null>;
}

/**
 * Hook for triggering repository analysis on demand.
 */
export function useAnalyze(): UseAnalyzeResult {
  const [data, setData] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (path: string, projectName?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeRepository(path, { projectName });
      setData(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, analyze };
}
