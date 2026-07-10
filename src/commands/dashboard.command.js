import { connectDatabase, disconnectDatabase } from '../database/connection.js';
import { createDashboardApp } from '../dashboard/dashboard-app.js';
import { logger } from '../utils/logger.js';

export async function dashboardAction(options) {
  const port = Number.parseInt(options.port, 10) || 3000;

  try {
    await connectDatabase({ log: false });
    const app = createDashboardApp();
    const server = app.listen(port, () => {
      logger.success(`Dashboard running at http://localhost:${port}`);
    });

    const shutdown = async () => {
      server.close(async () => {
        await disconnectDatabase({ log: false });
        process.exit(0);
      });
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    logger.error(error.message || 'Dashboard failed to start.');
    process.exitCode = 1;
    await disconnectDatabase({ log: false });
  }
}

export function registerDashboardCommand(program) {
  program
    .command('dashboard')
    .description('Start the QueueCTL monitoring dashboard.')
    .option('-p, --port <number>', 'Dashboard port.', '3000')
    .action(dashboardAction);
}

