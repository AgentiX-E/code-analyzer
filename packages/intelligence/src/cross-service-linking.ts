/**
 * Cross-Service Linking — TypeScript equivalent of codebase-memory-mcp's
 * cross-service detection pipeline.
 *
 * Ported from the C implementation in:
 *   internal/cbm/service_patterns.c  — library → edge type classification
 *   internal/cbm/extract_defs.c      — route extraction from decorators/annotations
 *   internal/cbm/extract_channels.c  — pub/sub channel detection
 *   src/pipeline/pass_parallel.c     — edge emission (HTTP_CALLS, GRPC_CALLS, etc.)
 *   src/pipeline/pass_route_nodes.c  — Route node synthesis + HANDLES edges
 *   src/pipeline/pass_cross_repo.c   — Cross-repo route matching
 *
 * ## Architecture
 *
 * The C implementation uses tree-sitter AST walking + registry-based name
 * resolution to classify call edges into service-level types. The pipeline is:
 *
 *   1. Extract: walk AST → collect definitions, calls, decorators, channel refs
 *   2. Resolve: match call targets to definitions → qualified names
 *   3. Classify: match resolved QNs against known library patterns → edge type
 *   4. Emit: create Route nodes + typed edges (HTTP_CALLS, GRPC_CALLS, etc.)
 *   5. Cross-repo: match Routes across project DBs → CROSS_* edges
 *
 * ## Edge Types Created
 *
 *   CALLS           — function call between two resolved definitions
 *   HTTP_CALLS      — synchronous HTTP client call (via Route node)
 *   ASYNC_CALLS     — async message/task dispatch (via Route node)
 *   GRPC_CALLS      — gRPC stub invocation (via __grpc__ Route node)
 *   GRAPHQL_CALLS   — GraphQL client query (via __gql__ Route node)
 *   TRPC_CALLS      — tRPC procedure call (via __trpc__ Route node)
 *   CONFIGURES      — config/env accessor call
 *   HANDLES         — function → Route (handler binding)
 *   EMITS           — channel participation (publish)
 *   LISTENS_ON      — channel participation (subscribe)
 *   CALL_REFERENCE  — explicit callable reference (e.g., callback)
 *   IMPORTS         — file → imported module
 *   INHERITS        — class → base class
 *   IMPLEMENTS      — class → interface/trait
 *   CROSS_HTTP_CALLS / CROSS_ASYNC_CALLS / CROSS_CHANNEL / CROSS_GRPC_CALLS
 *                    — cross-project service links
 *
 * ## Languages Supported
 *
 *   Go, Python, JavaScript, TypeScript, TSX, Rust, Java, Kotlin, C#, Ruby,
 *   Elixir, PHP, Scala, Haskell, Dart, Swift, Lua, C/C++
 *
 * This TypeScript version provides the same classification logic for use
 * in the code-analyzer intelligence package. It operates on pre-resolved
 * data (qualified names from a registry) rather than raw AST nodes.
 */

// ============================================================================
// Types
// ============================================================================

/** Edge types that correspond to service-level communications. */
export const ServiceEdgeType = {
  CALLS: "CALLS",
  HTTP_CALLS: "HTTP_CALLS",
  ASYNC_CALLS: "ASYNC_CALLS",
  GRPC_CALLS: "GRPC_CALLS",
  GRAPHQL_CALLS: "GRAPHQL_CALLS",
  TRPC_CALLS: "TRPC_CALLS",
  CONFIGURES: "CONFIGURES",
  ROUTE_REG: "ROUTE_REG",
  HANDLES: "HANDLES",
  EMITS: "EMITS",
  LISTENS_ON: "LISTENS_ON",
  IMPORTS: "IMPORTS",
  CALL_REFERENCE: "CALL_REFERENCE",
  USAGE: "USAGE",
  INHERITS: "INHERITS",
  IMPLEMENTS: "IMPLEMENTS",
  THROWS: "THROWS",
  CROSS_HTTP_CALLS: "CROSS_HTTP_CALLS",
  CROSS_ASYNC_CALLS: "CROSS_ASYNC_CALLS",
  CROSS_CHANNEL: "CROSS_CHANNEL",
  CROSS_GRPC_CALLS: "CROSS_GRPC_CALLS",
  CROSS_GRAPHQL_CALLS: "CROSS_GRAPHQL_CALLS",
  CROSS_TRPC_CALLS: "CROSS_TRPC_CALLS",
} as const;

export type ServiceEdgeType = (typeof ServiceEdgeType)[keyof typeof ServiceEdgeType];

/** Classification result for a resolved call. */
export interface ServiceClassification {
  /** The edge type this call should produce. */
  edgeType: ServiceEdgeType;
  /** For HTTP/gRPC: the URL path extracted from call arguments. */
  urlPath?: string;
  /** For HTTP: the HTTP method (GET, POST, PUT, DELETE, PATCH, ANY). */
  httpMethod?: string;
  /** For gRPC: the service name (e.g. "CartService"). */
  grpcService?: string;
  /** For gRPC: the method name (e.g. "GetCart"). */
  grpcMethod?: string;
  /** For ASYNC: the broker name (e.g. "pubsub", "kafka", "sqs"). */
  broker?: string;
  /** For channels: the channel name (e.g. "user.created"). */
  channelName?: string;
  /** For channels: the transport (e.g. "socketio", "event_emitter"). */
  channelTransport?: string;
  /** For channels: EMIT or LISTEN direction. */
  channelDirection?: "emit" | "listen";
  /** How the classification was determined. */
  via: "library_pattern" | "callee_name" | "arg_url" | "route_registration" | "proto_rpc";
}

/** A resolved call from the registry. Input to the classifier. */
export interface ResolvedCall {
  /** Raw callee name (e.g. "get", "post", "pb.NewCartServiceClient.GetCart"). */
  calleeName: string;
  /** Resolved qualified name from registry (e.g. "project.venv.requests.api.get"). */
  resolvedQn: string;
  /** Enclosing function's qualified name. */
  enclosingFuncQn: string;
  /** First string literal argument (URL, topic, key). */
  firstStringArg?: string;
  /** All call arguments with expressions. */
  args?: CallArg[];
  /** Whether this is a method call (obj.method()). */
  isMethod?: boolean;
}

export interface CallArg {
  expr: string;
  value?: string;
  keyword?: string;
  index: number;
}

/** Route node synthesized from a detected HTTP/ASYNC/gRPC endpoint. */
export interface RouteNode {
  /** Qualified name: "__route__<METHOD>__<canonical_path>" or "__grpc__<Svc>/<Method>" */
  qn: string;
  /** Display name: the URL path or topic name */
  name: string;
  /** HTTP method or "ANY" */
  method?: string;
  /** Broker name for async routes */
  broker?: string;
  /** Label: "Route" */
  label: "Route";
  /** JSON properties string */
  properties: Record<string, string>;
}

/** A channel participation record. */
export interface ChannelRecord {
  channelName: string;
  transport: string;
  enclosingFuncQn: string;
  direction: "emit" | "listen";
}

/** Complete cross-service edge to insert into the graph. */
export interface ServiceEdge {
  /** Source node QN */
  sourceQn: string;
  /** Target node QN (can be a Route QN) */
  targetQn: string;
  /** Edge type */
  type: ServiceEdgeType;
  /** JSON properties */
  properties: Record<string, string>;
}

// ============================================================================
// Library Pattern Tables
// ============================================================================

interface LibraryPattern {
  libraryId: string;   // substring to match in resolved QN
  kind: ServiceEdgeType;
  broker?: string;     // for ASYNC edges: broker name
}

/**
 * HTTP client libraries — matched by substring in the resolved QN.
 * Sources: github.com/easybase/awesome-http, official SDK docs (from C code).
 */
