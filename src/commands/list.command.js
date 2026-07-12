import chalk from 'chalk';

import { JOB_STATE_VALUES } from '../constants/job.constants.js';
import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { listJobs } from '../services/job.service.js';
import { logger } from '../utils/logger.js';

const DEFAULT_LIMIT = 25;
const COLUMN_WIDTHS = Object.freeze({
  jobId: 36,
  state: 11,
  priority: 8,
  attempts: 8,
  duration: 10,
  timedOut: 10,
  createdAt: 24,
  command: 34,
});

function formatMongoError(error) {
  const message = error?.message || 'List command failed.';

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('Server selection timed out') ||
    message.includes('MongoDB connection failed')
  ) {
    return 'Unable to connect to MongoDB. Ensure MongoDB is running and MONGODB_URI is correct.';
  }

  return message;
}

function truncate(value, width) {
  const text = String(value ?? '');

  if (text.length <= width) {
    return text.padEnd(width, ' ');
  }

  return `${text.slice(0, width - 1)}…`;
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toISOString();
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

export function serializeJobsForJson(jobs) {
  return jobs.map((job) => ({
    id: job.jobId,
    command: job.command,
    state: job.state,
    attempts: job.attempts,
    max_retries: job.maxRetries,
    created_at: toIsoDate(job.createdAt),
    updated_at: toIsoDate(job.updatedAt),
    // Optional extensions beyond the required fields:
    priority: job.priority,
    executionDuration: job.executionDuration ?? null,
    timedOut: Boolean(job.timedOut),
    exitCode: job.exitCode ?? null,
    error: job.error ?? null,
    claimedByWorkerId: job.claimedByWorkerId ?? null,
    leaseExpiresAt: toIsoDate(job.leaseExpiresAt),
    nextRetryAt: toIsoDate(job.nextRetryAt),
    runAt: toIsoDate(job.runAt),
    startedAt: toIsoDate(job.startedAt),
    completedAt: toIsoDate(job.completedAt),
  }));
}

function createDivider() {
  return [
    '+',
    '-'.repeat(COLUMN_WIDTHS.jobId + 2),
    '+',
    '-'.repeat(COLUMN_WIDTHS.state + 2),
    '+',
    '-'.repeat(COLUMN_WIDTHS.priority + 2),
    '+',
    '-'.repeat(COLUMN_WIDTHS.attempts + 2),
    '+',
    '-'.repeat(COLUMN_WIDTHS.duration + 2),
    '+',
    '-'.repeat(COLUMN_WIDTHS.timedOut + 2),
    '+',
    '-'.repeat(COLUMN_WIDTHS.createdAt + 2),
    '+',
    '-'.repeat(COLUMN_WIDTHS.command + 2),
    '+',
  ].join('');
}

function createRow({ jobId, state, priority, attempts, duration, timedOut, createdAt, command }) {
  return [
    '| ',
    truncate(jobId, COLUMN_WIDTHS.jobId),
    ' | ',
    truncate(state, COLUMN_WIDTHS.state),
    ' | ',
    truncate(priority, COLUMN_WIDTHS.priority),
    ' | ',
    String(attempts ?? '').padStart(COLUMN_WIDTHS.attempts, ' '),
    ' | ',
    String(duration ?? '-').padStart(COLUMN_WIDTHS.duration, ' '),
    ' | ',
    String(timedOut ?? '-').padStart(COLUMN_WIDTHS.timedOut, ' '),
    ' | ',
    truncate(createdAt, COLUMN_WIDTHS.createdAt),
    ' | ',
    truncate(command, COLUMN_WIDTHS.command),
    ' |',
  ].join('');
}

export function normalizeListOptions(options = {}) {
  const filters = {};

  if (options.state) {
    const state = options.state.trim().toLowerCase();

    if (!JOB_STATE_VALUES.includes(state)) {
      throw new Error(`state must be one of: ${JOB_STATE_VALUES.join(', ')}.`);
    }

    filters.state = state;
  }

  if (options.jobId) {
    filters.jobId = options.jobId;
  }

  const limit = Number.parseInt(options.limit, 10) || DEFAULT_LIMIT;

  return {
    filters,
    queryOptions: {
      limit,
      sort: { createdAt: -1 },
    },
  };
}

export function renderJobList(jobs, output = console.log) {
  output('');
  output(chalk.bold('QueueCTL Jobs'));

  if (jobs.length === 0) {
    output(chalk.gray('No jobs found.'));
    return;
  }

  const divider = createDivider();

  output(chalk.gray('Sorted by createdAt, newest first'));
  output(chalk.gray(divider));
  output(
    chalk.gray(
      createRow({
        jobId: 'Job ID',
        state: 'State',
        priority: 'Priority',
        attempts: 'Attempts',
        duration: 'Duration',
        timedOut: 'Timed Out',
        createdAt: 'Created At',
        command: 'Command',
      })
    )
  );
  output(chalk.gray(divider));

  for (const job of jobs) {
    output(
      createRow({
        jobId: job.jobId,
        state: job.state,
        priority: job.priority,
        attempts: job.attempts,
        duration: job.executionDuration ?? '-',
        timedOut: job.timedOut,
        createdAt: formatDate(job.createdAt),
        command: job.command,
      })
    );
  }

  output(chalk.gray(divider));
}

export async function listAction(options) {
  const jsonMode = Boolean(options.json);

  try {
    const { filters, queryOptions } = normalizeListOptions(options);

    await connectDatabase({ log: false });
    const jobs = await listJobs(filters, queryOptions);

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(serializeJobsForJson(jobs))}\n`);
      return;
    }

    renderJobList(jobs);
  } catch (error) {
    const message = formatMongoError(error);

    if (jsonMode) {
      process.stderr.write(`${message}\n`);
    } else {
      logger.error(message);
    }

    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export function registerListCommand(program) {
  program
    .command('list')
    .description('List jobs sorted by creation time, newest first.')
    .option('-s, --state <state>', `Filter by state: ${JOB_STATE_VALUES.join(', ')}.`)
    .option('--jobId <jobId>', 'Filter by job ID.')
    .option('-l, --limit <number>', 'Maximum jobs to return.', String(DEFAULT_LIMIT))
    .option('--json', 'Print only a JSON array to stdout.')
    .action(listAction);
}
