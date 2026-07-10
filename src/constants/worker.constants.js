export const WORKER_STATES = Object.freeze({
  ACTIVE: 'active',
  STOPPED: 'stopped',
});

export const WORKER_STATE_VALUES = Object.freeze(Object.values(WORKER_STATES));

export const WORKER_RUNTIME_STATES = Object.freeze({
  IDLE: 'idle',
  BUSY: 'busy',
});

export const WORKER_RUNTIME_STATE_VALUES = Object.freeze(
  Object.values(WORKER_RUNTIME_STATES)
);

export const WORKER_HEARTBEAT_INTERVAL_MS = 5000;
export const WORKER_HEARTBEAT_STALE_MS = 15000;
export const JOB_LEASE_RENEWAL_INTERVAL_MS = 10_000;
export const MAX_RECOVERY_DELAY_MS = 60_000;
export const WORKER_CONTROL_DIR = '.queuectl';
export const WORKER_PID_FILENAME = 'worker.pid';
