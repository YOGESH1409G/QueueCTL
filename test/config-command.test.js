import test from 'node:test';
import assert from 'node:assert/strict';

import { renderConfig } from '../src/commands/config.command.js';

test('renderConfig prints config values in a table', () => {
  const lines = [];

  renderConfig(
    {
      maxRetries: 5,
      backoffBase: 3,
      source: 'database',
    },
    (line) => lines.push(line)
  );

  const output = lines.join('\n');

  assert.match(output, /QueueCTL Config/);
  assert.match(output, /maxRetries/);
  assert.match(output, /backoffBase/);
  assert.match(output, /database/);
});

