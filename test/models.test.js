import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { Config } from '../src/models/config.model.js';
import { Job } from '../src/models/job.model.js';

test('Job model validates required fields and defaults', async () => {
  const job = new Job({
    jobId: 'job-test-1',
    command: 'node scripts/example.js',
  });

  await job.validate();

  assert.equal(job.state, JOB_STATES.PENDING);
  assert.equal(job.attempts, 0);
  assert.equal(job.maxRetries, 3);
});

test('Job model rejects invalid state values', async () => {
  const job = new Job({
    jobId: 'job-test-2',
    command: 'node scripts/example.js',
    state: 'unknown',
  });

  await assert.rejects(() => job.validate(), /state must be one of/);
});

test('Job model accepts the dead-letter state', async () => {
  const job = new Job({
    jobId: 'job-test-dead',
    command: 'node scripts/example.js',
    state: JOB_STATES.DEAD,
  });

  await job.validate();

  assert.equal(job.state, JOB_STATES.DEAD);
});

test('Config model validates retry configuration defaults', async () => {
  const config = new Config();

  await config.validate();

  assert.equal(config.configKey, 'default');
  assert.equal(config.maxRetries, 3);
  assert.equal(config.backoffBase, 2);
});

test('Config model rejects invalid retry configuration', async () => {
  const config = new Config({
    maxRetries: -1,
    backoffBase: 0,
  });

  await assert.rejects(() => config.validate(), /maxRetries cannot be negative/);
});
