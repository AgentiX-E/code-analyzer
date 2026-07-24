// @code-analyzer/web — useGraphStats hook
import { useState, useEffect, useCallback } from 'react';
import { getIndexStatus, type GraphStats } from '../api/client';

export interface UseGraphStatsResult {
  data: GraphStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches graph index statistics (nodes, edges, files).
 */
export function useGraphStats(projectId?: string): UseGraphStatsResult {
  const [data, setData] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await getIndexStatus(projectId);
      setData(stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
