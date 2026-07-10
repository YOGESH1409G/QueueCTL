import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { RetryService } from '../src/services/retry.service.js';

function createQueryResult(value) {
  return {
    exec: async () => value,
  };
}

function createJobModel(calls) {
  return {
    findOneAndUpdate(query, update, options) {
      calls.push({ query, update, options });

      return createQueryResult({
        jobId: query.jobId,
        ...update.$set,
      });
    },
  };
}

test('shouldRetry allows retries while attempts are within maxRetries', () => {
  const retryService = new RetryService();

  assert.equal(retryService.shouldRetry({ attempts: 2, maxRetries: 3 }), true);
  assert.equal(retryService.shouldRetry({ attempts: 4, maxRetries: 3 }), false);
});

test('calculateBackoff returns base raised to attempts', () => {
  const retryService = new RetryService();

  assert.equal(retryService.calculateBackoff(3, 2), 8);
  assert.equal(retryService.calculateBackoff(2, 5), 25);
});

test('scheduleRetry stores pending state and nextRetryAt in MongoDB', async () => {
  const calls = [];
  const retryService = new RetryService({
    configService: {
      getConfig: async () => ({
        backoffBase: 2,
        retryJitterMs: 0,
      }),
    },
    jobModel: createJobModel(calls),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const job = await retryService.scheduleRetry({
    jobId: 'job-1',
    attempts: 3,
  });

  assert.equal(job.state, JOB_STATES.PENDING);
  assert.equal(job.nextRetryAt.toISOString(), '2026-01-01T00:00:08.000Z');
  assert.equal(calls[0].query.jobId, 'job-1');
  assert.equal(calls[0].update.$set.state, JOB_STATES.PENDING);
  assert.equal(calls[0].update.$set.startedAt, null);
  assert.equal(calls[0].update.$set.completedAt, null);
});

test('moveToDLQ stores dead state in MongoDB', async () => {
  const calls = [];
  const retryService = new RetryService({
    jobModel: createJobModel(calls),
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  const job = await retryService.moveToDLQ({
    jobId: 'job-2',
  });

  assert.equal(job.state, JOB_STATES.DEAD);
  assert.equal(job.nextRetryAt, null);
  assert.equal(job.completedAt.toISOString(), '2026-01-01T00:00:00.000Z');
});
