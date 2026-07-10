# QueueCTL — Design Decisions

This document answers the internship assignment decision questions for the QueueCTL implementation.

---

## Which exact code prevents duplicate execution?

Duplicate execution is prevented by a single atomic MongoDB `findOneAndUpdate()` in `WorkerLoop.claimNextJob()` (`src/workers/worker-loop.js`).

The update only succeeds when all of these are true at claim time:

- `state = pending`
- `nextRetryAt <= now`
- `runAt` is null or `runAt <= now`

The update atomically transitions exactly one matching document to `processing` and sets:

- `startedAt`
- `claimedByWorkerId`
- `leaseExpiresAt`

MongoDB guarantees that only one worker process can win the update for a given job document. There is no read-modify-write race because claim and state transition happen in one database operation.

Equivalent guarantee in SQL terms: this is an atomic `UPDATE ... WHERE state='pending' ... LIMIT 1` inside a single database transaction.

---

## How crash recovery works after SIGKILL?

SIGKILL cannot be handled by Node.js. When a worker is killed with SIGKILL:

1. The worker stops immediately with no cleanup.
2. The job remains in `processing`, but its `leaseExpiresAt` stops being renewed.
3. Another worker's poll loop calls `JobRecoveryService.recoverStuckJobs()` on every iteration.
4. Recovery selects jobs where:
   - `state = processing`
   - and either `leaseExpiresAt <= now`
   - or legacy fallback: `leaseExpiresAt` is null and `startedAt` is older than `stuckJobTimeoutMs`
5. Recovered jobs are moved back to `pending` with:
   - `nextRetryAt = now`
   - lease fields cleared
   - `attempts` incremented
   - an explanatory `error` message

Recovery also runs on worker startup, so a full process restart still heals stale jobs.

Worker heartbeats are separate: `WorkerRegistryService.cleanStaleWorkers()` marks dead worker records as `stopped`, but job recovery is driven by job lease expiry, not only worker heartbeat loss.

---

## Worst-case recovery delay

Default configuration:

- `jobLeaseMs = 30_000` (30 seconds)
- worker poll interval = `1_000` ms (1 second)

Worst case timeline after SIGKILL:

1. Worker dies immediately after renewing a lease.
2. Job remains `processing` until `leaseExpiresAt`.
3. Another worker discovers the expired lease on its next poll.

Worst-case delay:

`jobLeaseMs + pollIntervalMs = ~31 seconds`

This is under the required 60-second bound.

Configurable upper bound remains capped at `55_000` ms for `jobLeaseMs`, so worst-case recovery stays below 60 seconds with default polling.

---

## Should DLQ retry reset attempts? Why?

Yes. `retryDeadJob()` in `src/services/dlq.service.js` resets `attempts` to `0`.

Reason:

- A manual DLQ retry is an operator-driven requeue, not an automatic retry of the same failure chain.
- Resetting attempts gives the job a fresh retry budget and avoids immediate re-dead-lettering on the first failure.
- The job still keeps its original `maxRetries` snapshot from enqueue time.
- Lease and processing metadata are also cleared so the job re-enters the queue cleanly.

Automatic worker retries do not reset attempts; only manual DLQ recovery does.

---

## Worker stop design choices

QueueCTL uses two complementary mechanisms:

### 1. PID file (`.queuectl/worker.pid`)

Written when a foreground worker (`--count 1`) or supervisor (`--count > 1`) starts.

`queuectl worker stop` reads this file and sends `SIGTERM` to the recorded PID. This enables cross-terminal shutdown without needing the original shell session.

### 2. MongoDB worker registry stop flag

`WorkerRegistryService.requestStop()` sets `stopRequestedAt` on active workers.

The worker loop checks `shouldStop()` before each poll. This provides a database-backed stop signal in addition to OS signals.

### Graceful shutdown behavior

- `SIGINT` / `SIGTERM`: worker stops claiming new jobs, finishes the current command, persists final state, marks worker stopped, removes PID file, disconnects MongoDB.
- `queuectl worker stop`: sends `SIGTERM` to the PID file process and marks active workers for stop in MongoDB.
- `SIGKILL`: intentionally unsupported for graceful shutdown; simulates crash and relies on lease recovery.

Foreground mode (`--count 1`) runs the worker in the current terminal process instead of forking, which satisfies the assignment's foreground worker requirement while preserving multi-worker mode via supervisor fork.

---

## Future priority queue design

Current priority support is already persisted on each job:

- `priority`: `HIGH | MEDIUM | LOW`
- `priorityRank`: numeric sort key

Claim order today:

1. lowest `priorityRank` first
2. oldest `createdAt` within the same priority band

Future improvements without breaking the CLI:

1. Add optional weighted fair queueing per tenant or queue name.
2. Add `queueName` to jobs with compound indexes like `{ queueName, state, priorityRank, createdAt }`.
3. Support delayed priority escalation, e.g. promote long-waiting `LOW` jobs after N minutes.
4. Add a dedicated `queuectl promote <jobId>` command for manual priority changes.
5. Keep atomic claim semantics unchanged: priority should affect sort order in the claim query, not introduce pre-read races.

The existing `findOneAndUpdate({ state: pending, ... }, ..., { sort })` pattern scales to richer priority rules as long as sorting remains part of the atomic claim operation.
