/**
 * Cross-Service gRPC Linking
 * gRPC library patterns and service/method detection.
 */

import type { LibraryPattern } from './types.js';

// ============================================================================
// gRPC Library Patterns
// ============================================================================

export const GRPC_LIBRARIES: LibraryPattern[] = [
  // Go
  { libraryId: "google.golang.org/grpc", kind: "GRPC_CALLS" },
  { libraryId: "grpc.Dial", kind: "GRPC_CALLS" },
  { libraryId: "grpc.NewClient", kind: "GRPC_CALLS" },
  { libraryId: "grpc.DialContext", kind: "GRPC_CALLS" },
  // Python
  { libraryId: "grpc.insecure_channel", kind: "GRPC_CALLS" },
  { libraryId: "grpc.secure_channel", kind: "GRPC_CALLS" },
  { libraryId: "grpcio", kind: "GRPC_CALLS" },
  { libraryId: "grpc.aio", kind: "GRPC_CALLS" },
  // Java/Kotlin
  { libraryId: "io.grpc", kind: "GRPC_CALLS" },
  { libraryId: "ManagedChannelBuilder", kind: "GRPC_CALLS" },
  { libraryId: "ManagedChannel", kind: "GRPC_CALLS" },
  { libraryId: "newBlockingStub", kind: "GRPC_CALLS" },
  { libraryId: "newFutureStub", kind: "GRPC_CALLS" },
  // C#
  { libraryId: "Grpc.Net.Client", kind: "GRPC_CALLS" },
  { libraryId: "GrpcChannel", kind: "GRPC_CALLS" },
  { libraryId: "Grpc.Core", kind: "GRPC_CALLS" },
  // JS/TS
  { libraryId: "@grpc/grpc-js", kind: "GRPC_CALLS" },
  { libraryId: "grpc-web", kind: "GRPC_CALLS" },
  // Rust
  { libraryId: "tonic", kind: "GRPC_CALLS" },
  // Dart/Flutter
  { libraryId: "package:grpc", kind: "GRPC_CALLS" },
];

// ============================================================================
// gRPC Service/Method Extraction
// ============================================================================

/**
 * Extract gRPC service and method from a callee name.
 *
 * Handles patterns like:
 *   pb.NewCartServiceClient(conn).GetCart -> CartService/GetCart
 *   FooServiceGrpc.newBlockingStub(ch).getBar -> FooService/getBar
 *   NewOrderServiceClient(conn).CreateOrder -> OrderService/CreateOrder
 */
export function extractGrpcServiceMethod(
  calleeName: string,
  resolvedQn?: string,
): { service: string; method: string } | null {
  const source = resolvedQn && resolvedQn.includes("Service") ? resolvedQn : calleeName;
  const lastDot = source.lastIndexOf(".");
  if (lastDot < 0 || lastDot === source.length - 1) return null;

  const method = source.slice(lastDot + 1);
  if (!method) return null;

  const prefix = source.slice(0, lastDot);

  let service = prefix;
  if (service.startsWith("pb.New")) service = service.slice(6);
  else if (service.startsWith("pb.")) service = service.slice(3);
  else if (service.startsWith("New")) service = service.slice(3);

  const suffixes = [
    "BlockingStub", "FutureStub", "AsyncStub",
    "AsyncClient", "Servicer", "Client", "Stub", "Grpc",
  ];

  let stripped = false;
  for (const sfx of suffixes) {
    if (service.endsWith(sfx) && service.length > sfx.length) {
      service = service.slice(0, service.length - sfx.length);
      stripped = true;
      break;
    }
  }

  if (!stripped) return null;
  if (!service || !method) return null;

  return { service, method };
}

