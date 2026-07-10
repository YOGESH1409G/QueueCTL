import { exec } from 'node:child_process';

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const TIMEOUT_EXIT_CODE = 124;
const KILL_GRACE_MS = 1000;

function normalizeExitCode(error) {
  if (!error) {
    return 0;
  }

  return typeof error.code === 'number' ? error.code : 1;
}

export function executeCommand(command, options = {}) {
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER_BYTES;
  const timeout = options.timeout || 0;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let timedOut = false;
    let timeoutId = null;
    let forceKillTimeoutId = null;
    const child = exec(command, { detached: true, maxBuffer }, (error, stdout, stderr) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }

      resolve({
        stdout,
        stderr,
        exitCode: timedOut ? TIMEOUT_EXIT_CODE : normalizeExitCode(error),
        executionDuration: Date.now() - startedAt,
        timedOut,
      });
    });

    timeoutId =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;

            try {
              process.kill(-child.pid, 'SIGTERM');
            } catch {
              child.kill('SIGTERM');
            }

            forceKillTimeoutId = setTimeout(() => {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch {
                child.kill('SIGKILL');
              }
            }, KILL_GRACE_MS);
          }, timeout)
        : null;
  });
}
