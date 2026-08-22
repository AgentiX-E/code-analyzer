/**
 * Cross-Service HTTP/REST Linking
 * Classification engine, route decorator parsing, URL extraction,
 * route node synthesis, edge construction, and cross-project matching.
 */

import type {
  ServiceClassification,
  ResolvedCall,
  RouteNode,
  ServiceEdge,
  DecoratorRoute,
  LibraryPattern,
  MethodSuffix,
  ChannelRecord,
  ChannelRule,
  CrossProjectMatch,
  ServiceEdgeType,
} from './types.js';
import {
  ROUTE_PREFIX,
  GRPC_PREFIX,
  GRAPHQL_PREFIX,
  TRPC_PREFIX,
  ServiceEdgeType as SET,
  HTTP_LIBRARIES,
  ASYNC_LIBRARIES,
  CONFIG_LIBRARIES,
  ROUTE_REG_LIBRARIES,
  METHOD_SUFFIXES,
  ROUTE_REG_SUFFIXES,
} from './types.js';
import { GRPC_LIBRARIES } from './grpc-linking.js';
import { extractGrpcServiceMethod } from './grpc-linking.js';
import { GRAPHQL_LIBRARIES, TRPC_LIBRARIES } from './graphql-linking.js';
import { EDGE_CALLS, EDGE_EMITS, EDGE_HANDLES, EDGE_LISTENS_ON } from '@code-analyzer/shared';

// ============================================================================
// Pattern Matching
// ============================================================================

function matchQn(qn: string, patterns: LibraryPattern[]): LibraryPattern | null {
  for (const p of patterns) {
    if (qn.includes(p.libraryId)) return p;
  }
  return null;
}

// ============================================================================
// Method Inference from Callee Name
// ============================================================================

export function inferHttpMethod(calleeName: string): string | null {
  for (const { suffix, method } of METHOD_SUFFIXES) {
    if (calleeName.endsWith(suffix)) return method;
  }
  return null;
}

export function inferRouteMethod(calleeName: string): string | null {
  for (const { suffix, method } of ROUTE_REG_SUFFIXES) {
    if (calleeName.endsWith(suffix)) return method;
  }
  return null;
}

// ============================================================================
// Classification Engine
// ============================================================================

export function classifyCall(call: ResolvedCall): ServiceClassification | null {
  const qn = call.resolvedQn;
  if (!qn) return classifyByCalleeName(call);

  let pattern: LibraryPattern | null;

  // 1. Route registration (handler binding, NOT outbound HTTP)
  pattern = matchQn(qn, ROUTE_REG_LIBRARIES);
  if (pattern) {
    const method = inferRouteMethod(call.calleeName);
    return {
      edgeType: 'ROUTE_REG',
      httpMethod: method ?? 'ANY',
      urlPath: call.firstStringArg,
      via: 'route_registration',
    };
  }

  // 2. HTTP client
  pattern = matchQn(qn, HTTP_LIBRARIES);
  if (pattern) {
    const method = inferHttpMethod(call.calleeName);
    return {
      edgeType: pattern.kind,
      httpMethod: method ?? undefined,
      urlPath: extractUrlFromArgs(call),
      via: 'library_pattern',
    };
  }

  // 3. ASYNC dispatch
  pattern = matchQn(qn, ASYNC_LIBRARIES);
  if (pattern) {
    return {
      edgeType: pattern.kind,
      broker: pattern.broker,
      urlPath: extractUrlFromArgs(call),
      via: 'library_pattern',
    };
  }

  // 4. CONFIG access
  pattern = matchQn(qn, CONFIG_LIBRARIES);
  if (pattern) {
    return { edgeType: pattern.kind, via: 'library_pattern' };
  }

  // 5. gRPC client
  pattern = matchQn(qn, GRPC_LIBRARIES);
  if (pattern) {
    const grpc = extractGrpcServiceMethod(call.calleeName, qn);
    if (!grpc) return { edgeType: pattern.kind, via: 'library_pattern' };
    return {
      edgeType: pattern.kind,
      grpcService: grpc.service,
      grpcMethod: grpc.method,
      via: 'library_pattern',
    };
  }

  // 6. GraphQL client
  pattern = matchQn(qn, GRAPHQL_LIBRARIES);
  if (pattern) {
    return { edgeType: pattern.kind, via: 'library_pattern' };
  }

  // 7. tRPC client
  pattern = matchQn(qn, TRPC_LIBRARIES);
  if (pattern) {
    return { edgeType: pattern.kind, via: 'library_pattern' };
  }

  // URL-in-args fallback
  const urlFromArgs = extractUrlFromArgs(call);
  if (urlFromArgs) {
    return { edgeType: 'HTTP_CALLS', urlPath: urlFromArgs, httpMethod: 'ANY', via: 'arg_url' };
  }

  return null;
}

export function isGlobalFetch(call: ResolvedCall): boolean {
  return call.calleeName === 'fetch' && !call.resolvedQn;
}

