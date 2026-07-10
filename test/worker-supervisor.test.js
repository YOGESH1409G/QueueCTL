import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkerSupervisor } from '../src/workers/worker-supervisor.js';

function createSilentLogger() {
  return {
    info() {},
    success() {},
    error() {},
  };
}

function createMockChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.connected = true;
  child.messages = [];
  child.send = (message) => {
    child.messages.push(message);
  };
  return child;
}

test('WorkerSupervisor forks the requested number of workers', () => {
  const children = [];
  const supervisor = new WorkerSupervisor({
    count: 3,
    logger: createSilentLogger(),
    supervisorId: 'supervisor-test',
    forkWorker(path, args, options) {
      const child = createMockChild(1000 + children.length);
      children.push({ child, path, args, options });
      return child;
    },
  });

  const startPromise = supervisor.start();

  assert.equal(children.length, 3);
  assert.equal(children[0].options.env.QUEUECTL_WORKER_ID, 'supervisor-test-1');
  assert.equal(children[1].options.env.QUEUECTL_WORKER_ID, 'supervisor-test-2');
  assert.equal(children[2].options.env.QUEUECTL_WORKER_ID, 'supervisor-test-3');
  assert.equal(children[0].options.env.QUEUECTL_WORKER_SLOT, '1');
  assert.deepEqual(children[0].options.stdio, ['inherit', 'inherit', 'inherit', 'ipc']);

  for (const { child } of children) {
    child.emit('exit', 0, null);
  }

  return startPromise;
});

test('WorkerSupervisor sends graceful shutdown messages to children', () => {
  const children = [];
  const supervisor = new WorkerSupervisor({
    count: 2,
    logger: createSilentLogger(),
    forkWorker() {
      const child = createMockChild(2000 + children.length);
      children.push(child);
      return child;
    },
  });

  const startPromise = supervisor.start();

  supervisor.stop('SIGTERM');

  assert.deepEqual(children[0].messages, [{ type: 'shutdown', reason: 'SIGTERM' }]);
  assert.deepEqual(children[1].messages, [{ type: 'shutdown', reason: 'SIGTERM' }]);

  for (const child of children) {
    child.emit('exit', 0, null);
  }

  return startPromise;
});
