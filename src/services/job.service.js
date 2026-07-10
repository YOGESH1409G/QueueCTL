import { randomUUID } from 'node:crypto';

import {
  JOB_PRIORITIES,
  JOB_PRIORITY_RANK,
  JOB_PRIORITY_VALUES,
  JOB_STATES,
  JOB_STATE_VALUES,
} from '../constants/job.constants.js';
import { Job } from '../models/job.model.js';
import { ConfigService } from './config.service.js';

const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

const ALLOWED_JOB_UPDATES = new Set([
  'state',
  'attempts',
  'maxRetries',
  'nextRetryAt',
  'output',
  'error',
  'startedAt',
  'completedAt',
]);

function removeUndefinedValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
}

function assertValidJobState(state) {
  if (state !== undefined && !JOB_STATE_VALUES.includes(state)) {
    throw new Error(`state must be one of: ${JOB_STATE_VALUES.join(', ')}.`);
  }
}

function normalizePriority(priority = JOB_PRIORITIES.MEDIUM) {
  const normalized = String(priority).trim().toUpperCase();

  if (!JOB_PRIORITY_VALUES.includes(normalized)) {
    throw new Error(`priority must be one of: ${JOB_PRIORITY_VALUES.join(', ')}.`);
  }

  return normalized;
}

function normalizeOptionalInteger(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsedValue;
}

function normalizeRunAt(value) {
  if (!value) {
    return new Date();
  }

  const runAt = new Date(value);

  if (Number.isNaN(runAt.getTime())) {
    throw new Error('runAt must be a valid ISO date.');
  }

  return runAt;
}

function buildJobFilter(filters = {}) {
  assertValidJobState(filters.state);

  return removeUndefinedValues({
    state: filters.state,
    jobId: filters.jobId,
    createdAt: filters.createdAt,
  });
}

function normalizeListOptions(options = {}) {
  const limit = Math.min(
    Math.max(Number.parseInt(options.limit, 10) || DEFAULT_LIST_LIMIT, 1),
    MAX_LIST_LIMIT
  );
  const skip = Math.max(Number.parseInt(options.skip, 10) || 0, 0);
  const sort = options.sort || { createdAt: -1 };

  return { limit, skip, sort };
}

function pickAllowedUpdates(updates) {
  return Object.fromEntries(
    Object.entries(removeUndefinedValues(updates || {})).filter(([key]) =>
      ALLOWED_JOB_UPDATES.has(key)
    )
  );
}

export async function createJob(payload) {
  assertNonEmptyString(payload?.command, 'command');

  const config = await new ConfigService().getConfig();
  const priority = normalizePriority(payload.priority);
  const timeout = normalizeOptionalInteger(payload.timeout, 'timeout') || config.defaultJobTimeoutMs || null;
  const runAt = normalizeRunAt(payload.runAt);

  const job = await Job.create({
    jobId: randomUUID(),
    command: payload.command.trim(),
    state: JOB_STATES.PENDING,
    priority,
    priorityRank: JOB_PRIORITY_RANK[priority],
    timeout,
    runAt,
    attempts: 0,
    maxRetries: config.maxRetries,
    nextRetryAt: runAt,
  });

  return job;
}

export async function getJobById(jobId) {
  assertNonEmptyString(jobId, 'jobId');

  return Job.findOne({ jobId }).exec();
}

export async function listJobs(filters = {}, options = {}) {
  const query = buildJobFilter(filters);
  const { limit, skip, sort } = normalizeListOptions(options);

  return Job.find(query).sort(sort).skip(skip).limit(limit).exec();
}

export async function updateJob(jobId, updates) {
  assertNonEmptyString(jobId, 'jobId');
  assertValidJobState(updates?.state);

  const updatePayload = pickAllowedUpdates(updates);

  if (Object.keys(updatePayload).length === 0) {
    throw new Error('updateJob requires at least one valid mutable field.');
  }

  return Job.findOneAndUpdate(
    { jobId },
    { $set: updatePayload },
    {
      returnDocument: 'after',
      runValidators: true,
      context: 'query',
    }
  ).exec();
}

export async function purgeJobs(filters = {}) {
  const query = buildJobFilter(filters);
  return Job.deleteMany(query).exec();
}