const HTTP_LIBRARIES: LibraryPattern[] = [
  // Python
  { libraryId: "requests", kind: "HTTP_CALLS" },
  { libraryId: "httpx", kind: "HTTP_CALLS" },
  { libraryId: "aiohttp", kind: "HTTP_CALLS" },
  { libraryId: "urllib", kind: "HTTP_CALLS" },
  { libraryId: "httplib2", kind: "HTTP_CALLS" },
  { libraryId: "pycurl", kind: "HTTP_CALLS" },
  { libraryId: "treq", kind: "HTTP_CALLS" },
  { libraryId: "uplink", kind: "HTTP_CALLS" },
  // JavaScript / TypeScript
  { libraryId: "axios", kind: "HTTP_CALLS" },
  { libraryId: "superagent", kind: "HTTP_CALLS" },
  { libraryId: "needle", kind: "HTTP_CALLS" },
  { libraryId: "node-fetch", kind: "HTTP_CALLS" },
  { libraryId: "undici", kind: "HTTP_CALLS" },
  { libraryId: "ofetch", kind: "HTTP_CALLS" },
  { libraryId: "wretch", kind: "HTTP_CALLS" },
  { libraryId: "ky/", kind: "HTTP_CALLS" },
  { libraryId: "phin", kind: "HTTP_CALLS" },
  // Go
  { libraryId: "net/http", kind: "HTTP_CALLS" },
  { libraryId: "resty", kind: "HTTP_CALLS" },
  { libraryId: "sling", kind: "HTTP_CALLS" },
  { libraryId: "heimdall", kind: "HTTP_CALLS" },
  { libraryId: "gentleman", kind: "HTTP_CALLS" },
  { libraryId: "retryablehttp", kind: "HTTP_CALLS" },
  // Java / Kotlin
  { libraryId: "HttpClient", kind: "HTTP_CALLS" },
  { libraryId: "OkHttp", kind: "HTTP_CALLS" },
  { libraryId: "okhttp3", kind: "HTTP_CALLS" },
  { libraryId: "RestTemplate", kind: "HTTP_CALLS" },
  { libraryId: "WebClient", kind: "HTTP_CALLS" },
  { libraryId: "Unirest", kind: "HTTP_CALLS" },
  { libraryId: "AsyncHttpClient", kind: "HTTP_CALLS" },
  { libraryId: "apache.http", kind: "HTTP_CALLS" },
  { libraryId: "Retrofit", kind: "HTTP_CALLS" },
  { libraryId: "Feign", kind: "HTTP_CALLS" },
  { libraryId: "ktor.client", kind: "HTTP_CALLS" },
  { libraryId: "kittinunf.fuel", kind: "HTTP_CALLS" },
  // Rust
  { libraryId: "reqwest", kind: "HTTP_CALLS" },
  { libraryId: "hyper", kind: "HTTP_CALLS" },
  { libraryId: "surf", kind: "HTTP_CALLS" },
  { libraryId: "ureq", kind: "HTTP_CALLS" },
  { libraryId: "isahc", kind: "HTTP_CALLS" },
  { libraryId: "attohttpc", kind: "HTTP_CALLS" },
  // C#
  { libraryId: "RestSharp", kind: "HTTP_CALLS" },
  { libraryId: "Flurl", kind: "HTTP_CALLS" },
  { libraryId: "Refit", kind: "HTTP_CALLS" },
  // Ruby
  { libraryId: "HTTParty", kind: "HTTP_CALLS" },
  { libraryId: "Faraday", kind: "HTTP_CALLS" },
  { libraryId: "RestClient", kind: "HTTP_CALLS" },
  { libraryId: "Typhoeus", kind: "HTTP_CALLS" },
  { libraryId: "Excon", kind: "HTTP_CALLS" },
  { libraryId: "Net::HTTP", kind: "HTTP_CALLS" },
  // PHP
  { libraryId: "Guzzle", kind: "HTTP_CALLS" },
  { libraryId: "guzzle", kind: "HTTP_CALLS" },
  { libraryId: "curl_", kind: "HTTP_CALLS" },
  { libraryId: "Symfony\\HttpClient", kind: "HTTP_CALLS" },
  // C/C++
  { libraryId: "cpr", kind: "HTTP_CALLS" },
  { libraryId: "cpp-httplib", kind: "HTTP_CALLS" },
  { libraryId: "Poco.Net", kind: "HTTP_CALLS" },
  { libraryId: "Beast", kind: "HTTP_CALLS" },
  // Swift
  { libraryId: "Alamofire", kind: "HTTP_CALLS" },
  { libraryId: "Moya", kind: "HTTP_CALLS" },
  { libraryId: "URLSession", kind: "HTTP_CALLS" },
  // Dart
  { libraryId: "Dio", kind: "HTTP_CALLS" },
  { libraryId: "dio", kind: "HTTP_CALLS" },
  { libraryId: "package:http", kind: "HTTP_CALLS" },
  { libraryId: "Chopper", kind: "HTTP_CALLS" },
  // Elixir
  { libraryId: "HTTPoison", kind: "HTTP_CALLS" },
  { libraryId: "Tesla", kind: "HTTP_CALLS" },
  { libraryId: "Finch", kind: "HTTP_CALLS" },
  { libraryId: "Mint.HTTP", kind: "HTTP_CALLS" },
  // Scala
  { libraryId: "sttp", kind: "HTTP_CALLS" },
  { libraryId: "akka.http", kind: "HTTP_CALLS" },
  { libraryId: "http4s", kind: "HTTP_CALLS" },
  { libraryId: "scalaj", kind: "HTTP_CALLS" },
  // Haskell
  { libraryId: "wreq", kind: "HTTP_CALLS" },
  { libraryId: "http-client", kind: "HTTP_CALLS" },
  { libraryId: "http-conduit", kind: "HTTP_CALLS" },
  { libraryId: "servant-client", kind: "HTTP_CALLS" },
  { libraryId: "Network.HTTP", kind: "HTTP_CALLS" },
  // Lua
  { libraryId: "socket.http", kind: "HTTP_CALLS" },
  { libraryId: "resty.http", kind: "HTTP_CALLS" },
];

