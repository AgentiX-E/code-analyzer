// @code-analyzer/core — Secret Scanner
// Detects secrets in source code using pattern matching and entropy analysis.
// NEVER logs actual secret values — all matches are redacted.

export interface SecretScanResult {
  filePath: string;
  line: number;
  type: 'password' | 'api_key' | 'token' | 'private_key' | 'certificate' | 'connection_string';
  match: string;
  severity: 'critical' | 'high';
  confidence: number;
}

// ---------------------------------------------------------------------------
// Built-in Patterns — separated by scan mode
// ---------------------------------------------------------------------------

interface SecretPattern {
  regex: RegExp;
  type: SecretScanResult['type'];
  severity: 'critical' | 'high';
  multiline: boolean;
}

const BUILT_IN_PATTERNS: SecretPattern[] = [
  // AWS Access Key IDs — single line
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, type: 'api_key', severity: 'high', multiline: false },
  // GitHub Personal Access Tokens (classic)
  { regex: /\bghp_[0-9a-zA-Z]{36}\b/g, type: 'token', severity: 'critical', multiline: false },
  // GitHub PAT (fine-grained)
  { regex: /\bgithub_pat_[0-9a-zA-Z_]{40,}\b/g, type: 'token', severity: 'critical', multiline: false },
  // JWT tokens
  { regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, type: 'token', severity: 'high', multiline: false },
  // Private keys (PEM) — multiline
  { regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, type: 'private_key', severity: 'critical', multiline: true },
  // Certificate (PEM) — multiline
  { regex: /-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----/g, type: 'certificate', severity: 'critical', multiline: true },
  // MongoDB connection strings
  { regex: /\bmongodb(?:\+srv)?:\/\/[^\s'"]+/gi, type: 'connection_string', severity: 'critical', multiline: false },
  // PostgreSQL connection strings
  { regex: /\bpostgres(?:ql)?:\/\/[^\s'"]+/gi, type: 'connection_string', severity: 'critical', multiline: false },
  // MySQL connection strings
  { regex: /\bmysql:\/\/[^\s'"]+/gi, type: 'connection_string', severity: 'critical', multiline: false },
  // Redis connection strings
  { regex: /\bredis:\/\/[^\s'"]+/gi, type: 'connection_string', severity: 'high', multiline: false },
  // Generic password assignments
  { regex: /password\s*[:=]\s*['"]([^'"]+)['"]/gi, type: 'password', severity: 'critical', multiline: false },
  // API key assignments
  { regex: /api[_-]?key\s*[:=]\s*['"]([A-Za-z0-9]{20,})['"]/gi, type: 'api_key', severity: 'high', multiline: false },
  // Generic token assignments
  { regex: /token\s*[:=]\s*['"]([A-Za-z0-9_-]{24,})['"]/gi, type: 'token', severity: 'high', multiline: false },
  // Secret key assignments
  { regex: /secret[_-]?key\s*[:=]\s*['"]([^'"]{8,})['"]/gi, type: 'api_key', severity: 'critical', multiline: false },
  // Generic credentials in URLs
  { regex: /:\/\/[^:@\s]+:[^:@\s]+@[^\s'"]+/g, type: 'connection_string', severity: 'critical', multiline: false },
];

export class SecretScanner {
  private linePatterns: SecretPattern[];
  private multilinePatterns: SecretPattern[];
  private entropyThreshold: number;

  constructor(options?: { entropyThreshold?: number; customPatterns?: RegExp[] }) {
    this.entropyThreshold = options?.entropyThreshold ?? 3.5;

    const patterns: SecretPattern[] = [...BUILT_IN_PATTERNS];
    if (options?.customPatterns) {
      for (const pattern of options.customPatterns) {
        patterns.push({ regex: pattern, type: 'api_key', severity: 'high', multiline: false });
      }
    }

    this.linePatterns = patterns.filter((p) => !p.multiline);
    this.multilinePatterns = patterns.filter((p) => p.multiline);
  }

  /** Scan a single file for secrets. */
  scanFile(filePath: string, content: string): SecretScanResult[] {
    const results: SecretScanResult[] = [];
    const lines = content.split('\n');

    // Scan single-line patterns per line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      for (const pattern of this.linePatterns) {
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.regex.exec(line)) !== null) {
          results.push({
            filePath,
            line: i + 1,
            type: pattern.type,
            match: SecretScanner.redact(match[0]),
            severity: pattern.severity,
            confidence: 0.9,
          });
        }
      }
    }

    // Scan multiline patterns against full content
    for (const pattern of this.multilinePatterns) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(content)) !== null) {
        // Determine line number from the match position
        const precedingContent = content.substring(0, match.index);
        const lineNumber = (precedingContent.match(/\n/g) || []).length + 1;

        results.push({
          filePath,
          line: lineNumber,
          type: pattern.type,
          match: SecretScanner.redact(match[0]),
          severity: pattern.severity,
          confidence: 0.9,
        });
      }
    }

    return results;
  }

  /** Scan arbitrary text content for secrets. */
  scanText(content: string): SecretScanResult[] {
    return this.scanFile('<inline>', content);
  }

  /** Check if text looks like a secret using Shannon entropy. */
  isLikelySecret(text: string): boolean {
    if (text.length < 8) return false;

    const entropy = this.calculateEntropy(text);
    return entropy >= this.entropyThreshold;
  }

  /** Redact a secret value for safe logging. Never reveals actual secret content. */
  static redact(_value: string): string {
    return '[REDACTED]';
  }

  /** Get the built-in detection patterns (without custom patterns). */
  static getPatterns(): RegExp[] {
    return BUILT_IN_PATTERNS.map((p) => p.regex);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private calculateEntropy(text: string): number {
    if (text.length === 0) return 0;

    const frequencies = new Map<string, number>();
    for (const char of text) {
      frequencies.set(char, (frequencies.get(char) || 0) + 1);
    }

    let entropy = 0;
    for (const count of frequencies.values()) {
      const prob = count / text.length;
      entropy -= prob * Math.log2(prob);
    }

    return entropy;
  }
}
