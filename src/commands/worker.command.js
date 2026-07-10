import { randomUUID } from 'node:crypto';

import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { WorkerControlService } from '../services/worker-control.service.js';
import { WorkerRegistryService } from '../services/worker-registry.service.js';
import { logger } from '../utils/logger.js';
import { runWorkerRuntime } from '../workers/worker-runtime.js';
import { WorkerSupervisor } from '../workers/worker-supervisor.js';

export function parseWorkerCount(value) {
  const count = Number.parseInt(value, 10);

  if (!Number.isInteger(count) || count < 1) {
    throw new Error('worker count must be a positive integer.');
  }

  return count;
}

function formatMongoError(error) {
  const message = error?.message || 'Worker command failed.';

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('Server selection timed out') ||
    message.includes('MongoDB connection failed')
  ) {
    return 'Unable to connect to MongoDB. Ensure MongoDB is running and MONGODB_URI is correct.';
  }

  return message;
}

async function startForegroundWorker() {
  const workerId = randomUUID();
  let shutdownHandler = null;

  const registerShutdown = (handler) => {
    shutdownHandler = handler;
  };

  process.once('SIGINT', () => shutdownHandler?.('SIGINT'));
  process.once('SIGTERM', () => shutdownHandler?.('SIGTERM'));

  await runWorkerRuntime({
    workerId,
    workerSlot: '1',
    writePidFile: true,
    onShutdown: registerShutdown,
  });
}

export async function startWorkerAction(options = {}) {
  let supervisor;
  let isShuttingDown = false;
  const workerControlService = new WorkerControlService();

  const requestShutdown = (signal) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    if (supervisor) {
      logger.info(`Received ${signal}. Stopping worker processes...`);
      supervisor.stop(signal);
      return;
    }

    logger.info(`Received ${signal}. Stopping worker...`);
  };

  const handleSigint = () => requestShutdown('SIGINT');
  const handleSigterm = () => requestShutdown('SIGTERM');

  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);

  try {
    const count = parseWorkerCount(options.count);

    if (count === 1) {
      await startForegroundWorker();
      return;
    }

    const supervisorId = randomUUID();
    supervisor = new WorkerSupervisor({ count, supervisorId, workerControlService });
    await workerControlService.writePidFile(process.pid, {
      supervisorId,
      mode: 'supervisor',
      workerCount: count,
    });
    await supervisor.start();
    process.exitCode = supervisor.exitCode;
    logger.success('All worker processes stopped');
  } catch (error) {
    logger.error(formatMongoError(error));
    process.exitCode = 1;
  } finally {
    await workerControlService.removePidFile().catch(() => {});
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  }
}

export async function stopWorkerAction() {
  try {
    await connectDatabase({ log: false });
    const workerControlService = new WorkerControlService();
    const workerRegistryService = new WorkerRegistryService();
    const activeWorkers = await workerRegistryService.listActiveWorkers();
    const result = await workerControlService.requestStop({
      workerIds: activeWorkers.map((worker) => worker.workerId),
    });

    logger.success(`Stop signal sent to worker pid ${result.pid}`);
  } catch (error) {
    logger.error(error.message || 'Failed to stop worker.');
    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export function registerWorkerCommand(program) {
  const workerCommand = program.command('worker').description('Manage QueueCTL workers.');

  workerCommand
    .command('start')
    .description('Start polling and processing pending jobs in the foreground.')
    .option('-c, --count <number>', 'Number of worker processes to start.', '1')
    .action(startWorkerAction);

  workerCommand
    .command('stop')
    .description('Gracefully stop the running worker from another terminal.')
    .action(stopWorkerAction);
}
