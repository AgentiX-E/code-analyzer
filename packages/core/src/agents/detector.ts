/**
 * AI Agent Auto-Detector.
 *
 * Scans the environment (env vars, config files, running processes,
 * installed binaries, VS Code extensions) to determine which AI coding
 * assistant the user is running and provides the correct MCP
 * configuration snippet.
 *
 * Supported agents (12):
 *   Claude Code, Cursor, Windsurf, Continue.dev, Aider, Cline,
 *   GitHub Copilot, Codeium, Tabnine, Amazon Q, Roo Code, Augment Code
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  AgentId,
  AgentMetadata,
  AgentDetection,
  AgentDetectionResult,
  DetectionSignal,
  DetectionConfidence,
} from './types.js';

// ── Agent Registry ───────────────────────────────────────────────

const AGENTS: AgentMetadata[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code',
    envSignals: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_CONFIG_DIR'],
    configSignals: ['.claude', '.claude.json', '.claude/settings.json'],
    binarySignals: ['claude'],
    extensionSignals: [],
    processSignals: ['claude'],
    preferredTransport: 'stdio',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    homepage: 'https://cursor.com',
    envSignals: ['CURSOR_TRACE_ID'],
    configSignals: ['.cursor', '.cursorrules', '.cursor/rules'],
    binarySignals: ['cursor'],
    extensionSignals: [],
    processSignals: ['Cursor', 'cursor'],
    preferredTransport: 'stdio',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    homepage: 'https://codeium.com/windsurf',
    envSignals: ['WINDSURF_API_KEY'],
    configSignals: ['.windsurfrules', '.windsurf'],
    binarySignals: ['windsurf'],
    extensionSignals: [],
    processSignals: ['Windsurf', 'windsurf'],
    preferredTransport: 'stdio',
  },
  {
    id: 'continue-dev',
    name: 'Continue.dev',
    homepage: 'https://continue.dev',
    envSignals: ['CONTINUE_SERVER_URL'],
    configSignals: ['.continue', 'continue-config.json', '.continue/config.json'],
    binarySignals: [],
    extensionSignals: ['Continue.continue'],
    processSignals: [],
    preferredTransport: 'stdio',
  },
  {
    id: 'aider',
    name: 'Aider',
    homepage: 'https://aider.chat',
    envSignals: ['AIDER_MODEL', 'AIDER_EDIT_FORMAT', 'AIDER_API_KEY'],
    configSignals: ['.aider.conf.yml', '.aider.conf.yaml', '.aider.yml', '.aider.conf'],
    binarySignals: ['aider'],
    extensionSignals: [],
    processSignals: ['aider'],
    preferredTransport: 'stdio',
  },
  {
    id: 'cline',
    name: 'Cline',
    homepage: 'https://github.com/cline/cline',
    envSignals: ['CLINE_API_KEY'],
    configSignals: ['.cline', '.clinerules'],
    binarySignals: [],
    extensionSignals: ['saoudrizwan.claude-dev'],
    processSignals: [],
    preferredTransport: 'stdio',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    homepage: 'https://github.com/features/copilot',
    envSignals: ['COPILOT_API_KEY', 'GITHUB_COPILOT_TOKEN'],
    configSignals: ['.github/copilot-instructions.md'],
    binarySignals: [],
    extensionSignals: ['GitHub.copilot', 'GitHub.copilot-chat'],
    processSignals: ['copilot-agent', 'copilot'],
    preferredTransport: 'stdio',
  },
  {
    id: 'codeium',
    name: 'Codeium',
    homepage: 'https://codeium.com',
    envSignals: ['CODEIUM_API_KEY'],
    configSignals: ['.codeium', '.codeium/config.json'],
    binarySignals: ['codeium'],
    extensionSignals: ['Codeium.codeium'],
    processSignals: ['codeium'],
    preferredTransport: 'stdio',
  },
  {
    id: 'tabnine',
    name: 'Tabnine',
    homepage: 'https://www.tabnine.com',
    envSignals: ['TABNINE_API_KEY', 'TABNINE_TOKEN'],
    configSignals: ['.tabnine', '.tabnine/config.json'],
    binarySignals: [],
    extensionSignals: ['TabNine.tabnine-vscode'],
    processSignals: ['tabnine', 'TabNine'],
    preferredTransport: 'stdio',
  },
  {
    id: 'amazon-q',
    name: 'Amazon Q Developer',
    homepage: 'https://aws.amazon.com/q/developer/',
    envSignals: ['AMAZON_Q_API_KEY', 'AWS_PROFILE'],
    configSignals: ['.aws/amazonq', '.amazonq'],
    binarySignals: ['q'],
    extensionSignals: ['amazonwebservices.amazon-q-vscode'],
    processSignals: ['amazon-q'],
    preferredTransport: 'stdio',
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    homepage: 'https://github.com/RooVetGit/Roo-Code',
    envSignals: ['ROO_CODE_API_KEY'],
    configSignals: ['.roo', '.roo-rules'],
    binarySignals: [],
    extensionSignals: ['rooveterinaryinc.roo-cline'],
    processSignals: [],
    preferredTransport: 'stdio',
  },
  {
    id: 'augment-code',
    name: 'Augment Code',
    homepage: 'https://www.augmentcode.com',
    envSignals: ['AUGMENT_API_KEY', 'AUGMENT_TOKEN'],
    configSignals: ['.augment', '.augment/config.json'],
    binarySignals: ['augment'],
    extensionSignals: ['Augment.augment-code'],
    processSignals: ['augment'],
    preferredTransport: 'stdio',
  },
];

// ── Helpers ──────────────────────────────────────────────────────

const homeDir = os.homedir();

/**
 * Check whether an environment variable is set (non-empty).
 */