/** Async dispatch / message broker libraries. */
const ASYNC_LIBRARIES: LibraryPattern[] = [
  // GCP
  { libraryId: "cloudtasks", kind: "ASYNC_CALLS", broker: "cloud_tasks" },
  { libraryId: "cloud_tasks", kind: "ASYNC_CALLS", broker: "cloud_tasks" },
  { libraryId: "cloud.tasks", kind: "ASYNC_CALLS", broker: "cloud_tasks" },
  { libraryId: "CloudTasks", kind: "ASYNC_CALLS", broker: "cloud_tasks" },
  { libraryId: "pubsub", kind: "ASYNC_CALLS", broker: "pubsub" },
  { libraryId: "cloud.pubsub", kind: "ASYNC_CALLS", broker: "pubsub" },
  { libraryId: "PubSub", kind: "ASYNC_CALLS", broker: "pubsub" },
  // AWS SQS
  { libraryId: "aws-sdk-go/service/sqs", kind: "ASYNC_CALLS", broker: "sqs" },
  { libraryId: "aws-sdk-go.service.sqs", kind: "ASYNC_CALLS", broker: "sqs" },
  { libraryId: "aws_sdk_sqs", kind: "ASYNC_CALLS", broker: "sqs" },
  { libraryId: "Amazon.SQS", kind: "ASYNC_CALLS", broker: "sqs" },
  { libraryId: "@aws-sdk/client-sqs", kind: "ASYNC_CALLS", broker: "sqs" },
  { libraryId: "boto3.client.sqs", kind: "ASYNC_CALLS", broker: "sqs" },
  // AWS SNS
  { libraryId: "aws-sdk-go/service/sns", kind: "ASYNC_CALLS", broker: "sns" },
  { libraryId: "aws-sdk-go.service.sns", kind: "ASYNC_CALLS", broker: "sns" },
  { libraryId: "aws_sdk_sns", kind: "ASYNC_CALLS", broker: "sns" },
  { libraryId: "Amazon.SNS", kind: "ASYNC_CALLS", broker: "sns" },
  { libraryId: "@aws-sdk/client-sns", kind: "ASYNC_CALLS", broker: "sns" },
  // AWS EventBridge
  { libraryId: "eventbridge", kind: "ASYNC_CALLS", broker: "eventbridge" },
  { libraryId: "EventBridge", kind: "ASYNC_CALLS", broker: "eventbridge" },
  // AWS Lambda
  { libraryId: "aws-sdk-go/service/lambda", kind: "ASYNC_CALLS", broker: "lambda" },
  { libraryId: "aws-sdk-go.service.lambda", kind: "ASYNC_CALLS", broker: "lambda" },
  { libraryId: "aws_sdk_lambda", kind: "ASYNC_CALLS", broker: "lambda" },
  { libraryId: "@aws-sdk/client-lambda", kind: "ASYNC_CALLS", broker: "lambda" },
  // AWS Step Functions
  { libraryId: "stepfunctions", kind: "ASYNC_CALLS", broker: "stepfunctions" },
  // Azure
  { libraryId: "ServiceBus", kind: "ASYNC_CALLS", broker: "servicebus" },
  { libraryId: "Azure.Messaging", kind: "ASYNC_CALLS", broker: "servicebus" },
  // Kafka
  { libraryId: "kafka", kind: "ASYNC_CALLS", broker: "kafka" },
  { libraryId: "Kafka", kind: "ASYNC_CALLS", broker: "kafka" },
  { libraryId: "kafkajs", kind: "ASYNC_CALLS", broker: "kafka" },
  { libraryId: "sarama", kind: "ASYNC_CALLS", broker: "kafka" },
  { libraryId: "rdkafka", kind: "ASYNC_CALLS", broker: "kafka" },
  { libraryId: "confluent", kind: "ASYNC_CALLS", broker: "kafka" },
  { libraryId: "Confluent.Kafka", kind: "ASYNC_CALLS", broker: "kafka" },
  // RabbitMQ
  { libraryId: "amqp", kind: "ASYNC_CALLS", broker: "rabbitmq" },
  { libraryId: "AMQP", kind: "ASYNC_CALLS", broker: "rabbitmq" },
  { libraryId: "amqplib", kind: "ASYNC_CALLS", broker: "rabbitmq" },
  { libraryId: "RabbitMQ", kind: "ASYNC_CALLS", broker: "rabbitmq" },
  { libraryId: "lapin", kind: "ASYNC_CALLS", broker: "rabbitmq" },
  { libraryId: "MassTransit", kind: "ASYNC_CALLS", broker: "rabbitmq" },
  // NATS
  { libraryId: "nats", kind: "ASYNC_CALLS", broker: "nats" },
  { libraryId: "NATS", kind: "ASYNC_CALLS", broker: "nats" },
  // Redis pub/sub
  { libraryId: "ioredis", kind: "ASYNC_CALLS", broker: "redis" },
  // Task queues
  { libraryId: "celery", kind: "ASYNC_CALLS", broker: "celery" },
  { libraryId: "Celery", kind: "ASYNC_CALLS", broker: "celery" },
  { libraryId: "dramatiq", kind: "ASYNC_CALLS", broker: "dramatiq" },
  { libraryId: "huey", kind: "ASYNC_CALLS", broker: "huey" },
  { libraryId: "python-rq", kind: "ASYNC_CALLS", broker: "rq" },
  { libraryId: "rq.Queue", kind: "ASYNC_CALLS", broker: "rq" },
  { libraryId: "bullmq", kind: "ASYNC_CALLS", broker: "bullmq" },
  { libraryId: "BullMQ", kind: "ASYNC_CALLS", broker: "bullmq" },
  { libraryId: "bull.Queue", kind: "ASYNC_CALLS", broker: "bull" },
  { libraryId: "Sidekiq", kind: "ASYNC_CALLS", broker: "sidekiq" },
  { libraryId: "sidekiq", kind: "ASYNC_CALLS", broker: "sidekiq" },
  { libraryId: "Resque", kind: "ASYNC_CALLS", broker: "resque" },
  { libraryId: "GoodJob", kind: "ASYNC_CALLS", broker: "goodjob" },
  { libraryId: "DelayedJob", kind: "ASYNC_CALLS", broker: "delayed_job" },
  { libraryId: "Hangfire", kind: "ASYNC_CALLS", broker: "hangfire" },
  { libraryId: "NServiceBus", kind: "ASYNC_CALLS", broker: "nservicebus" },
  { libraryId: "asynq", kind: "ASYNC_CALLS", broker: "asynq" },
  { libraryId: "machinery", kind: "ASYNC_CALLS", broker: "machinery" },
  // Workflow engines
  { libraryId: "temporalio", kind: "ASYNC_CALLS", broker: "temporal" },
  { libraryId: "@temporalio", kind: "ASYNC_CALLS", broker: "temporal" },
  { libraryId: "temporal.client", kind: "ASYNC_CALLS", broker: "temporal" },
  { libraryId: "inngest", kind: "ASYNC_CALLS", broker: "inngest" },
  // Elixir
  { libraryId: "Oban", kind: "ASYNC_CALLS", broker: "oban" },
  { libraryId: "Broadway", kind: "ASYNC_CALLS", broker: "broadway" },
  { libraryId: "GenStage", kind: "ASYNC_CALLS", broker: "genstage" },
  { libraryId: "Phoenix.PubSub", kind: "ASYNC_CALLS", broker: "phoenix_pubsub" },
  // MQTT
  { libraryId: "mqtt", kind: "ASYNC_CALLS", broker: "mqtt" },
  { libraryId: "paho.mqtt", kind: "ASYNC_CALLS", broker: "mqtt" },
  { libraryId: "MQTTClient", kind: "ASYNC_CALLS", broker: "mqtt" },
  { libraryId: "mosquitto", kind: "ASYNC_CALLS", broker: "mqtt" },
  { libraryId: "asyncio_mqtt", kind: "ASYNC_CALLS", broker: "mqtt" },
  { libraryId: "gmqtt", kind: "ASYNC_CALLS", broker: "mqtt" },
  { libraryId: "rumqttc", kind: "ASYNC_CALLS", broker: "mqtt" },
  // Dapr
  { libraryId: "dapr.clients.grpc", kind: "ASYNC_CALLS", broker: "dapr" },
  { libraryId: "DaprClient", kind: "ASYNC_CALLS", broker: "dapr" },
];

/** Config accessor libraries. */
const CONFIG_LIBRARIES: LibraryPattern[] = [
  { libraryId: "getenv", kind: "CONFIGURES" },
  { libraryId: "Getenv", kind: "CONFIGURES" },
  { libraryId: "getEnv", kind: "CONFIGURES" },
  { libraryId: "LookupEnv", kind: "CONFIGURES" },
  { libraryId: "lookupEnv", kind: "CONFIGURES" },
  { libraryId: "get_env", kind: "CONFIGURES" },
  { libraryId: "fetch_env", kind: "CONFIGURES" },
  { libraryId: "GetEnvironmentVariable", kind: "CONFIGURES" },
  { libraryId: "getProperty", kind: "CONFIGURES" },
  { libraryId: "getEnvironment", kind: "CONFIGURES" },
  { libraryId: "viper", kind: "CONFIGURES" },
  { libraryId: "envconfig", kind: "CONFIGURES" },
  { libraryId: "godotenv", kind: "CONFIGURES" },
  { libraryId: "decouple", kind: "CONFIGURES" },
  { libraryId: "dynaconf", kind: "CONFIGURES" },
  { libraryId: "dotenv", kind: "CONFIGURES" },
  { libraryId: "nconf", kind: "CONFIGURES" },
  { libraryId: "convict", kind: "CONFIGURES" },
  { libraryId: "envalid", kind: "CONFIGURES" },
  { libraryId: "dotenvy", kind: "CONFIGURES" },
  { libraryId: "figment", kind: "CONFIGURES" },
  { libraryId: "config-rs", kind: "CONFIGURES" },
  { libraryId: "ConfigFactory", kind: "CONFIGURES" },
  { libraryId: "ConfigurationProperties", kind: "CONFIGURES" },
  { libraryId: "Application.get_env", kind: "CONFIGURES" },
  { libraryId: "Application.fetch_env", kind: "CONFIGURES" },
];

/** Route registration frameworks. Checked BEFORE HTTP clients to prevent
 *  gin/express/echo from being misclassified as HTTP clients. */
const ROUTE_REG_LIBRARIES: LibraryPattern[] = [
  // Go
  { libraryId: "gin-gonic/gin", kind: "ROUTE_REG" },
  { libraryId: "gin.", kind: "ROUTE_REG" },
  { libraryId: "go-chi/chi", kind: "ROUTE_REG" },
  { libraryId: "chi.", kind: "ROUTE_REG" },
  { libraryId: "gorilla/mux", kind: "ROUTE_REG" },
  { libraryId: "labstack/echo", kind: "ROUTE_REG" },
  { libraryId: "echo.", kind: "ROUTE_REG" },
  { libraryId: "gofiber/fiber", kind: "ROUTE_REG" },
  { libraryId: "fiber.", kind: "ROUTE_REG" },
  { libraryId: "http.ServeMux", kind: "ROUTE_REG" },
  { libraryId: "httprouter", kind: "ROUTE_REG" },
  // JavaScript / TypeScript
  { libraryId: "express", kind: "ROUTE_REG" },
  { libraryId: "fastify", kind: "ROUTE_REG" },
  { libraryId: "koa-router", kind: "ROUTE_REG" },
  { libraryId: "hono", kind: "ROUTE_REG" },
  { libraryId: "hapi", kind: "ROUTE_REG" },
  // Python
  { libraryId: "flask", kind: "ROUTE_REG" },
  { libraryId: "FastAPI", kind: "ROUTE_REG" },
  { libraryId: "starlette", kind: "ROUTE_REG" },
  // PHP
  { libraryId: "Laravel", kind: "ROUTE_REG" },
  { libraryId: "Illuminate.Routing", kind: "ROUTE_REG" },
  { libraryId: "Symfony.Routing", kind: "ROUTE_REG" },
  // Kotlin
  { libraryId: "ktor.server", kind: "ROUTE_REG" },
  { libraryId: "ktor.routing", kind: "ROUTE_REG" },
  // Rust
  { libraryId: "actix-web", kind: "ROUTE_REG" },
  { libraryId: "actix_web", kind: "ROUTE_REG" },
  { libraryId: "axum", kind: "ROUTE_REG" },
  { libraryId: "rocket", kind: "ROUTE_REG" },
  // Java
  { libraryId: "Spring", kind: "ROUTE_REG" },
  { libraryId: "jakarta.ws.rs", kind: "ROUTE_REG" },
  // C#
  { libraryId: "Microsoft.AspNetCore", kind: "ROUTE_REG" },
  { libraryId: "MapGet", kind: "ROUTE_REG" },
  { libraryId: "MapPost", kind: "ROUTE_REG" },
  // Ruby
  { libraryId: "ActionDispatch", kind: "ROUTE_REG" },
  { libraryId: "Sinatra", kind: "ROUTE_REG" },
  // Elixir
  { libraryId: "Phoenix.Router", kind: "ROUTE_REG" },
  // Scala
  { libraryId: "akka.http.scaladsl.server", kind: "ROUTE_REG" },
  { libraryId: "play.api.routing", kind: "ROUTE_REG" },
];

