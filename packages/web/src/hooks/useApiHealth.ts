// @code-analyzer/web — useApiHealth hook
import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiHealth, type HealthResponse } from '../api/client';

export interface UseApiHealthResult {
  data: HealthResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Polls /api/v1/health on an interval. Returns health status, memory usage,
 * and uptime.
 */
export function useApiHealth(pollIntervalMs = 30_000): UseApiHealthResult {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    try {
      const result = await getApiHealth();
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Health check failed');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetch();

    const timer = setInterval(fetch, pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetch, pollIntervalMs]);

  return { data, loading, error, refetch: fetch };
}
