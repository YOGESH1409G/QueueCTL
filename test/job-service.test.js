import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { Config } from '../src/models/config.model.js';
import { Job } from '../src/models/job.model.js';
import { createJob } from '../src/services/job.service.js';

function mockLatestConfig(testContext, config) {
  testContext.mock.method(Config, 'findOne', () => ({
    lean() {
      return {
        exec: async () => config,
      };
    },
  }));
}

test('createJob creates a pending job with producer defaults', async (testContext) => {
  mockLatestConfig(testContext, { maxRetries: 5 });

  testContext.mock.method(Job, 'create', async (payload) => payload);

  const job = await createJob({ command: '  echo Hello  ' });

  assert.equal(job.command, 'echo Hello');
  assert.equal(job.state, JOB_STATES.PENDING);
  assert.equal(job.attempts, 0);
  assert.equal(job.maxRetries, 5);
  assert.ok(job.nextRetryAt instanceof Date);
  assert.equal(typeof job.jobId, 'string');
  assert.ok(job.jobId.length > 0);
});

test('createJob falls back to default maxRetries when config is missing', async (testContext) => {
  mockLatestConfig(testContext, null);

  testContext.mock.method(Job, 'create', async (payload) => payload);

  const job = await createJob({ command: 'echo Hello' });

  assert.equal(job.maxRetries, 3);
});

test('createJob rejects an empty command before writing to the database', async (testContext) => {
  mockLatestConfig(testContext, { maxRetries: 5 });

  const createMock = testContext.mock.method(Job, 'create', async (payload) => payload);

  await assert.rejects(() => createJob({ command: '   ' }), /command must be a non-empty string/);
  assert.equal(createMock.mock.callCount(), 0);
});
