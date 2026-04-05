import { AsyncLocalStorage } from 'node:async_hooks';

// =============================================================================
// Types
// =============================================================================
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogFormat = 'text' | 'json';

interface LogContext {
  readonly requestId: string;
}

// =============================================================================
// State
// =============================================================================
const logStore = new AsyncLocalStorage<LogContext>();

// eslint-disable-next-line functional/no-let
let logFormat: LogFormat = 'text';

// =============================================================================
// Configuration
// =============================================================================
const configureLogger = (format: LogFormat): void => {
  logFormat = format;
};

const runWithContext = <T>(context: LogContext, fn: () => T): T => logStore.run(context, fn);

const getContext = (): LogContext | undefined => logStore.getStore();

// =============================================================================
// Formatting
// =============================================================================
const MIN_MESSAGE_WIDTH = 80;

const formatText = (level: LogLevel, message: string, context: LogContext | undefined): string => {
  const timestamp = new Date().toISOString();
  const paddedMessage = message.padEnd(MIN_MESSAGE_WIDTH);
  const suffix = context ? `  requestId=${context.requestId}` : '';

  return `${timestamp} ${level} ${paddedMessage}${suffix}`;
};

const formatJson = (level: LogLevel, message: string, context: LogContext | undefined, error?: Error): string => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { requestId: context.requestId } : {}),
    ...(error ? { error: { name: error.name, message: error.message, stack: error.stack } } : {}),
  };

  return JSON.stringify(entry);
};

const formatEntry = (level: LogLevel, message: string, error?: Error): string => {
  const context = logStore.getStore();

  if (logFormat === 'json') {
    return formatJson(level, message, context, error);
  }

  const base = formatText(level, message, context);
  if (!error?.stack) {
    return base;
  }

  return `${base}\n${error.stack}`;
};

// =============================================================================
// Logger
// =============================================================================
const logger = {
  debug: (message: string): void => {
    console.info(formatEntry('DEBUG', message));
  },

  info: (message: string): void => {
    console.info(formatEntry('INFO', message));
  },

  warn: (message: string): void => {
    console.warn(formatEntry('WARN', message));
  },

  error: (message: string, error?: Error): void => {
    console.error(formatEntry('ERROR', message, error));
  },
} as const;

export { configureLogger, getContext, logger, runWithContext };
export type { LogContext, LogFormat, LogLevel };
