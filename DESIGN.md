# QueueCTL — Architecture & Design

This document describes the system architecture, component boundaries, data flow, and design decisions used in **QueueCTL**, a CLI-based background job queue backed by MongoDB.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Tech Stack](#tech-stack)
3. [High-Level Architecture](#high-level-architecture)
4. [Project Structure](#project-structure)
5. [Layered Design](#layered-design)
6. [Data Models](#data-models)
7. [Job Lifecycle](#job-lifecycle)
8. [Producer Flow (Enqueue)](#producer-flow-enqueue)
9. [Consumer Flow (Workers)](#consumer-flow-workers)
10. [Retry & Dead Letter Queue](#retry--dead-letter-queue)
11. [Configuration System](#configuration-system)
12. [Worker Registry & Heartbeats](#worker-registry--heartbeats)
13. [Stuck Job Recovery](#stuck-job-recovery)
14. [Command Executor](#command-executor)
15. [CLI Design](#cli-design)
16. [Web Dashboard](#web-dashboard)
17. [Observability & Logging](#observability--logging)
18. [Database Indexes & Query Patterns](#database-indexes--query-patterns)
19. [Concurrency & Atomicity](#concurrency--atomicity)
20. [Graceful Shutdown](#graceful-shutdown)
21. [Environment & Configuration](#environment--configuration)
22. [Testing Architecture](#testing-architecture)
23. [Design Decisions Summary](#design-decisions-summary)

---

## System Overview

QueueCTL is a **producer–consumer job queue** where:

- **Producers** enqueue shell commands via the CLI (`queuectl enqueue`).
- **Consumers** are worker processes that poll MongoDB, atomically claim jobs, execute commands via `child_process`, and persist results.
- **MongoDB** is the single source of truth for job state, retry scheduling, configuration, and worker heartbeats.
- **No in-memory schedulers** — retry timing is stored as `nextRetryAt` timestamps and evaluated at poll time.

```
┌─────────────┐     enqueue      ┌──────────────┐     claim/update    ┌─────────────┐
│   CLI /     │ ───────────────► │   MongoDB    │ ◄────────────────── │   Worker    │
│  Dashboard  │                  │  (jobs,      │                     │  Processes  │
└─────────────┘                  │   config,    │                     └──────┬──────┘
       │                         │   workers)   │                            │
       │                         └──────────────┘                            │
       │                                ▲                                    │
       └──────── status / metrics ──────┘                                    │
                                                                             ▼
                                                                    child_process.exec()
                                                                    (shell commands)
```

---

## Tech Stack

| Layer | Technology | Role |
|-------|------------|------|
| Runtime | Node.js ≥ 22.12 (ES Modules) | CLI, workers, dashboard |
| Database | MongoDB + Mongoose 9 | Persistence, atomic updates |
| CLI | Commander.js 15 | Command parsing & routing |
| Web UI | Express 5 + Bootstrap 5 (CDN) | Monitoring dashboard |
| Logging | Winston + winston-daily-rotate-file | Structured & rotated logs |
| Execution | `node:child_process` | Shell command execution |
| Process model | `node:child_process.fork()` | Multi-worker isolation |
| Config | dotenv | Environment variables |
| Terminal UX | chalk | Colored CLI output |
| Testing | Node.js test runner + Jest | Unit & integration tests |

---

## High-Level Architecture

The system follows a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│   CLI Commands (Commander)  │  Express Dashboard (HTTP)         │
├─────────────────────────────────────────────────────────────────┤
│                         Service Layer                            │
│  JobService │ ConfigService │ RetryService │ StatusService      │
│  MetricsService │ DlqService │ WorkerRegistryService             │
│  JobRecoveryService │ JobOutputLogService                        │
├─────────────────────────────────────────────────────────────────┤
│                          Worker Layer                            │
│  WorkerSupervisor → worker-process → WorkerService → WorkerLoop  │
│                                    → executor (child_process)    │
├─────────────────────────────────────────────────────────────────┤
│                          Data Layer                              │
│  Mongoose Models: Job │ Config │ Worker                          │
│  connection.js (connect / disconnect / state)                    │
├─────────────────────────────────────────────────────────────────┤
│                       Infrastructure                             │
│  env.js │ logger.js │ constants/                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Dependency direction:** Commands and workers call services; services call models. Workers do not import commands. Models do not import services.

---

## Project Structure

```
QueueCTL/
├── src/
│   ├── index.js                 # CLI entry point (Commander bootstrap)
│   ├── commands/                # CLI command handlers (thin layer)
│   │   ├── index.js             # Registers all commands
│   │   ├── enqueue.command.js
│   │   ├── list.command.js
│   │   ├── status.command.js
│   │   ├── config.command.js
│   │   ├── worker.command.js
│   │   ├── dlq.command.js
│   │   ├── metrics.command.js
│   │   └── dashboard.command.js
│   ├── services/                # Business logic & database operations
│   │   ├── job.service.js
│   │   ├── config.service.js
│   │   ├── retry.service.js
│   │   ├── dlq.service.js
│   │   ├── status.service.js
│   │   ├── metrics.service.js
│   │   ├── worker.service.js
│   │   ├── worker-registry.service.js
│   │   ├── job-recovery.service.js
│   │   └── job-output-log.service.js
│   ├── models/                  # Mongoose schemas
│   │   ├── job.model.js
│   │   ├── config.model.js
│   │   └── worker.model.js
│   ├── workers/                 # Background processing
│   │   ├── worker-supervisor.js # Forks N worker child processes
│   │   ├── worker-process.js    # Child process entry (per worker)
│   │   ├── worker-loop.js       # Poll → claim → execute → persist
│   │   └── executor.js          # child_process.exec wrapper
│   ├── dashboard/
│   │   └── dashboard-app.js     # Express app factory
│   ├── database/
│   │   └── connection.js        # MongoDB connect/disconnect singleton
│   ├── utils/
│   │   ├── env.js               # Environment variable parsing
│   │   └── logger.js            # Winston logger setup
│   └── constants/
│       ├── app.constants.js
│       ├── job.constants.js
│       ├── config.constants.js
│       └── worker.constants.js
├── test/                        # Node.js native test files
├── jest-tests/                  # Jest test files (bonus features)
├── logs/                        # Runtime logs (gitignored)
├── clear_db.js                  # Dev utility: wipe all jobs
├── inspect_db.js                # Dev utility: dump jobs
└── reset_job.js                 # Dev utility: reset stuck processing jobs
```

---

## Layered Design

### 1. Presentation Layer — Commands

Commands are **thin orchestrators**. They:

- Parse CLI arguments (Commander)
- Connect to MongoDB
- Delegate to services
- Render human-readable output (tables, chalk formatting)
- Disconnect and set `process.exitCode` on failure

Commands never contain business rules or direct Mongoose query logic beyond what services expose.

### 2. Service Layer

Services encapsulate **domain logic** and **database access**:

| Service | Responsibility |
|---------|----------------|
| `JobService` | Create, read, list, update, purge jobs |
| `ConfigService` | Read/write persisted queue configuration |
| `RetryService` | Backoff calculation, schedule retry, move to DLQ |
| `DlqService` | List dead jobs, retry dead jobs |
| `StatusService` | Aggregate job counts + active worker count |
| `MetricsService` | Execution stats, rates, throughput, retry distribution |
| `WorkerRegistryService` | Register workers, heartbeats, busy/idle state |
| `JobRecoveryService` | Recover stuck `processing` jobs |
| `JobOutputLogService` | Write per-job stdout/stderr log files |

Services accept optional injected dependencies (`jobModel`, `configService`, `now`) for testability.

### 3. Worker Layer

| Component | Responsibility |
|-----------|----------------|
| `WorkerSupervisor` | Parent process; forks N workers via IPC |
| `worker-process.js` | Child entry; DB connect, registry, heartbeat, shutdown |
| `WorkerService` | Thin wrapper around `WorkerLoop` |
| `WorkerLoop` | Core poll-claim-execute-persist loop |
| `executor.js` | Runs shell commands with timeout & output capture |

### 4. Data Layer

Three Mongoose collections:

- **`jobs`** — Job documents and lifecycle state
- **`configs`** — Singleton queue configuration
- **`workers`** — Worker registration and heartbeats

Connection is managed by a **singleton promise** in `connection.js` to avoid duplicate connections within a process.

---

## Data Models

### Job Model (`jobs` collection)

| Field | Type | Description |
|-------|------|-------------|
| `jobId` | String (UUID) | Unique immutable identifier |
| `command` | String | Shell command to execute (max 4096 chars) |
| `state` | Enum | `pending`, `processing`, `completed`, `failed`, `dead`, `retrying` |
| `priority` | Enum | `HIGH`, `MEDIUM`, `LOW` |
| `priorityRank` | Number | 1=HIGH, 2=MEDIUM, 3=LOW (for sort) |
| `timeout` | Number \| null | Max execution time in ms |
| `runAt` | Date | Earliest time job is eligible to run |
| `attempts` | Number | Number of failed execution attempts |
| `maxRetries` | Number | Max retries before DLQ (copied from config at enqueue) |
| `nextRetryAt` | Date | Earliest time a retried job can be claimed |
| `output` | String | Primary output (stdout on success) |
| `stdout` / `stderr` | String | Captured streams |
| `exitCode` | Number | Process exit code |
| `executionDuration` | Number | Execution time in ms |
| `timedOut` | Boolean | Whether command hit timeout |
| `logFilePath` | String | Path to per-job log file |
| `error` | String | Error message on failure |
| `startedAt` / `completedAt` | Date | Execution timestamps |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps |

**Validation highlights:**
- `completedAt >= startedAt`
- `attempts <= maxRetries + 1`
- `priorityRank` auto-set from `priority` via pre-validate hook

### Config Model (`configs` collection)

| Field | Default | Description |
|-------|---------|-------------|
| `configKey` | `"default"` | Singleton key |
| `maxRetries` | 3 | Max retry attempts per job |
| `backoffBase` | 2 | Exponential backoff base |
| `retryJitterMs` | 1000 | Random jitter added to retry delay |
| `defaultJobTimeoutMs` | 0 | Default timeout (0 = disabled) |
| `stuckJobTimeoutMs` | 300000 (5 min) | Age before recovering stuck jobs |

If no config document exists, `ConfigService.getConfig()` returns hardcoded defaults with `source: "defaults"`.

### Worker Model (`workers` collection)

| Field | Description |
|-------|-------------|
| `workerId` | Unique ID (`{supervisorId}-{slot}`) |
| `pid` | OS process ID |
| `state` | `active` or `stopped` |
| `runtimeState` | `idle` or `busy` |
| `currentJobId` | Job being processed (when busy) |
| `startedAt` | Worker start time |
| `lastHeartbeatAt` | Last heartbeat timestamp |
| `stoppedAt` | Shutdown time |

---

## Job Lifecycle

```
                    ┌──────────┐
                    │  enqueue │
                    └────┬─────┘
                         ▼
                   ┌───────────┐
            ┌─────►│  pending  │◄─────────────────┐
            │      └─────┬─────┘                  │
            │            │ worker claims           │ scheduleRetry()
            │            ▼ (atomic)               │
            │      ┌─────────────┐                  │
            │      │ processing  │                  │
            │      └──────┬──────┘                  │
            │             │                         │
            │      ┌──────┴──────┐                  │
            │      ▼             ▼                  │
            │ ┌──────────┐  ┌────────┐             │
            │ │completed │  │ failed │─────────────┘
            │ └──────────┘  └───┬────┘   (if attempts <= maxRetries)
            │                   │
            │                   │ moveToDLQ()
            │                   ▼ (if attempts > maxRetries)
            │              ┌────────┐
            └──────────────│  dead  │◄── dlq retry (manual)
                           └────────┘
```

### State Definitions

| State | Meaning |
|-------|---------|
| `pending` | Queued, waiting to be claimed |
| `processing` | Claimed by a worker, command running |
| `completed` | Command exited with code 0 |
| `failed` | Command failed; may be retried or moved to DLQ |
| `dead` | Exhausted retries; in dead letter queue |
| `retrying` | Defined in constants; transitions go through `pending` with `nextRetryAt` |

**Terminal states:** `completed`, `dead`

---

## Producer Flow (Enqueue)

```
User CLI
   │
   ▼
enqueue.command.js
   │  parseEnqueuePayload() — JSON validation
   ▼
connectDatabase()
   ▼
JobService.createJob()
   │  ConfigService.getConfig() → maxRetries, defaultJobTimeoutMs
   │  normalizePriority(), normalizeRunAt(), normalize timeout
   │  Job.create({ jobId: UUID, state: pending, nextRetryAt: runAt, ... })
   ▼
disconnectDatabase()
   │
   ▼
Print jobId to user
```

**Enqueue payload schema:**

```json
{
  "command": "echo Hello",       // required
  "priority": "HIGH",          // optional: HIGH | MEDIUM | LOW
  "timeout": 5000,             // optional: ms
  "runAt": "2026-07-15T18:30:00Z"  // optional: ISO date
}
```

---

## Consumer Flow (Workers)

### Process Hierarchy

```
queuectl worker start --count 3
         │
         ▼
  WorkerSupervisor (parent, PID X)
         │
         ├── fork → worker-process.js (worker 1, PID X+1)
         ├── fork → worker-process.js (worker 2, PID X+2)
         └── fork → worker-process.js (worker 3, PID X+3)
```

Each forked child receives environment variables:
- `QUEUECTL_WORKER_ID` — `{supervisorUuid}-{slot}`
- `QUEUECTL_WORKER_SLOT` — `"1"`, `"2"`, etc.

### Worker Loop (per child process)

```
worker-process.js starts
   │
   ├── connectDatabase()
   ├── WorkerRegistryService.markWorkerStarted()
   ├── startHeartbeat() every 5s
   │
   └── WorkerService.start() → WorkerLoop.run()
           │
           ├── JobRecoveryService.recoverStuckJobs()  (once at startup)
           │
           └── while (isRunning):
                 │
                 ├── claimNextJob()
                 │     findOneAndUpdate(
                 │       { state: pending, nextRetryAt <= now, runAt <= now },
                 │       { $set: { state: processing, startedAt: now } },
                 │       { sort: { priorityRank: 1, createdAt: 1 } }
                 │     )
                 │
                 ├── onJobStart → markWorkerBusy()
                 ├── executor(command, { timeout })
                 │
                 ├── exitCode === 0 → markJobCompleted()
                 │                      writeJobLog()
                 │
                 └── exitCode !== 0 → recordFailedAttempt()
                                        shouldRetry?
                                          yes → scheduleRetry() → pending
                                          no  → moveToDLQ() → dead
                 │
                 ├── onJobFinish → markWorkerIdle()
                 └── wait 1000ms (poll interval)
```

### Job Claiming Sort Order

Workers claim jobs in this priority:

1. **Highest priority first** (`priorityRank` ascending: HIGH=1, MEDIUM=2, LOW=3)
2. **Oldest first** (`createdAt` ascending)

This ensures urgent jobs are processed before lower-priority backlog.

---

## Retry & Dead Letter Queue

### Retry Logic (`RetryService`)

```
On failure:
  1. recordFailedAttempt() → state=failed, attempts++
  2. shouldRetry(job)?  attempts <= maxRetries
     │
     yes → scheduleRetry()
           delay = backoffBase^attempts seconds + random(0..retryJitterMs)
           nextRetryAt = now + delay
           state = pending
     │
     no  → moveToDLQ()
           state = dead
           completedAt = now
```

**Example** with `backoffBase=2`, `retryJitterMs=1000`, attempt 3:
- Delay = 2³ = 8 seconds + up to 1000ms jitter

### DLQ Operations

| Command | Action |
|---------|--------|
| `queuectl dlq list` | List jobs with `state=dead`, sorted by `updatedAt` desc |
| `queuectl dlq retry <jobId>` | Reset job: `state=pending`, `attempts=0`, `nextRetryAt=now` |

### Key Design Choice

Retry scheduling is **MongoDB-backed**, not in-memory `setTimeout`. This means:

- Retries survive worker restarts
- Multiple workers safely respect `nextRetryAt` via the claim query
- No timer leaks or orphaned schedules

---

## Configuration System

Configuration is stored in MongoDB (`configs` collection) with a singleton `configKey: "default"`.

```
queuectl config get
   └── ConfigService.getConfig()
         ├── findOne({ configKey: "default" })
         └── fallback to DEFAULT_CONFIG constants

queuectl config set --max-retries 3 --backoff-base 2
   └── ConfigService.setConfig()
         └── findOneAndUpdate upsert with validation
```

**Config is read at:**
- Job creation (`maxRetries`, `defaultJobTimeoutMs`)
- Retry scheduling (`backoffBase`, `retryJitterMs`)
- Stuck job recovery (`stuckJobTimeoutMs`)

Existing jobs retain their snapshot `maxRetries` from enqueue time; config changes affect new jobs only.

---

## Worker Registry & Heartbeats

Workers register themselves in MongoDB for observability and accurate `status` counts.

```
Worker starts  → markWorkerStarted(workerId, pid)
Every 5s       → heartbeat(workerId)  → updates lastHeartbeatAt
Job claimed    → markWorkerBusy(workerId, jobId)
Job finished   → markWorkerIdle(workerId)
Worker stops   → markWorkerStopped(workerId)
```

**Active worker count** = workers where:
- `state = active`
- `lastHeartbeatAt >= now - 15s` (stale threshold)

This prevents crashed workers from appearing as active indefinitely.

---

## Stuck Job Recovery

`JobRecoveryService.recoverStuckJobs()` runs once when each worker starts.

**Query:** jobs where `state=processing` AND `startedAt <= now - stuckJobTimeoutMs`

**Action:**
- Set `state=pending`, `nextRetryAt=now`
- Clear `startedAt`, `completedAt`
- Set error message: `"Recovered stuck processing job after worker interruption."`
- Increment `attempts`

This handles worker crashes mid-execution without leaving jobs permanently stuck in `processing`.

---

## Command Executor

`executor.js` wraps `child_process.exec()` with:

| Feature | Implementation |
|---------|----------------|
| Output capture | stdout + stderr (max 1MB buffer each) |
| Timeout | Optional ms timeout; kills process group on expiry |
| Timeout exit code | `124` (convention) |
| Process group | `detached: true` → kill via `process.kill(-pid)` |
| Grace period | SIGTERM first, SIGKILL after 1s |
| Duration tracking | `executionDuration` in milliseconds |

Workers pass `job.timeout` from the job document (set at enqueue or from config default).

---

## CLI Design

Built with **Commander.js**. Entry point: `src/index.js`.

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `enqueue <payload>` | — | Queue a JSON command payload |
| `list` | `--state`, `--jobId`, `--limit` | Tabular job listing |
| `status` | — | Queue health summary |
| `config` | `get`, `set` | Read/write queue config |
| `worker` | `start --count N` | Start worker processes |
| `dlq` | `list`, `retry <jobId>` | Dead letter queue management |
| `metrics` | — | Aggregated queue metrics |
| `dashboard` | `--port` | Start web monitoring UI |

**Error handling pattern:** All commands catch MongoDB connection errors and print a user-friendly message. Exit code `1` on failure.

---

## Web Dashboard

Express 5 app created by `createDashboardApp()` in `dashboard-app.js`.

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | Overview cards + processing jobs table |
| `/jobs` | GET | Filterable job list (`?state=`, `?search=`) |
| `/dlq` | GET | Dead letter queue with retry buttons |
| `/dlq/:jobId/retry` | POST | Retry a dead job |
| `/metrics` | GET | Metrics cards |
| `/config` | GET | Config JSON view |

- Auto-refreshes every **3 seconds** via `<meta http-equiv="refresh">`
- Bootstrap 5 styling via CDN
- HTML escaped to prevent XSS
- Shares the same services as the CLI (no duplicated business logic)

---

## Observability & Logging

### Application Logs (Winston)

| Transport | Output | Format |
|-----------|--------|--------|
| Console | stdout | Colored, human-readable |
| Daily rotate file | `logs/queuectl-YYYY-MM-DD.log` | JSON, 14-day retention |
| Error rotate file | `logs/queuectl-error-YYYY-MM-DD.log` | JSON, 30-day retention |

### Worker Logs

Workers use `logger.structured()` with metadata:

```json
{
  "level": "info",
  "message": "Processing job abc-123",
  "workerId": "supervisor-uuid-1",
  "workerSlot": "1",
  "timestamp": "..."
}
```

### Per-Job Output Logs

`JobOutputLogService` writes `logs/{jobId}.log` containing:
- Metadata (timestamp, jobId, command, status, exitCode, duration, timedOut)
- stdout, stderr, error sections

### Metrics (`MetricsService`)

| Metric | Source |
|--------|--------|
| totalJobs, completed, failed, dead, pending | Aggregation by state |
| averageExecutionTime | `$avg` of `executionDuration` |
| averageRetryCount | `$avg` of `attempts` |
| successRate / failureRate | Computed percentages |
| longestRunningJob / fastestJob | `$max` / `$min` of duration |
| jobsPerMinute | Count of jobs created in last 60s |
| retryCountDistribution | Group by `attempts` |
| workerCount | Active workers from registry |

---

## Database Indexes & Query Patterns

### Jobs Collection

| Index | Purpose |
|-------|---------|
| `{ jobId: 1 }` unique | Lookup by ID |
| `{ state: 1, createdAt: -1 }` | List/filter by state |
| `{ state: 1, nextRetryAt: 1, runAt: 1, priorityRank: 1, createdAt: 1 }` | **Worker claim query** |
| `{ state: 1, startedAt: 1 }` | Stuck job recovery |
| `{ createdAt: -1 }` | Default list sort |

### Configs Collection

| Index | Purpose |
|-------|---------|
| `{ configKey: 1 }` unique | Singleton config lookup |

### Workers Collection

| Index | Purpose |
|-------|---------|
| `{ workerId: 1 }` unique | Worker lookup |
| `{ state: 1, lastHeartbeatAt: -1 }` | Active worker queries |
| `{ state: 1, runtimeState: 1, lastHeartbeatAt: -1 }` | Filter by runtime state |

### Critical Query — Job Claiming

```javascript
findOneAndUpdate(
  {
    state: 'pending',
    nextRetryAt: { $lte: now },
    $or: [{ runAt: null }, { runAt: { $lte: now } }]
  },
  { $set: { state: 'processing', startedAt: now, error: null } },
  { sort: { priorityRank: 1, createdAt: 1 }, returnDocument: 'after' }
)
```

This single atomic operation prevents two workers from claiming the same job.

---

## Concurrency & Atomicity

| Operation | Mechanism |
|-----------|-----------|
| Job claiming | `findOneAndUpdate` with filter on `state=pending` |
| Job completion/failure | `findOneAndUpdate` on `{ jobId }` |
| Retry scheduling | `findOneAndUpdate` sets `state=pending` + `nextRetryAt` |
| DLQ move | `findOneAndUpdate` sets `state=dead` |
| Config update | `findOneAndUpdate` with upsert |
| Worker heartbeat | `findOneAndUpdate` on `{ workerId, state: active }` |
| Stuck recovery | `updateMany` on stale processing jobs |

**No distributed locks.** MongoDB atomic document updates provide sufficient concurrency control for this single-cluster design.

**Multi-worker isolation:** Each worker runs in a separate Node.js process (fork) with its own event loop and MongoDB connection, preventing one slow job from blocking others.

---

## Graceful Shutdown

### Worker Supervisor (parent)

```
SIGINT / SIGTERM received
   └── supervisor.stop(reason)
         └── for each child: child.send({ type: 'shutdown', reason })
         └── wait for all children to exit
         └── resolve start() promise
```

### Worker Process (child)

```
shutdown message / SIGINT / SIGTERM
   └── workerService.stop() → isRunning = false
         └── current job finishes (finally block runs)
         └── stopHeartbeat()
         └── markWorkerStopped()
         └── disconnectDatabase()
         └── process.disconnect()
```

**Key behavior:** Workers do **not** kill running commands on shutdown. The current job completes and its final state is persisted before exit.

---

## Environment & Configuration

### Environment Variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/queuectl` | MongoDB connection string |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | `5000` | Connection timeout |
| `LOG_LEVEL` | `info` | Winston log level |

### Worker Environment (set by supervisor)

| Variable | Description |
|----------|-------------|
| `QUEUECTL_WORKER_ID` | Unique worker identifier |
| `QUEUECTL_WORKER_SLOT` | Worker slot number (1..N) |

---

## Testing Architecture

Two test runners are used:

| Runner | Location | Command |
|--------|----------|---------|
| Node.js native | `test/*.test.js` | `npm test` |
| Jest | `jest-tests/*.jest.js` | `npm run test:jest` |

**Testing patterns:**
- Services accept injected mocks (`jobModel`, `configService`, `now`)
- Worker loop tested with mock job models and silent loggers
- Commands tested for payload parsing and rendering
- Executor tested with real short-lived shell commands
- No test database required for unit tests (mocks used)

**Syntax validation:** `npm run check` runs `node --check` on every source file.

---

## Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| **MongoDB as queue backend** | **Scalability & Concurrency:** MongoDB provides robust, atomic document-level locking (`findOneAndUpdate`). This guarantees that concurrent workers can claim jobs without the severe lock contention and deadlocks typically seen in SQLite. Additionally, MongoDB inherently supports horizontal scalability, allowing the worker pool to be distributed across multiple physical servers. |
| Poll-based workers (1s interval) | Simple, reliable; no change streams or pub/sub complexity |
| `findOneAndUpdate` for claiming | Prevents double-processing without distributed locks |
| Forked worker processes | Process isolation; one slow job doesn't block others |
| MongoDB-backed retry scheduling | Survives restarts; no in-memory timer leaks |
| Exponential backoff + jitter | Reduces thundering herd on retry |
| Config snapshot at enqueue | Job retry policy stable even if config changes later |
| Heartbeat-based worker counting | Accurate active worker count; stale workers excluded |
| Stuck job recovery on worker start | Self-healing after crashes |
| Per-job log files | Durable audit trail of command output |
| Thin commands, fat services | Testable business logic; reusable from CLI and dashboard |
| Winston with daily rotation | Production-ready log management |
| Priority + FIFO within priority | Important jobs processed first, fair ordering within tier |

---

## Future Extension Points

The architecture supports extension without structural changes:

- **New job states** — add to `JOB_STATES` constant and model enum
- **New CLI commands** — register in `commands/index.js`, delegate to services
- **New metrics** — extend `MetricsService` aggregations
- **Alternative executors** — inject custom executor into `WorkerLoop`
- **Webhook notifications** — hook into `onJobStart` / `onJobFinish` callbacks
- **Rate limiting** — add middleware or service layer before claim query
- **Multi-tenant queues** — add `queueName` field with compound indexes
