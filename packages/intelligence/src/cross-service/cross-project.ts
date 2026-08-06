/**
 * Cross-Service Cross-Project Route Matching
 * Matches HTTP routes, channels, and gRPC services across project boundaries.
 */

import type { CrossProjectMatch, ServiceEdgeType } from './types.js';
import { GRPC_PREFIX } from './types.js';

// ============================================================================
// Cross-Project Route Matching
// ============================================================================

export function matchCrossProjectRoutes(
  sourceRoutes: Array<{ qn: string; urlPath: string; sourceQn: string }>,
  targetRoutes: Array<{ qn: string; urlPath: string }>,
  sourceProject: string,
  targetProject: string,
): CrossProjectMatch[] {
  const matches: CrossProjectMatch[] = [];
  const targetByPath = new Map<string, string>();
  for (const tr of targetRoutes) {
    if (!targetByPath.has(tr.urlPath)) targetByPath.set(tr.urlPath, tr.qn);
  }
  for (const sr of sourceRoutes) {
    const pathOnly = sr.urlPath.replace(/^https?:\/\/[^/]+/, "");
    const targetQn = targetByPath.get(pathOnly) ?? targetByPath.get(sr.urlPath);
    if (targetQn) {
      matches.push({
        sourceProject, targetProject,
        edgeType: "CROSS_HTTP_CALLS",
        sourceQn: sr.sourceQn, targetQn, routePath: pathOnly,
      });
    }
  }
  return matches;
}

export function matchCrossProjectChannels(
  sourceChannels: Array<{ channelName: string; funcQn: string; direction: "emit" | "listen" }>,
  targetChannels: Array<{ channelName: string; direction: "emit" | "listen" }>,
  sourceProject: string,
  targetProject: string,
): CrossProjectMatch[] {
  const matches: CrossProjectMatch[] = [];
  const targetListen = new Set<string>();
  const targetEmit = new Set<string>();
  for (const tc of targetChannels) {
    if (tc.direction === "listen") targetListen.add(tc.channelName);
    else targetEmit.add(tc.channelName);
  }
  for (const sc of sourceChannels) {
    const matchesTarget =
      (sc.direction === "emit" && targetListen.has(sc.channelName)) ||
      (sc.direction === "listen" && targetEmit.has(sc.channelName));
    if (matchesTarget) {
      matches.push({
        sourceProject, targetProject,
        edgeType: "CROSS_CHANNEL",
        sourceQn: sc.funcQn,
        targetQn: `__channel__${sc.channelName}`,
        routePath: sc.channelName,
      });
    }
  }
  return matches;
}

export function matchCrossProjectGrpc(
  sourceGRpc: Array<{ service: string; method: string; sourceQn: string }>,
  targetGRpc: Array<{ service: string; method: string }>,
  sourceProject: string,
  targetProject: string,
): CrossProjectMatch[] {
  const matches: CrossProjectMatch[] = [];
  const targetSet = new Set<string>();
  for (const tg of targetGRpc) {
    targetSet.add(`${tg.service}/${tg.method}`);
  }
  for (const sg of sourceGRpc) {
    const key = `${sg.service}/${sg.method}`;
    if (targetSet.has(key)) {
      matches.push({
        sourceProject, targetProject,
        edgeType: "CROSS_GRPC_CALLS",
        sourceQn: sg.sourceQn,
        targetQn: `${GRPC_PREFIX}${key}`,
        routePath: key,
      });
    }
  }
  return matches;
}

