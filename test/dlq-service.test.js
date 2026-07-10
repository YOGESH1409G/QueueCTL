import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { Job } from '../src/models/job.model.js';
import { retryDeadJob } from '../src/services/dlq.service.js';

test('retryDeadJob resets a dead job back to pending', async (testContext) => {
  testContext.mock.method(Job, 'findOneAndUpdate', (query, update, options) => {
    assert.deepEqual(query, {
      jobId: 'job-dead-1',
      state: JOB_STATES.DEAD,
    });
    assert.equal(update.$set.state, JOB_STATES.PENDING);
    assert.equal(update.$set.attempts, 0);
    assert.ok(update.$set.nextRetryAt instanceof Date);
    assert.equal(update.$set.error, null);
    assert.equal(update.$set.completedAt, null);
    assert.equal(options.returnDocument, 'after');

    return {
      exec: async () => ({
        jobId: 'job-dead-1',
        ...update.$set,
      }),
    };
  });

  const job = await retryDeadJob('job-dead-1');

  assert.equal(job.state, JOB_STATES.PENDING);
  assert.equal(job.attempts, 0);
});

test('retryDeadJob throws when the job is not in DLQ', async (testContext) => {
  testContext.mock.method(Job, 'findOneAndUpdate', () => ({
    exec: async () => null,
  }));

  await assert.rejects(() => retryDeadJob('missing'), /No dead job found/);
});
