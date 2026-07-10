import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LOG_DIRECTORY = 'logs';

export class JobOutputLogService {
  constructor(options = {}) {
    this.logDirectory = options.logDirectory || LOG_DIRECTORY;
  }

  getLogFilePath(job) {
    return path.join(this.logDirectory, `${job.jobId}.log`);
  }

  async writeJobLog(job, result, status) {
    await mkdir(this.logDirectory, { recursive: true });

    const logFilePath = this.getLogFilePath(job);
    const content = [
      `timestamp=${new Date().toISOString()}`,
      `jobId=${job.jobId}`,
      `command=${job.command}`,
      `status=${status}`,
      `exitCode=${result.exitCode}`,
      `durationMs=${result.executionDuration ?? 0}`,
      `timedOut=${Boolean(result.timedOut)}`,
      '',
      '[stdout]',
      result.stdout || '',
      '',
      '[stderr]',
      result.stderr || '',
      '',
      '[error]',
      result.error || '',
      '',
    ].join('\n');

    await writeFile(logFilePath, content, 'utf8');

    return logFilePath;
  }
}
