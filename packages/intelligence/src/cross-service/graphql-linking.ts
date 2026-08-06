/**
 * Cross-Service GraphQL & tRPC Linking
 * GraphQL/tRPC library patterns, operation classification,
 * and pub/sub channel detection rules.
 */

import type {
  LibraryPattern,
  GraphQLOperation,
  ChannelRecord,
  ChannelRule,
  ChannelTransport,
} from './types.js';

// ============================================================================
// GraphQL Library Patterns
// ============================================================================

export const GRAPHQL_LIBRARIES: LibraryPattern[] = [
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

// ============================================================================
// tRPC Library Patterns
// ============================================================================

export const TRPC_LIBRARIES: LibraryPattern[] = [
  { libraryId: "@trpc/server", kind: "TRPC_CALLS" },
  { libraryId: "@trpc/client", kind: "TRPC_CALLS" },
  { libraryId: "@trpc/react-query", kind: "TRPC_CALLS" },
  { libraryId: "createTRPCRouter", kind: "TRPC_CALLS" },
  { libraryId: "createTRPCProxyClient", kind: "TRPC_CALLS" },
];

// ============================================================================
// GraphQL Operation Classification
// ============================================================================

export function classifyGraphQLCall(calleeName: string): GraphQLOperation | null {
  const lastDot = calleeName.lastIndexOf(".");
  const method = lastDot >= 0 ? calleeName.slice(lastDot + 1) : calleeName;
  if (method === "query" || method === "readQuery" || method === "watchQuery") return "QUERY";
  if (method === "mutate" || method === "writeQuery") return "MUTATION";
  if (method === "subscribe" || method === "subscribeToMore") return "SUBSCRIPTION";
  return null;
}

// ============================================================================
// Pub/Sub Channel Detection Rules
// ============================================================================

const CHANNEL_RULES: ChannelRule[] = [
  // JS/TS -- Socket.IO
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "emit", direction: "emit", transport: "socketio", desc: "socket.emit('event')" },
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "on", direction: "listen", transport: "socketio", desc: "socket.on('event')" },
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "addListener", direction: "listen", transport: "socketio", desc: "socket.addListener" },
  { language: "js", nodeType: "call_expression", receiverPattern: /socket|io|ws|client|server$/,
    methodName: "once", direction: "listen", transport: "socketio", desc: "socket.once('event')" },

  // JS/TS -- EventEmitter
  { language: "js", nodeType: "call_expression",
    receiverPattern: /emitter|eventEmitter|events|bus|eventBus|pubsub$/,
    methodName: "emit", direction: "emit", transport: "event_emitter", desc: "emitter.emit('event')" },
  { language: "js", nodeType: "call_expression",
    receiverPattern: /emitter|eventEmitter|events|bus|eventBus|pubsub$/,
    methodName: "on", direction: "listen", transport: "event_emitter", desc: "emitter.on('event')" },
  { language: "js", nodeType: "call_expression",
    receiverPattern: /emitter|eventEmitter|events|bus|eventBus|pubsub$/,
    methodName: "addListener", direction: "listen", transport: "event_emitter", desc: "emitter.addListener" },

  // JS/TS -- Kafka
  { language: "js", nodeType: "call_expression", receiverPattern: /producer$/,
    methodName: "send", direction: "emit", transport: "kafka", desc: "producer.send()" },
  { language: "js", nodeType: "call_expression", receiverPattern: /producer$/,
    methodName: "sendBatch", direction: "emit", transport: "kafka", desc: "producer.sendBatch()" },
  { language: "js", nodeType: "call_expression", receiverPattern: /consumer$/,
    methodName: "subscribe", direction: "listen", transport: "kafka", desc: "consumer.subscribe()" },
  { language: "js", nodeType: "call_expression", receiverPattern: /consumer$/,
    methodName: "run", direction: "listen", transport: "kafka", desc: "consumer.run()" },

  // JS/TS -- RabbitMQ
  { language: "js", nodeType: "call_expression",
    methodName: "publish", direction: "emit", transport: "rabbitmq", desc: "channel.publish()" },
  { language: "js", nodeType: "call_expression",
    methodName: "sendToQueue", direction: "emit", transport: "rabbitmq", desc: "channel.sendToQueue()" },
  { language: "js", nodeType: "call_expression",
    methodName: "consume", direction: "listen", transport: "rabbitmq", desc: "channel.consume()" },
  { language: "js", nodeType: "call_expression",
    methodName: "assertQueue", direction: "listen", transport: "rabbitmq", desc: "channel.assertQueue()" },

  // Python -- python-socketio / Django Channels
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

  // Python -- FastAPI WebSocket
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

  // Python -- Kafka
  { language: "py", nodeType: "call", receiverPattern: /producer$/,
    methodName: "send", direction: "emit", transport: "kafka", desc: "producer.send()" },
  { language: "py", nodeType: "call", receiverPattern: /producer$/,
    methodName: "produce", direction: "emit", transport: "kafka", desc: "producer.produce()" },
  { language: "py", nodeType: "call", receiverPattern: /consumer$/,
    methodName: "subscribe", direction: "listen", transport: "kafka", desc: "consumer.subscribe()" },
  { language: "py", nodeType: "call", receiverPattern: /consumer$/,
    methodName: "poll", direction: "listen", transport: "kafka", desc: "consumer.poll()" },

  // Go -- gorilla/nhooyr WebSocket
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

  // Java -- Spring STOMP/WebSocket
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

  // Java -- WebSocket annotations
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

  // C# -- SignalR
  { language: "csharp", nodeType: "invocation_expression",
    methodName: "SendAsync", direction: "emit", transport: "signalr",
    desc: "Clients.All.SendAsync()" },
  { language: "csharp", nodeType: "invocation_expression",
    methodName: "SendCoreAsync", direction: "emit", transport: "signalr",
    desc: "Clients.SendCoreAsync()" },
  { language: "csharp", nodeType: "invocation_expression",
    methodName: "On", direction: "listen", transport: "signalr", desc: "connection.On()" },

  // Ruby -- ActionCable
  { language: "ruby", nodeType: "call",
    methodName: "broadcast", direction: "emit", transport: "actioncable",
    desc: "ActionCable.server.broadcast()" },
  { language: "ruby", nodeType: "call",
    methodName: "stream_from", direction: "listen", transport: "actioncable",
    desc: "stream_from()" },
  { language: "ruby", nodeType: "call",
    methodName: "stream_for", direction: "listen", transport: "actioncable",
    desc: "stream_for()" },

  // Elixir -- Phoenix.PubSub / Phoenix.Channel
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

  // Rust -- tokio-tungstenite
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

// ============================================================================
// Channel Detection
// ============================================================================

export function detectChannel(
  language: string,
  receiverText: string,
  methodName: string,
  firstArg?: string,
): ChannelRecord | null {
  const candidates = CHANNEL_RULES.filter((r) => r.language === language && r.methodName === methodName);

  for (const rule of candidates) {
    if (rule.receiverPattern) {
      const tail = receiverText.includes(".") ? receiverText.slice(receiverText.lastIndexOf(".") + 1) : receiverText;
      if (!rule.receiverPattern.test(tail) && !rule.receiverPattern.test(receiverText)) continue;
    }
    const channelName = firstArg ?? `(${rule.transport})`;
    return { channelName, transport: rule.transport, enclosingFuncQn: "", direction: rule.direction };
  }

  return null;
}

export function getChannelRules(language: string): ChannelRule[] {
  return CHANNEL_RULES.filter((r) => r.language === language);
}

