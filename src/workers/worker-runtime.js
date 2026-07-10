import { randomUUID } from 'node:crypto';

import { WORKER_HEARTBEAT_INTERVAL_MS } from '../constants/worker.constants.js';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { WorkerControlService } from '../services/worker-control.service.js';
import { WorkerRegistryService } from '../services/worker-registry.service.js';
import { WorkerService } from '../services/worker.service.js';
import { logger } from '../utils/logger.js';

function createWorkerLogger(workerId, workerSlot) {
  return Object.freeze({
    info(message) {
      logger.structured('info', message, { workerId, workerSlot });
    },
    success(message) {
      logger.structured('info', message, { workerId, workerSlot });
    },
    warn(message) {
      logger.structured('warn', message, { workerId, workerSlot });
    },
    error(message) {
      logger.structured('error', message, { workerId, workerSlot });
    },
  });
}

function formatWorkerError(error) {
  const message = error?.message || 'Worker failed.';

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('Server selection timed out') ||
    message.includes('MongoDB connection failed')
  ) {
    return 'Unable to connect to MongoDB. Ensure MongoDB is running and MONGODB_URI is correct.';
  }

  return message;
}

export async function runWorkerRuntime(options = {}) {
  const workerId = options.workerId || process.env.QUEUECTL_WORKER_ID || randomUUID();
  const workerSlot = options.workerSlot || process.env.QUEUECTL_WORKER_SLOT || '1';
  const supervisorId = options.supervisorId || process.env.QUEUECTL_SUPERVISOR_ID || null;
  const writePidFile = options.writePidFile ?? false;
  const workerControlService = options.workerControlService || new WorkerControlService();
  const workerRegistryService = options.workerRegistryService || new WorkerRegistryService();
  const workerLogger = options.logger || createWorkerLogger(workerId, workerSlot);

  let isShuttingDown = false;
  let heartbeatIntervalId = null;
  let isRegistered = false;
  let workerService;

  const requestShutdown = (reason) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    workerLogger.info(`Received ${reason}. Finishing current job before shutdown...`);
    workerService?.stop();
  };

  const startHeartbeat = () => {
    heartbeatIntervalId = setInterval(() => {
      workerRegistryService.heartbeat(workerId).catch((error) => {
        workerLogger.warn(`heartbeat failed: ${error.message}`);
      });
      workerRegistryService.cleanStaleWorkers().catch(() => {});
    }, WORKER_HEARTBEAT_INTERVAL_MS);
  };

  const stopHeartbeat = () => {
    if (!heartbeatIntervalId) {
      return;
    }

    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  };

  if (options.onShutdown) {
    options.onShutdown(requestShutdown);
  } else {
    process.once('SIGINT', () => requestShutdown('SIGINT'));
    process.once('SIGTERM', () => requestShutdown('SIGTERM'));
  }

  process.on('message', (message) => {
    if (message?.type === 'shutdown') {
      requestShutdown(message.reason || 'parent shutdown');
    }
  });

  try {
    await connectDatabase({ log: false });

    if (writePidFile) {
      await workerControlService.writePidFile(process.pid, {
        workerId,
        supervisorId,
        mode: supervisorId ? 'supervised-child' : 'foreground',
      });
    }

    await workerRegistryService.markWorkerStarted(workerId, process.pid, { supervisorId });
    isRegistered = true;
    startHeartbeat();

    workerService = new WorkerService({
      workerId,
      logger: workerLogger,
      shouldStop: () => workerRegistryService.isStopRequested(workerId),
      onJobStart: async (job) => {
        await workerRegistryService.markWorkerBusy(workerId, job.jobId);
      },
      onJobFinish: async () => {
        await workerRegistryService.markWorkerIdle(workerId);
      },
    });

    if (!isShuttingDown) {
      workerLogger.success(`started with pid ${process.pid}`);
      await workerService.start();
    }

    workerLogger.success('stopped cleanly');
  } catch (error) {
    workerLogger.error(formatWorkerError(error));
    process.exitCode = 1;
  } finally {
    stopHeartbeat();

    if (isRegistered) {
      await workerRegistryService.markWorkerStopped(workerId).catch((error) => {
        workerLogger.warn(`failed to mark worker stopped: ${error.message}`);
      });
    }

    if (writePidFile) {
      await workerControlService.removePidFile().catch(() => {});
    }

    await disconnectDatabase({ log: false });

    if (process.connected) {
      process.disconnect();
    }
  }
}