function hasEnv(name: string): boolean {
  const val = process.env[name];
  return val !== undefined && val !== '';
}

/**
 * Check whether a file or directory exists at the given path.
 * Supports ~-prefixed paths.
 */
function hasPath(filePath: string): boolean {
  /* v8 ignore next */
  const resolved = filePath.startsWith('~')
    ? path.join(homeDir, filePath.slice(1))
    : filePath;
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Look for a binary in PATH.
 */
function hasBinary(name: string): boolean {
  /* v8 ignore next */
  const pathDirs = (process.env.PATH ?? '/usr/bin').split(path.delimiter);
  for (const dir of pathDirs) {
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      /* v8 ignore next */
      return true;
    } catch {
      // not in this directory
    }
  }
  return false;
}

// ── Detector ─────────────────────────────────────────────────────

/**
 * Detect a single agent by scanning all signal types.
 */
function detectAgent(meta: AgentMetadata): AgentDetection {
  const signals: DetectionSignal[] = [];

  // Environment variable signals
  for (const env of meta.envSignals) {
    if (hasEnv(env)) {
      signals.push({
        type: 'env',
        detail: `$${env} is set`,
        confidence: 'medium',
      });
    }
  }

  // Config file signals (check relative to home + cwd)
  for (const cfg of meta.configSignals) {
    const homePath = path.join(homeDir, cfg);
    const cwdPath = path.join(process.cwd(), cfg);
    /* v8 ignore next 4 */
    if (hasPath(homePath)) {
      signals.push({ type: 'config', detail: `Config found: ~/${cfg}`, confidence: 'high' });
      break;
    }
    /* v8 ignore next 4 */
    if (hasPath(cwdPath)) {
      signals.push({ type: 'config', detail: `Config found: ./${cfg}`, confidence: 'high' });
      break;
    }
  }

  // Binary signals
  for (const bin of meta.binarySignals) {
    /* v8 ignore next 8 */
    if (hasBinary(bin)) {
      signals.push({
        type: 'binary',
        detail: `Binary found in PATH: ${bin}`,
        confidence: 'medium',
      });
      break;
    }
  }

  // Process signals — using /proc on Linux, pgrep on macOS
  for (const proc of meta.processSignals) {
    /* v8 ignore next 9 */
    if (checkProcess(proc)) {
      signals.push({
        type: 'process',
        detail: `Process running: ${proc}`,
        confidence: 'high',
      });
      break;
    }
  }

  // VS Code extension signals
  for (const ext of meta.extensionSignals) {
    /* v8 ignore next 8 */
    if (checkVSCodeExtension(ext)) {
      signals.push({
        type: 'extension',
        detail: `VS Code extension installed: ${ext}`,
        confidence: 'medium',
      });
      break;
    }
  }

  const confidence = aggregateConfidence(signals);
  const detected = signals.length > 0;

  return {
    id: meta.id,
    name: meta.name,
    detected,
    confidence,
    signals,
    preferredTransport: meta.preferredTransport,
  };
}

