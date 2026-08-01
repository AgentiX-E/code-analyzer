import { describe, it, expect } from 'vitest';

import { LifecycleManager } from '../lifecycle/index.js';

import type { Component, HealthCheckResult } from '../lifecycle/index.js';

/** Simple mock component for testing. */
class MockComponent implements Component {
  public initialized = false;
  public shutDown = false;
  public initDelay = 0;
  public initShouldFail = false;
  public shutdownDelay = 0;
  public shutdownShouldFail = false;

  constructor(public readonly name: string) {}

  async init(): Promise<void> {
    if (this.initDelay > 0) {
      await delay(this.initDelay);
    }
    if (this.initShouldFail) {
      throw new Error(`Init failed for ${this.name}`);
    }
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (this.shutdownDelay > 0) {
      await delay(this.shutdownDelay);
    }
    if (this.shutdownShouldFail) {
      throw new Error(`Shutdown failed for ${this.name}`);
    }
    this.shutDown = true;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('LifecycleManager', () => {
  describe('registration', () => {
    it('should register a component', () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('test');
      mgr.register({ component: comp });
      // No error means success
    });

    it('should throw on duplicate registration', () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('test');
      mgr.register({ component: comp });
      expect(() => mgr.register({ component: comp })).toThrow(
        'Component "test" is already registered'
      );
    });
  });

  describe('resolveInitOrder', () => {
    it('should return components in topological order', () => {
      const mgr = new LifecycleManager();
      const db = new MockComponent('db');
      const cache = new MockComponent('cache');
      const api = new MockComponent('api');

      mgr.register({ component: db });
      mgr.register({ component: cache, dependsOn: ['db'] });
      mgr.register({ component: api, dependsOn: ['db', 'cache'] });

      const order = mgr.resolveInitOrder();

      // db must come before cache, and both before api
      const dbIdx = order.indexOf('db');
      const cacheIdx = order.indexOf('cache');
      const apiIdx = order.indexOf('api');

      expect(dbIdx).toBeLessThan(cacheIdx);
      expect(dbIdx).toBeLessThan(apiIdx);
      expect(cacheIdx).toBeLessThan(apiIdx);
    });

    it('should handle components with no dependencies', () => {
      const mgr = new LifecycleManager();
      const a = new MockComponent('a');
      const b = new MockComponent('b');
      const c = new MockComponent('c');

      mgr.register({ component: a });
      mgr.register({ component: b });
      mgr.register({ component: c });

      const order = mgr.resolveInitOrder();
      expect(order).toHaveLength(3);
      expect(order).toContain('a');
      expect(order).toContain('b');
      expect(order).toContain('c');
    });

    it('should detect circular dependencies', () => {
      const mgr = new LifecycleManager();
      const a = new MockComponent('a');
      const b = new MockComponent('b');

      mgr.register({ component: a, dependsOn: ['b'] });
      mgr.register({ component: b, dependsOn: ['a'] });

      expect(() => mgr.resolveInitOrder()).toThrow('Circular dependency detected');
    });

    it('should throw for missing dependencies', () => {
      const mgr = new LifecycleManager();
      const a = new MockComponent('a');

      mgr.register({ component: a, dependsOn: ['nonexistent'] });

      expect(() => mgr.resolveInitOrder()).toThrow(
        'Dependency "nonexistent" referenced but not registered'
      );
    });
  });

  describe('init', () => {
    it('should initialize all components in dependency order', async () => {
      const mgr = new LifecycleManager();
      const db = new MockComponent('db');
      const api = new MockComponent('api');

      mgr.register({ component: db });
      mgr.register({ component: api, dependsOn: ['db'] });

      const count = await mgr.init();
      expect(count).toBe(2);
      expect(db.initialized).toBe(true);
      expect(api.initialized).toBe(true);
    });

    it('should stop on first failure', async () => {
      const mgr = new LifecycleManager();
      const db = new MockComponent('db');
      db.initShouldFail = true;
      const api = new MockComponent('api');

      mgr.register({ component: db });
      mgr.register({ component: api, dependsOn: ['db'] });

      const count = await mgr.init();
      expect(count).toBe(0);
      expect(api.initialized).toBe(false);
    });

    it('should call onInitError callback on failure', async () => {
      const failures: Array<{ name: string; error: Error }> = [];
      const mgr = new LifecycleManager({
        onInitError: (name, error) => failures.push({ name, error }),
      });
      const comp = new MockComponent('bad');
      comp.initShouldFail = true;

      mgr.register({ component: comp });

      const count = await mgr.init();
      expect(count).toBe(0);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.name).toBe('bad');
      expect(failures[0]?.error.message).toContain('Init failed');
    });
  });

