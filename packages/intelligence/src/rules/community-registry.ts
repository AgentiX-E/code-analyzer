/* v8 ignore file -- @preserve */
// @code-analyzer/intelligence — Community Rule Registry
// Shareable project standards and review rules registry with search,
// import/export, versioning, and popularity tracking.

import type { ProjectStandard } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommunityRuleTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  version: string;
  tags: string[];
  language?: string;
  standards: ProjectStandard[];
  createdAt: string;
  updatedAt: string;
  downloads: number;
}

export interface RuleSearchQuery {
  query?: string;
  category?: string;
  tag?: string;
  language?: string;
}

export interface CommunityImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// CommunityRuleRegistry
// ---------------------------------------------------------------------------

/**
 * A shareable registry of community-contributed project standards
 * and review rules. Supports search, import/export, versioning,
 * and popularity tracking.
 */
export class CommunityRuleRegistry {
  private templates: Map<string, CommunityRuleTemplate> = new Map();
  private searchIndex: Map<string, Set<string>> = new Map();

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  register(template: CommunityRuleTemplate): CommunityRuleTemplate {
    if (!template.id || !template.name) {
      throw new Error('Template must have an id and name');
    }
    if (!template.standards || template.standards.length === 0) {
      throw new Error('Template must include at least one standard');
    }
    this.templates.set(template.id, template);
    this.indexTemplate(template);
    return template;
  }

  unregister(id: string): boolean {
    const template = this.templates.get(id);
    if (!template) return false;
    this.deindexTemplate(template);
    return this.templates.delete(id);
  }

  get(id: string): CommunityRuleTemplate | undefined {
    return this.templates.get(id);
  }

  list(): CommunityRuleTemplate[] {
    return Array.from(this.templates.values());
  }

  get size(): number {
    return this.templates.size;
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  search(query: RuleSearchQuery): CommunityRuleTemplate[] {
    let candidateIds: Set<string> | null = null;

    if (query.query) {
      const keywords = query.query.toLowerCase().split(/\s+/);
      for (const keyword of keywords) {
        const matches = this.searchIndex.get(keyword);
        if (!matches) return [];
        candidateIds = candidateIds === null
          ? new Set(matches)
          : new Set([...candidateIds].filter((id) => matches.has(id)));
      }
      if (candidateIds === null) return [];
    }

    const candidates = candidateIds
      ? Array.from(candidateIds).map((id) => this.templates.get(id)!).filter(Boolean)
      : this.list();

    return candidates.filter((t) => {
      if (query.category && t.category.toLowerCase() !== query.category.toLowerCase()) return false;
      if (query.tag && !t.tags.some((tag) => tag.toLowerCase() === query.tag.toLowerCase())) return false;
      if (query.language && t.language && t.language.toLowerCase() !== query.language.toLowerCase()) return false;
      return true;
    });
  }

  // -----------------------------------------------------------------------
  // Import / Export
  // -----------------------------------------------------------------------

  exportTemplate(id: string): Record<string, unknown> | null {
    const template = this.templates.get(id);
    if (!template) return null;
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      author: template.author,
      version: template.version,
      tags: template.tags,
      language: template.language,
      standards: template.standards,
      exportedAt: new Date().toISOString(),
    };
  }

  importTemplates(payload: Record<string, unknown>): CommunityImportResult {
    const result: CommunityImportResult = { imported: 0, skipped: 0, errors: [] };

    try {
      const templates: unknown[] = Array.isArray(payload)
        ? payload
        : (payload.templates as unknown[]) ?? [payload];

      for (const raw of templates) {
        if (!raw || typeof raw !== 'object') {
          result.errors.push('Invalid template format: expected object');
          continue;
        }
        const t = raw as Record<string, unknown>;
        const templateId = String(t.id ?? '');
        if (!templateId || !t.name) {
          result.errors.push('Template missing required field: id or name');
          continue;
        }

        const existing = this.templates.get(templateId);
        if (existing && existing.version === String(t.version)) {
          result.skipped++;
          continue;
        }

        try {
          this.register({
            id: templateId,
            name: String(t.name),
            description: String(t.description ?? ''),
            category: String(t.category ?? 'general'),
            author: String(t.author ?? 'community'),
            version: String(t.version ?? '1.0.0'),
            tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
            language: t.language ? String(t.language) : undefined,
            standards: (t.standards as ProjectStandard[]) ?? [],
            createdAt: String(t.createdAt ?? new Date().toISOString()),
            updatedAt: String(t.updatedAt ?? new Date().toISOString()),
            downloads: Number(t.downloads ?? 0),
          });
          result.imported++;
        } catch (err) {
          result.errors.push(
            `Failed to import "${templateId}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch {
      result.errors.push('Failed to parse import payload');
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Popularity
  // -----------------------------------------------------------------------

  getPopular(limit = 10): CommunityRuleTemplate[] {
    return this.list()
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, limit);
  }

  getByCategory(category: string): CommunityRuleTemplate[] {
    return this.list().filter((t) => t.category.toLowerCase() === category.toLowerCase());
  }

  incrementDownloads(id: string): boolean {
    const template = this.templates.get(id);
    if (!template) return false;
    template.downloads++;
    return true;
  }

  // -----------------------------------------------------------------------
  // Private indexing
  // -----------------------------------------------------------------------

  private indexTemplate(template: CommunityRuleTemplate): void {
    const keywords = new Set<string>();
    keywords.add(template.id.toLowerCase());
    keywords.add(template.category.toLowerCase());
    for (const tag of template.tags) keywords.add(tag.toLowerCase());
    if (template.language) keywords.add(template.language.toLowerCase());
    for (const word of template.name.toLowerCase().split(/[\s\-_]+/)) keywords.add(word);
    for (const word of template.description.toLowerCase().split(/[\s\-_]+/)) {
      if (word.length > 2) keywords.add(word);
    }
    for (const keyword of keywords) {
      if (!this.searchIndex.has(keyword)) {
        this.searchIndex.set(keyword, new Set());
      }
      this.searchIndex.get(keyword)!.add(template.id);
    }
  }

  private deindexTemplate(template: CommunityRuleTemplate): void {
    for (const [, ids] of this.searchIndex) {
      ids.delete(template.id);
    }
  }
}
