import { jest } from '@jest/globals';

import { JOB_PRIORITIES, JOB_STATES } from '../src/constants/job.constants.js';
import { parseEnqueuePayload } from '../src/commands/enqueue.command.js';
import { retryDeadJob } from '../src/services/dlq.service.js';
import { MetricsService } from '../src/services/metrics.service.js';
import { RetryService } from '../src/services/retry.service.js';
import { executeCommand } from '../src/workers/executor.js';
import { Job } from '../src/models/job.model.js';
import { WorkerLoop } from '../src/workers/worker-loop.js';

function queryResult(value) {
  return { exec: jest.fn(async () => value) };
}

test('enqueue accepts timeout, priority, and runAt payloads', () => {
  const payload = parseEnqueuePayload(
    '{"command":"echo hi","timeout":5000,"priority":"HIGH","runAt":"2026-07-15T18:30:00Z"}'
  );

  expect(payload).toEqual({
    command: 'echo hi',
    timeout: 5000,
    priority: 'HIGH',
    runAt: '2026-07-15T18:30:00Z',
  });
});

test('retry service adds bounded jitter to exponential backoff', async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  const calls = [];
  const retryService = new RetryService({
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    configService: {
      getConfig: async () => ({ backoffBase: 2, retryJitterMs: 1000 }),
    },
    jobModel: {
      findOneAndUpdate(query, update) {
        calls.push({ query, update });
        return queryResult({ jobId: query.jobId, ...update.$set });
      },
    },
  });

  const job = await retryService.scheduleRetry({ jobId: 'job-1', attempts: 3 });

  expect(job.nextRetryAt.toISOString()).toBe('2026-01-01T00:00:08.500Z');
  expect(calls[0].update.$set.state).toBe(JOB_STATES.PENDING);
});

test('worker claim query prioritizes high priority and oldest jobs', async () => {
  const calls = [];
  const workerLoop = new WorkerLoop({
    logger: { info() {}, success() {}, warn() {}, error() {} },
    recoveryService: { recoverStuckJobs: async () => 0 },
    leaseService: { getLeaseDurationMs: async () => 30_000 },
    jobModel: {
      findOneAndUpdate(query, update, options) {
        calls.push({ query, update, options });
        return queryResult(null);
      },
    },
  });

  await workerLoop.claimNextJob();

  expect(calls[0].query.state).toBe(JOB_STATES.PENDING);
  expect(calls[0].query.$or).toBeDefined();
  expect(calls[0].options.sort).toEqual({ priorityRank: 1, createdAt: 1 });
});

test('priority constants preserve expected ordering', () => {
  expect(JOB_PRIORITIES.HIGH).toBe('HIGH');
  expect(JOB_PRIORITIES.MEDIUM).toBe('MEDIUM');
  expect(JOB_PRIORITIES.LOW).toBe('LOW');
});

test('executor times out long running commands', async () => {
  const result = await executeCommand('node -e "setTimeout(() => {}, 1000)"', {
    timeout: 50,
  });

  expect(result.timedOut).toBe(true);
  expect(result.exitCode).toBe(124);
  expect(result.executionDuration).toBeGreaterThanOrEqual(50);
});

test('DLQ retry resets a dead job to pending', async () => {
  const spy = jest.spyOn(Job, 'findOneAndUpdate').mockReturnValue(
    queryResult({
      jobId: 'dead-job',
      state: JOB_STATES.PENDING,
      attempts: 0,
    })
  );

  const job = await retryDeadJob('dead-job');

  expect(job.state).toBe(JOB_STATES.PENDING);
  expect(spy.mock.calls[0][0]).toEqual({ jobId: 'dead-job', state: JOB_STATES.DEAD });
});

test('metrics service calculates rates from job counts', async () => {
  const metricsService = new MetricsService({
    workerRegistryService: { countActiveWorkers: async () => 2 },
    jobModel: {
      aggregate(pipeline) {
        if (pipeline.some((stage) => stage.$group?.averageExecutionTime)) {
          return queryResult([
            {
              averageExecutionTime: 100,
              averageRetryCount: 1,
              longestRunningJob: 300,
              fastestJob: 50,
            },
          ]);
        }

        if (pipeline.some((stage) => stage.$sort)) {
          return queryResult([{ _id: 0, count: 2 }]);
        }

        return queryResult([
          { _id: JOB_STATES.COMPLETED, count: 8 },
          { _id: JOB_STATES.FAILED, count: 1 },
          { _id: JOB_STATES.DEAD, count: 1 },
        ]);
      },
      countDocuments() {
        return queryResult(4);
      },
    },
  });

  const metrics = await metricsService.getMetrics();

  expect(metrics.totalJobs).toBe(10);
  expect(metrics.successRate).toBe(80);
  expect(metrics.failureRate).toBe(20);
  expect(metrics.workerCount).toBe(2);
});
