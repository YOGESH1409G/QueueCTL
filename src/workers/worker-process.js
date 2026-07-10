import { runWorkerRuntime } from './worker-runtime.js';

await runWorkerRuntime({
  writePidFile: false,
});
