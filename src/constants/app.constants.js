import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

export const APP_NAME = 'queuectl';
export const APP_VERSION = packageJson.version;
export const APP_DESCRIPTION =
  'CLI-based background job queue system for MongoDB-backed job processing.';

export const DEFAULT_ENVIRONMENT = 'development';
export const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/queuectl';
export const DEFAULT_MONGODB_SERVER_SELECTION_TIMEOUT_MS = 2000;

