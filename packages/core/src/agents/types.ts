/**
 * AI Agent auto-detection types.
 *
 * detects which AI coding assistant the user is running and provides
 * the correct MCP configuration snippet for seamless integration.
 */

/**
 * Known AI coding agent identifiers.
 */
export type AgentId =
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'continue-dev'
  | 'aider'
  | 'cline'
  | 'github-copilot'
  | 'codeium'
  | 'tabnine'
  | 'amazon-q'
  | 'roo-code'
  | 'augment-code';

/**
 * Detection confidence level.
 */
export type DetectionConfidence = 'high' | 'medium' | 'low';

/**
 * A single detection signal — one piece of evidence.
 */
export interface DetectionSignal {
  /** Type of signal: env var, config file, process, extension, or binary path. */
  type: 'env' | 'config' | 'process' | 'extension' | 'binary';
  /** Human-readable description of the signal. */
  detail: string;
  /** Confidence contribution of this signal. */
  confidence: DetectionConfidence;
}

/**
 * Result of detecting a single agent.
 */
export interface AgentDetection {
  /** Agent identifier. */
  id: AgentId;
  /** Human-readable agent name. */
  name: string;
  /** Whether the agent is detected. */
  detected: boolean;
  /** Overall confidence. */
  confidence: DetectionConfidence;
  /** Individual detection signals that contributed. */
  signals: DetectionSignal[];
  /** MCP transport method this agent prefers. */
  preferredTransport: 'stdio' | 'sse' | 'both';
}

/**
 * Summary of all agent detections.
 */
export interface AgentDetectionResult {
  /** List of all agent detection results (detected + not detected). */
  agents: AgentDetection[];
  /** Primary detected agent (highest confidence, first match). */
  primary: AgentId | null;
  /** Number of agents detected. */
  detectedCount: number;
  /** Timestamp of detection. */
  timestamp: number;
}

/**
 * MCP configuration template for a specific agent.
 */
export interface McpConfigTemplate {
  /** Agent this template is for. */
  agentId: AgentId;
  /** Transport method. */
  transport: 'stdio' | 'sse';
  /** The config snippet (JSON or YAML depending on agent). */
  config: string;
  /** File path where the config should be placed. */
  configPath: string;
  /** Instructions for the user. */
  instructions: string;
}

/**
 * Agent metadata registry entry.
 */
export interface AgentMetadata {
  id: AgentId;
  name: string;
  homepage: string;
  /** Environment variables that indicate this agent is active. */
  envSignals: string[];
  /** Config file/directory paths that indicate this agent. */
  configSignals: string[];
  /** CLI binary names to check. */
  binarySignals: string[];
  /** VS Code extension IDs. */
  extensionSignals: string[];
  /** Process names to look for. */
  processSignals: string[];
  /** Preferred MCP transport. */
  preferredTransport: 'stdio' | 'sse' | 'both';
}
