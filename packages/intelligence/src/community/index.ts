// @code-analyzer/intelligence — Community Detection
// Public API for Louvain and Leiden community detection algorithms.

export { LouvainDetector } from './louvain.js';
export type { CommunityResult } from './louvain.js';

export { leiden } from './leiden.js';
export type { LeidenCommunityResult, LeidenInput, LeidenConfig } from './leiden.js';

export { LeidenCommunityDetector } from './leiden-detector.js';
export type { LeidenResult, LeidenCommunityInfo } from './leiden-detector.js';

export { buildReducedGraph, mapToOriginalNodes, louvainWithAggregation } from './aggregation.js';
export type { ReducedGraph } from './aggregation.js';
