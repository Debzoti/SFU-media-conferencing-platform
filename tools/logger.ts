import pino from 'pino';

export class Logger {
  private logger: pino.Logger;

  constructor(serviceName: string) {
    this.logger = pino({
      name: serviceName,
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname'
        }
      } : undefined
    });
  }

  info(obj: object | string, msg?: string): void {
    if (typeof obj === 'string') {
      this.logger.info(obj);
    } else {
      this.logger.info(obj, msg);
    }
  }

  error(obj: object | string, msg?: string): void {
    if (typeof obj === 'string') {
      this.logger.error(obj);
    } else {
      this.logger.error(obj, msg);
    }
  }

  warn(obj: object | string, msg?: string): void {
    if (typeof obj === 'string') {
      this.logger.warn(obj);
    } else {
      this.logger.warn(obj, msg);
    }
  }

  debug(obj: object | string, msg?: string): void {
    if (typeof obj === 'string') {
      this.logger.debug(obj);
    } else {
      this.logger.debug(obj, msg);
    }
  }
}

export const createLogger = (serviceName: string) => new Logger(serviceName);