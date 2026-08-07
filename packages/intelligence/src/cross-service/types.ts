/**
 * Cross-Service Linking — Shared Types
 * Types, interfaces, library patterns, and constants used across protocol-specific modules.
 * Ported from the C implementation in codebase-memory-mcp.
 */

// ============================================================================
// Constants
// ============================================================================

export const ROUTE_PREFIX = "__route__";
export const GRPC_PREFIX = "__grpc__";
export const GRAPHQL_PREFIX = "__gql__";
export const TRPC_PREFIX = "__trpc__";

// ============================================================================
// Edge Type Constants
// ============================================================================

export const ServiceEdgeType = {
  CALLS: EDGE_CALLS,
  HTTP_CALLS: "HTTP_CALLS",
  ASYNC_CALLS: "ASYNC_CALLS",
  GRPC_CALLS: "GRPC_CALLS",
  GRAPHQL_CALLS: "GRAPHQL_CALLS",
  TRPC_CALLS: "TRPC_CALLS",
  CONFIGURES: EDGE_CONFIGURES,
  ROUTE_REG: "ROUTE_REG",
  HANDLES: EDGE_HANDLES,
  EMITS: EDGE_EMITS,
  LISTENS_ON: EDGE_LISTENS_ON,
  IMPORTS: EDGE_IMPORTS,
  CALL_REFERENCE: "CALL_REFERENCE",
  USAGE: "USAGE",
  INHERITS: "INHERITS",
  IMPLEMENTS: EDGE_IMPLEMENTS,
  THROWS: "THROWS",
  CROSS_HTTP_CALLS: "CROSS_HTTP_CALLS",
  CROSS_ASYNC_CALLS: "CROSS_ASYNC_CALLS",
  CROSS_CHANNEL: "CROSS_CHANNEL",
  CROSS_GRPC_CALLS: "CROSS_GRPC_CALLS",
  CROSS_GRAPHQL_CALLS: "CROSS_GRAPHQL_CALLS",
  CROSS_TRPC_CALLS: "CROSS_TRPC_CALLS",
} as const;

export type ServiceEdgeType = (typeof ServiceEdgeType)[keyof typeof ServiceEdgeType];

// ============================================================================
// Core Interfaces
// ============================================================================

export interface ServiceClassification {
  edgeType: ServiceEdgeType;
  urlPath?: string;
  httpMethod?: string;
  grpcService?: string;
  grpcMethod?: string;
  broker?: string;
  channelName?: string;
  channelTransport?: string;
  channelDirection?: "emit" | "listen";
  via: "library_pattern" | "callee_name" | "arg_url" | "route_registration" | "proto_rpc";
}

export interface ResolvedCall {
  calleeName: string;
  resolvedQn: string;
  enclosingFuncQn: string;
  firstStringArg?: string;
  args?: CallArg[];
  isMethod?: boolean;
}

export interface CallArg {
  expr: string;
  value?: string;
  keyword?: string;
  index: number;
}

export interface RouteNode {
  qn: string;
  name: string;
  method?: string;
  broker?: string;
  label: "Route";
  properties: Record<string, string>;
}

export interface ChannelRecord {
  channelName: string;
  transport: string;
  enclosingFuncQn: string;
  direction: "emit" | "listen";
}

export interface ServiceEdge {
  sourceQn: string;
  targetQn: string;
  type: ServiceEdgeType;
  properties: Record<string, string>;
}

export interface DecoratorRoute {
  method: string;
  path: string;
  framework: string;
}

export type GraphQLOperation = "QUERY" | "MUTATION" | "SUBSCRIPTION";

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

export interface CrossProjectMatch {
  sourceProject: string;
  targetProject: string;
  edgeType: ServiceEdgeType;
  sourceQn: string;
  targetQn: string;
  routePath: string;
}

// ============================================================================
// Pattern Types
// ============================================================================

export interface LibraryPattern {
  libraryId: string;
  kind: ServiceEdgeType;
  broker?: string;
}

export interface MethodSuffix {
  suffix: string;
  method: string | null;
}

export interface ChannelRule {
  language: string;
  nodeType: string;
  receiverPattern?: RegExp;
  methodName: string;
  direction: "emit" | "listen";
  transport: ChannelTransport;
  desc: string;
}

// ============================================================================
// Library Pattern Tables
// ============================================================================

/** HTTP client libraries — matched by substring in the resolved QN. */
export const HTTP_LIBRARIES: LibraryPattern[] = [
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
export const ASYNC_LIBRARIES: LibraryPattern[] = [
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
export const CONFIG_LIBRARIES: LibraryPattern[] = [
  { libraryId: "getenv", kind: EDGE_CONFIGURES },
  { libraryId: "Getenv", kind: EDGE_CONFIGURES },
  { libraryId: "getEnv", kind: EDGE_CONFIGURES },
  { libraryId: "LookupEnv", kind: EDGE_CONFIGURES },
  { libraryId: "lookupEnv", kind: EDGE_CONFIGURES },
  { libraryId: "get_env", kind: EDGE_CONFIGURES },
  { libraryId: "fetch_env", kind: EDGE_CONFIGURES },
  { libraryId: "GetEnvironmentVariable", kind: EDGE_CONFIGURES },
  { libraryId: "getProperty", kind: EDGE_CONFIGURES },
  { libraryId: "getEnvironment", kind: EDGE_CONFIGURES },
  { libraryId: "viper", kind: EDGE_CONFIGURES },
  { libraryId: "envconfig", kind: EDGE_CONFIGURES },
  { libraryId: "godotenv", kind: EDGE_CONFIGURES },
  { libraryId: "decouple", kind: EDGE_CONFIGURES },
  { libraryId: "dynaconf", kind: EDGE_CONFIGURES },
  { libraryId: "dotenv", kind: EDGE_CONFIGURES },
  { libraryId: "nconf", kind: EDGE_CONFIGURES },
  { libraryId: "convict", kind: EDGE_CONFIGURES },
  { libraryId: "envalid", kind: EDGE_CONFIGURES },
  { libraryId: "dotenvy", kind: EDGE_CONFIGURES },
  { libraryId: "figment", kind: EDGE_CONFIGURES },
  { libraryId: "config-rs", kind: EDGE_CONFIGURES },
  { libraryId: "ConfigFactory", kind: EDGE_CONFIGURES },
  { libraryId: "ConfigurationProperties", kind: EDGE_CONFIGURES },
  { libraryId: "Application.get_env", kind: EDGE_CONFIGURES },
  { libraryId: "Application.fetch_env", kind: EDGE_CONFIGURES },
];

/** Route registration frameworks. Checked BEFORE HTTP clients. */
export const ROUTE_REG_LIBRARIES: LibraryPattern[] = [
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
import { EDGE_CALLS, EDGE_CONFIGURES, EDGE_EMITS, EDGE_HANDLES, EDGE_IMPLEMENTS, EDGE_IMPORTS, EDGE_LISTENS_ON } from '@code-analyzer/shared';
  { libraryId: "akka.http.scaladsl.server", kind: "ROUTE_REG" },
  { libraryId: "play.api.routing", kind: "ROUTE_REG" },
];

/** HTTP method suffixes on callee names. */
export const METHOD_SUFFIXES: MethodSuffix[] = [
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

/** Route registration method suffixes. */
export const ROUTE_REG_SUFFIXES: MethodSuffix[] = [
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