import chalk from 'chalk';

import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { ConfigService } from '../services/config.service.js';
import { logger } from '../utils/logger.js';

const LABEL_COLUMN_WIDTH = 14;
const VALUE_COLUMN_WIDTH = 24;

function formatMongoError(error) {
  const message = error?.message || 'Config command failed.';

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
  return `+${'-'.repeat(LABEL_COLUMN_WIDTH + 2)}+${'-'.repeat(VALUE_COLUMN_WIDTH + 2)}+`;
}

function createRow(label, value) {
  return `| ${String(label).padEnd(LABEL_COLUMN_WIDTH, ' ')} | ${String(value).padEnd(
    VALUE_COLUMN_WIDTH,
    ' '
  )} |`;
}

export function renderConfig(config, output = console.log) {
  const divider = createDivider();

  output('');
  output(chalk.bold('QueueCTL Config'));
  output(chalk.gray(divider));
  output(chalk.gray(createRow('Setting', 'Value')));
  output(chalk.gray(divider));
  output(createRow('maxRetries', config.maxRetries));
  output(createRow('backoffBase', config.backoffBase));
  output(createRow('retryJitterMs', config.retryJitterMs));
  output(createRow('jobTimeoutMs', config.defaultJobTimeoutMs));
  output(createRow('stuckJobMs', config.stuckJobTimeoutMs));
  output(createRow('jobLeaseMs', config.jobLeaseMs));
  output(createRow('source', config.source));
  output(chalk.gray(divider));
}

async function withDatabase(action) {
  try {
    await connectDatabase({ log: false });
    await action(new ConfigService());
  } catch (error) {
    logger.error(formatMongoError(error));
    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export async function configGetAction() {
  await withDatabase(async (configService) => {
    const config = await configService.getConfig();
    renderConfig(config);
  });
}

export async function configSetAction(options) {
  const updates = {
    maxRetries: options.maxRetries,
    backoffBase: options.backoffBase,
    retryJitterMs: options.retryJitterMs,
    defaultJobTimeoutMs: options.defaultJobTimeoutMs,
    stuckJobTimeoutMs: options.stuckJobTimeoutMs,
    jobLeaseMs: options.jobLeaseMs,
  };

  if (options.key || options.value) {
    if (!options.key || options.value === undefined) {
      logger.error('config set key/value usage requires both <key> and <value>.');
      process.exitCode = 1;
      return;
    }

    if (options.key === 'maxRetries' || options.key === 'max-retries') {
      updates.maxRetries = options.value;
    } else if (options.key === 'backoffBase' || options.key === 'backoff-base') {
      updates.backoffBase = options.value;
    } else if (options.key === 'retryJitterMs' || options.key === 'retry-jitter-ms') {
      updates.retryJitterMs = options.value;
    } else if (options.key === 'defaultJobTimeoutMs' || options.key === 'default-job-timeout-ms') {
      updates.defaultJobTimeoutMs = options.value;
    } else if (options.key === 'stuckJobTimeoutMs' || options.key === 'stuck-job-timeout-ms') {
      updates.stuckJobTimeoutMs = options.value;
    } else if (options.key === 'jobLeaseMs' || options.key === 'job-lease-ms') {
      updates.jobLeaseMs = options.value;
    } else {
      logger.error(
        'config key must be one of: maxRetries, backoffBase, retryJitterMs, defaultJobTimeoutMs, stuckJobTimeoutMs, jobLeaseMs.'
      );
      process.exitCode = 1;
      return;
    }
  }

  await withDatabase(async (configService) => {
    const config = await configService.setConfig(updates);

    logger.success('Config updated successfully');
    renderConfig(config);
  });
}

export function registerConfigCommand(program) {
  const configCommand = program.command('config').description('Manage QueueCTL config.');

  configCommand
    .command('get')
    .description('Show persisted QueueCTL config.')
    .action(configGetAction);

  configCommand
    .command('set')
    .description('Persist QueueCTL config values.')
    .argument('[key]', 'Config key: maxRetries or backoffBase.')
    .argument('[value]', 'Config value.')
    .option('--max-retries <number>', 'Maximum retries per job.')
    .option('--backoff-base <number>', 'Exponential retry backoff base.')
    .option('--retry-jitter-ms <number>', 'Maximum random retry jitter in milliseconds.')
    .option('--default-job-timeout-ms <number>', 'Default job timeout in milliseconds; 0 disables.')
    .option('--stuck-job-timeout-ms <number>', 'Processing job recovery age in milliseconds.')
    .option('--job-lease-ms <number>', 'Processing job lease duration in milliseconds.')
    .action((key, value, options) => configSetAction({ ...options, key, value }));
}
