import { AsyncLocalStorage } from 'node:async_hooks';

// =============================================================================
// Types
// =============================================================================
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  readonly requestId: string;
}

// =============================================================================
// Context
// =============================================================================
const logStore = new AsyncLocalStorage<LogContext>();

const runWithContext = <T>(context: LogContext, fn: () => T): T => logStore.run(context, fn);

const getContext = (): LogContext | undefined => logStore.getStore();

// =============================================================================
// Formatting
// =============================================================================
const MIN_MESSAGE_WIDTH = 80;

const formatEntry = (level: LogLevel, message: string, error?: Error): string => {
  const timestamp = new Date().toISOString();
  const context = logStore.getStore();
  const paddedMessage = message.padEnd(MIN_MESSAGE_WIDTH);
  const suffix = context ? `  requestId=${context.requestId}` : '';
  const base = `${timestamp} ${level} ${paddedMessage}${suffix}`;

  if (!error?.stack) return base;
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

export { getContext, logger, runWithContext };
export type { LogContext, LogLevel };
