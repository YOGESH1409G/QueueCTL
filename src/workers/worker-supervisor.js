import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { logger } from '../utils/logger.js';

const DEFAULT_WORKER_PROCESS_PATH = fileURLToPath(
  new URL('./worker-process.js', import.meta.url)
);

export class WorkerSupervisor {
  constructor(options = {}) {
    this.count = options.count;
    this.forkWorker = options.forkWorker || fork;
    this.logger = options.logger || logger;
    this.supervisorId = options.supervisorId || randomUUID();
    this.workerControlService = options.workerControlService || null;
    this.workerProcessPath = options.workerProcessPath || DEFAULT_WORKER_PROCESS_PATH;
    this.children = new Map();
    this.isStopping = false;
    this.exitCode = 0;
    this.resolveDone = null;
  }

  async start() {
    this.logger.info(`Starting ${this.count} worker process(es)`);

    return new Promise((resolve) => {
      this.resolveDone = resolve;

      for (let workerId = 1; workerId <= this.count; workerId += 1) {
        this.startWorker(workerId);
      }
    });
  }

  startWorker(workerId) {
    const child = this.forkWorker(this.workerProcessPath, [], {
      env: {
        ...process.env,
        QUEUECTL_WORKER_ID: `${this.supervisorId}-${workerId}`,
        QUEUECTL_WORKER_SLOT: String(workerId),
        QUEUECTL_SUPERVISOR_ID: this.supervisorId,
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    this.children.set(workerId, child);
    this.logger.success(`Worker ${workerId} forked with pid ${child.pid}`);

    child.once('exit', (code, signal) => {
      this.children.delete(workerId);

      if (!this.isStopping && code !== 0) {
        this.exitCode = 1;
        this.logger.error(
          `Worker ${workerId} exited unexpectedly with code ${code ?? 'null'} signal ${signal ?? 'null'}`
        );
      } else {
        this.logger.info(`Worker ${workerId} stopped`);
      }

      this.resolveIfDone();
    });

    child.once('error', (error) => {
      this.children.delete(workerId);
      this.exitCode = 1;
      this.logger.error(`Worker ${workerId} failed to start: ${error.message}`);
      this.resolveIfDone();
    });
  }

  stop(reason = 'shutdown') {
    if (this.isStopping) {
      return;
    }

    this.isStopping = true;
    this.logger.info(`Stopping ${this.children.size} worker process(es)`);

    for (const [workerId, child] of this.children.entries()) {
      this.logger.info(`Requesting worker ${workerId} shutdown (${reason})`);

      if (child.connected) {
        child.send({ type: 'shutdown', reason });
      }
    }

    this.resolveIfDone();
  }

  resolveIfDone() {
    if (this.children.size === 0 && this.resolveDone) {
      this.resolveDone();
      this.resolveDone = null;
    }
  }
}
