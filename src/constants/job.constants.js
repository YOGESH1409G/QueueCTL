export const JOB_STATES = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead',
  RETRYING: 'retrying',
});

export const TERMINAL_JOB_STATES = Object.freeze([
  JOB_STATES.COMPLETED,
  JOB_STATES.DEAD,
]);

export const ACTIVE_JOB_STATES = Object.freeze([
  JOB_STATES.PENDING,
  JOB_STATES.PROCESSING,
  JOB_STATES.RETRYING,
]);

export const JOB_STATE_VALUES = Object.freeze(Object.values(JOB_STATES));

export const JOB_PRIORITIES = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

export const JOB_PRIORITY_VALUES = Object.freeze(Object.values(JOB_PRIORITIES));

export const JOB_PRIORITY_RANK = Object.freeze({
  [JOB_PRIORITIES.HIGH]: 1,
  [JOB_PRIORITIES.MEDIUM]: 2,
  [JOB_PRIORITIES.LOW]: 3,
});
