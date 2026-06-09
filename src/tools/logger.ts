import pino, { type Logger, type LoggerOptions } from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),

  // Keep timestamps as epoch millis in prod (cheap, machine-parseable);
  // pino-pretty handles human formatting in dev.
  base: { service: 'p2p-streaming' },

  // Never let secrets / PII reach the logs. Add paths as the app grows.
  redact: {
    paths: ['req.headers.authorization', '*.password', '*.token', 'token'],
    censor: '[REDACTED]',
  },

  // Pretty-print only in local dev. In prod (and tests) we emit raw NDJSON,
  // which is what log shippers expect — no worker thread is spawned.
  transport: !isProd && !isTest
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
};

/**
 * The single root logger for the whole process. One instance means one output
 * stream (and at most one pino-pretty worker thread), with consistent ordering.
 */
export const logger: Logger = pino(options);

/**
 * Create a namespaced child logger for a module/subsystem. Children are cheap,
 * share the root's transport/level, and tag every line with `{ name }`.
 * Bind extra context (peerId, roomId, ...) by passing more fields.
 *
 *   const log = childLogger('signalling');
 *   const peerLog = log.child({ peerId });
 *   peerLog.info({ roomId }, 'peer joined');
 */
export const childLogger = (name: string, bindings: Record<string, unknown> = {}): Logger =>
  logger.child({ name, ...bindings });
