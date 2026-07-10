import mongoose from 'mongoose';

import {
  DEFAULT_BACKOFF_BASE,
  DEFAULT_CONFIG_KEY,
  DEFAULT_JOB_LEASE_MS,
  DEFAULT_JOB_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_JITTER_MS,
  DEFAULT_STUCK_JOB_TIMEOUT_MS,
  MAX_JOB_LEASE_MS,
} from '../constants/config.constants.js';

const { Schema, model, models } = mongoose;

const configSchema = new Schema(
  {
    configKey: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      default: DEFAULT_CONFIG_KEY,
    },
    maxRetries: {
      type: Number,
      required: true,
      default: DEFAULT_MAX_RETRIES,
      min: [0, 'maxRetries cannot be negative.'],
      validate: {
        validator: Number.isInteger,
        message: 'maxRetries must be an integer.',
      },
    },
    backoffBase: {
      type: Number,
      required: true,
      default: DEFAULT_BACKOFF_BASE,
      min: [1, 'backoffBase must be at least 1.'],
      validate: {
        validator: Number.isInteger,
        message: 'backoffBase must be an integer.',
      },
    },
    retryJitterMs: {
      type: Number,
      required: true,
      default: DEFAULT_RETRY_JITTER_MS,
      min: [0, 'retryJitterMs cannot be negative.'],
      validate: {
        validator: Number.isInteger,
        message: 'retryJitterMs must be an integer.',
      },
    },
    defaultJobTimeoutMs: {
      type: Number,
      required: true,
      default: DEFAULT_JOB_TIMEOUT_MS,
      min: [0, 'defaultJobTimeoutMs cannot be negative.'],
      validate: {
        validator: Number.isInteger,
        message: 'defaultJobTimeoutMs must be an integer.',
      },
    },
    stuckJobTimeoutMs: {
      type: Number,
      required: true,
      default: DEFAULT_STUCK_JOB_TIMEOUT_MS,
      min: [1000, 'stuckJobTimeoutMs must be at least 1000ms.'],
      validate: {
        validator: Number.isInteger,
        message: 'stuckJobTimeoutMs must be an integer.',
      },
    },
    jobLeaseMs: {
      type: Number,
      required: true,
      default: DEFAULT_JOB_LEASE_MS,
      min: [5000, 'jobLeaseMs must be at least 5000ms.'],
      max: [MAX_JOB_LEASE_MS, 'jobLeaseMs cannot exceed 55000ms.'],
      validate: {
        validator: Number.isInteger,
        message: 'jobLeaseMs must be an integer.',
      },
    },
  },
  {
    collection: 'configs',
    timestamps: true,
    versionKey: false,
  }
);

configSchema.index(
  { configKey: 1 },
  {
    unique: true,
    partialFilterExpression: { configKey: { $exists: true } },
  }
);
configSchema.index({ updatedAt: -1 });

export const Config = models.Config || model('Config', configSchema);
