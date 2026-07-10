import { JOB_STATES } from '../constants/job.constants.js';
import { Job } from '../models/job.model.js';
import { ConfigService } from './config.service.js';

export class JobLeaseService {
  constructor(options = {}) {
    this.jobModel = options.jobModel || Job;
    this.configService = options.configService || new ConfigService(options);
    this.now = options.now || (() => new Date());
  }

  async getLeaseDurationMs() {
    const config = await this.configService.getConfig();
    return config.jobLeaseMs;
  }

  buildLeaseExpiry(leaseMs) {
    return new Date(this.now().getTime() + leaseMs);
  }

  async renewLease(jobId, workerId) {
    const leaseMs = await this.getLeaseDurationMs();

    return this.jobModel
      .findOneAndUpdate(
        {
          jobId,
          state: JOB_STATES.PROCESSING,
          claimedByWorkerId: workerId,
        },
        {
          $set: {
            leaseExpiresAt: this.buildLeaseExpiry(leaseMs),
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async releaseLease(jobId) {
    return this.jobModel
      .findOneAndUpdate(
        { jobId },
        {
          $set: {
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
}
