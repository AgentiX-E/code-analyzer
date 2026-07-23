// @code-analyzer/intelligence — Version Compatibility Matrix
// Builds and analyzes dependency version compatibility across repo groups.
// Detects conflicts, suggests alignments, and checks upgrade safety.

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface CompatibilityMatrix {
  groupId: string;
  repos: string[];
  sharedDependencies: Record<string, Record<string, string>>; // pkg → repo → version
  matrix: Record<string, Record<string, string>>; // repo → pkg → version
}

export interface VersionConflict {
  packageName: string;
  repos: { repo: string; version: string }[];
  conflictType: 'major_mismatch' | 'minor_mismatch' | 'patch_mismatch';
  recommendedVersion: string;
}

export interface VersionAlignment {
  packageName: string;
  currentVersions: Record<string, string>;
  suggestedVersion: string;
  reposToUpdate: string[];
  rationale: string;
}

export interface UpgradeSafetyReport {
  safe: boolean;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  breakingChanges: string[];
  affectedRepos: string[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// VersionCompatibilityMatrix
// ---------------------------------------------------------------------------

export class VersionCompatibilityMatrix {
  /**
   * Build a compatibility matrix for all repos in a group.
   * Shows which versions of shared dependencies each repo uses.
   */
  buildMatrix(
    groupId: string,
    repoVersions: { repo: string; version?: string; dependencies: Record<string, string> }[],
  ): CompatibilityMatrix {
    if (!groupId) {
      throw new Error('groupId is required');
    }

    const repos = repoVersions.map((r) => r.repo);
    const sharedDependencies: Record<string, Record<string, string>> = {};
    const matrix: Record<string, Record<string, string>> = {};

    for (const rv of repoVersions) {
      matrix[rv.repo] = rv.dependencies;

      for (const [pkg, version] of Object.entries(rv.dependencies)) {
        if (!sharedDependencies[pkg]) {
          sharedDependencies[pkg] = {};
        }
        sharedDependencies[pkg]![rv.repo] = version;
      }
    }

    // Filter to only shared dependencies (used by 2+ repos)
    for (const pkg of Object.keys(sharedDependencies)) {
      if (Object.keys(sharedDependencies[pkg]!).length < 2) {
        delete sharedDependencies[pkg];
      }
    }

    return {
      groupId,
      repos,
      sharedDependencies,
      matrix,
    };
  }

  /**
   * Detect version conflicts between repos that share dependencies.
   */
  detectConflicts(matrix: CompatibilityMatrix): VersionConflict[] {
    if (!matrix || !matrix.sharedDependencies) {
      return [];
    }

    const conflicts: VersionConflict[] = [];

    for (const [pkgName, repoVersions] of Object.entries(
      matrix.sharedDependencies,
    )) {
      const entries = Object.entries(repoVersions ?? {});
      if (entries.length < 2) continue;

      const versions = [...new Set(entries.map(([, v]) => v))];
      if (versions.length > 1) {
        // Determine conflict type
        let conflictType: VersionConflict['conflictType'] = 'patch_mismatch';
        let hasMinor = false;
        let hasMajor = false;

        for (const version of versions) {
          const parsed = this.parseSemver(version);
          for (const otherVersion of versions) {
            if (version === otherVersion) continue;
            const otherParsed = this.parseSemver(otherVersion);
            if (parsed.major !== otherParsed.major) {
              hasMajor = true;
            } else if (parsed.minor !== otherParsed.minor) {
              hasMinor = true;
            }
          }
        }

        if (hasMajor) conflictType = 'major_mismatch';
        else if (hasMinor) conflictType = 'minor_mismatch';

        // Determine recommended version (pick the highest)
        const versionEntries = entries.map(([repo, version]) => ({
          repo,
          version,
        }));
        const recommendedVersion = this.pickHighestVersion(
          versionEntries.map((e) => e.version),
        );

        conflicts.push({
          packageName: pkgName,
          repos: versionEntries,
          conflictType,
          recommendedVersion,
        });
      }
    }

    return conflicts;
  }

  /**
   * Suggest version alignments to resolve conflicts.
   */
  suggestAlignments(conflicts: VersionConflict[]): VersionAlignment[] {
    if (!conflicts || conflicts.length === 0) {
      return [];
    }

    const alignments: VersionAlignment[] = [];

    for (const conflict of conflicts) {
      const currentVersions: Record<string, string> = {};
      const reposToUpdate: string[] = [];

      for (const entry of conflict.repos) {
        currentVersions[entry.repo] = entry.version;
        if (entry.version !== conflict.recommendedVersion) {
          reposToUpdate.push(entry.repo);
        }
      }

      let riskLevel = 'safe';
      if (conflict.conflictType === 'major_mismatch') {
        riskLevel = 'needs review — major version differences may indicate intentional divergence';
      } else if (conflict.conflictType === 'minor_mismatch') {
        riskLevel = 'moderate risk — check changelog for breaking changes';
      }

      alignments.push({
        packageName: conflict.packageName,
        currentVersions,
        suggestedVersion: conflict.recommendedVersion,
        reposToUpdate,
        rationale: `Align all repos to ${conflict.recommendedVersion} to resolve ${conflict.conflictType}. ${riskLevel}`,
      });
    }

    return alignments;
  }

  /**
   * Check if a specific version upgrade is safe across all repos.
   */
  checkUpgradeSafety(
    pkgName: string,
    fromVersion: string,
    toVersion: string,
    matrix: CompatibilityMatrix,
  ): UpgradeSafetyReport {
    if (!pkgName || !fromVersion || !toVersion) {
      throw new Error('pkgName, fromVersion, and toVersion are required');
    }

    if (!matrix) {
      throw new Error('matrix is required');
    }

    const from = this.parseSemver(fromVersion);
    const to = this.parseSemver(toVersion);
    const breakingChanges: string[] = [];
    const affectedRepos: string[] = [];
    const recommendations: string[] = [];

    // Determine which repos use this package
    const pkgInfo = matrix.sharedDependencies[pkgName] ?? {};
    const affectedRepoNames = Object.keys(pkgInfo);
    affectedRepos.push(...affectedRepoNames);

    // Check for major version bump (breaking changes)
    if (to.major > from.major) {
      breakingChanges.push(
        `Major version bump: ${fromVersion} → ${toVersion}`,
      );
      recommendations.push(
        'Review the changelog for breaking changes before upgrading',
      );
      recommendations.push(
        'Run full test suite for all affected repos',
      );
      recommendations.push(
        'Consider a phased rollout: upgrade one repo at a time',
      );
    }

    // Minor version bump (possible breaking changes)
    if (to.minor > from.minor && to.major === from.major) {
      recommendations.push(
        `Minor version bump (${fromVersion} → ${toVersion}): check for new features and deprecations`,
      );
    }

    // Downgrade attempt
    if (this.compareSemver(toVersion, fromVersion) < 0) {
      breakingChanges.push(
        `Downgrading from ${fromVersion} to ${toVersion} — this may break existing functionality`,
      );
      recommendations.push('Verify downgrade is intentional and safe');
    }

    // Same version
    if (fromVersion === toVersion) {
      recommendations.push('Versions are identical — no upgrade needed');
    }

    // Check for repos that are already on the target version
    const alreadyOnTarget = affectedRepoNames.filter(
      (repo) => pkgInfo[repo] === toVersion,
    );
    if (alreadyOnTarget.length > 0) {
      recommendations.push(
        `${alreadyOnTarget.length} repo(s) already on ${toVersion}: ${alreadyOnTarget.join(', ')}`,
      );
    }

    return {
      safe: breakingChanges.length === 0,
      packageName: pkgName,
      fromVersion,
      toVersion,
      breakingChanges,
      affectedRepos,
      recommendations,
    };
  }

  /**
   * Parse a semver string into major/minor/patch components.
   */
  parseSemver(version: string): { major: number; minor: number; patch: number } {
    // Strip leading non-digit chars (^, ~, >=, <=, v, *, etc.)
    const cleaned = version.replace(/^[^\d]*/, '').replace(/[^.\d].*$/, '');
    const parts = cleaned.split('.').map(Number);
    return {
      major: isNaN(parts[0]!) ? 0 : parts[0]!,
      minor: isNaN(parts[1]!) ? 0 : parts[1]!,
      patch: isNaN(parts[2]!) ? 0 : parts[2]!,
    };
  }

  /**
   * Compare two semver strings.
   * Returns: negative if a < b, 0 if equal, positive if a > b.
   */
  compareSemver(a: string, b: string): number {
    const pa = this.parseSemver(a);
    const pb = this.parseSemver(b);

    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    return pa.patch - pb.patch;
  }

  /**
   * Pick the highest version from a list.
   */
  pickHighestVersion(versions: string[]): string {
    if (versions.length === 0) return '0.0.0';
    if (versions.length === 1) return versions[0]!;

    return versions.reduce((highest, current) => {
      return this.compareSemver(current, highest) > 0 ? current : highest;
    });
  }
}
