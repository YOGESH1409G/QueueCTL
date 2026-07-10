import dotenv from 'dotenv';

import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_MONGODB_SERVER_SELECTION_TIMEOUT_MS,
  DEFAULT_MONGODB_URI,
} from '../constants/app.constants.js';

dotenv.config({ quiet: true });

function parseInteger(value, fallback) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || DEFAULT_ENVIRONMENT,
  mongoUri: process.env.MONGODB_URI || DEFAULT_MONGODB_URI,
  mongoServerSelectionTimeoutMs: parseInteger(
    process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    DEFAULT_MONGODB_SERVER_SELECTION_TIMEOUT_MS
  ),
});

export function isProduction() {
  return env.nodeEnv === 'production';
}
