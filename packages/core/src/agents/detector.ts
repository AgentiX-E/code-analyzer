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
//
// The signal helpers below are exported so they can be exercised directly in
// unit tests. The platform- and filesystem-sensitive ones accept injectable
// defaults (home directory, PATH, platform, /proc root, extension dirs) so the
// environment-specific branches are testable without real OS state.

const homeDir = os.homedir();

/**
 * Check whether an environment variable is set (non-empty).
 */
export function hasEnv(name: string): boolean {
  const val = process.env[name];
  return val !== undefined && val !== '';
}

/**
 * Check whether a file or directory exists at the given path.
 * Supports ~-prefixed paths resolved against `home`.
 */
export function hasPath(filePath: string, home: string = homeDir): boolean {
  const resolved = filePath.startsWith('~') ? path.join(home, filePath.slice(1)) : filePath;
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Look for a binary in the colon-delimited `pathEnv`.
 */
export function hasBinary(
  name: string,
  pathEnv: string = process.env['PATH'] ?? '/usr/bin',
): boolean {
  const pathDirs = pathEnv.split(path.delimiter);
  for (const dir of pathDirs) {
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return true;
    } catch {
      // not in this directory
    }
  }
  return false;
}

/**
 * Aggregate individual signal confidences into overall confidence.
 */
export function aggregateConfidence(signals: DetectionSignal[]): DetectionConfidence {
  if (signals.length === 0) return 'low';
  const highCount = signals.filter((s) => s.confidence === 'high').length;
  const mediumCount = signals.filter((s) => s.confidence === 'medium').length;

  if (highCount >= 2 || (highCount >= 1 && mediumCount >= 2)) return 'high';
  if (highCount >= 1 || mediumCount >= 2) return 'medium';
  return 'low';
}

/**
 * Check if a process with the given name is running.
 * Scans the Linux /proc filesystem (injectable `procRoot` for tests);
 * returns false on other platforms or when /proc is unavailable.
 */
export function checkProcess(
  name: string,
  platform: NodeJS.Platform = process.platform,
  procRoot: string = '/proc',
): boolean {
  try {
    // Linux: scan /proc/*/comm
    if (platform === 'linux') {
      const procDirs = fs.readdirSync(procRoot).filter((d) => /^\d+$/.test(d));
      for (const pid of procDirs.slice(0, 200)) {
        // limit scan to first 200
        try {
          const comm = fs.readFileSync(path.join(procRoot, pid, 'comm'), 'utf-8').trim();
          if (comm.toLowerCase().includes(name.toLowerCase())) {
            return true;
          }
        } catch {}
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve the VS Code extension directories to scan for `platform`.
 * macOS additionally includes the Code app's user directory.
 */
export function getVSCodeExtDirs(platform: NodeJS.Platform = process.platform): string[] {
  const dirs = [path.join(homeDir, '.vscode', 'extensions')];
  if (platform === 'darwin') {
    dirs.push(path.join(homeDir, 'Library', 'Application Support', 'Code', 'User'));
  }
  return dirs;
}

const VSCODE_EXT_DIRS: string[] = getVSCodeExtDirs();

/**
 * Check if a VS Code extension is installed by scanning the given
 * extension directories for a matching `publisher.extension-version` dir.
 */
export function checkVSCodeExtension(extId: string, dirs: string[] = VSCODE_EXT_DIRS): boolean {
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Extension directories are named like "publisher.extension-version"
        if (entry.isDirectory() && entry.name.toLowerCase().startsWith(extId.toLowerCase())) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}

// ── Detector ─────────────────────────────────────────────────────

/**
 * Injectable environment overrides for `detectAgent`, mirroring the
 * module-level defaults consumed by the signal helpers.
 */
export interface DetectorEnv {
  /** Home directory used for the home config-signal check. */
  home?: string;
  /** Working directory used for the cwd config-signal check. */
  cwd?: string;
  /** Colon-delimited PATH used for the binary-signal check. */
  pathEnv?: string;
  /** Process platform used for /proc process detection. */
  platform?: NodeJS.Platform;
  /** Root of the proc filesystem (Linux process detection). */
  procRoot?: string;
  /** VS Code extension directories to scan. */
  extDirs?: string[];
}

/**
 * Detect a single agent by scanning all signal types.
 */
export function detectAgent(meta: AgentMetadata, env: DetectorEnv = {}): AgentDetection {
  const signals: DetectionSignal[] = [];
  const home = env.home ?? homeDir;
  const cwd = env.cwd ?? process.cwd();

  // Environment variable signals
  for (const envVar of meta.envSignals) {
    if (hasEnv(envVar)) {
      signals.push({
        type: 'env',
        detail: `$${envVar} is set`,
        confidence: 'medium',
      });
    }
  }

  // Config file signals (check relative to home + cwd)
  for (const cfg of meta.configSignals) {
    const homePath = path.join(home, cfg);
    const cwdPath = path.join(cwd, cfg);
    if (hasPath(homePath)) {
      signals.push({ type: 'config', detail: `Config found: ~/${cfg}`, confidence: 'high' });
      break;
    }
    if (hasPath(cwdPath)) {
      signals.push({ type: 'config', detail: `Config found: ./${cfg}`, confidence: 'high' });
      break;
    }
  }

  // Binary signals
  for (const bin of meta.binarySignals) {
    if (hasBinary(bin, env.pathEnv)) {
      signals.push({
        type: 'binary',
        detail: `Binary found in PATH: ${bin}`,
        confidence: 'medium',
      });
      break;
    }
  }

  // Process signals — using /proc on Linux
  for (const proc of meta.processSignals) {
    if (checkProcess(proc, env.platform, env.procRoot)) {
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
    if (checkVSCodeExtension(ext, env.extDirs)) {
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

// ── Public API ───────────────────────────────────────────────────

/**
 * Detect all supported AI coding agents in the current environment.
 *
 * Returns a sorted list (detected first, by confidence) plus a primary
 * recommendation for the agent most likely being used.
 */
export function detectAllAgents(env: DetectorEnv = {}): AgentDetectionResult {
  const agents = AGENTS.map((meta) => detectAgent(meta, env));

  // Sort: detected first, then by confidence (high → low)
  agents.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    const order: DetectionConfidence[] = ['high', 'medium', 'low'];
    return order.indexOf(a.confidence) - order.indexOf(b.confidence);
  });

  const detected = agents.filter((a) => a.detected);
  const primary: AgentId | null = detected[0]?.id ?? null;

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
