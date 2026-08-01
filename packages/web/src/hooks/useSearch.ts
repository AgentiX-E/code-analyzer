// @code-analyzer/web — useSearch hook
import { useState, useEffect, useRef } from 'react';
import { searchCode, type SearchResult } from '../api/client';

export interface UseSearchResult {
  results: SearchResult[];
  total: number;
  loading: boolean;
  error: string | null;
  hasSearched: boolean;
}

/**
 * Debounced code search. Triggers API call when `query` changes
 * (after `debounceMs` delay).
 */
export function useSearch(
  query: string,
  options?: { limit?: number; projectId?: string; debounceMs?: number },
): UseSearchResult {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const debounceMs = options?.debounceMs ?? 300;

  useEffect(() => {
    // Clear any pending debounce
    if (timerRef.current) clearTimeout(timerRef.current);

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();

    // Don't search empty queries
    if (!query.trim()) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    timerRef.current = setTimeout(async () => {
      try {
        const data = await searchCode(query, {
          limit: options?.limit ?? 50,
          projectId: options?.projectId,
        });
        setResults(data.results);
        setTotal(data.total);
        setError(null);
        setHasSearched(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, options?.limit, options?.projectId, debounceMs]);

  return { results, total, loading, error, hasSearched };
}