  describe('shutdown', () => {
    it('should shut down components in reverse order', async () => {
      const mgr = new LifecycleManager();
      const db = new MockComponent('db');
      const api = new MockComponent('api');

      mgr.register({ component: db });
      mgr.register({ component: api, dependsOn: ['db'] });

      await mgr.init();

      const count = await mgr.shutdown();
      expect(count).toBe(2);
      expect(db.shutDown).toBe(true);
      expect(api.shutDown).toBe(true);
    });

    it('should continue shutdown even if one component fails', async () => {
      const mgr = new LifecycleManager();
      const good = new MockComponent('good');
      const bad = new MockComponent('bad');
      bad.shutdownShouldFail = true;

      mgr.register({ component: good });
      mgr.register({ component: bad });

      await mgr.init();

      const count = await mgr.shutdown();
      // Only 'good' shuts down successfully, 'bad' fails
      expect(count).toBe(1);
      expect(good.shutDown).toBe(true);
    });

    it('should not shut down uninitialized components', async () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('comp');

      mgr.register({ component: comp });

      const count = await mgr.shutdown();
      expect(count).toBe(0);
      expect(comp.shutDown).toBe(false);
    });

    it('should timeout on slow shutdown', async () => {
      const mgr = new LifecycleManager({ shutdownTimeout: 100 });
      const comp = new MockComponent('slow');
      comp.shutdownDelay = 500;

      mgr.register({ component: comp });
      await mgr.init();

      const count = await mgr.shutdown();
      expect(count).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should report uninitialized components as unhealthy', () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('comp');

      mgr.register({ component: comp });

      const results = mgr.healthCheck();
      expect(results).toHaveLength(1);
      expect(results[0]?.component).toBe('comp');
      expect(results[0]?.status).toBe('unhealthy');
    });

    it('should report initialized components as healthy', async () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('comp');

      mgr.register({ component: comp });
      await mgr.init();

      const results = mgr.healthCheck();
      expect(results[0]?.status).toBe('healthy');
    });

    it('should use registered health check callbacks', () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('comp');

      mgr.register({ component: comp });
      mgr.registerHealthCheck('comp', (): HealthCheckResult => ({
        component: 'comp',
        status: 'degraded',
        details: 'disk space low',
        timestamp: new Date().toISOString(),
      }));

      const results = mgr.healthCheck();
      expect(results[0]?.status).toBe('degraded');
      expect(results[0]?.details).toBe('disk space low');
    });

    it('should return timestamp with each health check result', () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('comp');

      mgr.register({ component: comp });

      const results = mgr.healthCheck();
      expect(results[0]?.timestamp).toBeDefined();
      expect(() => new Date(results[0]!.timestamp)).not.toThrow();
    });
  });

  describe('isHealthy', () => {
    it('should return false when no components are initialized', () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('comp');
      mgr.register({ component: comp });
      expect(mgr.isHealthy()).toBe(false);
    });

    it('should return true when all components are initialized', async () => {
      const mgr = new LifecycleManager();
      const comp = new MockComponent('comp');
      mgr.register({ component: comp });
      await mgr.init();
      expect(mgr.isHealthy()).toBe(true);
    });
  });

  describe('getUninitialized', () => {
    it('should list uninitialized components', async () => {
      const mgr = new LifecycleManager();
      const a = new MockComponent('a');
      const b = new MockComponent('b');

      mgr.register({ component: a });
      mgr.register({ component: b });
      await mgr.init();

      // All are initialized
      expect(mgr.getUninitialized()).toHaveLength(0);

      // After shutdown, they should show as uninitialized
      await mgr.shutdown();
      expect(mgr.getUninitialized()).toEqual(['a', 'b']);
    });
  });
});
