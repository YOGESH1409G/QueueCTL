export const DEFAULT_CONFIG_KEY = 'default';
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BACKOFF_BASE = 2;
export const DEFAULT_RETRY_JITTER_MS = 1000;
export const DEFAULT_JOB_TIMEOUT_MS = 0;
export const DEFAULT_JOB_LEASE_MS = 30_000;
export const MAX_JOB_LEASE_MS = 55_000;
export const DEFAULT_STUCK_JOB_TIMEOUT_MS = 45_000;

export const CONFIG_FIELDS = Object.freeze([
  'maxRetries',
  'backoffBase',
  'retryJitterMs',
  'defaultJobTimeoutMs',
  'stuckJobTimeoutMs',
  'jobLeaseMs',
]);
