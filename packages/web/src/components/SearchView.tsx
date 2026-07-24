import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearch, type UseSearchResult } from '../hooks';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TypeFilter = 'all' | 'function' | 'class' | 'module' | 'interface' | 'variable';

/* ------------------------------------------------------------------ */
/*  Debounce hook                                                      */
/* ------------------------------------------------------------------ */

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const SearchView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const debouncedQuery = useDebounce(query, 250);

  // Use the real API hook when query is non-empty, otherwise show nothing
  const effectiveQuery = debouncedQuery.trim();
  const searchResult: UseSearchResult = useSearch(effectiveQuery || '', {
    limit: 50,
    debounceMs: 0, // debounce already handled above
  });

  // We only use searchResult when there's actually a query
  const results = effectiveQuery ? searchResult.results : [];
  const total = effectiveQuery ? searchResult.total : 0;
  const loading = effectiveQuery ? searchResult.loading : false;
  const error = effectiveQuery ? searchResult.error : null;
  const hasSearched = effectiveQuery ? searchResult.hasSearched : false;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Filter results client-side by type if API doesn't support type filter
  const filteredResults = useMemo(() => {
    if (typeFilter === 'all') return results;
    return results.filter((r) => r.type.toLowerCase() === typeFilter.toLowerCase());
  }, [results, typeFilter]);

  const selected = useMemo(
    () => (selectedIdx !== null ? filteredResults[selectedIdx] ?? null : null),
    [selectedIdx, filteredResults],
  );

  const handleResultClick = useCallback((idx: number) => {
    setSelectedIdx((prev) => (prev === idx ? null : idx));
  }, []);

  const typeFilters: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: 'All Types' },
    { value: 'function', label: 'Functions' },
    { value: 'class', label: 'Classes' },
    { value: 'module', label: 'Modules' },
    { value: 'interface', label: 'Interfaces' },
    { value: 'variable', label: 'Variables' },
  ];

  return (
    <div className="search-view">
      <div className="search-bar">
        <div className="search-input-wrapper">
          <span className="search-icon">&#128269;</span>
          <input
            className="search-input"
            type="text"
            placeholder="Search symbols, files, or types..."
            value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            autoFocus
          />
          {loading && <span className="search-spinner">⏳</span>}
        </div>
        <select
          className="filter-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter((e.target as HTMLSelectElement).value as TypeFilter)}
        >
          {typeFilters.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {hasSearched && (
        <div className="search-stats">
          <span>
            <strong>{filteredResults.length}</strong> result{filteredResults.length !== 1 ? 's' : ''} found
            {total !== filteredResults.length && ` (filtered from ${total})`}
          </span>
        </div>
      )}

      {error && (
        <div className="search-error">
          <p>⚠ Search failed: {error}</p>
        </div>
      )}

      <div className="search-content">
        <div className="results-list">
          {!hasSearched && (
            <div className="no-results">
              <p>Start typing to search the codebase</p>
            </div>
          )}
          {hasSearched && !loading && filteredResults.length === 0 && (
            <div className="no-results">
              <p>No results found for &quot;{query}&quot;</p>
              <p style={{ marginTop: 4, fontSize: '0.8125rem' }}>
                Try different keywords or adjust the type filter
              </p>
            </div>
          )}
          {filteredResults.map((result, i) => (
            <div
              key={`${result.file}:${result.line}:${result.name}`}
              className={`result-item ${selectedIdx === i ? 'selected' : ''}`}
              onClick={() => handleResultClick(i)}
            >
              <div className="result-header">
                <span className="result-name">{result.name}</span>
                <span className={`result-type ${result.type.toLowerCase()}`}>{result.type}</span>
              </div>
              <div className="result-meta">
                <span className="result-file" title={result.file}>
                  {result.file}
                </span>
                <span className="result-line">:{result.line}</span>
                {result.score != null && (
                  <span className="result-score">
                    {Math.round(result.score * 100)}% match
                  </span>
                )}
              </div>
              {(result.score != null) && (
                <div className="result-score-bar">
                  <div
                    className="result-score-fill"
                    style={{ width: `${Math.min(result.score * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div className="detail-panel">
          {selected ? (
            <>
              <h3>{selected.name}</h3>
              <div className="detail-row">
                <span className="detail-label">Type</span>
                <span className="detail-value">{selected.type}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">File</span>
                <span className="detail-value">{selected.file}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Line</span>
                <span className="detail-value">{selected.line}</span>
              </div>
              {selected.score != null && (
                <div className="detail-row">
                  <span className="detail-label">Score</span>
                  <span className="detail-value">
                    {Math.round(selected.score * 100)}%
                  </span>
                </div>
              )}
              {selected.snippet && (
                <div className="detail-snippet">{selected.snippet}</div>
              )}
            </>
          ) : (
            <div className="detail-empty">
              <p>Select a result to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchView;
