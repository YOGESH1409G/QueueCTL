import { JOB_STATES } from '../constants/job.constants.js';
import { Job } from '../models/job.model.js';
import { ConfigService } from './config.service.js';

export class RetryService {
  constructor(options = {}) {
    this.configService = options.configService || new ConfigService(options);
    this.jobModel = options.jobModel || Job;
    this.now = options.now || (() => new Date());
  }

  shouldRetry(job) {
    return job.attempts <= job.maxRetries;
  }

  calculateBackoff(attempts, base) {
    return Math.pow(base, attempts);
  }

  calculateJitter(maxJitterMs) {
    if (!maxJitterMs) {
      return 0;
    }

    return Math.floor(Math.random() * (maxJitterMs + 1));
  }

  async scheduleRetry(job) {
    const config = await this.configService.getConfig();
    const delaySeconds = this.calculateBackoff(job.attempts, config.backoffBase);
    const jitterMs = this.calculateJitter(config.retryJitterMs);
    const nextRetryAt = new Date(this.now().getTime() + delaySeconds * 1000 + jitterMs);

    return this.jobModel
      .findOneAndUpdate(
        { jobId: job.jobId },
        {
          $set: {
            state: JOB_STATES.PENDING,
            nextRetryAt,
            startedAt: null,
            completedAt: null,
            claimedByWorkerId: null,
            leaseExpiresAt: null,
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async moveToDLQ(job) {
    return this.jobModel
      .findOneAndUpdate(
        { jobId: job.jobId },
        {
          $set: {
            state: JOB_STATES.DEAD,
            nextRetryAt: null,
            completedAt: this.now(),
            claimedByWorkerId: null,
            leaseExpiresAt: null,
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async getBackoffBase() {
    const config = await this.configService.getConfig();

    return config.backoffBase;
  }
}
