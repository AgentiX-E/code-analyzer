// @code-analyzer/core — Secret Scanner
// Detects hardcoded secrets in source code using regex patterns and
// Shannon entropy analysis. Designed for pre-commit hooks and PR review.
//
// Supports 16+ pattern categories:
//   - Cloud credentials (AWS, GCP, Azure)
//   - API keys (GitHub, GitLab, Stripe, Slack, etc.)
//   - Private keys (SSH, PGP, JWT)
//   - Connection strings (database URLs, etc.)
//   - Generic high-entropy strings (base64, hex)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity of a detected secret. */
export type SecretSeverity = 'critical' | 'high' | 'medium' | 'low';

/** A single detected secret. */
export interface SecretFinding {
  /** The matched text (truncated for display). */
  readonly match: string;
  /** The secret category. */
  readonly category: string;
  /** The regex pattern that matched. */
  readonly patternName: string;
  /** Severity level. */
  readonly severity: SecretSeverity;
  /** Line number (1-based, if available). */
  readonly line?: number;
  /** Start column (1-based, if available). */
  readonly column?: number;
  /** Whether the secret was detected via entropy analysis. */
  readonly entropyBased: boolean;
  /** Shannon entropy of the matched string (if computed). */
  readonly entropy?: number;
}

/** Secret scanner configuration. */
export interface SecretScannerConfig {
  /** Whether to enable entropy-based detection. */
  entropyDetection: boolean;
  /** Minimum entropy threshold for high-entropy detection (default: 4.5). */
  entropyThreshold: number;
  /** Minimum length for entropy analysis (default: 20). */
  entropyMinLength: number;
  /** Patterns to exclude (e.g., test patterns). */
  excludePatterns: readonly RegExp[];
}

const DEFAULT_CONFIG: SecretScannerConfig = {
  entropyDetection: true,
  entropyThreshold: 4.5,
  entropyMinLength: 20,
  excludePatterns: [
    /EXAMPLE_KEY/i,
    /test[-_]secret/i,
    /placeholder/i,
    /REPLACE_ME/i,
    /your[-_]?(api[-_]?)?key/i,
    /<YOUR_.*?>/,
  ],
};

// ---------------------------------------------------------------------------
// Patterns (16 categories)
// ---------------------------------------------------------------------------

interface SecretPattern {
  name: string;
  category: string;
  severity: SecretSeverity;
  regex: RegExp;
}

