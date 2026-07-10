import mongoose from 'mongoose';

import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

let connectionPromise = null;

export async function connectDatabase(options = {}) {
  const { log = true } = options;

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    mongoose.set('strictQuery', true);

    connectionPromise = mongoose
      .connect(env.mongoUri, {
        serverSelectionTimeoutMS: env.mongoServerSelectionTimeoutMs,
      })
      .then(() => {
        if (log) {
          logger.success(`MongoDB connected: ${mongoose.connection.name}`);
        }

        return mongoose.connection;
      })
      .catch((error) => {
        connectionPromise = null;

        if (log) {
          logger.error('MongoDB connection failed');
        }

        throw error;
      });
  }

  return connectionPromise;
}

export async function disconnectDatabase(options = {}) {
  const { log = true } = options;

  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();

  if (log) {
    logger.info('MongoDB disconnected');
  }
}

export function getDatabaseState() {
  return {
    host: mongoose.connection.host,
    name: mongoose.connection.name,
    readyState: mongoose.connection.readyState,
  };
}