/** gRPC client libraries — protobuf stub invocations. */
const GRPC_LIBRARIES: LibraryPattern[] = [
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

/** GraphQL client libraries. */
const GRAPHQL_LIBRARIES: LibraryPattern[] = [
  { libraryId: "graphql-request", kind: "GRAPHQL_CALLS" },
  { libraryId: "@apollo/client", kind: "GRAPHQL_CALLS" },
  { libraryId: "apollo-client", kind: "GRAPHQL_CALLS" },
  { libraryId: "urql", kind: "GRAPHQL_CALLS" },
  { libraryId: "graphql-tag", kind: "GRAPHQL_CALLS" },
  { libraryId: "gql", kind: "GRAPHQL_CALLS" },
  { libraryId: "sgqlc", kind: "GRAPHQL_CALLS" },
  { libraryId: "graphene", kind: "GRAPHQL_CALLS" },
  { libraryId: "graphql-java", kind: "GRAPHQL_CALLS" },
  { libraryId: "DgsQueryExecutor", kind: "GRAPHQL_CALLS" },
  { libraryId: "graphql-go", kind: "GRAPHQL_CALLS" },
  { libraryId: "gqlgen", kind: "GRAPHQL_CALLS" },
  { libraryId: "graphql-ruby", kind: "GRAPHQL_CALLS" },
  { libraryId: "async-graphql", kind: "GRAPHQL_CALLS" },
  { libraryId: "juniper", kind: "GRAPHQL_CALLS" },
];

/** tRPC libraries (TypeScript only). */
const TRPC_LIBRARIES: LibraryPattern[] = [
  { libraryId: "@trpc/server", kind: "TRPC_CALLS" },
  { libraryId: "@trpc/client", kind: "TRPC_CALLS" },
  { libraryId: "@trpc/react-query", kind: "TRPC_CALLS" },
  { libraryId: "createTRPCRouter", kind: "TRPC_CALLS" },
  { libraryId: "createTRPCProxyClient", kind: "TRPC_CALLS" },
];

/** HTTP method suffixes on callee names (for HTTP client calls). */
interface MethodSuffix {
  suffix: string;
  method: string | null; // null = no method inferred
}

const METHOD_SUFFIXES: MethodSuffix[] = [
  { suffix: ".get", method: "GET" },       { suffix: ".Get", method: "GET" },
  { suffix: ".GET", method: "GET" },
  { suffix: ".post", method: "POST" },      { suffix: ".Post", method: "POST" },
  { suffix: ".POST", method: "POST" },
  { suffix: ".put", method: "PUT" },        { suffix: ".Put", method: "PUT" },
  { suffix: ".PUT", method: "PUT" },
  { suffix: ".delete", method: "DELETE" },  { suffix: ".Delete", method: "DELETE" },
  { suffix: ".DELETE", method: "DELETE" },
  { suffix: ".patch", method: "PATCH" },    { suffix: ".Patch", method: "PATCH" },
  { suffix: ".PATCH", method: "PATCH" },
  { suffix: ".head", method: "HEAD" },      { suffix: ".Head", method: "HEAD" },
  { suffix: ".HEAD", method: "HEAD" },
  { suffix: ".options", method: "OPTIONS" }, { suffix: ".Options", method: "OPTIONS" },
  { suffix: "GetAsync", method: "GET" },
  { suffix: "PostAsync", method: "POST" },  { suffix: "PutAsync", method: "PUT" },
  { suffix: "DeleteAsync", method: "DELETE" },
  { suffix: "SendAsync", method: null },
  { suffix: "getForObject", method: "GET" }, { suffix: "getForEntity", method: "GET" },
  { suffix: "postForObject", method: "POST" }, { suffix: "postForEntity", method: "POST" },
];

/** Route registration method suffixes — matched on callee name.
 *  These are methods on router objects that register handlers. */
const ROUTE_REG_SUFFIXES: MethodSuffix[] = [
  { suffix: ".GET", method: "GET" },     { suffix: ".Get", method: "GET" },
  { suffix: ".get", method: "GET" },
  { suffix: ".POST", method: "POST" },    { suffix: ".Post", method: "POST" },
  { suffix: ".post", method: "POST" },
  { suffix: ".PUT", method: "PUT" },      { suffix: ".Put", method: "PUT" },
  { suffix: ".put", method: "PUT" },
  { suffix: ".DELETE", method: "DELETE" }, { suffix: ".Delete", method: "DELETE" },
  { suffix: ".delete", method: "DELETE" },
  { suffix: ".PATCH", method: "PATCH" },  { suffix: ".Patch", method: "PATCH" },
  { suffix: ".patch", method: "PATCH" },
  { suffix: ".Handle", method: "ANY" },   { suffix: ".HandleFunc", method: "ANY" },
  { suffix: ".handle", method: "ANY" },
  { suffix: ".Route", method: "ANY" },    { suffix: ".route", method: "ANY" },
  { suffix: "::get", method: "GET" },     { suffix: "::post", method: "POST" },
  { suffix: "::put", method: "PUT" },     { suffix: "::delete", method: "DELETE" },
  { suffix: "::patch", method: "PATCH" },
  { suffix: ".MapGet", method: "GET" },   { suffix: ".MapPost", method: "POST" },
  { suffix: ".MapPut", method: "PUT" },   { suffix: ".MapDelete", method: "DELETE" },
  { suffix: ".include_router", method: "ANY" }, { suffix: ".mount", method: "ANY" },
  { suffix: ".add_url_rule", method: "ANY" },   { suffix: ".register_blueprint", method: "ANY" },
  { suffix: ".use", method: "ANY" },      { suffix: ".register", method: "ANY" },
  { suffix: ".add_route", method: "ANY" }, { suffix: ".add_api_route", method: "ANY" },
  { suffix: ".add_api_websocket_route", method: "ANY" },
];

// ============================================================================
// Classification Engine
// ============================================================================

/**
 * Match a library identifier against a list of patterns.
 * Uses case-sensitive substring matching on the resolved QN.
 */
function matchQn(qn: string, patterns: LibraryPattern[]): LibraryPattern | null {
  for (const p of patterns) {
    if (qn.includes(p.libraryId)) {
      return p;
    }
  }
  return null;
}

/**
 * Extract the HTTP method from a callee name suffix.
 * Uses string-suffix matching (e.g., ".get" → "GET").
 */
export function inferHttpMethod(calleeName: string): string | null {
  for (const { suffix, method } of METHOD_SUFFIXES) {
    if (calleeName.endsWith(suffix)) {
      return method;
    }
  }
  return null;
}

/**
 * Extract the route registration method from a callee name.
 * (e.g., "router.GET" → "GET", "app.post" → "POST").
 */
export function inferRouteMethod(calleeName: string): string | null {
  for (const { suffix, method } of ROUTE_REG_SUFFIXES) {
    if (calleeName.endsWith(suffix)) {
      return method;
    }
  }
  return null;
}

/**
 * Classify a resolved call into a service edge type based on the callee's
 * resolved qualified name and the known library patterns.
 *
 * Order matters: route registration is checked FIRST to prevent frameworks
 * like gin/express from being classified as HTTP clients (both have .get/.post
 * suffixes but serve opposite roles).
 */
export function classifyCall(call: ResolvedCall): ServiceClassification | null {
  const qn = call.resolvedQn;
  if (!qn) {
    // Unresolved call — try callee-name-only heuristics
    return classifyByCalleeName(call);
  }

  // Check in priority order:
  // 1. Route registration (handler binding, NOT outbound HTTP)
  // 2. HTTP client
  // 3. ASYNC dispatch
  // 4. CONFIG access
  // 5. gRPC client
  // 6. GraphQL client
  // 7. tRPC client

  let pattern: LibraryPattern | null;

  pattern = matchQn(qn, ROUTE_REG_LIBRARIES);
  if (pattern) {
    const method = inferRouteMethod(call.calleeName);
    return {
      edgeType: "ROUTE_REG",
      httpMethod: method ?? "ANY",
      urlPath: call.firstStringArg,
      via: "route_registration",
    };
  }

  pattern = matchQn(qn, HTTP_LIBRARIES);
  if (pattern) {
    const method = inferHttpMethod(call.calleeName);
    return {
      edgeType: pattern.kind,
      httpMethod: method ?? undefined,
      urlPath: extractUrlFromArgs(call),
      via: "library_pattern",
    };
  }

  pattern = matchQn(qn, ASYNC_LIBRARIES);
  if (pattern) {
    return {
      edgeType: pattern.kind,
      broker: pattern.broker,
      urlPath: extractUrlFromArgs(call),
      via: "library_pattern",
    };
  }

  pattern = matchQn(qn, CONFIG_LIBRARIES);
  if (pattern) {
    return { edgeType: pattern.kind, via: "library_pattern" };
  }

  pattern = matchQn(qn, GRPC_LIBRARIES);
  if (pattern) {
    const { service, method } = extractGrpcServiceMethod(call.calleeName, qn);
    return {
      edgeType: pattern.kind,
      grpcService: service,
      grpcMethod: method,
      via: "library_pattern",
    };
  }

  pattern = matchQn(qn, GRAPHQL_LIBRARIES);
  if (pattern) {
    return { edgeType: pattern.kind, via: "library_pattern" };
  }

  pattern = matchQn(qn, TRPC_LIBRARIES);
  if (pattern) {
    return { edgeType: pattern.kind, via: "library_pattern" };
  }

  // No service pattern matched — this is a regular CALLS edge.
  // But still try URL-in-args detection for unclassified calls.
  const urlFromArgs = extractUrlFromArgs(call);
  if (urlFromArgs) {
    return {
      edgeType: "HTTP_CALLS",
      urlPath: urlFromArgs,
      httpMethod: "ANY",
      via: "arg_url",
    };
  }

  return null; // Regular CALLS edge
}

/** Global `fetch()` API detection (deliberately checked last). */
export function isGlobalFetch(call: ResolvedCall): boolean {
  return call.calleeName === "fetch" && !call.resolvedQn;
}

/** Classify by callee name alone (unresolved calls). */
function classifyByCalleeName(call: ResolvedCall): ServiceClassification | null {
  // Global fetch()
  if (isGlobalFetch(call)) {
    const urlFromArgs = extractUrlFromArgs(call);
    return {
      edgeType: "HTTP_CALLS",
      urlPath: urlFromArgs,
      via: "arg_url",
    };
  }

  // URL-in-args detection for bare callee names
  const urlFromArgs = extractUrlFromArgs(call);
  if (urlFromArgs) {
    return {
      edgeType: "HTTP_CALLS",
      urlPath: urlFromArgs,
      httpMethod: "ANY",
      via: "arg_url",
    };
  }

  return null;
}

// ============================================================================
// HTTP Route Detection (from decorators/annotations)
// ============================================================================

/**
 * HTTP method names recognized in Python decorator calls.
 * (e.g., @router.post → "POST", @app.get → "GET")
 */
function decoratorMethodName(attrText: string): string | null {
  const dot = attrText.lastIndexOf(".");
  const method = dot >= 0 ? attrText.slice(dot + 1) : attrText;
  const methodMap: Record<string, string> = {
    "get": "GET", "Get": "GET",
    "post": "POST", "Post": "POST",
    "put": "PUT", "Put": "PUT",
    "delete": "DELETE", "Delete": "DELETE",
    "patch": "PATCH", "Patch": "PATCH",
    "route": "ANY", "api_route": "ANY",
  };
  return methodMap[method] ?? null;
}

/**
 * HTTP method for Spring/JAX-RS style annotations.
 * (e.g., @GetMapping → "GET", @RequestMapping → "ANY")
 */
function annotationRouteMethod(name: string): string | null {
  const mappingMap: Record<string, string> = {
    "GetMapping": "GET",
    "PostMapping": "POST",
    "PutMapping": "PUT",
    "DeleteMapping": "DELETE",
    "PatchMapping": "PATCH",
    "RequestMapping": "ANY",
  };
  if (mappingMap[name]) return mappingMap[name];

  // JAX-RS bare-verb annotations (@GET, @POST, ...)
  const jaxVerbs = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
  if (jaxVerbs.includes(name)) return name;

  return null;
}

/**
 * Extract route path and method from a decorator string.
 * Supports:
 *   Flask: @app.route("/path")
 *   FastAPI: @router.post("/path"), @app.get("/path")
 *   Django REST: @action(detail=True, methods=["post"], url_path="approve")
 *   Express: app.get("/path"), router.post("/path")
 *   Spring: @GetMapping("/orders"), @RequestMapping(value="/api")
 *   Gin: router.GET("/path")
 *   ASP.NET: [HttpGet("/api")]
 *   JAX-RS: @GET @Path("/api")
 *
 * @param decoratorText - full decorator text (e.g., "router.get('/users')")
 * @returns { method, path } or null if not a route decorator
 */
export interface DecoratorRoute {
  method: string;  // "GET", "POST", "PUT", "DELETE", "PATCH", "ANY"
  path: string;    // URL path starting with "/"
  framework: string; // identified framework
}

export function parseRouteDecorator(decoratorText: string): DecoratorRoute | null {
  if (!decoratorText) return null;

  // Extract function name and path from pattern: <name>("<path>", ...)
  const callMatch = decoratorText.match(/^([\w.]+)\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!callMatch) {
    // Try annotation-style: @GetMapping("/path") where decorator IS the full text
    const annotationMatch = decoratorText.match(/^@?(\w+)\s*\(\s*(?:value\s*=\s*)?["'`]([^"'`]+)["'`]/);
    if (!annotationMatch) return null;

    const [, name, path] = annotationMatch;
    const method = annotationRouteMethod(name);
    if (!method || !path.startsWith("/")) return null;
    return { method, path, framework: detectFramework(decoratorText, name) };
  }

  let [, funcName, path] = callMatch;
  if (!path.startsWith("/")) return null;

  // Try annotation form first
  const method = annotationRouteMethod(funcName);
  if (method) {
    return { method, path, framework: detectFramework(decoratorText, funcName) };
  }

  // Try decorator method form
  const decMethod = decoratorMethodName(funcName);
  if (!decMethod) return null;

  return { method: decMethod, path, framework: detectFramework(decoratorText, funcName) };
}

/** Detect web framework from decorator text. */
function detectFramework(text: string, name: string): string {
  if (text.includes("flask") || name.startsWith("app.")) return "Flask";
  if (text.includes("fastapi") || text.includes("FastAPI") || text.includes("router.")) return "FastAPI";
  if (text.includes("django") || text.includes("action")) return "Django";
  if (text.includes("express") || text.includes("Express")) return "Express";
  if (text.includes("gin-gonic") || name.startsWith("gin.")) return "Gin";
  if (text.includes("echo") || name.startsWith("echo.")) return "Echo";
  if (text.includes("chi") || name.startsWith("chi.")) return "Chi";
  if (text.includes("fiber") || name.startsWith("fiber.")) return "Fiber";
  if (text.includes("Spring") || name.endsWith("Mapping")) return "Spring";
  if (text.includes("GetMap") || text.includes("MapGet")) return "ASP.NET";
  if (text.includes("jakarta") || text.includes("Path")) return "JAX-RS";
  if (text.includes("actix") || text.includes("axum") || text.includes("rocket")) return "Rust";
  if (text.includes("Phoenix") || text.includes("Router")) return "Phoenix";
  return "unknown";
}

// ============================================================================
// gRPC Service Detection (from callee name)
// ============================================================================

/**
 * Extract gRPC service and method from a callee name.
 *
 * Handles patterns like:
 *   pb.NewCartServiceClient(conn).GetCart → CartService/GetCart
 *   FooServiceGrpc.newBlockingStub(ch).getBar → FooService/getBar
 *   NewOrderServiceClient(conn).CreateOrder → OrderService/CreateOrder
 *
 * Strips generated-stub suffixes: Client, Stub, Grpc, BlockingStub,
 * FutureStub, AsyncStub, AsyncClient, Servicer.
 */
export function extractGrpcServiceMethod(
  calleeName: string,
  resolvedQn?: string,
): { service: string; method: string } | null {
  // Also try the resolved QN for Go chained calls:
  // calleeName = "GetCart", QN = "...CartServiceClient.GetCart"
  const source = resolvedQn && resolvedQn.includes("Service") ? resolvedQn : calleeName;
  const lastDot = source.lastIndexOf(".");
  if (lastDot < 0 || lastDot === source.length - 1) return null;

  const method = source.slice(lastDot + 1);
  if (!method) return null;

  const prefix = source.slice(0, lastDot);

  // Strip Go-generated prefixes: pb.New, New, pb.
  let service = prefix;
  if (service.startsWith("pb.New")) service = service.slice(6);
  else if (service.startsWith("pb.")) service = service.slice(3);
  else if (service.startsWith("New")) service = service.slice(3);

  // Strip generated stub/client suffixes (longest first to catch BlockingStub over Stub)
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

  // Only return when a recognized suffix was stripped (avoids false positives
  // like `_provider.GetGroup` producing phantom `__grpc__provider/GetGroup`)
  if (!stripped) return null;
  if (!service || !method) return null;

  return { service, method };
}

// ============================================================================
// GraphQL Schema Detection (operation types from decorators/patterns)
// ============================================================================

/**
 * Detect GraphQL operation type from callee name or context.
 * Matches patterns like:
 *   client.query(QUERY, vars) → QUERY
 *   client.mutate(MUTATION, vars) → MUTATE
 *   useQuery(QUERY) → QUERY
 */
export type GraphQLOperation = "QUERY" | "MUTATION" | "SUBSCRIPTION";

/**
 * Classify a GraphQL call by its callee name suffix.
 */
export function classifyGraphQLCall(calleeName: string): GraphQLOperation | null {
  const lastDot = calleeName.lastIndexOf(".");
  const method = lastDot >= 0 ? calleeName.slice(lastDot + 1) : calleeName;

  if (method === "query" || method === "readQuery" || method === "watchQuery") return "QUERY";
  if (method === "mutate" || method === "writeQuery") return "MUTATION";
  if (method === "subscribe" || method === "subscribeToMore") return "SUBSCRIPTION";

  return null;
}

// ============================================================================
// Pub/Sub Channel Detection
// ============================================================================

/**
 * Channel transport types (matching the C implementation in extract_channels.c).
 */
export type ChannelTransport =
  | "socketio"
  | "event_emitter"
  | "websocket"
  | "kafka"
  | "rabbitmq"
  | "django_channels"
  | "spring_websocket"
  | "signalr"
  | "actioncable"
  | "phoenix_pubsub"
  | "phoenix_channel";

/**
 * Channel detection rules by language.
 * Maps method name + receiver hint → (transport, direction).
 */
interface ChannelRule {
  language: string;
  nodeType: string;       // AST node type (e.g., "call_expression", "decorator")
  receiverPattern?: RegExp; // match on receiver/object text
  methodName: string;     // exact method name
  direction: "emit" | "listen";
  transport: ChannelTransport;
  desc: string;
}

/** Complete channel detection rules (ported from extract_channels.c). */
const CHANNEL_RULES: ChannelRule[] = [
  // JS/TS — Socket.IO
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "emit", direction: "emit", transport: "socketio", desc: "socket.emit('event')" },
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "on", direction: "listen", transport: "socketio", desc: "socket.on('event')" },
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "addListener", direction: "listen", transport: "socketio", desc: "socket.addListener" },
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "once", direction: "listen", transport: "socketio", desc: "socket.once('event')" },

  // JS/TS — EventEmitter
  { language: "js", nodeType: "call_expression",
    receiverPattern: /emitter|eventEmitter|events|bus|eventBus|pubsub$/,
    methodName: "emit", direction: "emit", transport: "event_emitter", desc: "emitter.emit('event')" },
  { language: "js", nodeType: "call_expression",
    receiverPattern: /emitter|eventEmitter|events|bus|eventBus|pubsub$/,
    methodName: "on", direction: "listen", transport: "event_emitter", desc: "emitter.on('event')" },
  { language: "js", nodeType: "call_expression",
    receiverPattern: /emitter|eventEmitter|events|bus|eventBus|pubsub$/,
    methodName: "addListener", direction: "listen", transport: "event_emitter", desc: "emitter.addListener" },

  // JS/TS — Kafka
  { language: "js", nodeType: "call_expression", receiverPattern: /producer$/,
    methodName: "send", direction: "emit", transport: "kafka", desc: "producer.send()" },
  { language: "js", nodeType: "call_expression", receiverPattern: /producer$/,
    methodName: "sendBatch", direction: "emit", transport: "kafka", desc: "producer.sendBatch()" },
  { language: "js", nodeType: "call_expression", receiverPattern: /consumer$/,
    methodName: "subscribe", direction: "listen", transport: "kafka", desc: "consumer.subscribe()" },
  { language: "js", nodeType: "call_expression", receiverPattern: /consumer$/,
    methodName: "run", direction: "listen", transport: "kafka", desc: "consumer.run()" },

  // JS/TS — RabbitMQ
  { language: "js", nodeType: "call_expression",
    methodName: "publish", direction: "emit", transport: "rabbitmq", desc: "channel.publish()" },
  { language: "js", nodeType: "call_expression",
    methodName: "sendToQueue", direction: "emit", transport: "rabbitmq", desc: "channel.sendToQueue()" },
  { language: "js", nodeType: "call_expression",
    methodName: "consume", direction: "listen", transport: "rabbitmq", desc: "channel.consume()" },
  { language: "js", nodeType: "call_expression",
    methodName: "assertQueue", direction: "listen", transport: "rabbitmq", desc: "channel.assertQueue()" },

  // Python — python-socketio / Django Channels
  { language: "py", nodeType: "call", receiverPattern: /sio|socketio|socket$/,
    methodName: "emit", direction: "emit", transport: "socketio", desc: "sio.emit('event')" },
  { language: "py", nodeType: "call", receiverPattern: /sio|socketio|socket$/,
    methodName: "on", direction: "listen", transport: "socketio", desc: "@sio.on('event')" },
  { language: "py", nodeType: "decorator", receiverPattern: /sio|socketio|socket$/,
    methodName: "on", direction: "listen", transport: "socketio", desc: "@sio.on('event')" },
  { language: "py", nodeType: "call", receiverPattern: /channel_layer$/,
    methodName: "send", direction: "emit", transport: "django_channels", desc: "channel_layer.send()" },
  { language: "py", nodeType: "call", receiverPattern: /channel_layer$/,
    methodName: "group_send", direction: "emit", transport: "django_channels", desc: "channel_layer.group_send()" },

  // Python — FastAPI WebSocket
  { language: "py", nodeType: "call", receiverPattern: /websocket|ws$/,
    methodName: "send", direction: "emit", transport: "websocket", desc: "ws.send()" },
  { language: "py", nodeType: "call", receiverPattern: /websocket|ws$/,
    methodName: "send_text", direction: "emit", transport: "websocket", desc: "ws.send_text()" },
  { language: "py", nodeType: "call", receiverPattern: /websocket|ws$/,
    methodName: "send_json", direction: "emit", transport: "websocket", desc: "ws.send_json()" },
  { language: "py", nodeType: "call", receiverPattern: /websocket|ws$/,
    methodName: "receive", direction: "listen", transport: "websocket", desc: "ws.receive()" },
  { language: "py", nodeType: "call", receiverPattern: /websocket|ws$/,
    methodName: "receive_text", direction: "listen", transport: "websocket", desc: "ws.receive_text()" },
  { language: "py", nodeType: "call", receiverPattern: /websocket|ws$/,
    methodName: "receive_json", direction: "listen", transport: "websocket", desc: "ws.receive_json()" },

  // Python — Kafka
  { language: "py", nodeType: "call", receiverPattern: /producer$/,
    methodName: "send", direction: "emit", transport: "kafka", desc: "producer.send()" },
  { language: "py", nodeType: "call", receiverPattern: /producer$/,
    methodName: "produce", direction: "emit", transport: "kafka", desc: "producer.produce()" },
  { language: "py", nodeType: "call", receiverPattern: /consumer$/,
    methodName: "subscribe", direction: "listen", transport: "kafka", desc: "consumer.subscribe()" },
  { language: "py", nodeType: "call", receiverPattern: /consumer$/,
    methodName: "poll", direction: "listen", transport: "kafka", desc: "consumer.poll()" },

  // Go — gorilla/nhooyr WebSocket
  { language: "go", nodeType: "call_expression", receiverPattern: /conn|wsConn|ws|c|Conn|connection$/,
    methodName: "WriteMessage", direction: "emit", transport: "websocket", desc: "conn.WriteMessage()" },
  { language: "go", nodeType: "call_expression", receiverPattern: /conn|wsConn|ws|c|Conn|connection$/,
    methodName: "WriteJSON", direction: "emit", transport: "websocket", desc: "conn.WriteJSON()" },
  { language: "go", nodeType: "call_expression", receiverPattern: /conn|wsConn|ws|c|Conn|connection$/,
    methodName: "Write", direction: "emit", transport: "websocket", desc: "conn.Write()" },
  { language: "go", nodeType: "call_expression", receiverPattern: /conn|wsConn|ws|c|Conn|connection$/,
    methodName: "ReadMessage", direction: "listen", transport: "websocket", desc: "conn.ReadMessage()" },
  { language: "go", nodeType: "call_expression", receiverPattern: /conn|wsConn|ws|c|Conn|connection$/,
    methodName: "ReadJSON", direction: "listen", transport: "websocket", desc: "conn.ReadJSON()" },
  { language: "go", nodeType: "call_expression", receiverPattern: /conn|wsConn|ws|c|Conn|connection$/,
    methodName: "Read", direction: "listen", transport: "websocket", desc: "conn.Read()" },

  // Java — Spring STOMP/WebSocket
  { language: "java", nodeType: "method_invocation",
    methodName: "convertAndSend", direction: "emit", transport: "spring_websocket",
    desc: "template.convertAndSend()" },
  { language: "java", nodeType: "method_invocation",
    methodName: "convertAndSendToUser", direction: "emit", transport: "spring_websocket",
    desc: "template.convertAndSendToUser()" },
  { language: "java", nodeType: "method_invocation",
    methodName: "sendText", direction: "emit", transport: "websocket", desc: "session.sendText()" },
  { language: "java", nodeType: "method_invocation",
    methodName: "sendObject", direction: "emit", transport: "websocket", desc: "session.sendObject()" },
  { language: "java", nodeType: "method_invocation",
    methodName: "sendBinary", direction: "emit", transport: "websocket", desc: "session.sendBinary()" },

  // Java — WebSocket annotations
  { language: "java", nodeType: "annotation",
    methodName: "OnMessage", direction: "listen", transport: "websocket", desc: "@OnMessage" },
  { language: "java", nodeType: "annotation",
    methodName: "OnOpen", direction: "listen", transport: "websocket", desc: "@OnOpen" },
  { language: "java", nodeType: "annotation",
    methodName: "OnClose", direction: "listen", transport: "websocket", desc: "@OnClose" },
  { language: "java", nodeType: "annotation",
    methodName: "MessageMapping", direction: "listen", transport: "spring_websocket",
    desc: "@MessageMapping" },
  { language: "java", nodeType: "annotation",
    methodName: "ServerEndpoint", direction: "listen", transport: "websocket",
    desc: "@ServerEndpoint" },

  // C# — SignalR
  { language: "csharp", nodeType: "invocation_expression",
    methodName: "SendAsync", direction: "emit", transport: "signalr",
    desc: "Clients.All.SendAsync()" },
  { language: "csharp", nodeType: "invocation_expression",
    methodName: "SendCoreAsync", direction: "emit", transport: "signalr",
    desc: "Clients.SendCoreAsync()" },
  { language: "csharp", nodeType: "invocation_expression",
    methodName: "On", direction: "listen", transport: "signalr", desc: "connection.On()" },

  // Ruby — ActionCable
  { language: "ruby", nodeType: "call",
    methodName: "broadcast", direction: "emit", transport: "actioncable",
    desc: "ActionCable.server.broadcast()" },
  { language: "ruby", nodeType: "call",
    methodName: "stream_from", direction: "listen", transport: "actioncable",
    desc: "stream_from()" },
  { language: "ruby", nodeType: "call",
    methodName: "stream_for", direction: "listen", transport: "actioncable",
    desc: "stream_for()" },

  // Elixir — Phoenix.PubSub / Phoenix.Channel
  { language: "elixir", nodeType: "call",
    methodName: "broadcast", direction: "emit", transport: "phoenix_channel",
    desc: "PubSub.broadcast()" },
  { language: "elixir", nodeType: "call",
    methodName: "broadcast!", direction: "emit", transport: "phoenix_channel",
    desc: "broadcast!" },
  { language: "elixir", nodeType: "call",
    methodName: "push", direction: "emit", transport: "phoenix_channel", desc: "push()" },
  { language: "elixir", nodeType: "def",
    methodName: "handle_in", direction: "listen", transport: "phoenix_channel",
    desc: "handle_in('event')" },

  // Rust — tokio-tungstenite
  { language: "rust", nodeType: "call_expression",
    receiverPattern: /sink|ws_sender|writer|write$/,
    methodName: "send", direction: "emit", transport: "websocket", desc: "sink.send()" },
  { language: "rust", nodeType: "call_expression",
    receiverPattern: /sink|ws_sender|writer|write$/,
    methodName: "send_all", direction: "emit", transport: "websocket", desc: "sink.send_all()" },
  { language: "rust", nodeType: "call_expression",
    receiverPattern: /sink|ws_sender|writer|write$/,
    methodName: "feed", direction: "emit", transport: "websocket", desc: "sink.feed()" },
  { language: "rust", nodeType: "call_expression",
    receiverPattern: /stream|ws_receiver|reader|read|ws_stream|ws$/,
    methodName: "next", direction: "listen", transport: "websocket", desc: "stream.next()" },
  { language: "rust", nodeType: "call_expression",
    receiverPattern: /stream|ws_receiver|reader|read|ws_stream|ws$/,
    methodName: "try_next", direction: "listen", transport: "websocket", desc: "stream.try_next()" },
];

/**
 * Detect channel participation from a method call.
 *
 * @param language - language identifier ("js", "py", "go", "java", "csharp", "ruby", "elixir", "rust")
 * @param receiverText - the object/receiver text (e.g., "socket", "producer")
 * @param methodName - the method being called (e.g., "emit", "on", "publish")
 * @param firstArg - first string argument (the channel name)
 * @returns ChannelRecord or null if no channel pattern matches
 */
export function detectChannel(
  language: string,
  receiverText: string,
  methodName: string,
  firstArg?: string,
): ChannelRecord | null {
  // Match against rules for the given language
  const candidates = CHANNEL_RULES.filter((r) => r.language === language && r.methodName === methodName);

  for (const rule of candidates) {
    // If rule has receiver pattern, check it
    if (rule.receiverPattern) {
      // Extract the tail from "obj.method" → "obj"
      const tail = receiverText.includes(".") ? receiverText.slice(receiverText.lastIndexOf(".") + 1) : receiverText;
      if (!rule.receiverPattern.test(tail) && !rule.receiverPattern.test(receiverText)) {
        continue;
      }
    }

    // For Kafka/RabbitMQ, channel name is sometimes the topic from the first arg
    const channelName = firstArg ?? `(${rule.transport})`;

    return {
      channelName,
      transport: rule.transport,
      enclosingFuncQn: "",
      direction: rule.direction,
    };
  }

  return null;
}

/**
 * Get all channel rules for a given language.
 * Useful for AST-based scanning when building the full channel list.
 */
export function getChannelRules(language: string): ChannelRule[] {
  return CHANNEL_RULES.filter((r) => r.language === language);
}

// ============================================================================
// Route Node Synthesis
// ============================================================================

/** Route QN prefix constants (matching C code: "__route__", "__grpc__", etc.) */
const ROUTE_PREFIX = "__route__";
const GRPC_PREFIX = "__grpc__";
const GRAPHQL_PREFIX = "__gql__";
const TRPC_PREFIX = "__trpc__";

/**
 * Canonize a URL path by normalizing template variables:
 *   /api/users/:id → /api/users/:param
 *   /api/orders/{order_id} → /api/orders/:param
 */
export function canonicRoutePath(path: string): string {
  return path
    .replace(/\/:\w+/g, "/:param")
    .replace(/\/\{\w+\}/g, "/:param")
    .replace(/\/\/+/g, "/")
    .replace(/\/$/, "");
}

/**
 * Synthesize a Route node from a classification result.
 *
 * Route QN format (matching C code):
 *   HTTP:  __route__<METHOD>__<canonical_path>
 *   gRPC:  __grpc__<Service>/<Method>
 *   GraphQL: __gql__<Operation>
 *   tRPC:  __trpc__<Procedure>
 */
export function synthesizeRouteNode(result: ServiceClassification): RouteNode {
  switch (result.edgeType) {
    case "HTTP_CALLS":
    case "ROUTE_REG": {
      const method = result.httpMethod ?? "ANY";
      const path = result.urlPath ?? "/";
      const canon = canonicRoutePath(path);
      return {
        qn: `${ROUTE_PREFIX}${method}__${canon}`,
        name: `${method} ${path}`,
        method,
        label: "Route",
        properties: {
          method,
          url_path: canon,
          source: result.via,
        },
      };
    }

    case "ASYNC_CALLS": {
      const broker = result.broker ?? "unknown";
      const target = result.urlPath ?? broker;
      return {
        qn: `${ROUTE_PREFIX}ASYNC__${broker}/${target}`,
        name: target,
        broker,
        label: "Route",
        properties: {
          broker,
          target,
          source: result.via,
        },
      };
    }

    case "GRPC_CALLS": {
      const service = result.grpcService ?? "Unknown";
      const method = result.grpcMethod ?? "Unknown";
      return {
        qn: `${GRPC_PREFIX}${service}/${method}`,
        name: `${service}/${method}`,
        label: "Route",
        properties: {
          service,
          method,
          source: result.via,
        },
      };
    }

    case "GRAPHQL_CALLS": {
      return {
        qn: `${GRAPHQL_PREFIX}${result.grpcMethod ?? "query"}`,
        name: `GraphQL ${result.grpcMethod ?? "query"}`,
        label: "Route",
        properties: { source: result.via },
      };
    }

    case "TRPC_CALLS": {
      return {
        qn: `${TRPC_PREFIX}${result.grpcMethod ?? result.urlPath ?? "unknown"}`,
        name: `tRPC ${result.grpcMethod ?? result.urlPath ?? "unknown"}`,
        label: "Route",
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

/**
 * Build a ServiceEdge from a classification result.
 *
 * @param sourceQn - QN of the calling function
 * @param classification - result of classifyCall()
 * @returns a ServiceEdge ready to insert into the graph
 */
export function buildServiceEdge(
  sourceQn: string,
  classification: ServiceClassification,
): ServiceEdge | null {
  const route = synthesizeRouteNode(classification);

  const properties: Record<string, string> = {
    callee: classification.grpcService
      ? `${classification.grpcService}/${classification.grpcMethod}`
      : classification.httpMethod ?? "ANY",
    via: classification.via,
  };

  if (classification.urlPath) properties.url_path = classification.urlPath;
  if (classification.httpMethod) properties.method = classification.httpMethod;
  if (classification.broker) properties.broker = classification.broker;
  if (classification.grpcService) properties.service = classification.grpcService;
  if (classification.grpcMethod) properties.rpc_method = classification.grpcMethod;

  return {
    sourceQn,
    targetQn: route.qn,
    type: classification.edgeType === "ROUTE_REG" ? "CALLS" : classification.edgeType,
    properties,
  };
}

/**
 * Build a HANDLES edge linking a handler function to a Route node.
 *
 * @param handlerQn - QN of the handler function
 * @param routeQn - QN of the Route node
 */
export function buildHandlesEdge(handlerQn: string, routeQn: string): ServiceEdge {
  return {
    sourceQn: handlerQn,
    targetQn: routeQn,
    type: "HANDLES",
    properties: { handler: handlerQn },
  };
}

/**
 * Build a channel edge (EMITS or LISTENS_ON) linking a function to a Channel node.
 */
export function buildChannelEdge(
  funcQn: string,
  channelName: string,
  transport: string,
  direction: "emit" | "listen",
): ServiceEdge {
  return {
    sourceQn: funcQn,
    targetQn: `__channel__${channelName}`,
    type: direction === "emit" ? "EMITS" : "LISTENS_ON",
    properties: {
      channel_name: channelName,
      transport,
    },
  };
}

// ============================================================================
// URL Extraction from Arguments
// ============================================================================

/**
 * Extract a URL/API path from call arguments.
 * Mirrors the detect_url_in_args() function from pass_parallel.c.
 *
 * Recognizes:
 *   - Full URLs: "https://api.example.com/users"
 *   - API paths: "/api/users"
 *   - Template literals: `/${base}/users/${id}`
 */
function extractUrlFromArgs(call: ResolvedCall): string | undefined {
  if (!call.args || call.args.length === 0) {
    // Also check firstStringArg
    if (call.firstStringArg && isUrlCandidate(call.firstStringArg)) {
      return normalizeUrlArg(call.firstStringArg);
    }
    return undefined;
  }

  for (const arg of call.args) {
    const url = arg.value ?? arg.expr;
    if (!url || (!url.startsWith("/") && !url.startsWith("http"))) continue;

    if (isUrlCandidate(url)) {
      return normalizeUrlArg(url);
    }
  }

  return undefined;
}

/** Check if a string looks like a URL/path candidate (not a filesystem path). */
function isUrlCandidate(s: string): boolean {
  // Reject regex metacharacters, spaces, double-slashes
  if (/[\\^$*+()|[\] ]/.test(s)) return false;
  if (s.includes("//")) return false;

  // Reject filesystem paths (/etc/..., /home/..., /var/...)
  const fsRoots = [
    "etc", "root", "var", "usr", "home", "tmp", "private", "opt",
    "bin", "sbin", "dev", "proc", "sys", "run", "lib", "lib64",
    "mnt", "media", "boot", "srv", "Users", "Volumes",
  ];
  for (const root of fsRoots) {
    if (s === `/${root}` || s.startsWith(`/${root}/`)) return false;
  }

  // Reject config file extensions
  if (/\.(cfg|conf|env|ini|toml|properties|service|sock|socket|sqlite|db|crt|key|pem|pid)$/.test(s))
    return false;

  // Reject config paths
  if (/\/\.(aws|azure|config|docker|env|git|gnupg|kube|ssh)\//.test(s)) return false;

  return true;
}

/** Normalize template literal URLs and reject junk. */
function normalizeUrlArg(url: string): string {
  let u = url;
  // Strip quotes/backticks
  if (u.startsWith("'") || u.startsWith('"') || u.startsWith("`")) u = u.slice(1);
  if (u.endsWith("'") || u.endsWith('"') || u.endsWith("`")) u = u.slice(0, -1);

  // Full URL → just return it
  if (u.startsWith("http://") || u.startsWith("https://")) return u;

  // Normalize template literals: ${var} → :param
  if (u.includes("${")) {
    u = u.replace(/\$\{[^}]+\}/g, ":param");
  }

  // Must contain at least one '/'
  if (!u.includes("/", 1)) return "";

  return u;
}

// ============================================================================
// Cross-Project Route Matching
// ============================================================================

/**
 * Match a route QN from one project against routes in other projects.
 *
 * The C implementation (pass_cross_repo.c) does this by:
 *   1. Scanning HTTP_CALLS edges in the source project
 *   2. Extracting the url_path from edge properties
 *   3. Looking up the Route node by QN in other project DBs
 *   4. Creating CROSS_HTTP_CALLS edges
 *
 * This function provides the matching logic for TypeScript.
 */
export interface CrossProjectMatch {
  sourceProject: string;
  targetProject: string;
  edgeType: ServiceEdgeType;
  sourceQn: string;
  targetQn: string;
  routePath: string;
}

/**
 * Match HTTP_CALLS route paths across projects.
 * Returns pairs of (source edge, matching target Route) that should become CROSS_HTTP_CALLS.
 */
export function matchCrossProjectRoutes(
  sourceRoutes: Array<{ qn: string; urlPath: string; sourceQn: string }>,
  targetRoutes: Array<{ qn: string; urlPath: string }>,
  sourceProject: string,
  targetProject: string,
): CrossProjectMatch[] {
  const matches: CrossProjectMatch[] = [];

  // Build lookup map: url_path → target Route QN
  const targetByPath = new Map<string, string>();
  for (const tr of targetRoutes) {
    if (!targetByPath.has(tr.urlPath)) {
      targetByPath.set(tr.urlPath, tr.qn);
    }
  }

  for (const sr of sourceRoutes) {
    // Strip scheme://host:port from full URLs to match path-only routes
    const pathOnly = sr.urlPath.replace(/^https?:\/\/[^/]+/, "");
    const targetQn = targetByPath.get(pathOnly) ?? targetByPath.get(sr.urlPath);
    if (targetQn) {
      matches.push({
        sourceProject,
        targetProject,
        edgeType: "CROSS_HTTP_CALLS",
        sourceQn: sr.sourceQn,
        targetQn,
        routePath: pathOnly,
      });
    }
  }

  return matches;
}

/**
 * Match channel names across projects.
 * EMITS in source → matching LISTENS_ON in target = CROSS_CHANNEL.
 */
export function matchCrossProjectChannels(
  sourceChannels: Array<{ channelName: string; funcQn: string; direction: "emit" | "listen" }>,
  targetChannels: Array<{ channelName: string; direction: "emit" | "listen" }>,
  sourceProject: string,
  targetProject: string,
): CrossProjectMatch[] {
  const matches: CrossProjectMatch[] = [];

  // Build set of target channel names by direction
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
        sourceProject,
        targetProject,
        edgeType: "CROSS_CHANNEL",
        sourceQn: sc.funcQn,
        targetQn: `__channel__${sc.channelName}`,
        routePath: sc.channelName,
      });
    }
  }

  return matches;
}

/**
 * Match gRPC routes (service/method pairs) across projects.
 */
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
        sourceProject,
        targetProject,
        edgeType: "CROSS_GRPC_CALLS",
        sourceQn: sg.sourceQn,
        targetQn: `${GRPC_PREFIX}${key}`,
        routePath: key,
      });
    }
  }

  return matches;
}
