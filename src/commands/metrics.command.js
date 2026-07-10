import chalk from 'chalk';

import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { MetricsService } from '../services/metrics.service.js';
import { logger } from '../utils/logger.js';

function row(label, value) {
  return `| ${label.padEnd(26, ' ')} | ${String(value).padStart(16, ' ')} |`;
}

function divider() {
  return `+${'-'.repeat(28)}+${'-'.repeat(18)}+`;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2);
}

export function renderMetrics(metrics, output = console.log) {
  output('');
  output(chalk.bold('QueueCTL Metrics'));
  output(chalk.gray(divider()));
  output(chalk.gray(row('Metric', 'Value')));
  output(chalk.gray(divider()));
  output(row('Total Jobs', metrics.totalJobs));
  output(row('Completed', metrics.completed));
  output(row('Failed', metrics.failed));
  output(row('Dead', metrics.dead));
  output(row('Pending', metrics.pending));
  output(row('Average Execution Time', `${formatNumber(metrics.averageExecutionTime)}ms`));
  output(row('Average Retry Count', formatNumber(metrics.averageRetryCount)));
  output(row('Worker Count', metrics.workerCount));
  output(row('Success Rate', `${formatNumber(metrics.successRate)}%`));
  output(row('Failure Rate', `${formatNumber(metrics.failureRate)}%`));
  output(row('Longest Running Job', `${metrics.longestRunningJob || 0}ms`));
  output(row('Fastest Job', `${metrics.fastestJob || 0}ms`));
  output(row('Jobs Per Minute', metrics.jobsPerMinute));
  output(chalk.gray(divider()));

  output('');
  output(chalk.bold('Retry Count Distribution'));
  for (const item of metrics.retryCountDistribution) {
    output(`attempts=${item.attempts}: ${item.count}`);
  }
}

export async function metricsAction() {
  try {
    await connectDatabase({ log: false });
    renderMetrics(await new MetricsService().getMetrics());
  } catch (error) {
    logger.error(error.message || 'Metrics command failed.');
    process.exitCode = 1;
  } finally {
    await disconnectDatabase({ log: false });
  }
}

export function registerMetricsCommand(program) {
  program.command('metrics').description('Show queue metrics.').action(metricsAction);
}
