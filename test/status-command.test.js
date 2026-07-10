import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_STATES } from '../src/constants/job.constants.js';
import { renderStatus } from '../src/commands/status.command.js';

test('renderStatus prints a professional status table', () => {
  const lines = [];

  renderStatus(
    {
      jobs: {
        [JOB_STATES.PENDING]: 1,
        [JOB_STATES.PROCESSING]: 2,
        [JOB_STATES.COMPLETED]: 3,
        [JOB_STATES.FAILED]: 4,
        [JOB_STATES.DEAD]: 5,
      },
      activeWorkers: 6,
    },
    (line) => lines.push(line)
  );

  const output = lines.join('\n');

  assert.match(output, /QueueCTL Status/);
  assert.match(output, /Pending/);
  assert.match(output, /Processing/);
  assert.match(output, /Completed/);
  assert.match(output, /Failed/);
  assert.match(output, /Dead/);
  assert.match(output, /Active Workers/);
});

