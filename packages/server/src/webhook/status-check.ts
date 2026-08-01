// @code-analyzer/server — GitHub Status Check Integration
// Creates and updates GitHub check runs for PR reviews.
// Reports line-level annotations and overall review status.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckRunConfig {
  /** GitHub API token */
  token: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
}

export interface CheckRun {
  id: number;
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  output: CheckRunOutput;
  completedAt: string | null;
  detailsUrl: string | null;
}

export interface CheckRunOutput {
  title: string;
  summary: string;
  text: string | null;
  annotations: CheckAnnotation[];
}

export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
  rawDetails?: string;
}

export interface CheckRunResult {
  checkRunId: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
  title: string;
  summary: string;
  annotationsCount: number;
  htmlUrl: string | null;
}

// ---------------------------------------------------------------------------
// StatusCheckManager
// ---------------------------------------------------------------------------

export class StatusCheckManager {
  private activeChecks = new Map<string, CheckRun>();

  constructor(private config?: CheckRunConfig) {}

  /**
   * Create a new check run for a PR.
   * In production, this calls the GitHub API.
   */
  async createCheckRun(
    headSha: string,
    name: string,
    title: string,
  ): Promise<CheckRun> {
    const checkRun: CheckRun = {
      id: Date.now(), // Simulated ID
      name,
      headSha,
      status: 'in_progress',
      conclusion: null,
      output: {
        title,
        summary: '',
        text: null,
        annotations: [],
      },
      completedAt: null,
      detailsUrl: null,
    };

    this.activeChecks.set(headSha + ':' + name, checkRun);
    return checkRun;
  }

  /**
   * Update a check run with results.
   */
  async updateCheckRun(
    headSha: string,
    name: string,
    update: {
      status?: 'queued' | 'in_progress' | 'completed';
      conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
      output?: Partial<CheckRunOutput>;
      detailsUrl?: string;
    },
  ): Promise<CheckRun | null> {
    const key = headSha + ':' + name;
    const checkRun = this.activeChecks.get(key);
    if (!checkRun) return null;

    if (update.status) checkRun.status = update.status;
    if (update.conclusion) checkRun.conclusion = update.conclusion;
    if (update.output) {
      if (update.output.title) checkRun.output.title = update.output.title;
      if (update.output.summary !== undefined) checkRun.output.summary = update.output.summary;
      if (update.output.text !== undefined) checkRun.output.text = update.output.text;
      if (update.output.annotations) {
        checkRun.output.annotations = [
          ...checkRun.output.annotations,
          ...update.output.annotations,
        ];
      }
    }
    if (update.detailsUrl) checkRun.detailsUrl = update.detailsUrl;

    if (checkRun.status === 'completed') {
      checkRun.completedAt = new Date().toISOString();
    }

    this.activeChecks.set(key, checkRun);
    return checkRun;
  }

  /**
   * Add annotations to a check run.
   */
  async addAnnotations(
    headSha: string,
    name: string,
    annotations: CheckAnnotation[],
  ): Promise<void> {
    const key = headSha + ':' + name;
    const checkRun = this.activeChecks.get(key);
    if (!checkRun) return;

    checkRun.output.annotations.push(...annotations);
    this.activeChecks.set(key, checkRun);
  }

  /**
   * Complete a check run with final status.
   */
  async completeCheckRun(
    headSha: string,
    name: string,
    conclusion: 'success' | 'failure' | 'neutral',
    summary: string,
    annotations?: CheckAnnotation[],
  ): Promise<CheckRunResult | null> {
    const updated = await this.updateCheckRun(headSha, name, {
      status: 'completed',
      conclusion,
      output: {
        summary,
        annotations: annotations ?? [],
      },
    });

    if (!updated) return null;

    return {
      checkRunId: updated.id,
      status: updated.status,
      conclusion: updated.conclusion!,
      title: updated.output.title,
      summary: updated.output.summary,
      annotationsCount: updated.output.annotations.length,
      htmlUrl: updated.detailsUrl,
    };
  }

  /**
   * Convert review comments to check annotations.
   */
  commentsToAnnotations(
    comments: Array<{
      filePath: string;
      startLine: number;
      endLine: number;
      severity: string;
      message: string;
    }>,
  ): CheckAnnotation[] {
    return comments.map((c) => ({
      path: c.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      annotationLevel: this.severityToAnnotationLevel(c.severity),
      message: c.message,
    }));
  }

  /**
   * Get all active check runs.
   */
  getActiveChecks(): CheckRun[] {
    return Array.from(this.activeChecks.values());
  }

  /**
   * Get a specific check run.
   */
  getCheckRun(headSha: string, name: string): CheckRun | undefined {
    return this.activeChecks.get(headSha + ':' + name);
  }

  /**
   * Clear all active checks.
   */
  clearChecks(): void {
    this.activeChecks.clear();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private severityToAnnotationLevel(
    severity: string,
  ): 'notice' | 'warning' | 'failure' {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'error':
        return 'failure';
      case 'high':
      case 'warning':
        return 'warning';
      default:
        return 'notice';
    }
  }
}
