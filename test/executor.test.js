import test from 'node:test';
import assert from 'node:assert/strict';

import { executeCommand } from '../src/workers/executor.js';

test('executeCommand captures stdout and a zero exit code', async () => {
  const result = await executeCommand('printf "hello"');

  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 0);
});

test('executeCommand captures stderr and a non-zero exit code', async () => {
  const result = await executeCommand('node -e "console.error(\'bad\'); process.exit(7)"');

  assert.equal(result.stdout, '');
  assert.match(result.stderr, /bad/);
  assert.equal(result.exitCode, 7);
});

