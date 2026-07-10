import { JOB_STATES } from '../constants/job.constants.js';
import { Job } from '../models/job.model.js';
import { listJobs } from './job.service.js';

export async function listDeadJobs(options = {}) {
  return listJobs(
    { state: JOB_STATES.DEAD },
    {
      limit: options.limit,
      skip: options.skip,
      sort: { updatedAt: -1 },
    }
  );
}

export async function retryDeadJob(jobId) {
  const job = await Job.findOneAndUpdate(
    {
      jobId,
      state: JOB_STATES.DEAD,
    },
    {
      $set: {
        state: JOB_STATES.PENDING,
        attempts: 0,
        nextRetryAt: new Date(),
        error: null,
        completedAt: null,
        startedAt: null,
        claimedByWorkerId: null,
        leaseExpiresAt: null,
      },
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  ).exec();

  if (!job) {
    throw new Error(`No dead job found with id: ${jobId}`);
  }

  return job;
}
