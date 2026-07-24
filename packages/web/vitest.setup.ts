import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver — used by GraphExplorer
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
