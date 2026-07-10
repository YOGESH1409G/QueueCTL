import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  WORKER_CONTROL_DIR,
  WORKER_PID_FILENAME,
} from '../constants/worker.constants.js';
import { WorkerRegistryService } from './worker-registry.service.js';

export class WorkerControlService {
  constructor(options = {}) {
    this.controlDir = options.controlDir || WORKER_CONTROL_DIR;
    this.pidFilename = options.pidFilename || WORKER_PID_FILENAME;
    this.workerRegistryService =
      options.workerRegistryService || new WorkerRegistryService(options);
    this.killProcess = options.killProcess || ((pid, signal) => process.kill(pid, signal));
  }

  getPidFilePath() {
    return path.join(this.controlDir, this.pidFilename);
  }

  async writePidFile(pid, metadata = {}) {
    await mkdir(this.controlDir, { recursive: true });

    let existingRecord = null;
    try {
      existingRecord = await this.readPidFile();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (existingRecord?.pid) {
      try {
        this.killProcess(existingRecord.pid, 0);
        throw new Error(`A worker is already running with PID ${existingRecord.pid}. Please stop it first.`);
      } catch (error) {
        if (error.code !== 'ESRCH' && error.message !== `A worker is already running with PID ${existingRecord.pid}. Please stop it first.`) {
          throw new Error(`A worker might be running with PID ${existingRecord.pid} (permission denied). Please stop it first.`);
        }
        if (error.message === `A worker is already running with PID ${existingRecord.pid}. Please stop it first.`) {
            throw error;
        }
      }
    }

    const payload = {
      pid,
      writtenAt: new Date().toISOString(),
      ...metadata,
    };

    await writeFile(this.getPidFilePath(), `${JSON.stringify(payload)}\n`, 'utf8');
  }

  async readPidFile() {
    const content = await readFile(this.getPidFilePath(), 'utf8');
    return JSON.parse(content.trim());
  }

  async removePidFile() {
    try {
      await unlink(this.getPidFilePath());
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async requestStop(options = {}) {
    const { signal = 'SIGTERM', workerIds = [] } = options;

    let pidRecord = null;

    try {
      pidRecord = await this.readPidFile();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (workerIds.length > 0) {
      await Promise.all(workerIds.map((workerId) => this.workerRegistryService.requestStop(workerId)));
    }

    if (!pidRecord?.pid) {
      throw new Error('No running worker found. Start a worker with `queuectl worker start`.');
    }

    try {
      this.killProcess(pidRecord.pid, signal);
    } catch (error) {
      if (error.code === 'ESRCH') {
        await this.removePidFile();
        throw new Error('Worker process is not running. PID file was stale and has been removed.');
      }

      throw error;
    }

    return {
      pid: pidRecord.pid,
      signal,
      supervisorId: pidRecord.supervisorId || null,
    };
  }
}
