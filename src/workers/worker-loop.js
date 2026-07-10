import { JOB_STATES } from '../constants/job.constants.js';
import { JOB_LEASE_RENEWAL_INTERVAL_MS } from '../constants/worker.constants.js';
import { Job } from '../models/job.model.js';
import { JobLeaseService } from '../services/job-lease.service.js';
import { JobOutputLogService } from '../services/job-output-log.service.js';
import { JobRecoveryService } from '../services/job-recovery.service.js';
import { RetryService } from '../services/retry.service.js';
import { logger } from '../utils/logger.js';
import { executeCommand } from './executor.js';

export const DEFAULT_WORKER_POLL_INTERVAL_MS = 1000;

function buildExecutionError(result) {
  if (result.timedOut) {
    return `Command timed out after ${result.executionDuration}ms`;
  }

  const stderr = result.stderr?.trim();

  if (stderr) {
    return `Command exited with code ${result.exitCode}: ${stderr}`;
  }

  return `Command exited with code ${result.exitCode}`;
}

export class WorkerLoop {
  constructor(options = {}) {
    this.workerId = options.workerId || 'worker-1';
    this.jobModel = options.jobModel || Job;
    this.executor = options.executor || executeCommand;
    this.logger = options.logger || logger;
    this.outputLogService = options.outputLogService || new JobOutputLogService();
    this.recoveryService = options.recoveryService || new JobRecoveryService({ jobModel: this.jobModel });
    this.leaseService = options.leaseService || new JobLeaseService({ jobModel: this.jobModel });
    this.onJobStart = options.onJobStart || (async () => {});
    this.onJobFinish = options.onJobFinish || (async () => {});
    this.shouldStop = options.shouldStop || (async () => false);
    this.retryService =
      options.retryService || new RetryService({ jobModel: this.jobModel });
    this.pollIntervalMs = options.pollIntervalMs || DEFAULT_WORKER_POLL_INTERVAL_MS;
    this.isRunning = false;
    this.startPromise = null;
    this.pendingDelay = null;
    this.leaseRenewalIntervalId = null;
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.isRunning = true;
    this.startPromise = this.run();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async run() {
    this.logger.info(`Worker polling every ${this.pollIntervalMs}ms`);
    const recoveredCount = await this.recoveryService.recoverStuckJobs();

    if (recoveredCount > 0) {
      this.logger.warn(`Recovered ${recoveredCount} stale processing job(s)`);
    }

    try {
      while (this.isRunning) {
        if (await this.shouldStop()) {
          this.logger.info('Stop requested. Finishing after current work...');
          this.stop();
          break;
        }

        await this.recoverStaleJobsIfNeeded();
        await this.processNextJob();

        if (this.isRunning) {
          await this.waitForNextPoll();
        }
      }
    } finally {
      this.stopLeaseRenewal();
      this.isRunning = false;
    }
  }

  async recoverStaleJobsIfNeeded() {
    const recoveredCount = await this.recoveryService.recoverStuckJobs();

    if (recoveredCount > 0) {
      this.logger.warn(`Recovered ${recoveredCount} stale processing job(s)`);
    }
  }

  stop() {
    this.isRunning = false;
    this.interruptDelay();
  }

  startLeaseRenewal(jobId) {
    this.stopLeaseRenewal();

    this.leaseRenewalIntervalId = setInterval(() => {
      this.leaseService.renewLease(jobId, this.workerId).catch((error) => {
        this.logger.warn(`Lease renewal failed for ${jobId}: ${error.message}`);
      });
    }, JOB_LEASE_RENEWAL_INTERVAL_MS);
  }

  stopLeaseRenewal() {
    if (!this.leaseRenewalIntervalId) {
      return;
    }

    clearInterval(this.leaseRenewalIntervalId);
    this.leaseRenewalIntervalId = null;
  }

  waitForNextPoll() {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingDelay = null;
        resolve();
      }, this.pollIntervalMs);

