import {
  CONFIG_FIELDS,
  DEFAULT_BACKOFF_BASE,
  DEFAULT_CONFIG_KEY,
  DEFAULT_JOB_LEASE_MS,
  DEFAULT_JOB_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_JITTER_MS,
  DEFAULT_STUCK_JOB_TIMEOUT_MS,
  MAX_JOB_LEASE_MS,
} from '../constants/config.constants.js';
import { Config } from '../models/config.model.js';

const DEFAULT_CONFIG = Object.freeze({
  configKey: DEFAULT_CONFIG_KEY,
  maxRetries: DEFAULT_MAX_RETRIES,
  backoffBase: DEFAULT_BACKOFF_BASE,
  retryJitterMs: DEFAULT_RETRY_JITTER_MS,
  defaultJobTimeoutMs: DEFAULT_JOB_TIMEOUT_MS,
  stuckJobTimeoutMs: DEFAULT_STUCK_JOB_TIMEOUT_MS,
  jobLeaseMs: DEFAULT_JOB_LEASE_MS,
});

function parseInteger(value, fieldName) {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isInteger(parsedValue)) {
    throw new Error(`${fieldName} must be an integer.`);
  }

  return parsedValue;
}

function normalizeConfigUpdates(updates = {}) {
  const normalized = {};

  if (updates.maxRetries !== undefined) {
    normalized.maxRetries = parseInteger(updates.maxRetries, 'maxRetries');

    if (normalized.maxRetries < 0) {
      throw new Error('maxRetries cannot be negative.');
    }
  }

  if (updates.backoffBase !== undefined) {
    normalized.backoffBase = parseInteger(updates.backoffBase, 'backoffBase');

    if (normalized.backoffBase < 1) {
      throw new Error('backoffBase must be at least 1.');
    }
  }

  if (updates.retryJitterMs !== undefined) {
    normalized.retryJitterMs = parseInteger(updates.retryJitterMs, 'retryJitterMs');

    if (normalized.retryJitterMs < 0) {
      throw new Error('retryJitterMs cannot be negative.');
    }
  }

  if (updates.defaultJobTimeoutMs !== undefined) {
    normalized.defaultJobTimeoutMs = parseInteger(
      updates.defaultJobTimeoutMs,
      'defaultJobTimeoutMs'
    );

    if (normalized.defaultJobTimeoutMs < 0) {
      throw new Error('defaultJobTimeoutMs cannot be negative.');
    }
  }

  if (updates.stuckJobTimeoutMs !== undefined) {
    normalized.stuckJobTimeoutMs = parseInteger(
      updates.stuckJobTimeoutMs,
      'stuckJobTimeoutMs'
    );

    if (normalized.stuckJobTimeoutMs < 1000) {
      throw new Error('stuckJobTimeoutMs must be at least 1000.');
    }
  }

  if (updates.jobLeaseMs !== undefined) {
    normalized.jobLeaseMs = parseInteger(updates.jobLeaseMs, 'jobLeaseMs');

    if (normalized.jobLeaseMs < 5000) {
      throw new Error('jobLeaseMs must be at least 5000.');
    }

    if (normalized.jobLeaseMs > MAX_JOB_LEASE_MS) {
      throw new Error(`jobLeaseMs cannot exceed ${MAX_JOB_LEASE_MS}.`);
    }
  }

  return normalized;
}

function serializeConfig(config, source) {
  return {
    configKey: config.configKey || DEFAULT_CONFIG_KEY,
    maxRetries: config.maxRetries,
    backoffBase: config.backoffBase,
    retryJitterMs: config.retryJitterMs,
    defaultJobTimeoutMs: config.defaultJobTimeoutMs,
    stuckJobTimeoutMs: config.stuckJobTimeoutMs,
    jobLeaseMs: config.jobLeaseMs ?? DEFAULT_JOB_LEASE_MS,
    source,
    createdAt: config.createdAt || null,
    updatedAt: config.updatedAt || null,
  };
}

export class ConfigService {
  constructor(options = {}) {
    this.configModel = options.configModel || Config;
  }

  async getConfig() {
    const config = await this.configModel
      .findOne({ configKey: DEFAULT_CONFIG_KEY })
      .lean()
      .exec();

    if (!config) {
      return serializeConfig(DEFAULT_CONFIG, 'defaults');
    }

    return serializeConfig(config, 'database');
  }

  async setConfig(updates) {
    const normalized = normalizeConfigUpdates(updates);

    if (Object.keys(normalized).length === 0) {
      throw new Error(`config set requires at least one field: ${CONFIG_FIELDS.join(', ')}.`);
    }

    const config = await this.configModel
      .findOneAndUpdate(
        { configKey: DEFAULT_CONFIG_KEY },
        {
          $set: normalized,
          $setOnInsert: { configKey: DEFAULT_CONFIG_KEY },
        },
        {
          upsert: true,
          returnDocument: 'after',
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      )
      .exec();

    return serializeConfig(config, 'database');
  }
}
