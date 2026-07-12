# QueueCTL

**[🎥 Watch the Demo Video Here](#)** *(Replace `#` with your actual video link)*

QueueCTL is a highly-scalable, production-minded CLI background job queue built with Node.js, MongoDB, Mongoose, Commander.js, and `child_process`. 

It supports enqueueing shell commands, multi-worker processing, MongoDB-backed retries, dead-letter queue management, crash recovery, worker registry metadata, metrics, and a real-time monitoring dashboard.

## Tech Stack



## Architecture

```text
CLI Commands
  enqueue | list | status | config | worker | dlq | metrics | dashboard
        |
        v
Service Layer
  JobService | RetryService | JobRecoveryService | JobLeaseService
  WorkerRegistryService | WorkerControlService | ConfigService
        |
        v
MongoDB Collections
  jobs | configs | workers
        |
        v
Worker Runtime
  worker start -> WorkerLoop -> child_process.exec()
```

### Why MongoDB instead of SQLite?

While many simple local queues default to SQLite, QueueCTL was deliberately architected with **MongoDB** to satisfy modern, distributed production requirements:

1. **True Concurrency via Document-Level Locking**: SQLite relies on database-level or table-level locks, which create severe bottlenecks when multiple workers attempt to claim jobs simultaneously. MongoDB's `findOneAndUpdate` provides atomic, document-level locking. This allows QueueCTL to scale to dozens of concurrent workers without lock contention or deadlocks.
2. **Horizontal Scalability (Cloud-Native)**: A local SQLite file restricts your worker pool to a single physical machine. By decoupling the persistence layer into MongoDB, QueueCTL workers can be distributed across multiple servers, containers, or pods, all coordinating against a centralized MongoDB cluster.
3. **Rich Data Structures**: QueueCTL tracks complex metadata (e.g., historical retry timestamps, nested worker heartbeats, and configuration arrays). MongoDB's BSON format natively supports these without the need for rigid schema migrations or stringified JSON columns.
4. **Resilience & High Availability**: MongoDB Replica Sets provide automatic failover and data redundancy, ensuring that the queue remains operational and jobs are never lost even if a database node goes down.

### Core design choices

- MongoDB is the centralized source of truth for jobs, retries, leases, config, and worker metadata.
- Workers claim jobs with one atomic `findOneAndUpdate()` operation, completely eliminating race conditions.
- Processing jobs carry a lease (`leaseExpiresAt`) that must be renewed while executing.
- Recovery is database-driven and robust against worker crashes.
- Foreground worker mode (`--count 1`) runs in the current terminal process.
- Multi-worker mode (`--count N`) uses a supervisor that forks isolated child processes.

See also:

- [DESIGN.md](./DESIGN.md) for full system design
- [DECISIONS.md](./DECISIONS.md) for assignment decision answers

## Getting Started

```bash
npm install
cp .env.example .env
npm start -- --help
```

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `NODE_ENV` | Runtime environment name | `development` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/queuectl` |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | MongoDB connect timeout | `5000` |
| `LOG_LEVEL` | Winston log level | `info` |

## CLI Commands

### Enqueue

```bash
queuectl enqueue '{"command":"echo Hello"}'
queuectl enqueue '{"command":"sleep 5","timeout":2000,"priority":"HIGH"}'
```

### List jobs

```bash
queuectl list
queuectl list --state completed
queuectl list --state pending --json
```

`--json` prints only a JSON array to stdout. Errors go to stderr.

### Worker lifecycle

```bash
# Foreground worker in current terminal
queuectl worker start

# Multiple OS processes
queuectl worker start --count 3

# Stop from another terminal
queuectl worker stop
```

#### Foreground behavior

- `queuectl worker start` blocks in the foreground.
- `Ctrl+C` (`SIGINT`) and `SIGTERM` stop claiming new jobs, finish the current job, persist state, then exit.
- `SIGKILL` simulates a crash and skips cleanup.

#### Cross-process stop

`queuectl worker stop` uses:

1. `.queuectl/worker.pid` to find the running worker/supervisor PID
2. MongoDB worker registry `stopRequestedAt` as a secondary stop signal

### Status, metrics, config, DLQ

```bash
queuectl status
queuectl metrics
queuectl config get
queuectl config set --max-retries 3 --job-lease-ms 30000
queuectl dlq list
queuectl dlq retry <jobId>
queuectl dashboard --port 3000
```

## Crash Recovery

Jobs must never remain permanently in `processing`.

QueueCTL uses a lease + heartbeat model:

1. On claim, a job gets `claimedByWorkerId` and `leaseExpiresAt`.
2. While executing, the worker renews the lease every 10 seconds.
3. On every poll, workers run `JobRecoveryService.recoverStuckJobs()`.
4. Expired leases are moved back to `pending`.

Default worst-case recovery:

- `jobLeaseMs = 30s`
- poll interval = `1s`
- worst case ~= `31s` (< 60s requirement)

Recovery works after:

- worker `SIGKILL`
- terminal kill
- full process restart

## Atomic Locking Explanation

Job claiming is atomic because MongoDB applies this as one operation:

```js
findOneAndUpdate(
  { state: 'pending', nextRetryAt: { $lte: now }, ... },
  { $set: { state: 'processing', claimedByWorkerId, leaseExpiresAt, startedAt } },
  { sort: { priorityRank: 1, createdAt: 1 } }
)
```

Only one worker can transition a given pending job to `processing`. No duplicate execution occurs across multiple OS processes.

## Worker Registry

Active workers are persisted in MongoDB with:

- `workerId`
- `pid`
- `startedAt`
- `lastHeartbeatAt`
- `runtimeState` (`idle` / `busy`)
- `currentJobId`
- `stopRequestedAt`

Stale workers are automatically marked `stopped` when heartbeats age out.

## Testing

### Unit tests

```bash
npm run check
npm test
npm run test:jest
```

### End-to-end validation script

Requires MongoDB running locally:

```bash
chmod +x scripts/validate-e2e.sh
npm run validate:e2e
```

The script validates:

- successful job execution
- retry + DLQ behavior
- multi-worker processing
- `SIGKILL` recovery
- restart persistence
- strict `list --json` stdout contract

### Manual demo flow

```bash
# Terminal 1
npm start -- worker start

# Terminal 2
npm start -- enqueue '{"command":"echo demo"}'
npm start -- enqueue '{"command":"exit 1"}'
npm start -- list --state completed --json
npm start -- status
npm start -- worker stop
```

## Demo Recording Section

Suggested 3-5 minute demo script:

1. Show `queuectl --help` and `config get`.
2. Enqueue one success job and one failing job.
3. Start `queuectl worker start` in foreground.
4. Show `status`, `list`, and `metrics`.
5. Show `dlq list` after retries exhaust.
6. Open a second terminal and run `queuectl worker stop`.
7. Optional crash demo:
   - enqueue `{"command":"sleep 30"}`
   - start worker
   - `kill -9 <worker-pid>`
   - restart worker
   - show job recovered to `pending` within ~30 seconds

## Project Structure

```text
src/
  commands/       CLI handlers
  services/       business logic
  models/         Mongoose schemas
  workers/        worker loop + runtime
  database/       MongoDB connection
  dashboard/      Express monitoring UI
  utils/          env + logging
  constants/      shared constants
scripts/
  validate-e2e.sh automated assignment validation
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Run CLI |
| `npm test` | Node.js unit tests |
| `npm run test:jest` | Jest bonus tests |
| `npm run check` | Syntax check all source files |
| `npm run validate:e2e` | Full assignment validation against MongoDB |

## Graceful Shutdown Summary

| Signal / Action | Behavior |
| --- | --- |
| `SIGINT` / `SIGTERM` | Finish current job, persist, exit |
| `queuectl worker stop` | Send stop signal via PID file + registry |
| `SIGKILL` | No cleanup; lease recovery requeues job |

## License

MIT
