import DailyRotateFile from 'winston-daily-rotate-file';
import winston from 'winston';

const { combine, colorize, errors, printf, timestamp } = winston.format;

const consoleFormat = printf(({ level, message, timestamp: logTimestamp, ...metadata }) => {
  const metadataKeys = Object.keys(metadata).filter(
    (key) => metadata[key] !== undefined && key !== 'stack'
  );
  const suffix = metadataKeys.length > 0 ? ` ${JSON.stringify(metadata)}` : '';

  return `${logTimestamp} ${level}: ${message}${suffix}`;
});

const jsonFormat = combine(timestamp(), errors({ stack: true }), winston.format.json());

export const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: jsonFormat,
  transports: [
    new winston.transports.Console({
      format: combine(timestamp(), colorize(), consoleFormat),
    }),
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'queuectl-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      zippedArchive: false,
    }),
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'queuectl-error-%DATE%.log',
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      zippedArchive: false,
    }),
  ],
});

export const logger = Object.freeze({
  info(message, metadata = {}) {
    winstonLogger.info(message, metadata);
  },
  success(message, metadata = {}) {
    winstonLogger.info(message, metadata);
  },
  warn(message, metadata = {}) {
    winstonLogger.warn(message, metadata);
  },
  error(message, metadata = {}) {
    winstonLogger.error(message, metadata);
  },
  debug(message, metadata = {}) {
    winstonLogger.debug(message, metadata);
  },
  structured(level, message, metadata = {}) {
    winstonLogger.log(level, message, metadata);
  },
});
