import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { createJob } from '../services/job.service.js';
import { logger } from '../utils/logger.js';

function formatCliError(error) {
  const message = error?.message || 'Failed to enqueue job.';

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('Server selection timed out') ||
    message.includes('MongoDB connection failed')
  ) {
    return 'Unable to connect to MongoDB. Ensure MongoDB is running and MONGODB_URI is correct.';
  }

  return message;
}

export function parseEnqueuePayload(rawPayload) {
  let payload;

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new Error('Invalid JSON payload. Example: queuectl enqueue \'{"command":"echo Hello"}\'');
  }

  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('Payload must be a JSON object.');
  }

  if (!Object.hasOwn(payload, 'command')) {
    throw new Error('Payload must include a command field.');
  }

  if (typeof payload.command !== 'string' || payload.command.trim().length === 0) {
    throw new Error('command cannot be empty.');
  }

  return {
    id: payload.id,
    command: payload.command.trim(),
    timeout: payload.timeout,
    priority: payload.priority,
    runAt: payload.runAt,
  };
}

export async function enqueueAction(rawPayload) {
  try {
    const payload = parseEnqueuePayload(rawPayload);

    await connectDatabase({ log: false });
    const job = await createJob(payload);

    logger.success('\u2713 Job queued successfully');
    logger.info(`Job ID: ${job.jobId}`);
  } catch (error) {
    logger.error(formatCliError(error));
    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export function registerEnqueueCommand(program) {
  program
    .command('enqueue')
    .description('Queue a command for background execution.')
    .argument('<payload>', 'JSON payload, for example: {"command":"echo Hello"}')
    .action(enqueueAction);
}
