import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { serializeJobsForJson } from '../src/commands/list.command.js';

test('serializeJobsForJson returns a machine-readable job array', () => {
  const payload = serializeJobsForJson([
    {
      jobId: 'job-1',
      command: 'echo hi',
      state: JOB_STATES.COMPLETED,
      priority: 'HIGH',
      attempts: 0,
      maxRetries: 2,
      executionDuration: 12,
      timedOut: false,
      exitCode: 0,
      error: null,
      claimedByWorkerId: null,
      leaseExpiresAt: null,
      nextRetryAt: new Date('2026-01-01T00:00:00.000Z'),
      runAt: null,
      startedAt: new Date('2026-01-01T00:00:01.000Z'),
      completedAt: new Date('2026-01-01T00:00:02.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:02.000Z'),
    },
  ]);

  assert.equal(payload.length, 1);
  assert.equal(payload[0].jobId, 'job-1');
  assert.equal(payload[0].state, JOB_STATES.COMPLETED);
  assert.equal(payload[0].completedAt, '2026-01-01T00:00:02.000Z');
});

test('serializeJobsForJson can be written as pure JSON stdout', () => {
  const output = JSON.stringify(serializeJobsForJson([]));

  assert.equal(output, '[]');
});
