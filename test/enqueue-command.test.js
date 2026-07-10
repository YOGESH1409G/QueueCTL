import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEnqueuePayload } from '../src/commands/enqueue.command.js';

test('parseEnqueuePayload accepts a valid enqueue payload', () => {
  const payload = parseEnqueuePayload('{"command":"echo Hello"}');

  assert.equal(payload.command, 'echo Hello');
  assert.equal(payload.timeout, undefined);
  assert.equal(payload.priority, undefined);
  assert.equal(payload.runAt, undefined);
});

test('parseEnqueuePayload trims command whitespace', () => {
  const payload = parseEnqueuePayload('{"command":"  echo Hello  "}');

  assert.equal(payload.command, 'echo Hello');
});

test('parseEnqueuePayload rejects invalid JSON', () => {
  assert.throws(() => parseEnqueuePayload('{bad-json'), /Invalid JSON payload/);
});

test('parseEnqueuePayload rejects a missing command', () => {
  assert.throws(() => parseEnqueuePayload('{"name":"missing"}'), /command field/);
});

test('parseEnqueuePayload rejects an empty command', () => {
  assert.throws(() => parseEnqueuePayload('{"command":"   "}'), /command cannot be empty/);
});
