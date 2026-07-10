import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWorkerCount } from '../src/commands/worker.command.js';

test('parseWorkerCount accepts positive integers', () => {
  assert.equal(parseWorkerCount('1'), 1);
  assert.equal(parseWorkerCount('3'), 3);
});

test('parseWorkerCount rejects invalid counts', () => {
  assert.throws(() => parseWorkerCount('0'), /positive integer/);
  assert.throws(() => parseWorkerCount('-1'), /positive integer/);
  assert.throws(() => parseWorkerCount('abc'), /positive integer/);
});

