// @code-analyzer/intelligence — the question-answering surface
//
// **One import for the whole composition**, so a tool handler, a measurement and a test all take the same path into
// it. The pieces are exported individually as well, because the retrieval arm and the citation checker are useful on
// their own - and a measurement that wants to isolate one stage should not have to reach past a barrel file.

export {
  DEFAULT_CONTEXT_OPTIONS,
  DEFAULT_EXPANSION_RELATIONS,
  assembleContext,
  blockCost,
  contextChars,
  excerpt,
  filesOf,
  neighboursOf,
  nodeBody,
  rankCandidates,
} from './context.js';
export type { RetrievedCandidate } from './context.js';

export { hasGroundedClaim, parseCitationIds, sentences, verifyCitations } from './citations.js';
export { answerPrompt, renderBlock } from './prompt.js';
export { askCodebase, nodesForFiles, retrieveContext } from './ask.js';
export type { AskInput } from './ask.js';

export {
  GENERIC_REPOSITORY_NAMES,
  LANGUAGE_SUFFIXES,
  headWord,
  indexOfWords,
  isDistinctiveName,
  namedProjects,
  projectName,
  resolveScope,
} from './scope.js';
export type { NamedProject } from './scope.js';

export { ABSTAIN_REASONS } from './types.js';
export type {
  AbstainReason,
  AnswerResult,
  AskOptions,
  Citation,
  ContextBlock,
  ContextOptions,
  GroundingReport,
  ScopeReport,
} from './types.js';
