import { JOB_STATES } from '../constants/job.constants.js';
import { Job } from '../models/job.model.js';
import { WorkerRegistryService } from './worker-registry.service.js';

const METRIC_STATES = Object.freeze([
  JOB_STATES.PENDING,
  JOB_STATES.PROCESSING,
  JOB_STATES.COMPLETED,
  JOB_STATES.FAILED,
  JOB_STATES.DEAD,
]);

function createEmptyCounts() {
  return Object.fromEntries(METRIC_STATES.map((state) => [state, 0]));
}

export class MetricsService {
  constructor(options = {}) {
    this.jobModel = options.jobModel || Job;
    this.workerRegistryService =
      options.workerRegistryService || new WorkerRegistryService(options);
    this.now = options.now || (() => new Date());
  }

  async getMetrics() {
    const [stateCounts, executionStats, retryDistribution, workerCount, throughput] =
      await Promise.all([
        this.getStateCounts(),
        this.getExecutionStats(),
        this.getRetryDistribution(),
        this.workerRegistryService.countActiveWorkers(),
        this.getJobsPerMinute(),
      ]);

    const totalJobs = Object.values(stateCounts).reduce((sum, count) => sum + count, 0);
    const completed = stateCounts[JOB_STATES.COMPLETED];
    const failed = stateCounts[JOB_STATES.FAILED] + stateCounts[JOB_STATES.DEAD];

    return {
      totalJobs,
      completed,
      failed: stateCounts[JOB_STATES.FAILED],
      dead: stateCounts[JOB_STATES.DEAD],
      pending: stateCounts[JOB_STATES.PENDING],
      averageExecutionTime: executionStats.averageExecutionTime || 0,
      averageRetryCount: executionStats.averageRetryCount || 0,
      workerCount,
      successRate: totalJobs === 0 ? 0 : (completed / totalJobs) * 100,
      failureRate: totalJobs === 0 ? 0 : (failed / totalJobs) * 100,
      longestRunningJob: executionStats.longestRunningJob || null,
      fastestJob: executionStats.fastestJob || null,
      jobsPerMinute: throughput,
      retryCountDistribution: retryDistribution,
    };
  }

  async getStateCounts() {
    const counts = createEmptyCounts();
    const results = await this.jobModel
      .aggregate([
        { $match: { state: { $in: METRIC_STATES } } },
        { $group: { _id: '$state', count: { $sum: 1 } } },
      ])
      .exec();

    for (const result of results) {
      counts[result._id] = result.count;
    }

    return counts;
  }

  async getExecutionStats() {
    const [summary] = await this.jobModel
      .aggregate([
        { $match: { executionDuration: { $ne: null } } },
        {
          $group: {
            _id: null,
            averageExecutionTime: { $avg: '$executionDuration' },
            averageRetryCount: { $avg: '$attempts' },
            longestRunningJob: { $max: '$executionDuration' },
            fastestJob: { $min: '$executionDuration' },
          },
        },
      ])
      .exec();

    return summary || {};
  }

  async getJobsPerMinute() {
    const oneMinuteAgo = new Date(this.now().getTime() - 60 * 1000);

    return this.jobModel.countDocuments({ createdAt: { $gte: oneMinuteAgo } }).exec();
  }

  async getRetryDistribution() {
    const results = await this.jobModel
      .aggregate([
        { $group: { _id: '$attempts', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .exec();

    return results.map((result) => ({
      attempts: result._id,
      count: result.count,
    }));
  }
}