function classifyByCalleeName(call: ResolvedCall): ServiceClassification | null {
  if (isGlobalFetch(call)) {
    const urlFromArgs = extractUrlFromArgs(call);
    return { edgeType: 'HTTP_CALLS', urlPath: urlFromArgs, via: 'arg_url' };
  }
  const urlFromArgs = extractUrlFromArgs(call);
  if (urlFromArgs) {
    return { edgeType: 'HTTP_CALLS', urlPath: urlFromArgs, httpMethod: 'ANY', via: 'arg_url' };
  }
  return null;
}

// ============================================================================
// HTTP Route Detection (from decorators/annotations)
// ============================================================================

function decoratorMethodName(attrText: string): string | null {
  const dot = attrText.lastIndexOf('.');
  const method = dot >= 0 ? attrText.slice(dot + 1) : attrText;
  const methodMap: Record<string, string> = {
    get: 'GET',
    Get: 'GET',
    post: 'POST',
    Post: 'POST',
    put: 'PUT',
    Put: 'PUT',
    delete: 'DELETE',
    Delete: 'DELETE',
    patch: 'PATCH',
    Patch: 'PATCH',
    route: 'ANY',
    api_route: 'ANY',
  };
  return methodMap[method] ?? null;
}

function annotationRouteMethod(name: string): string | null {
  const mappingMap: Record<string, string> = {
    GetMapping: 'GET',
    PostMapping: 'POST',
    PutMapping: 'PUT',
    DeleteMapping: 'DELETE',
    PatchMapping: 'PATCH',
    RequestMapping: 'ANY',
  };
  if (mappingMap[name]) return mappingMap[name];
  const jaxVerbs = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  if (jaxVerbs.includes(name)) return name;
  return null;
}

