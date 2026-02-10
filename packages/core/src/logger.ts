import type { Logger, LogLevel } from './types';

const logLevelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function logWithLevel(
  logger: Logger,
  level: LogLevel,
  threshold: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (logLevelOrder[level] < logLevelOrder[threshold]) {
    return;
  }

  const fn =
    logger[level] ?? logger.warn ?? logger.info ?? logger.debug ?? logger.error ?? console.log;

  try {
    fn.call(logger, message, fields);
  } catch {
    // Logging should never disrupt instrumentation.
  }
}
