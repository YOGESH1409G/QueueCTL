import { JOB_STATES } from '../constants/job.constants.js';
import { Job } from '../models/job.model.js';
import { WorkerRegistryService } from './worker-registry.service.js';

const STATUS_JOB_STATES = Object.freeze([
  JOB_STATES.PENDING,
  JOB_STATES.PROCESSING,
  JOB_STATES.COMPLETED,
  JOB_STATES.FAILED,
  JOB_STATES.DEAD,
]);

export { STATUS_JOB_STATES };

function createEmptyJobCounts() {
  return Object.fromEntries(STATUS_JOB_STATES.map((state) => [state, 0]));
}

export class StatusService {
  constructor(options = {}) {
    this.jobModel = options.jobModel || Job;
    this.workerRegistryService =
      options.workerRegistryService || new WorkerRegistryService(options);
  }

  async getStatus() {
    const [jobCounts, activeWorkers, workers] = await Promise.all([
      this.getJobCounts(),
      this.workerRegistryService.countActiveWorkers(),
      this.workerRegistryService.listActiveWorkers(),
    ]);

    return {
      jobs: jobCounts,
      activeWorkers,
      workers,
    };
  }

  async getJobCounts() {
    const counts = createEmptyJobCounts();
    const results = await this.jobModel
      .aggregate([
        {
          $match: {
            state: { $in: STATUS_JOB_STATES },
          },
        },
        {
          $group: {
            _id: '$state',
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    for (const result of results) {
      counts[result._id] = result.count;
    }

    return counts;
  }
}
