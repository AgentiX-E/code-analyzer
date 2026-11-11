import '@testing-library/jest-dom/vitest';

/**
 * jsdom implements no layout, so it has no `ResizeObserver` for GraphExplorer to observe.
 *
 * **The constructor takes the callback the interface takes**, and that signature is the point of
 * this file: the previous class declared no constructor at all, so `new ResizeObserver(handler)`
 * passed an argument to a constructor that accepts none - a shape TypeScript allowed only through
 * the `as unknown as typeof ResizeObserver` cast below, and one that a static analyser reports as a
 * superfluous argument. **A mock whose signature disagrees with the interface it stands in for is a
 * mock that stops the compiler from checking the one call it exists to support.**
 *
 * The callback is kept and not invoked. Invoking it would have to invent a size, and every number
 * invented here would be a figure no browser produced: an element's box in jsdom is `0 × 0`, and a
 * test that asserts against a fabricated `800 × 600` asserts against the mock rather than the
 * component.
 */
class MockResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
