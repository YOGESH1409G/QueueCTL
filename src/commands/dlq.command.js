import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { listDeadJobs, retryDeadJob } from '../services/dlq.service.js';
import { logger } from '../utils/logger.js';

function formatMongoError(error) {
  const message = error?.message || 'DLQ command failed.';

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('Server selection timed out') ||
    message.includes('MongoDB connection failed')
  ) {
    return 'Unable to connect to MongoDB. Ensure MongoDB is running and MONGODB_URI is correct.';
  }

  return message;
}

function renderDeadJobs(jobs) {
  if (jobs.length === 0) {
    logger.info('No jobs in DLQ.');
    return;
  }

  for (const job of jobs) {
    logger.info(
      `${job.jobId} | attempts=${job.attempts} | updated=${job.updatedAt.toISOString()} | ${job.command}`
    );
  }
}

export async function listDlqAction(options) {
  try {
    await connectDatabase({ log: false });
    const jobs = await listDeadJobs({ limit: options.limit });
    renderDeadJobs(jobs);
  } catch (error) {
    logger.error(formatMongoError(error));
    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export async function retryDlqAction(jobId) {
  try {
    await connectDatabase({ log: false });
    const job = await retryDeadJob(jobId);

    logger.success('DLQ job scheduled for retry');
    logger.info(`Job ID: ${job.jobId}`);
  } catch (error) {
    logger.error(formatMongoError(error));
    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export function registerDlqCommand(program) {
  const dlqCommand = program.command('dlq').description('Manage dead-letter jobs.');

  dlqCommand
    .command('list')
    .description('List jobs in the dead-letter queue.')
    .option('-l, --limit <number>', 'Maximum jobs to return.', '25')
    .action(listDlqAction);

  dlqCommand
    .command('retry')
    .description('Move a dead-letter job back to the pending queue.')
    .argument('<jobId>', 'Job identifier to retry.')
    .action(retryDlqAction);
}

