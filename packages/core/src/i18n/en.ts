/**
 * English (en) translation messages for the Code Analyzer.
 *
 * All user-facing messages are defined here. Messages support
 * template interpolation using the `{variable}` syntax.
 */

/** Default messages used across the core system. */
export const DEFAULT_MESSAGES: Record<string, string | number> = {
  // Config
  'config.loading': 'Loading configuration...',
  'config.loaded': 'Configuration loaded successfully',
  'config.loadFailed': 'Failed to load configuration: {error}',
  'config.loadedDefaults': 'Using default configuration',
  'config.loadedGlobal': 'Merged global config from {path}',
  'config.loadedProject': 'Merged project config from {path}',
  'config.envOverrides': 'Applied environment variable overrides',
  'config.envWarning': 'Environment variable {name} has invalid value: {value}',
  'config.invalid': 'Invalid configuration: {errors}',
  'config.validationFailed': 'Configuration validation failed with {count} error(s)',
  'defaults_maxFiles': 50000,

  // Logging
  'logging.initialized': 'Logger initialized for component "{component}" at level {level}',
  'logging.fileTransport': 'File transport enabled, writing to {dir}',
  'logging.closed': 'Logger closed for component "{component}"',

  // Lifecycle
  'lifecycle.init': 'Initializing component "{component}"',
  'lifecycle.initDone': 'Component "{component}" initialized successfully',
  'lifecycle.initFailed': 'Component "{component}" initialization failed: {error}',
  'lifecycle.shutdown': 'Shutting down component "{component}"',
  'lifecycle.shutdownDone': 'Component "{component}" shut down successfully',
  'lifecycle.shutdownFailed': 'Component "{component}" shutdown failed: {error}',
  'lifecycle.shutdownTimeout': 'Shutdown timed out for component "{component}" after {timeout}ms',
  'lifecycle.healthCheck': 'Health check for "{component}" returned {status}',
  'lifecycle.dependencyOrder': 'Components will initialize in order: {order}',
  'lifecycle.circularDependency': 'Circular dependency detected: {chain}',

  // Errors
  'errors.generic': 'An unexpected error occurred',
  'errors.configError': 'Configuration error: {message}',
  'errors.ioError': 'I/O error: {message}',
  'errors.parseError': 'Parse error: {message}',
  'errors.resolutionError': 'Resolution error: {message}',
  'errors.graphIntegrityError': 'Graph integrity error: {message}',
  'errors.embeddingError': 'Embedding error: {message}',
  'errors.llmProviderError': 'LLM provider error: {message}',
  'errors.mcpProtocolError': 'MCP protocol error: {message}',
  'errors.rateLimitError': 'Rate limit error: {message}',

  // Metrics
  'metrics.counter': 'Counter {name} incremented by {value}',
  'metrics.histogram': 'Histogram {name} recorded {value}',
  'metrics.gauge': 'Gauge {name} set to {value}',
  'metrics.collectorCreated': 'Metrics collector initialized',
  'metrics.collectorShutdown': 'Metrics collector shut down',
};
