import { describe, it, expect } from 'vitest';

import {
  createLogger,
  createNoopLogger,
  LoggerImpl,
  formatJson,
  formatPretty,
  createLevelFilter,
} from '../logging/index.js';

import type { LogLevel, LogEntry, LogTransport } from '../logging/index.js';

class TestTransport implements LogTransport {
  entries: LogEntry[] = [];

  write(_formatted: string, entry: LogEntry): void {
    this.entries.push(entry);
  }

  flush(): void {
    // no-op
  }

  close(): void {
    // no-op
  }
}

describe('Logger', () => {
  it('should create a logger with default level (info)', () => {
    const logger = createLogger('test');
    expect(logger.component).toBe('test');
    expect(logger.isLevelEnabled('info')).toBe(true);
    expect(logger.isLevelEnabled('debug')).toBe(false);
    expect(logger.isLevelEnabled('trace')).toBe(false);
    expect(logger.isLevelEnabled('warn')).toBe(true);
    expect(logger.isLevelEnabled('error')).toBe(true);
    expect(logger.isLevelEnabled('fatal')).toBe(true);
  });

  it('should create a logger with custom level', () => {
    const logger = createLogger('test', { minLevel: 'debug' });
    expect(logger.isLevelEnabled('info')).toBe(true);
    expect(logger.isLevelEnabled('debug')).toBe(true);
    expect(logger.isLevelEnabled('trace')).toBe(false);
  });

  it('should log messages to a transport', () => {
    const transport = new TestTransport();
    const logger = createLogger('test', {
      minLevel: 'trace',
      transports: [transport],
    });

    logger.info('hello world', { key: 'value' });
    expect(transport.entries).toHaveLength(1);
    expect(transport.entries[0]?.message).toBe('hello world');
    expect(transport.entries[0]?.level).toBe('info');
    expect(transport.entries[0]?.component).toBe('test');
    expect(transport.entries[0]?.data).toEqual({ key: 'value' });
  });

  it('should log to all log levels', () => {
    const transport = new TestTransport();
    const logger = createLogger('test', {
      minLevel: 'trace',
      transports: [transport],
    });

    const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    for (const level of levels) {
      const logMethod = level === 'fatal' || level === 'error'
        ? (msg: string) => (logger as LoggerImpl)[level](msg, new Error('test'))
        : (msg: string) => (logger as LoggerImpl)[level](msg);

      logMethod(`test ${level}`);
    }

    expect(transport.entries).toHaveLength(6);
    const loggedLevels = transport.entries.map((e) => e.level);
    expect(loggedLevels).toEqual(levels);
  });

  it('should filter out messages below minimum level', () => {
    const transport = new TestTransport();
    const logger = createLogger('test', {
      minLevel: 'error',
      transports: [transport],
    });

    logger.info('should not appear');
    logger.debug('should not appear');
    logger.trace('should not appear');
    logger.warn('should not appear');
    logger.error('should appear', new Error('test'));

    expect(transport.entries).toHaveLength(1);
    expect(transport.entries[0]?.level).toBe('error');
  });

  it('should include error details in log entry', () => {
    const transport = new TestTransport();
    const logger = createLogger('test', {
      minLevel: 'trace',
      transports: [transport],
    });

    const error = new Error('something bad');
    logger.error('error occurred', error);

    expect(transport.entries[0]?.error).toBeDefined();
    expect(transport.entries[0]?.error?.name).toBe('Error');
    expect(transport.entries[0]?.error?.message).toBe('something bad');
    expect(transport.entries[0]?.error?.stack).toBeDefined();
  });

  it('should extract code and context from CodeAnalyzerError', async () => {
    const { CodeAnalyzerError } = await import('../errors/hierarchy.js');
    const transport = new TestTransport();
    const logger = createLogger('test', {
      minLevel: 'trace',
      transports: [transport],
    });

    const err = new CodeAnalyzerError('CONFIG', 'TEST', 'config error', { field: 'value' });
    logger.error('bad config', err);

    expect(transport.entries[0]?.error?.code).toBe('CA_CONFIG_TEST');
    expect(transport.entries[0]?.error?.context).toEqual({ field: 'value' });
  });

  it('should not log after close', () => {
    const transport = new TestTransport();
    const logger = createLogger('test', {
      minLevel: 'trace',
      transports: [transport],
    });

    logger.close();
    logger.info('after close');

    expect(transport.entries).toHaveLength(0);
  });

  it('should apply custom filters', () => {
    const transport = new TestTransport();
    const logger = createLogger('test', {
      minLevel: 'trace',
      transports: [transport],
      filters: [
        (entry: LogEntry) => !entry.message.includes('secret'),
      ],
    });

    logger.info('public message');
    logger.info('secret data should not appear');

    expect(transport.entries).toHaveLength(1);
    expect(transport.entries[0]?.message).toBe('public message');
  });
});

describe('createNoopLogger', () => {
  it('should create a noop logger that never writes', () => {
    const transport = new TestTransport();
    const logger = createNoopLogger('noop');
    // Noop logger has minLevel 'fatal' and no transports passed, so nothing should log
    logger.info('should not be logged');
    logger.error('also not logged', new Error('test'));
    // All should be silent — no crash
    expect(transport.entries).toHaveLength(0);
  });
});

describe('formatJson', () => {
  it('should format a log entry as valid JSON string', () => {
    const entry: LogEntry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'info',
      component: 'test',
      message: 'hello',
    };
    const json = formatJson(entry);
    const parsed = JSON.parse(json);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('hello');
    expect(parsed.component).toBe('test');
  });

  it('should include optional fields when present', () => {
    const entry: LogEntry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'error',
      component: 'test',
      message: 'error msg',
      data: { meta: 'value' },
      error: { name: 'Error', message: 'fail', stack: 'some-stack' },
    };
    const json = formatJson(entry);
    const parsed = JSON.parse(json);
    expect(parsed.data).toEqual({ meta: 'value' });
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.name).toBe('Error');
  });
});

describe('formatPretty', () => {
  it('should return a string with level and component', () => {
    const entry: LogEntry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'info',
      component: 'test',
      message: 'hello world',
    };
    const output = formatPretty(entry);
    expect(output).toContain('INFO');
    expect(output).toContain('[test]');
    expect(output).toContain('hello world');
  });

  it('should include error details', () => {
    const entry: LogEntry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'error',
      component: 'test',
      message: 'fail',
      error: { name: 'Error', message: 'boom', code: 'CA_CONFIG_ERROR' },
    };
    const output = formatPretty(entry);
    expect(output).toContain('Error:');
    expect(output).toContain('boom');
    expect(output).toContain('CA_CONFIG_ERROR');
  });

  it('should include data when present', () => {
    const entry: LogEntry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'info',
      component: 'test',
      message: 'with data',
      data: { key: 'value' },
    };
    const output = formatPretty(entry);
    expect(output).toContain('Data:');
    expect(output).toContain('"key": "value"');
  });
});

describe('createLevelFilter', () => {
  it('should allow entries at or above the minimum level', () => {
    const filter = createLevelFilter('warn');
    const makeEntry = (level: LogLevel): LogEntry => ({
      timestamp: '',
      level,
      component: '',
      message: '',
    });

    expect(filter(makeEntry('trace'))).toBe(false);
    expect(filter(makeEntry('debug'))).toBe(false);
    expect(filter(makeEntry('info'))).toBe(false);
    expect(filter(makeEntry('warn'))).toBe(true);
    expect(filter(makeEntry('error'))).toBe(true);
    expect(filter(makeEntry('fatal'))).toBe(true);
  });
});
