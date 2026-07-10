import { JOB_STATES } from '../constants/job.constants.js';
import { Job } from '../models/job.model.js';
import { ConfigService } from './config.service.js';

export class JobRecoveryService {
  constructor(options = {}) {
    this.jobModel = options.jobModel || Job;
    this.configService = options.configService || new ConfigService(options);
    this.now = options.now || (() => new Date());
  }

  buildStaleProcessingQuery(config) {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - config.stuckJobTimeoutMs);

    return {
      state: JOB_STATES.PROCESSING,
      $or: [
        { leaseExpiresAt: { $lte: now } },
        { leaseExpiresAt: null, startedAt: { $lte: staleBefore } },
      ],
    };
  }

  async recoverStuckJobs() {
    const config = await this.configService.getConfig();

    const result = await this.jobModel
      .updateMany(
        this.buildStaleProcessingQuery(config),
        {
          $set: {
            state: JOB_STATES.PENDING,
            nextRetryAt: this.now(),
            error: 'Recovered stale processing job after worker crash or lease expiry.',
            startedAt: null,
            completedAt: null,
            claimedByWorkerId: null,
            leaseExpiresAt: null,
          },
          $inc: {
            attempts: 1,
          },
        },
        {
          runValidators: true,
        }
      )
      .exec();

    return result.modifiedCount || 0;
  }
}
