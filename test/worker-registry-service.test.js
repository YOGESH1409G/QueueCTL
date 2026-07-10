import test from 'node:test';
import assert from 'node:assert/strict';

import { WORKER_STATES } from '../src/constants/worker.constants.js';
import { WorkerRegistryService } from '../src/services/worker-registry.service.js';

function createQueryResult(value) {
  return {
    exec: async () => value,
  };
}

test('WorkerRegistryService marks a worker active', async () => {
  const calls = [];
  const registry = new WorkerRegistryService({
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    workerModel: {
      findOneAndUpdate(query, update, options) {
        calls.push({ query, update, options });
        return createQueryResult({ workerId: query.workerId, ...update.$set });
      },
    },
  });

  const worker = await registry.markWorkerStarted('worker-1', 1234);

  assert.equal(worker.workerId, 'worker-1');
  assert.equal(worker.state, WORKER_STATES.ACTIVE);
  assert.equal(calls[0].update.$setOnInsert.workerId, 'worker-1');
  assert.equal(calls[0].update.$set.pid, 1234);
  assert.equal(calls[0].options.upsert, true);
  assert.equal(calls[0].options.returnDocument, 'after');
});

test('WorkerRegistryService counts only fresh active workers', async () => {
  const registry = new WorkerRegistryService({
    now: () => new Date('2026-01-01T00:00:20.000Z'),
    staleMs: 15000,
    workerModel: {
      countDocuments(query) {
        assert.equal(query.state, WORKER_STATES.ACTIVE);
        assert.equal(query.lastHeartbeatAt.$gte.toISOString(), '2026-01-01T00:00:05.000Z');
        return createQueryResult(2);
      },
    },
  });

  const count = await registry.countActiveWorkers();

  assert.equal(count, 2);
});

