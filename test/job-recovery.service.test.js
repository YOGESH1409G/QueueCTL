import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { JobRecoveryService } from '../src/services/job-recovery.service.js';

function createQueryResult(value) {
  return {
    exec: async () => value,
  };
}

test('JobRecoveryService recovers jobs with expired leases', async () => {
  const calls = [];
  const recoveryService = new JobRecoveryService({
    now: () => new Date('2026-01-01T00:01:00.000Z'),
    configService: {
      getConfig: async () => ({
        stuckJobTimeoutMs: 45_000,
        jobLeaseMs: 30_000,
      }),
    },
    jobModel: {
      updateMany(query, update) {
        calls.push({ query, update });
        return createQueryResult({ modifiedCount: 2 });
      },
    },
  });

  const recovered = await recoveryService.recoverStuckJobs();

  assert.equal(recovered, 2);
  assert.equal(calls[0].query.state, JOB_STATES.PROCESSING);
  assert.equal(calls[0].query.$or[0].leaseExpiresAt.$lte.toISOString(), '2026-01-01T00:01:00.000Z');
  assert.equal(calls[0].update.$set.state, JOB_STATES.PENDING);
  assert.equal(calls[0].update.$set.claimedByWorkerId, null);
  assert.equal(calls[0].update.$set.leaseExpiresAt, null);
  assert.deepEqual(calls[0].update.$inc, { attempts: 1 });
});