export function parseRouteDecorator(decoratorText: string): DecoratorRoute | null {
  if (!decoratorText) return null;

  const callMatch = decoratorText.match(/^([\w.]+)\s*\(\s*["'\`]([^"'\`]+)["'\`]/);
  if (!callMatch) {
    const annotationMatch = decoratorText.match(
      /^@?(\w+)\s*\(\s*(?:value\s*=\s*)?["'\`]([^"'\`]+)["'\`]/,
    );
    if (!annotationMatch) return null;
    const [, name, path] = annotationMatch;
    if (!name || !path) return null;
    const method = annotationRouteMethod(name);
    if (!method || !path.startsWith('/')) return null;
    return { method, path, framework: detectFramework(decoratorText, name) };
  }

  let [, funcName, path] = callMatch;
  if (!funcName || !path) return null;
  if (!path.startsWith('/')) return null;

  const method = annotationRouteMethod(funcName);
  if (method) {
    return { method, path, framework: detectFramework(decoratorText, funcName) };
  }

  const decMethod = decoratorMethodName(funcName);
  if (!decMethod) return null;
  return { method: decMethod, path, framework: detectFramework(decoratorText, funcName) };
}

function detectFramework(text: string, name: string): string {
  if (text.includes('flask') || name.startsWith('app.')) return 'Flask';
  if (text.includes('fastapi') || text.includes('FastAPI') || text.includes('router.'))
    return 'FastAPI';
  if (text.includes('django') || text.includes('action')) return 'Django';
  if (text.includes('express') || text.includes('Express')) return 'Express';
  if (text.includes('gin-gonic') || name.startsWith('gin.')) return 'Gin';
  if (text.includes('echo') || name.startsWith('echo.')) return 'Echo';
  if (text.includes('chi') || name.startsWith('chi.')) return 'Chi';
  if (text.includes('fiber') || name.startsWith('fiber.')) return 'Fiber';
  if (text.includes('Spring') || name.endsWith('Mapping')) return 'Spring';
  if (text.includes('GetMap') || text.includes('MapGet')) return 'ASP.NET';
  if (text.includes('jakarta') || text.includes('Path')) return 'JAX-RS';
  if (text.includes('actix') || text.includes('axum') || text.includes('rocket')) return 'Rust';
  if (text.includes('Phoenix') || text.includes('Router')) return 'Phoenix';
  return 'unknown';
}

// ============================================================================
// URL Extraction from Arguments
// ============================================================================

function extractUrlFromArgs(call: ResolvedCall): string | undefined {
  if (!call.args || call.args.length === 0) {
    if (call.firstStringArg && isUrlCandidate(call.firstStringArg)) {
      return normalizeUrlArg(call.firstStringArg);
    }
    return undefined;
  }
  for (const arg of call.args) {
    const url = arg.value ?? arg.expr;
    if (!url || (!url.startsWith('/') && !url.startsWith('http'))) continue;
    if (isUrlCandidate(url)) return normalizeUrlArg(url);
  }
  return undefined;
}

function isUrlCandidate(s: string): boolean {
  if (/[\\^$*+()|[\] ]/.test(s)) return false;
  if (s.includes('//')) return false;
  const fsRoots = [
    'etc',
    'root',
    'var',
    'usr',
    'home',
    'tmp',
    'private',
    'opt',
    'bin',
    'sbin',
    'dev',
    'proc',
    'sys',
    'run',
    'lib',
    'lib64',
    'mnt',
    'media',
    'boot',
    'srv',
    'Users',
    'Volumes',
  ];
  for (const root of fsRoots) {
    if (s === `/${root}` || s.startsWith(`/${root}/`)) return false;
  }
  if (/\.(cfg|conf|env|ini|toml|properties|service|sock|socket|sqlite|db|crt|key|pem|pid)$/.test(s))
    return false;
  if (/\/\.(aws|azure|config|docker|env|git|gnupg|kube|ssh)\//.test(s)) return false;
  return true;
}

function normalizeUrlArg(url: string): string {
  let u = url;
  if (u.startsWith("'") || u.startsWith('"') || u.startsWith('\`')) u = u.slice(1);
  if (u.endsWith("'") || u.endsWith('"') || u.endsWith('\`')) u = u.slice(0, -1);
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.includes('${')) u = u.replace(/\$\{[^}]+\}/g, ':param');
  if (!u.includes('/', 1)) return '';
  return u;
}

// ============================================================================
// Route Node Synthesis
// ============================================================================

export function canonicRoutePath(path: string): string {
  return path
    .replace(/\/:\w+/g, '/:param')
    .replace(/\/\{\w+\}/g, '/:param')
    .replace(/\/\/+/g, '/')
    .replace(/\/$/, '');
}

export function synthesizeRouteNode(result: ServiceClassification): RouteNode {
  switch (result.edgeType) {
    case 'HTTP_CALLS':
    case 'ROUTE_REG': {
      const method = result.httpMethod ?? 'ANY';
      const path = result.urlPath ?? '/';
      const canon = canonicRoutePath(path);
      return {
        qn: `${ROUTE_PREFIX}${method}__${canon}`,
        name: `${method} ${path}`,
        method,
        label: 'Route',
        properties: { method, url_path: canon, source: result.via },
      };
    }
    case 'ASYNC_CALLS': {
      const broker = result.broker ?? 'unknown';
      const target = result.urlPath ?? broker;
      return {
        qn: `${ROUTE_PREFIX}ASYNC__${broker}/${target}`,
        name: target,
        broker,
        label: 'Route',
        properties: { broker, target, source: result.via },
      };
    }
    case 'GRPC_CALLS': {
      const service = result.grpcService ?? 'Unknown';
      const method = result.grpcMethod ?? 'Unknown';
      return {
        qn: `${GRPC_PREFIX}${service}/${method}`,
        name: `${service}/${method}`,
        label: 'Route',
        properties: { service, method, source: result.via },
      };
    }
    case 'GRAPHQL_CALLS': {
      return {
        qn: `${GRAPHQL_PREFIX}${result.grpcMethod ?? 'query'}`,
        name: `GraphQL ${result.grpcMethod ?? 'query'}`,
        label: 'Route',
        properties: { source: result.via },
      };
    }
    case 'TRPC_CALLS': {
      return {
        qn: `${TRPC_PREFIX}${result.grpcMethod ?? result.urlPath ?? 'unknown'}`,
        name: `tRPC ${result.grpcMethod ?? result.urlPath ?? 'unknown'}`,
        label: 'Route',
        properties: { source: result.via },
      };
    }
    default:
      throw new Error(`Cannot synthesize route for edge type: ${result.edgeType}`);
  }
}

// ============================================================================
// Edge Construction
// ============================================================================

export function buildServiceEdge(
  sourceQn: string,
  classification: ServiceClassification,
): ServiceEdge | null {
  const route = synthesizeRouteNode(classification);
  const properties: Record<string, string> = {
    callee: classification.grpcService
      ? `${classification.grpcService}/${classification.grpcMethod}`
      : (classification.httpMethod ?? 'ANY'),
    via: classification.via,
  };
  if (classification.urlPath) properties['url_path'] = classification.urlPath;
  if (classification.httpMethod) properties['method'] = classification.httpMethod;
  if (classification.broker) properties['broker'] = classification.broker;
  if (classification.grpcService) properties['service'] = classification.grpcService;
  if (classification.grpcMethod) properties['rpc_method'] = classification.grpcMethod;
  return {
    sourceQn,
    targetQn: route.qn,
    type: classification.edgeType === 'ROUTE_REG' ? EDGE_CALLS : classification.edgeType,
    properties,
  };
}

export function buildHandlesEdge(handlerQn: string, routeQn: string): ServiceEdge {
  return {
    sourceQn: handlerQn,
    targetQn: routeQn,
    type: EDGE_HANDLES,
    properties: { handler: handlerQn },
  };
}

export function buildChannelEdge(
  funcQn: string,
  channelName: string,
  transport: string,
  direction: 'emit' | 'listen',
): ServiceEdge {
  return {
    sourceQn: funcQn,
    targetQn: `__channel__${channelName}`,
    type: direction === 'emit' ? EDGE_EMITS : EDGE_LISTENS_ON,
    properties: { channel_name: channelName, transport },
  };
}
