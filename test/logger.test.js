import test from 'node:test';
import assert from 'node:assert/strict';

import { logger, winstonLogger } from '../src/utils/logger.js';

test('logger.structured writes JSON logs with metadata', (testContext) => {
  const calls = [];
  testContext.mock.method(winstonLogger, 'log', (level, message, metadata) => {
    calls.push({ level, message, metadata });
  });

  logger.structured('info', 'worker started', {
    workerId: 'worker-1',
  });

  assert.deepEqual(calls[0], {
    level: 'info',
    message: 'worker started',
    metadata: {
      workerId: 'worker-1',
    },
  });
});
