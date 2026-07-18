// @code-analyzer/infra — Infrastructure stubs

export { SqliteStore } from './storage/sqlite-store.js';
export interface GitOperations {}
export function createGitOperations(): GitOperations { return {}; }
export interface FileDiscoverer {}
export function createFileDiscoverer(): FileDiscoverer { return {}; }
export interface WorkerPool {}
export function createWorkerPool(): WorkerPool { return {}; }
export interface ParseCache {}
export function createParseCache(): ParseCache { return {}; }
