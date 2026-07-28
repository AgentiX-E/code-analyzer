// @code-analyzer/intelligence — Delegation Mode
// Implements OCR's "delegation mode" where the host AI agent performs the
// review itself, and code-analyzer only handles file selection and rule
// resolution.

import type { ProjectStandard } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegatePreview {
  mode: 'diff' | 'scan';
  ref?: { from: string; to: string };
  bundles: Array<{ files: string[]; ruleIds: string[] }>;
  totalFiles: number;
  totalBundles: number;
}

export interface ResolvedRule {
  ruleId: string;
  category: string;
  severity: string;
  pattern: string;
  description: string;
  appliesTo: string[];
}

// ---------------------------------------------------------------------------
// Delegation Manager
// ---------------------------------------------------------------------------

export class DelegationManager {
  /**
   * Preview the reviewable file list with mode/ref metadata.
   * Groups files into bundles so the host LLM can review them in batches.
   *
   * @param files — list of file paths to review
   * @param projectRoot — the project root directory
   * @param mode — review mode (default: 'scan')
   * @param ref — optional git reference range (for diff mode)
   * @param bundleSize — max files per bundle (default: 10)
   */
  preview(
    files: string[],
    projectRoot: string,
    mode: 'diff' | 'scan' = 'scan',
    ref?: { from: string; to: string },
    bundleSize = 10,
  ): DelegatePreview {
    const filtered = files.filter((f) => f.startsWith(projectRoot));

    // Build bundles
    const bundles: Array<{ files: string[]; ruleIds: string[] }> = [];
    for (let i = 0; i < filtered.length; i += bundleSize) {
      bundles.push({
        files: filtered.slice(i, i + bundleSize),
        ruleIds: [],
      });
    }

    return {
      mode,
      ref,
      bundles,
      totalFiles: filtered.length,
      totalBundles: bundles.length,
    };
  }

  /**
   * Resolve which review rules apply to a specific file based on the
   * project standards and file characteristics.
   *
   * @param filePath — the file to resolve rules for
   * @param standards — project standards containing rule definitions
   */
  resolveRules(
    filePath: string,
    standards: ProjectStandard[],
  ): ResolvedRule[] {
    const resolved: ResolvedRule[] = [];
    const ext = this.getFileExtension(filePath);

    for (const standard of standards) {
      for (const rule of standard.rules) {
        const appliesTo = this.getAppliesTo(ext, standard);

        // Only include rules that apply to this file type
        if (appliesTo.length > 0) {
          resolved.push({
            ruleId: rule.id,
            category: standard.category,
            severity: rule.severity,
            pattern:
              typeof rule.checkConfig.pattern === 'string'
                ? rule.checkConfig.pattern
                : JSON.stringify(rule.checkConfig),
            description: rule.description,
            appliesTo,
          });
        }
      }
    }

    return resolved;
  }

  /**
   * Build a delegation prompt for the host LLM to use for review.
   * The prompt includes file bundles, applicable rules, and review instructions.
   *
   * @param preview — the delegate preview from `preview()`
   * @param rules — resolved rules to include in the prompt
   */
  buildDelegationPrompt(
    preview: DelegatePreview,
    rules: ResolvedRule[],
  ): string {
    const sections: string[] = [];

    // Header
    sections.push('# Code Review Delegation Prompt');
    sections.push('');
    sections.push(
      `Review mode: **${preview.mode}**`,
    );

    if (preview.ref) {
      sections.push(
        `Git range: \`${preview.ref.from}\` → \`${preview.ref.to}\``,
      );
    }

    sections.push(`Total files: ${preview.totalFiles}`);
    sections.push(`Total bundles: ${preview.totalBundles}`);
    sections.push('');

    // Rules section
    if (rules.length > 0) {
      sections.push('## Applicable Review Rules');
      sections.push('');

      const rulesByCategory = new Map<string, ResolvedRule[]>();
      for (const rule of rules) {
        const list = rulesByCategory.get(rule.category) ?? [];
        list.push(rule);
        rulesByCategory.set(rule.category, list);
      }

      for (const [category, categoryRules] of rulesByCategory) {
        sections.push(`### ${category}`);
        sections.push('');
        for (const rule of categoryRules) {
          sections.push(`- **${rule.ruleId}** [${rule.severity}]: ${rule.description}`);
          sections.push(`  - Applies to: \`${rule.appliesTo.join(', ')}\``);
        }
        sections.push('');
      }
    }

    // Bundle section
    sections.push('## File Bundles');
    sections.push('');

    for (let i = 0; i < preview.bundles.length; i++) {
      const bundle = preview.bundles[i];
      sections.push(`### Bundle ${i + 1} (${bundle.files.length} files)`);
      sections.push('');
      for (const file of bundle.files) {
        sections.push(`- \`${file}\``);
      }
      sections.push('');
    }

    // Instructions
    sections.push('## Instructions');
    sections.push('');
    sections.push('1. Review each file bundle against the rules listed above.');
    sections.push(
      '2. For each violation found, note the file path, line range, and rule violated.',
    );
    sections.push('3. Categorize findings by severity and category.');
    sections.push(
      '4. Provide actionable suggestions for each finding.',
    );
    sections.push('5. Return results in a structured format.');

    return sections.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract the file extension (lowercase, without the dot).
   */
  private getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) {
      return '';
    }
    return filePath.slice(lastDot + 1).toLowerCase();
  }

  /**
   * Determine which file patterns a rule applies to based on extension and
   * standard configuration.
   */
  private getAppliesTo(
    ext: string,
    standard: ProjectStandard,
  ): string[] {
    const patterns: string[] = [];

    // If the standard has explicit include paths, check them
    if (standard.config?.includePaths && standard.config.includePaths.length > 0) {
      for (const includePath of standard.config.includePaths) {
        const includeExt = this.getFileExtension(includePath);
        if (includeExt && includeExt === ext) {
          patterns.push(includePath);
        } else if (includePath === '*' || includePath === '**/*') {
          patterns.push(`*.${ext}`);
        }
      }

      // If includePaths are specified, only return matches from them
      return patterns;
    }

    // Otherwise, map standard category to common file extensions
    const categoryToExtensions: Record<string, string[]> = {
      'code-style': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs', 'rb'],
      'security': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs'],
      'performance': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs', 'cpp'],
      'testing': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs'],
      'api-design': ['ts', 'tsx', 'py', 'go', 'java'],
      'error-handling': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs'],
      'documentation': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs', 'rb'],
      'dependency': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs'],
      'architecture': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs'],
      'custom': ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rs'],
    };

    const compatibleExtensions = categoryToExtensions[standard.category] ?? [];
    if (compatibleExtensions.includes(ext)) {
      patterns.push(`*.${ext}`);
    }

    return patterns;
  }
}