      this.pendingDelay = {
        resolve,
        timeoutId,
      };
    });
  }

  interruptDelay() {
    if (!this.pendingDelay) {
      return;
    }

    clearTimeout(this.pendingDelay.timeoutId);
    this.pendingDelay.resolve();
    this.pendingDelay = null;
  }

  async claimNextJob() {
    const now = new Date();
    const leaseMs = await this.leaseService.getLeaseDurationMs();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);

    const job = await this.jobModel
      .findOneAndUpdate(
        {
          state: JOB_STATES.PENDING,
          nextRetryAt: { $lte: now },
          $or: [{ runAt: null }, { runAt: { $lte: now } }],
        },
        {
          $set: {
            state: JOB_STATES.PROCESSING,
            startedAt: now,
            error: null,
            claimedByWorkerId: this.workerId,
            leaseExpiresAt,
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
          sort: { priorityRank: 1, createdAt: 1 },
        }
      )
      .exec();

    if (job) {
      this.logger.info(`Claimed job ${job.jobId}`);
    }

    return job;
  }

  async processNextJob() {
    const job = await this.claimNextJob();

    if (!job) {
      return null;
    }

    this.logger.info(`Processing job ${job.jobId}`);
    this.startLeaseRenewal(job.jobId);
    await this.onJobStart(job);

    try {
      const result = await this.executor(job.command, { timeout: job.timeout });
      let persistedJob;

      if (result.exitCode === 0) {
        const completedJob = await this.markJobCompleted(job, result);
        this.logger.success(`Job completed ${job.jobId}`);
        persistedJob = completedJob;
      } else {
        persistedJob = await this.handleFailedJob(job, result);
      }

      return persistedJob;
    } finally {
      this.stopLeaseRenewal();
      await this.onJobFinish(job);
    }
  }

  clearLeaseFields() {
    return {
      claimedByWorkerId: null,
      leaseExpiresAt: null,
    };
  }

  async markJobCompleted(job, result) {
    const logFilePath = this.outputLogService.getLogFilePath(job);

    const updatedJob = await this.jobModel
      .findOneAndUpdate(
        { jobId: job.jobId },
        {
          $set: {
            state: JOB_STATES.COMPLETED,
            completedAt: new Date(),
            output: result.stdout,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionDuration: result.executionDuration,
            timedOut: Boolean(result.timedOut),
            logFilePath,
            error: null,
            ...this.clearLeaseFields(),
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();

    await this.outputLogService.writeJobLog(job, result, JOB_STATES.COMPLETED);
    return updatedJob;
  }

  async handleFailedJob(job, result) {
    const failedJob = await this.recordFailedAttempt(job, result);

    if (this.retryService.shouldRetry(failedJob)) {
      const retriedJob = await this.retryService.scheduleRetry(failedJob);
      this.logger.warn(
        `Job ${job.jobId} failed with exit code ${result.exitCode}; retry scheduled for ${retriedJob.nextRetryAt.toISOString()}`
      );
      return retriedJob;
    }

    const deadJob = await this.retryService.moveToDLQ(failedJob);
    this.logger.error(`Job ${job.jobId} moved to DLQ after ${failedJob.attempts} attempts`);
    return deadJob;
  }

  async recordFailedAttempt(job, result) {
    const logFilePath = this.outputLogService.getLogFilePath(job);

    const updatedJob = await this.jobModel
      .findOneAndUpdate(
        { jobId: job.jobId },
        {
          $set: {
            state: JOB_STATES.FAILED,
            output: result.stdout,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionDuration: result.executionDuration,
            timedOut: Boolean(result.timedOut),
            logFilePath,
            error: buildExecutionError(result),
            ...this.clearLeaseFields(),
          },
          $inc: {
            attempts: 1,
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();

    await this.outputLogService.writeJobLog(job, result, JOB_STATES.FAILED);
    return updatedJob;
  }
}
