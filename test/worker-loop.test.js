import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { WorkerLoop } from '../src/workers/worker-loop.js';

function createSilentLogger() {
  return {
    info() {},
    success() {},
    warn() {},
    error() {},
  };
}

function createNoopRecoveryService() {
  return {
    recoverStuckJobs: async () => 0,
  };
}

function createNoopOutputLogService() {
  return {
    getLogFilePath: () => 'logs/test-job.log',
    writeJobLog: async () => 'logs/test-job.log',
  };
}

function createMockLeaseService() {
  return {
    getLeaseDurationMs: async () => 30_000,
    renewLease: async () => null,
  };
}

function createMockJobModel(claimedJob, calls) {
  return {
    findOneAndUpdate(query, update, options) {
      calls.push({ query, update, options });

      return {
        exec: async () => {
          if (calls.length === 1) {
            return claimedJob;
          }

          return {
            ...claimedJob,
            ...update.$set,
            attempts: claimedJob.attempts + (update.$inc?.attempts || 0),
          };
        },
      };
    },
  };
}

test('claimNextJob atomically moves one pending job to processing', async () => {
  const calls = [];
  const claimedJob = {
    jobId: 'job-1',
    command: 'echo hello',
    attempts: 0,
  };
  const workerLoop = new WorkerLoop({
    jobModel: createMockJobModel(claimedJob, calls),
    logger: createSilentLogger(),
    recoveryService: createNoopRecoveryService(),
    outputLogService: createNoopOutputLogService(),
    leaseService: createMockLeaseService(),
  });

  const job = await workerLoop.claimNextJob();

  assert.equal(job.jobId, 'job-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query.state, JOB_STATES.PENDING);
  assert.deepEqual(Object.keys(calls[0].query), ['state', 'nextRetryAt', '$or']);
  assert.ok(calls[0].query.nextRetryAt.$lte instanceof Date);
  assert.deepEqual(calls[0].query.$or[0], { runAt: null });
  assert.equal(calls[0].update.$set.state, JOB_STATES.PROCESSING);
  assert.ok(calls[0].update.$set.startedAt instanceof Date);
  assert.equal(calls[0].update.$set.claimedByWorkerId, 'worker-1');
  assert.ok(calls[0].update.$set.leaseExpiresAt instanceof Date);
  assert.equal(calls[0].options.returnDocument, 'after');
  assert.deepEqual(calls[0].options.sort, { priorityRank: 1, createdAt: 1 });
});

test('processNextJob marks a successful job as completed', async () => {
  const calls = [];
  const claimedJob = {
    jobId: 'job-2',
    command: 'echo hello',
    attempts: 0,
  };
  const workerLoop = new WorkerLoop({
    jobModel: createMockJobModel(claimedJob, calls),
    executor: async () => ({
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
    }),
    logger: createSilentLogger(),
    recoveryService: createNoopRecoveryService(),
    outputLogService: createNoopOutputLogService(),
    leaseService: createMockLeaseService(),
  });

  const job = await workerLoop.processNextJob();

  assert.equal(job.state, JOB_STATES.COMPLETED);
  assert.equal(job.output, 'hello\n');
  assert.equal(job.error, null);
  assert.equal(calls[1].update.$set.state, JOB_STATES.COMPLETED);
  assert.ok(calls[1].update.$set.completedAt instanceof Date);
});

test('processNextJob schedules retry when retries are available', async () => {
  const calls = [];
  const claimedJob = {
    jobId: 'job-3',
    command: 'exit 1',
    attempts: 0,
  };
  const workerLoop = new WorkerLoop({
    jobModel: createMockJobModel(claimedJob, calls),
    executor: async () => ({
      stdout: '',
      stderr: 'boom\n',
      exitCode: 1,
    }),
    retryService: {
      shouldRetry(job) {
        return job.attempts <= 3;
      },
      async scheduleRetry(job) {
        return {
          ...job,
          state: JOB_STATES.PENDING,
          nextRetryAt: new Date('2026-01-01T00:00:02.000Z'),
        };
      },
      async moveToDLQ() {
        throw new Error('moveToDLQ should not be called');
      },
    },
    logger: createSilentLogger(),
    recoveryService: createNoopRecoveryService(),
    outputLogService: createNoopOutputLogService(),
    leaseService: createMockLeaseService(),
  });

  const job = await workerLoop.processNextJob();

  assert.equal(job.state, JOB_STATES.PENDING);
  assert.equal(job.error, 'Command exited with code 1: boom');
  assert.equal(job.attempts, 1);
  assert.equal(calls[1].update.$set.state, JOB_STATES.FAILED);
  assert.deepEqual(calls[1].update.$inc, { attempts: 1 });
});

test('processNextJob moves a failed job to DLQ when retries are exhausted', async () => {
  const calls = [];
  const claimedJob = {
    jobId: 'job-4',
    command: 'exit 1',
    attempts: 3,
  };
  const workerLoop = new WorkerLoop({
    jobModel: createMockJobModel(claimedJob, calls),
    executor: async () => ({
      stdout: '',
      stderr: 'done\n',
      exitCode: 1,
    }),
    retryService: {
      shouldRetry() {
        return false;
      },
      async scheduleRetry() {
        throw new Error('scheduleRetry should not be called');
      },
      async moveToDLQ(job) {
        return {
          ...job,
          state: JOB_STATES.DEAD,
          nextRetryAt: null,
        };
      },
    },
    logger: createSilentLogger(),
    recoveryService: createNoopRecoveryService(),
    outputLogService: createNoopOutputLogService(),
    leaseService: createMockLeaseService(),
  });

  const job = await workerLoop.processNextJob();

  assert.equal(job.state, JOB_STATES.DEAD);
  assert.equal(job.nextRetryAt, null);
  assert.equal(job.attempts, 4);
});

test('stop lets the active job finish and persist completion', async () => {
  const calls = [];
  let finishExecution;
  let startPromise;
  let resolveExecutionStarted;
  const executionStarted = new Promise((resolve) => {
    resolveExecutionStarted = resolve;
  });

  const workerLoop = new WorkerLoop({
    jobModel: createMockJobModel(
      {
        jobId: 'job-5',
        command: 'sleepy command',
        attempts: 0,
      },
      calls
    ),
    executor: async () => {
      resolveExecutionStarted();

      return new Promise((finish) => {
        finishExecution = finish;
      });
    },
    logger: createSilentLogger(),
    recoveryService: createNoopRecoveryService(),
    outputLogService: createNoopOutputLogService(),
    leaseService: createMockLeaseService(),
    pollIntervalMs: 100000,
  });

  startPromise = workerLoop.start();

  await executionStarted;

  workerLoop.stop();
  finishExecution({
    stdout: 'done\n',
    stderr: '',
    exitCode: 0,
  });

  await startPromise;

  assert.equal(calls.length, 2);
  assert.equal(calls[1].update.$set.state, JOB_STATES.COMPLETED);
  assert.equal(calls[1].update.$set.output, 'done\n');
});

test('stop interrupts idle polling delay without claiming another job', async () => {
  const calls = [];
  const jobModel = {
    findOneAndUpdate(query, update, options) {
      calls.push({ query, update, options });

      return {
        exec: async () => null,
      };
    },
  };
  const workerLoop = new WorkerLoop({
    jobModel,
    logger: createSilentLogger(),
    recoveryService: createNoopRecoveryService(),
    outputLogService: createNoopOutputLogService(),
    leaseService: createMockLeaseService(),
    pollIntervalMs: 100000,
  });

  const startPromise = workerLoop.start();

  while (calls.length === 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }

  workerLoop.stop();
  await startPromise;

  assert.equal(calls.length, 1);
});
