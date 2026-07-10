import {
  WORKER_RUNTIME_STATES,
  WORKER_HEARTBEAT_STALE_MS,
  WORKER_STATES,
} from '../constants/worker.constants.js';
import { Worker } from '../models/worker.model.js';

export class WorkerRegistryService {
  constructor(options = {}) {
    this.workerModel = options.workerModel || Worker;
    this.now = options.now || (() => new Date());
    this.staleMs = options.staleMs || WORKER_HEARTBEAT_STALE_MS;
  }

  async markWorkerStarted(workerId, pid, metadata = {}) {
    const now = this.now();

    return this.workerModel
      .findOneAndUpdate(
        { workerId },
        {
          $setOnInsert: {
            workerId,
          },
          $set: {
            pid,
            state: WORKER_STATES.ACTIVE,
            runtimeState: WORKER_RUNTIME_STATES.IDLE,
            currentJobId: null,
            startedAt: now,
            lastHeartbeatAt: now,
            stoppedAt: null,
            stopRequestedAt: null,
            supervisorId: metadata.supervisorId || null,
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      )
      .exec();
  }

  async heartbeat(workerId) {
    return this.workerModel
      .findOneAndUpdate(
        {
          workerId,
          state: WORKER_STATES.ACTIVE,
        },
        {
          $set: {
            lastHeartbeatAt: this.now(),
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async markWorkerBusy(workerId, jobId) {
    return this.workerModel
      .findOneAndUpdate(
        { workerId, state: WORKER_STATES.ACTIVE },
        {
          $set: {
            runtimeState: WORKER_RUNTIME_STATES.BUSY,
            currentJobId: jobId,
            lastHeartbeatAt: this.now(),
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async markWorkerIdle(workerId) {
    return this.workerModel
      .findOneAndUpdate(
        { workerId, state: WORKER_STATES.ACTIVE },
        {
          $set: {
            runtimeState: WORKER_RUNTIME_STATES.IDLE,
            currentJobId: null,
            lastHeartbeatAt: this.now(),
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async markWorkerStopped(workerId) {
    const now = this.now();

    return this.workerModel
      .findOneAndUpdate(
        { workerId },
        {
          $set: {
            state: WORKER_STATES.STOPPED,
            runtimeState: WORKER_RUNTIME_STATES.IDLE,
            currentJobId: null,
            stoppedAt: now,
            lastHeartbeatAt: now,
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async countActiveWorkers() {
    return this.workerModel
      .countDocuments({
        state: WORKER_STATES.ACTIVE,
        lastHeartbeatAt: {
          $gte: new Date(this.now().getTime() - this.staleMs),
        },
      })
      .exec();
  }

  async listActiveWorkers() {
    return this.workerModel
      .find({
        state: WORKER_STATES.ACTIVE,
        lastHeartbeatAt: {
          $gte: new Date(this.now().getTime() - this.staleMs),
        },
      })
      .sort({ workerId: 1 })
      .lean()
      .exec();
  }

  async requestStop(workerId) {
    return this.workerModel
      .findOneAndUpdate(
        { workerId, state: WORKER_STATES.ACTIVE },
        {
          $set: {
            stopRequestedAt: this.now(),
            lastHeartbeatAt: this.now(),
          },
        },
        {
          returnDocument: 'after',
          runValidators: true,
        }
      )
      .exec();
  }

  async isStopRequested(workerId) {
    const worker = await this.workerModel
      .findOne({ workerId, state: WORKER_STATES.ACTIVE })
      .lean()
      .exec();

    return Boolean(worker?.stopRequestedAt);
  }

  async cleanStaleWorkers() {
    const staleBefore = new Date(this.now().getTime() - this.staleMs);
    const now = this.now();

    const result = await this.workerModel
      .updateMany(
        {
          state: WORKER_STATES.ACTIVE,
          lastHeartbeatAt: { $lt: staleBefore },
        },
        {
          $set: {
            state: WORKER_STATES.STOPPED,
            runtimeState: WORKER_RUNTIME_STATES.IDLE,
            currentJobId: null,
            stoppedAt: now,
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
