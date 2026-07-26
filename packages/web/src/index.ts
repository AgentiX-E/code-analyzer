// @code-analyzer/web — Package entry point
// Exports API client, hooks, and components for use as a library or standalone app.

export * from './api/client';
export * from './hooks';
export { default as App } from './App';
export { default as GraphExplorer } from './components/GraphExplorer';
export { default as SearchView } from './components/SearchView';
export { default as Dashboard } from './components/Dashboard';
export { default as CrossRepoDashboard } from './components/CrossRepoDashboard';
export { default as PRReviewPanel } from './components/PRReviewPanel';
export { default as RepoGroupManager } from './components/RepoGroupManager';
