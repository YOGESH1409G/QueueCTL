import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { StatusService } from '../src/services/status.service.js';

function createAggregateResult(results) {
  return {
    exec: async () => results,
  };
}

test('StatusService returns counts for required job states and active workers', async () => {
  const statusService = new StatusService({
    jobModel: {
      aggregate(pipeline) {
        assert.deepEqual(pipeline[0].$match.state.$in, [
          JOB_STATES.PENDING,
          JOB_STATES.PROCESSING,
          JOB_STATES.COMPLETED,
          JOB_STATES.FAILED,
          JOB_STATES.DEAD,
        ]);

        return createAggregateResult([
          { _id: JOB_STATES.PENDING, count: 2 },
          { _id: JOB_STATES.COMPLETED, count: 5 },
          { _id: JOB_STATES.DEAD, count: 1 },
        ]);
      },
    },
    workerRegistryService: {
      countActiveWorkers: async () => 3,
      listActiveWorkers: async () => [
        {
          workerId: 'worker-1',
          runtimeState: 'idle',
        },
      ],
    },
  });

  const status = await statusService.getStatus();

  assert.deepEqual(status, {
    jobs: {
      [JOB_STATES.PENDING]: 2,
      [JOB_STATES.PROCESSING]: 0,
      [JOB_STATES.COMPLETED]: 5,
      [JOB_STATES.FAILED]: 0,
      [JOB_STATES.DEAD]: 1,
    },
    activeWorkers: 3,
    workers: [
      {
        workerId: 'worker-1',
        runtimeState: 'idle',
      },
    ],
  });
});
