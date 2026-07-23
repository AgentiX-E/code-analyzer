import React, { useCallback, useEffect, useMemo, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SearchResult {
  name: string;
  type: string;
  file: string;
  line: number;
  score: number;
  snippet?: string;
}

type TypeFilter = 'all' | 'function' | 'class' | 'module' | 'interface' | 'variable';

/* ------------------------------------------------------------------ */
/*  Mock search backend                                                */
/* ------------------------------------------------------------------ */

const MOCK_RESULTS: SearchResult[] = [
  {
    name: 'parseArgs',
    type: 'function',
    file: 'src/cli/parser.ts',
    line: 42,
    score: 0.94,
    snippet: 'export function parseArgs(argv: string[]): CliOptions {\n  const args = minimist(argv);\n  return { ... }',
  },
  {
    name: 'UserService',
    type: 'class',
    file: 'src/services/user.ts',
    line: 15,
    score: 0.88,
    snippet: 'export class UserService implements IUserService {\n  constructor(private db: Database) {}',
  },
  {
    name: 'validate',
    type: 'function',
    file: 'src/utils/validate.ts',
    line: 8,
    score: 0.85,
    snippet: 'export function validate<T>(data: unknown, schema: Schema<T>): T {\n  const result = ...',
  },
  {
    name: 'AppConfig',
    type: 'interface',
    file: 'src/config/types.ts',
    line: 3,
    score: 0.82,
    snippet: 'export interface AppConfig {\n  port: number;\n  host: string;\n  logLevel: LogLevel;',
  },
  {
    name: 'Database',
    type: 'class',
    file: 'src/db/database.ts',
    line: 22,
    score: 0.79,
    snippet: 'export class Database {\n  private pool: Pool;\n  async connect(): Promise<void> {',
  },
  {
    name: 'sanitize',
    type: 'function',
    file: 'src/utils/sanitize.ts',
    line: 5,
    score: 0.76,
    snippet: 'export function sanitize(input: string): string {\n  return input.replace(/[<>]/g, "");',
  },
  {
    name: 'CacheManager',
    type: 'class',
    file: 'src/cache/manager.ts',
    line: 30,
    score: 0.71,
    snippet: 'export class CacheManager {\n  private store = new Map<string, CacheEntry>();',
  },
  {
    name: 'Logger',
    type: 'class',
    file: 'src/logging/logger.ts',
    line: 18,
    score: 0.68,
    snippet: 'export class Logger {\n  constructor(private level: LogLevel) {}',
  },
  {
    name: 'constants',
    type: 'module',
    file: 'src/constants.ts',
    line: 1,
    score: 0.65,
    snippet: 'export const VERSION = "1.0.0";\nexport const DEFAULT_PORT = 3000;',
  },
  {
    name: 'IRepository',
    type: 'interface',
    file: 'src/db/repository.ts',
    line: 1,
    score: 0.62,
    snippet: 'export interface IRepository<T> {\n  findById(id: string): Promise<T>;\n  findAll(): Promise<T[]>;',
  },
  {
    name: 'formatDate',
    type: 'function',
    file: 'src/utils/format.ts',
    line: 12,
    score: 0.58,
    snippet: 'export function formatDate(date: Date, format: string): string {\n  return dayjs(date).format(format);',
  },
  {
    name: 'Router',
    type: 'class',
    file: 'src/http/router.ts',
    line: 10,
    score: 0.55,
    snippet: 'export class Router {\n  private routes: Route[] = [];\n  add(method, path, handler) {',
  },
];

function mockSearch(query: string, typeFilter: TypeFilter): { results: SearchResult[]; timeMs: number } {
  const start = performance.now();
  const q = query.toLowerCase();

  let filtered = MOCK_RESULTS;

  if (q) {
    filtered = filtered.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.file.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q),
    );
  }

  if (typeFilter !== 'all') {
    filtered = filtered.filter((r) => r.type === typeFilter);
  }

  // Sort by relevance (score)
  filtered = [...filtered].sort((a, b) => b.score - a.score);

  const end = performance.now();
  return { results: filtered, timeMs: Math.round((end - start) * 100) / 100 };
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [timeMs, setTimeMs] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    if (!debouncedQuery && typeFilter === 'all') {
      if (hasSearched) {
        // Show all results when clearing
        const { results: all, timeMs: t } = mockSearch('', 'all');
        setResults(all);
        setTimeMs(t);
      } else {
        setResults([]);
      }
      return;
    }

    const { results: r, timeMs: t } = mockSearch(debouncedQuery, typeFilter);
    setResults(r);
    setTimeMs(t);
    setHasSearched(true);
    setSelectedIdx(null);
  }, [debouncedQuery, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => (selectedIdx !== null ? results[selectedIdx] ?? null : null),
    [selectedIdx, results],
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
            <strong>{results.length}</strong> result{results.length !== 1 ? 's' : ''} found
          </span>
          {timeMs > 0 && <span className="time">{timeMs} ms</span>}
        </div>
      )}

      <div className="search-content">
        <div className="results-list">
          {!hasSearched && (
            <div className="no-results">
              <p>Start typing to search the codebase</p>
            </div>
          )}
          {hasSearched && results.length === 0 && (
            <div className="no-results">
              <p>No results found for &quot;{query}&quot;</p>
              <p style={{ marginTop: 4, fontSize: '0.8125rem' }}>
                Try different keywords or adjust the type filter
              </p>
            </div>
          )}
          {results.map((result, i) => (
            <div
              key={`${result.file}:${result.line}:${result.name}`}
              className={`result-item ${selectedIdx === i ? 'selected' : ''}`}
              onClick={() => handleResultClick(i)}
            >
              <div className="result-header">
                <span className="result-name">{result.name}</span>
                <span className={`result-type ${result.type}`}>{result.type}</span>
              </div>
              <div className="result-meta">
                <span className="result-file" title={result.file}>
                  {result.file}
                </span>
                <span className="result-line">:{result.line}</span>
                <span className="result-score">
                  {(result.score * 100).toFixed(0)}% match
                </span>
              </div>
              <div className="result-score-bar">
                <div
                  className="result-score-fill"
                  style={{ width: `${result.score * 100}%` }}
                />
              </div>
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
              <div className="detail-row">
                <span className="detail-label">Score</span>
                <span className="detail-value">
                  {(selected.score * 100).toFixed(1)}%
                </span>
              </div>
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