const PATTERNS: readonly SecretPattern[] = [
  // AWS
  {
    name: 'aws-access-key',
    category: 'aws',
    severity: 'critical',
    regex: /(?:A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}/g,
  },
  {
    name: 'aws-secret-key',
    category: 'aws',
    severity: 'critical',
    regex: /(?:aws)(?:.{0,20})?['"]([0-9a-zA-Z/+]{40})['"]/g,
  },
  // GCP
  {
    name: 'gcp-service-account',
    category: 'gcp',
    severity: 'critical',
    regex: /"type":\s*"service_account"/g,
  },
  {
    name: 'gcp-api-key',
    category: 'gcp',
    severity: 'high',
    regex: /AIza[0-9A-Za-z\-_]{35}/g,
  },
  // GitHub
  {
    name: 'github-token',
    category: 'github',
    severity: 'critical',
    regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}/g,
  },
  {
    name: 'github-pat',
    category: 'github',
    severity: 'critical',
    regex: /github_pat_[A-Za-z0-9_]{22,}/g,
  },
  // GitLab
  {
    name: 'gitlab-token',
    category: 'gitlab',
    severity: 'high',
    regex: /glpat-[A-Za-z0-9\-_]{20,}/g,
  },
  // Generic API keys
  {
    name: 'generic-api-key',
    category: 'api-key',
    severity: 'high',
    regex: /(?:api[_-]?key|apikey|API[_-]?KEY)\s*[:=]\s*['"]([A-Za-z0-9_\-.]{20,})['"]/g,
  },
  // JWT
  {
    name: 'jwt-token',
    category: 'jwt',
    severity: 'high',
    regex: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
  },
  // SSH private key
  {
    name: 'ssh-private-key',
    category: 'ssh',
    severity: 'critical',
    regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g,
  },
  // PGP private key
  {
    name: 'pgp-private-key',
    category: 'pgp',
    severity: 'critical',
    regex: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
  },
  // Password in config
  {
    name: 'password-assignment',
    category: 'password',
    severity: 'high',
    regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]([^'"]{3,})['"]/gi,
  },
  // Database connection string
  {
    name: 'db-connection-string',
    category: 'database',
    severity: 'high',
    regex: /(?:mongodb|postgres|mysql|redis|sqlite):\/\/[^:\s]+:[^@\s]+@/gi,
  },
  // Stripe
  {
    name: 'stripe-key',
    category: 'stripe',
    severity: 'high',
    regex: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/g,
  },
  // Slack
  {
    name: 'slack-token',
    category: 'slack',
    severity: 'medium',
    regex: /xox[abops]-(?:[0-9]+-){2,}[A-Za-z0-9]+/g,
  },
  // OpenAI
  {
    name: 'openai-key',
    category: 'openai',
    severity: 'high',
    regex: /sk-(?:proj-)?[A-Za-z0-9]{32,}/g,
  },
];

// ---------------------------------------------------------------------------
// Secret Scanner
// ---------------------------------------------------------------------------

export class SecretScanner {
  private config: SecretScannerConfig;

  constructor(config?: Partial<SecretScannerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.excludePatterns) {
      this.config.excludePatterns = [
        ...DEFAULT_CONFIG.excludePatterns,
        ...config.excludePatterns,
      ];
    }
  }

  /**
   * Scan a single line of text for secrets.
   * @param line — Line content
   * @param lineNumber — Line number (1-based)
   * @returns Array of detected secrets
   */
  scanLine(line: string, lineNumber?: number): SecretFinding[] {
    const findings: SecretFinding[] = [];

    for (const pattern of PATTERNS) {
      // Reset regex state
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(line)) !== null) {
        const fullMatch = match[0];
        if (fullMatch && !this.isExcluded(fullMatch) && !this.isLineExcluded(line, match.index)) {
          findings.push({
            match: this.truncateMatch(fullMatch),
            category: pattern.category,
            patternName: pattern.name,
            severity: pattern.severity,
            line: lineNumber,
            column: match.index + 1,
            entropyBased: false,
          });
        }
      }
    }

    return findings;
  }

  /**
   * Scan multi-line content for secrets.
   * @param content — Full content string
   * @returns All detected secrets across all lines
   */
  scan(content: string): SecretFinding[] {
    const lines = content.split('\n');
    const findings: SecretFinding[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lineFindings = this.scanLine(lines[i]!, i + 1);
      findings.push(...lineFindings);
    }

    // Entropy-based detection on the whole content
    if (this.config.entropyDetection) {
      const entropyFindings = this.scanEntropy(content);
      findings.push(...entropyFindings);
    }

    return findings;
  }

  /**
   * Scan a file at the given path for secrets.
   * (Synchronous version — use scan() with fs.readFileSync for async)
   */
  scanContent(content: string, filePath: string): SecretFinding[] {
    return this.scan(content);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private isExcluded(match: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      if (pattern.test(match)) return true;
    }
    return false;
  }

  /** Check if the surrounding line context indicates a false positive. */
  private isLineExcluded(line: string, matchIndex: number): boolean {
    // Check a window around the match for exclusion keywords
    const contextStart = Math.max(0, matchIndex - 30);
    const contextEnd = Math.min(line.length, matchIndex + 60);
    const context = line.slice(contextStart, contextEnd).toLowerCase();

    const exclusionKeywords = [
      'example', 'placeholder', 'replace_me', '<your_', 'test_secret',
      'your-key', 'your_api', 'your_password',
    ];

    for (const keyword of exclusionKeywords) {
      if (context.includes(keyword)) return true;
    }

    return false;
  }

  private truncateMatch(match: string): string {
    if (match.length <= 40) return match;
    return match.slice(0, 17) + '...' + match.slice(-17);
  }

  /**
   * Detect high-entropy strings (potential secrets that don't match
   * known patterns). Splits on whitespace and quotes, computes Shannon
   * entropy for each token above minLength.
   */
  private scanEntropy(content: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const tokens = content.split(/[\s"'`;:={}(),\[\]]+/);

    let lineOffset = 1;
    let colOffset = 1;

    for (const token of tokens) {
      if (token.length < this.config.entropyMinLength) {
        colOffset += token.length + 1;
        continue;
      }

      // Only skip short common-naming tokens; long alphanumeric tokens may be secrets
      if (/^[a-zA-Z_][a-zA-Z0-9_]{0,20}$/.test(token)) {
        colOffset += token.length + 1;
        continue;
      }

      const entropy = this.computeShannonEntropy(token);
      if (entropy >= this.config.entropyThreshold && !this.isExcluded(token)) {
        findings.push({
          match: this.truncateMatch(token),
          category: 'high-entropy',
          patternName: 'entropy-detection',
          severity: entropy > 5.5 ? 'high' : 'medium',
          line: lineOffset,
          column: colOffset,
          entropyBased: true,
          entropy,
        });
      }

      colOffset += token.length + 1;
    }

    return findings;
  }

  /**
   * Compute Shannon entropy of a string.
   * H = -Σ p(x) * log₂(p(x))
   *
   * Maximum entropy for 64 character set: log₂(64) = 6.0
   * Baseline for typical code tokens: ~3.5-4.0
   * Secrets tend to have entropy > 4.5
   */
  private computeShannonEntropy(str: string): number {
    if (str.length === 0) return 0;

    const freq = new Map<string, number>();
    for (const char of str) {
      freq.set(char, (freq.get(char) ?? 0) + 1);
    }

    let entropy = 0;
    const len = str.length;
    for (const count of freq.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }
}
