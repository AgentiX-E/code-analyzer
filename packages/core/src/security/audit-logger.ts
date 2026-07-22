// @code-analyzer/core — Audit Logger
// Enterprise audit trail with buffered writes, querying, and JSON Lines export.

import { createHash } from 'crypto';
import type { WriteStream } from 'fs';
import { createWriteStream, writeFile } from 'fs';
import { promisify } from 'util';

const writeFileAsync = promisify(writeFile);

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure' | 'denied';
  details?: Record<string, unknown>;
  clientIp?: string;
  correlationId?: string;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  resource?: string;
  outcome?: 'success' | 'failure' | 'denied';
  from?: string;
  to?: string;
  limit?: number;
}

export interface AuditSummary {
  totalEvents: number;
  byAction: Record<string, number>;
  byOutcome: Record<string, number>;
  byActor: Record<string, number>;
  failures: number;
  denied: number;
}

export class AuditLogger {
  private events: AuditEvent[] = [];
  private buffer: AuditEvent[] = [];
  private bufferSize: number;
  private persistToFile?: string;
  private writeStream?: WriteStream;

  constructor(options?: { persistToFile?: string; bufferSize?: number }) {
    this.persistToFile = options?.persistToFile;
    this.bufferSize = options?.bufferSize ?? 100;
  }

  /** Log an audit event. Returns the generated event ID. */
  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): string {
    const id = this.generateId();
    const timestamp = new Date().toISOString();

    const fullEvent: AuditEvent = {
      ...event,
      id,
      timestamp,
    };

    this.events.push(fullEvent);
    this.buffer.push(fullEvent);

    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }

    return id;
  }

  /** Query audit events with optional filters. */
  query(query: AuditQuery): AuditEvent[] {
    let results = this.events.slice();

    if (query.actor) {
      results = results.filter((e) => e.actor === query.actor);
    }
    if (query.action) {
      results = results.filter((e) => e.action === query.action);
    }
    if (query.resource) {
      results = results.filter((e) => e.resource === query.resource);
    }
    if (query.outcome) {
      results = results.filter((e) => e.outcome === query.outcome);
    }
    if (query.from) {
      results = results.filter((e) => e.timestamp >= query.from!);
    }
    if (query.to) {
      results = results.filter((e) => e.timestamp <= query.to!);
    }
    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /** Get a summary of audit events. */
  getSummary(from?: string, to?: string): AuditSummary {
    let filtered = this.events;

    if (from) {
      filtered = filtered.filter((e) => e.timestamp >= from);
    }
    if (to) {
      filtered = filtered.filter((e) => e.timestamp <= to);
    }

    const byAction: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    let failures = 0;
    let denied = 0;

    for (const event of filtered) {
      byAction[event.action] = (byAction[event.action] || 0) + 1;
      byOutcome[event.outcome] = (byOutcome[event.outcome] || 0) + 1;
      byActor[event.actor] = (byActor[event.actor] || 0) + 1;

      if (event.outcome === 'failure') failures++;
      if (event.outcome === 'denied') denied++;
    }

    return {
      totalEvents: filtered.length,
      byAction,
      byOutcome,
      byActor,
      failures,
      denied,
    };
  }

  /** Export audit log to a file in JSON Lines format. */
  async export(filePath: string): Promise<void> {
    const lines = this.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFileAsync(filePath, lines, 'utf-8');
  }

  /** Flush buffered events to persistent storage if configured. */
  flush(): void {
    if (!this.persistToFile) {
      this.buffer = [];
      return;
    }

    if (this.buffer.length === 0) return;

    if (!this.writeStream) {
      this.writeStream = createWriteStream(this.persistToFile, {
        flags: 'a',
        encoding: 'utf-8',
      });
    }

    for (const event of this.buffer) {
      this.writeStream.write(JSON.stringify(event) + '\n');
    }

    this.buffer = [];
  }

  /** Get total event count. */
  getCount(): number {
    return this.events.length;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private generateId(): string {
    const random = Math.random().toString(36).substring(2, 10);
    const time = Date.now().toString(36);
    const hash = createHash('sha256')
      .update(random + time)
      .digest('hex')
      .substring(0, 8);
    return `audit_${time}_${hash}`;
  }
}
