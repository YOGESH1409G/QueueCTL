import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { normalizeListOptions, renderJobList } from '../src/commands/list.command.js';

test('normalizeListOptions builds newest-first query options', () => {
  const options = normalizeListOptions({
    state: 'Completed',
    limit: '10',
  });

  assert.deepEqual(options, {
    filters: {
      state: JOB_STATES.COMPLETED,
    },
    queryOptions: {
      limit: 10,
      sort: { createdAt: -1 },
    },
  });
});

test('normalizeListOptions rejects invalid states', () => {
  assert.throws(() => normalizeListOptions({ state: 'unknown' }), /state must be one of/);
});

test('renderJobList prints a readable job table', () => {
  const lines = [];

  renderJobList(
    [
      {
        jobId: 'job-1',
        state: JOB_STATES.COMPLETED,
        attempts: 1,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        command: 'echo hello',
      },
    ],
    (line) => lines.push(line)
  );

  const output = lines.join('\n');

  assert.match(output, /QueueCTL Jobs/);
  assert.match(output, /Sorted by createdAt, newest first/);
  assert.match(output, /Job ID/);
  assert.match(output, /completed/);
  assert.match(output, /echo hello/);
});

test('renderJobList prints an empty state message', () => {
  const lines = [];

  renderJobList([], (line) => lines.push(line));

  assert.match(lines.join('\n'), /No jobs found/);
});

