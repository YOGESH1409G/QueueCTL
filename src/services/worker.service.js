import { WorkerLoop } from '../workers/worker-loop.js';

export class WorkerService {
  constructor(options = {}) {
    this.workerLoop =
      options.workerLoop ||
      new WorkerLoop({
        ...options,
        onJobStart: options.onJobStart,
        onJobFinish: options.onJobFinish,
      });
  }

  async start() {
    await this.workerLoop.start();
  }

  stop() {
    this.workerLoop.stop();
  }

  isRunning() {
    return this.workerLoop.isRunning;
  }
}
