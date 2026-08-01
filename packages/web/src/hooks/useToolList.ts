// @code-analyzer/web — useToolList hook
import { useState, useEffect, useCallback } from 'react';
import { getToolList, type ToolInfo } from '../api/client';

export interface UseToolListResult {
  data: ToolInfo[];
  loading: boolean;
  error: string | null;
  /** Tools grouped by category. */
  byCategory: Record<string, ToolInfo[]>;
  refetch: () => void;
}

/**
 * Fetches the list of available MCP tools from the server.
 */
export function useToolList(): UseToolListResult {
  const [data, setData] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getToolList();
      setData(res.tools);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const byCategory: Record<string, ToolInfo[]> = {};
  for (const tool of data) {
    const cat = tool.category || 'other';
    (byCategory[cat] ??= []).push(tool);
  }

  return { data, loading, error, byCategory, refetch: fetch };
}
