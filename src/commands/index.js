import { registerConfigCommand } from './config.command.js';
import { registerDashboardCommand } from './dashboard.command.js';
import { registerDlqCommand } from './dlq.command.js';
import { registerEnqueueCommand } from './enqueue.command.js';
import { registerListCommand } from './list.command.js';
import { registerMetricsCommand } from './metrics.command.js';
import { registerStatusCommand } from './status.command.js';
import { registerWorkerCommand } from './worker.command.js';

export function registerCommands(program) {
  registerConfigCommand(program);
  registerDashboardCommand(program);
  registerDlqCommand(program);
  registerEnqueueCommand(program);
  registerListCommand(program);
  registerMetricsCommand(program);
  registerStatusCommand(program);
  registerWorkerCommand(program);

  program.addHelpText(
    'after',
    `
Workers use MongoDB-backed retry scheduling.`
  );

  return program;
}
