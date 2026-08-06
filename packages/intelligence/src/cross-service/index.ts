// Cross-Service Linking — Public API

// Types
export type {
  ServiceEdgeType,
  ServiceClassification,
  ResolvedCall,
  CallArg,
  RouteNode,
  ChannelRecord,
  ServiceEdge,
  DecoratorRoute,
  GraphQLOperation,
  ChannelTransport,
  CrossProjectMatch,
  LibraryPattern,
  MethodSuffix,
  ChannelRule,
} from './types.js';
export {
  ServiceEdgeType,
  ROUTE_PREFIX,
  GRPC_PREFIX,
  GRAPHQL_PREFIX,
  TRPC_PREFIX,
  HTTP_LIBRARIES,
  ASYNC_LIBRARIES,
  CONFIG_LIBRARIES,
  ROUTE_REG_LIBRARIES,
  METHOD_SUFFIXES,
  ROUTE_REG_SUFFIXES,
} from './types.js';

// HTTP Linking
export {
  classifyCall,
  isGlobalFetch,
  inferHttpMethod,
  inferRouteMethod,
  parseRouteDecorator,
  synthesizeRouteNode,
  canonicRoutePath,
  buildServiceEdge,
  buildHandlesEdge,
  buildChannelEdge,
} from './http-linking.js';

// gRPC Linking
export {
  GRPC_LIBRARIES,
  extractGrpcServiceMethod,
} from './grpc-linking.js';

// GraphQL & tRPC Linking
export {
  GRAPHQL_LIBRARIES,
  TRPC_LIBRARIES,
  classifyGraphQLCall,
  detectChannel,
  getChannelRules,
} from './graphql-linking.js';

// Cross-Project Matching
export {
  matchCrossProjectRoutes,
  matchCrossProjectChannels,
  matchCrossProjectGrpc,
} from './cross-project.js';