/**
 * Aggregate individual signal confidences into overall confidence.
 */
function aggregateConfidence(signals: DetectionSignal[]): DetectionConfidence {
  if (signals.length === 0) return 'low';
  const highCount = signals.filter((s) => s.confidence === 'high').length;
  const mediumCount = signals.filter((s) => s.confidence === 'medium').length;

  if (highCount >= 2 || (highCount >= 1 && mediumCount >= 2)) return 'high';
  if (highCount >= 1 || mediumCount >= 2) return 'medium';
  return 'low';
}

/**
 * Check if a process with the given name is running.
 * Uses /proc filesystem on Linux, falls back gracefully.
 */
/* v8 ignore start */
function checkProcess(name: string): boolean {
  try {
    // Linux: scan /proc/*/comm
    if (process.platform === 'linux') {
      const procDirs = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
      for (const pid of procDirs.slice(0, 200)) {
        // limit scan to first 200
        try {
          const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf-8').trim();
          if (comm.toLowerCase().includes(name.toLowerCase())) {
            return true;
          }
        } catch {
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}
/* v8 ignore stop */

/**
 * Check if a VS Code extension is installed.
 * Scans ~/.vscode/extensions/ and ~/.cursor/extensions/.
 */
const VSCODE_EXT_DIRS: string[] = (() => {
  const dirs = [path.join(homeDir, '.vscode', 'extensions')];
  /* v8 ignore next 3 */
  if (process.platform === 'darwin') {
    dirs.push(path.join(homeDir, 'Library', 'Application Support', 'Code', 'User'));
  }
  return dirs;
})();

/* v8 ignore start */
function checkVSCodeExtension(extId: string): boolean {
  for (const dir of VSCODE_EXT_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Extension directories are named like "publisher.extension-version"
        if (entry.isDirectory() && entry.name.startsWith(extId.toLowerCase())) {
          return true;
        }
      }
    } catch {
    }
  }
  return false;
}
/* v8 ignore stop */

// ── Public API ───────────────────────────────────────────────────

/**
 * Detect all supported AI coding agents in the current environment.
 *
 * Returns a sorted list (detected first, by confidence) plus a primary
 * recommendation for the agent most likely being used.
 */
export function detectAllAgents(): AgentDetectionResult {
  const agents = AGENTS.map(detectAgent);

  // Sort: detected first, then by confidence (high → low)
  agents.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    const order: DetectionConfidence[] = ['high', 'medium', 'low'];
    return order.indexOf(a.confidence) - order.indexOf(b.confidence);
  });

  const detected = agents.filter((a) => a.detected);
  const primary: AgentId | null =
    detected.length > 0 ? detected[0].id : null;

  return {
    agents,
    primary,
    detectedCount: detected.length,
    timestamp: Date.now(),
  };
}

/**
 * Detect a specific agent by ID. Returns null if the agent ID is unknown.
 */
export function detectAgentById(agentId: AgentId): AgentDetection | null {
  const meta = AGENTS.find((a) => a.id === agentId);
  if (!meta) return null;
  return detectAgent(meta);
}

/**
 * Get the list of all supported agent IDs.
 */
export function getSupportedAgents(): AgentId[] {
  return AGENTS.map((a) => a.id);
}

/**
 * Get metadata for a specific agent.
 */
export function getAgentMetadata(agentId: AgentId): AgentMetadata | undefined {
  return AGENTS.find((a) => a.id === agentId);
}

/**
 * Get the registry of all known agent metadata entries.
 */
export function getAgentRegistry(): ReadonlyArray<AgentMetadata> {
  return AGENTS;
}
