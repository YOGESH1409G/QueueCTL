import chalk from 'chalk';

import { JOB_STATES } from '../constants/job.constants.js';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { StatusService } from '../services/status.service.js';
import { logger } from '../utils/logger.js';

const STATUS_ROWS = Object.freeze([
  ['Pending', JOB_STATES.PENDING],
  ['Processing', JOB_STATES.PROCESSING],
  ['Completed', JOB_STATES.COMPLETED],
  ['Failed', JOB_STATES.FAILED],
  ['Dead', JOB_STATES.DEAD],
]);
const LABEL_COLUMN_WIDTH = 16;
const COUNT_COLUMN_WIDTH = 8;

function formatMongoError(error) {
  const message = error?.message || 'Status command failed.';

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('Server selection timed out') ||
    message.includes('MongoDB connection failed')
  ) {
    return 'Unable to connect to MongoDB. Ensure MongoDB is running and MONGODB_URI is correct.';
  }

  return message;
}

function createDivider() {
  return `+${'-'.repeat(LABEL_COLUMN_WIDTH + 2)}+${'-'.repeat(COUNT_COLUMN_WIDTH + 2)}+`;
}

function createRow(label, value) {
  const paddedLabel = label.padEnd(LABEL_COLUMN_WIDTH, ' ');
  const paddedValue = String(value).padStart(COUNT_COLUMN_WIDTH, ' ');

  return `| ${paddedLabel} | ${paddedValue} |`;
}

export function renderStatus(status, output = console.log) {
  const divider = createDivider();

  output('');
  output(chalk.bold('QueueCTL Status'));
  output(chalk.gray(divider));
  output(chalk.gray(createRow('Metric', 'Count')));
  output(chalk.gray(divider));
  for (const [label, state] of STATUS_ROWS) {
    output(createRow(label, status.jobs[state]));
  }

  output(chalk.gray(divider));
  output(createRow('Active Workers', status.activeWorkers));
  output(chalk.gray(divider));

  if (status.workers?.length > 0) {
    output('');
    output(chalk.bold('Workers'));
    for (const worker of status.workers) {
      output(
        `${worker.workerId} | running | ${worker.runtimeState} | heartbeat=${new Date(
          worker.lastHeartbeatAt
        ).toISOString()} | job=${worker.currentJobId || '-'}`
      );
    }
  }
}

export async function statusAction() {
  try {
    await connectDatabase({ log: false });
    const status = await new StatusService().getStatus();
    renderStatus(status);
  } catch (error) {
    logger.error(formatMongoError(error));
    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export function registerStatusCommand(program) {
  program
    .command('status')
    .description('Show queue and worker status.')
    .action(statusAction);
}
