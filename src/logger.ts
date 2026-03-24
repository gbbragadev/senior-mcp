/**
 * Lightweight logger for senior-mcp.
 * Uses console-based logging to avoid external dependencies like winston.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function formatMessage(level: LogLevel, message: string): string {
  return `${new Date().toISOString()} ${level.toUpperCase()}: ${message}`;
}

const logger = {
  debug(message: string) {
    if (shouldLog('debug')) console.debug(formatMessage('debug', message));
  },
  info(message: string) {
    if (shouldLog('info')) console.log(formatMessage('info', message));
  },
  warn(message: string) {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message));
  },
  error(message: string) {
    if (shouldLog('error')) console.error(formatMessage('error', message));
  },
};

export default logger;
