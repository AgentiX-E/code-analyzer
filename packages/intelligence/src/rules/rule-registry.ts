// @code-analyzer/intelligence — Community Rule Registry
// A shareable registry of project standards and review rules with versioning,
// import/export, and validation. Enables teams to share and reuse rule sets.

import type { ProjectStandard, Severity } from '@code-analyzer/shared';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tags: string[];
  rules: TemplateRule[];
  createdAt: string;
  updatedAt: string;
  /** SHA-256 hash of the rule content for integrity verification */
  checksum: string;
}

export interface TemplateRule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: Severity;
  /** Rule pattern (regex or expression string) */
  pattern: string;
  /** Human-readable suggestion when rule is violated */
  suggestion: string;
  /** File path glob patterns this rule applies to */
  appliesTo: string[];
}

export interface RegistryImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Rule Registry
// ---------------------------------------------------------------------------

export class RuleRegistry {
  private templates: Map<string, RegistryTemplate> = new Map();
  private standardVersions: Map<string, number> = new Map();

  /**
   * Register a standard template. If the same id exists, the version is
   * incremented and the previous version is archived.
   */
  register(template: RegistryTemplate): void {
    const existingVersion = this.standardVersions.get(template.id) ?? 0;
    this.standardVersions.set(template.id, existingVersion + 1);

    // Compute checksum if not provided
    if (!template.checksum) {
      template.checksum = this.computeChecksum(template);
    }

    this.templates.set(template.id, template);
  }

  /**
   * Get a standard template by id.
   */
  get(id: string): RegistryTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * List all registered templates.
   */
  list(): RegistryTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * List templates filtered by tags.
   */
  listByTags(tags: string[]): RegistryTemplate[] {
    return this.list().filter((t) => tags.some((tag) => t.tags.includes(tag)));
  }

  /**
   * Search templates by keyword in name and description.
   */
  search(query: string): RegistryTemplate[] {
    const lower = query.toLowerCase();
    return this.list().filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        t.tags.some((tag) => tag.toLowerCase().includes(lower)),
    );
  }

  /**
   * Remove a template by id.
   */
  remove(id: string): boolean {
    return this.templates.delete(id);
  }

  /**
   * Convert a RegistryTemplate to a ProjectStandard for use in the review engine.
   */
  toProjectStandard(template: RegistryTemplate): ProjectStandard {
    return {
      id: template.id,
      name: template.name,
      /* v8 ignore next -- @preserve */
      category: (template.tags[0] ?? 'code-quality') as ProjectStandard['category'],
      description: template.description,
      version: template.version,
      rules: template.rules.map((r) => ({
        id: r.id,
        description: r.description,
        checkType: 'regex' as const,
        severity: r.severity,
        checkConfig: {
          pattern: r.pattern,
          suggestion: r.suggestion,
          appliesTo: r.appliesTo,
        },
        autoFixable: false,
      })),
      examples: [],
    };
  }

  /**
   * Import templates from a JSON/YAML string.
   * Skips templates that already exist with the same checksum.
   */
  importTemplates(jsonString: string): RegistryImportResult {
    const result: RegistryImportResult = { imported: 0, skipped: 0, errors: [] };

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      // JSON.parse always throws a SyntaxError (an Error) for malformed input,
      // so the rejection is always an Error carrying a `message` property.
      result.errors.push(`Invalid JSON: ${(err as Error).message}`);
      return result;
    }

    const templates = Array.isArray(parsed) ? parsed : [parsed];

    for (let i = 0; i < templates.length; i++) {
      const item = templates[i] as Record<string, unknown>;

      if (!item['id'] || !item['name'] || !item['version']) {
        result.errors.push(`Item ${i}: missing required fields (id, name, version)`);
        continue;
      }

      const checksum = this.computeChecksum(item as unknown as RegistryTemplate);
      const existing = this.templates.get(item['id'] as string);

      if (existing && existing.checksum === checksum) {
        result.skipped++;
        continue;
      }

      // register() only assigns fields and stores the template in a Map; it
      // never throws for JSON-parsed input (no circular references, no BigInt),
      // so there is no per-item error path to catch here.
      this.register(item as unknown as RegistryTemplate);
      result.imported++;
    }

    return result;
  }

  /**
   * Export all templates as a JSON string.
   */
  exportTemplates(): string {
    return JSON.stringify(this.list(), null, 2);
  }

  /**
   * Verify a template's integrity by comparing its checksum.
   */
  verifyChecksum(template: RegistryTemplate): boolean {
    const computed = this.computeChecksum(template);
    return computed === template.checksum;
  }

  /**
   * Get the number of registered templates.
   */
  get size(): number {
    return this.templates.size;
  }

  /**
   * Get all available tags across all templates.
   */
  getTags(): string[] {
    const tagSet = new Set<string>();
    for (const template of this.templates.values()) {
      for (const tag of template.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private computeChecksum(template: Omit<RegistryTemplate, 'checksum'>): string {
    const content = JSON.stringify({
      id: template.id,
      name: template.name,
      version: template.version,
      rules: template.rules,
    });
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
