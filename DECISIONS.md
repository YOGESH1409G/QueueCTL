# QueueCTL — Design Decisions

This document answers the internship assignment decision questions for the QueueCTL implementation.

---

## 1. Which exact line(s) prevent two workers from claiming the same job, and why is that operation atomic across separate OS processes?

The prevention lives in **`src/workers/worker-loop.js`, lines 153–175**, inside `claimNextJob()`:

```javascript
const job = await this.jobModel
  .findOneAndUpdate(                          // line 154 — the atomic gate
    {
      state: JOB_STATES.PENDING,              // line 156 — only match unclaimed jobs
      nextRetryAt: { $lte: now },             // line 157 — respect retry schedule
      $or: [{ runAt: null }, { runAt: { $lte: now } }], // line 158 — respect scheduled time
    },
    {
      $set: {
        state: JOB_STATES.PROCESSING,         // line 162 — atomically transition to claimed
        claimedByWorkerId: this.workerId,      // line 165 — stamp owner
        leaseExpiresAt,                        // line 166 — start the lease clock
      },
    },
    {
      sort: { priorityRank: 1, createdAt: 1 }, // line 172 — deterministic job selection
    }
  )
  .exec();
```

**Why this is atomic across separate OS processes:**

MongoDB executes `findOneAndUpdate` as a **single atomic server-side operation** — the filter, the update, and the document return happen in one step, protected by MongoDB's internal document-level write lock.

Because the operation runs on the MongoDB server (not inside the Node.js process), it doesn't matter whether two workers are:
- threads in the same process,
- separate Node.js processes on the same machine (`--count 3` forks), or
- separate machines pointing at the same MongoDB cluster.

The first worker to reach the MongoDB server wins the document lock. The second worker's `findOneAndUpdate` runs after the first one commits, finds `state = "processing"` (no longer `"pending"`), and returns `null` — so it never executes the job. There is no read-then-write window, no compare-and-swap, no advisory lock needed.

This is the **same guarantee as `SELECT ... FOR UPDATE SKIP LOCKED`** in PostgreSQL — atomicity is enforced by the database server, not by application-level coordination.

---

## 2. A worker is SIGKILL'd halfway through a job. Walk through, step by step, what state the job is in and how it eventually runs again. What is the worst-case delay before recovery?

### Step-by-step state walkthrough

| Step | What Happens | Job State |
|------|--------------|-----------|
| 1 | Worker claims the job | `processing` — `claimedByWorkerId` set, `leaseExpiresAt` = now + 30s |
| 2 | Worker executes the shell command | `processing` — lease heartbeat renews `leaseExpiresAt` every ~10s |
| 3 | `kill -9 <pid>` sent mid-execution | `processing` — process dies instantly, no cleanup possible |
| 4 | `leaseExpiresAt` clock keeps ticking | `processing` — nobody renews the lease because the worker is gone |
| 5 | Lease expires (up to 30s later) | `processing` — job is now eligible for recovery |
| 6 | A new worker starts (or existing worker's poll fires) | `JobRecoveryService.recoverStuckJobs()` runs |
| 7 | Recovery query finds the expired-lease job | `pending` — `attempts` incremented, lease cleared, `nextRetryAt = now` |
| 8 | Worker's next poll claims the recovered job | `processing` → `completed` or `failed` |

**The exact recovery query** (`src/services/job-recovery.service.js`):
```javascript
{ state: 'processing', leaseExpiresAt: { $lte: now } }
```
Jobs matching this are moved back to `pending` with `attempts++`.

### Worst-case delay calculation

```
jobLeaseMs         = 30,000 ms  (last renewal just happened before SIGKILL)
+ poll interval    =  1,000 ms  (recovery runs on the next poll tick)
─────────────────────────────
Worst case         ≈ 31,000 ms  (~31 seconds)
```

This is **well within the required 60-second bound.**

`jobLeaseMs` is configurable but is capped at `55,000 ms` in the validation layer, so worst-case recovery always stays below 60 seconds with default polling.

---

## 3. Does `dlq retry` reset `attempts`? Why is that the right call?

**Yes.** `retryDeadJob()` in `src/services/dlq.service.js` resets `attempts` to `0`.

### Why resetting is the right call

A job reaches the DLQ because it failed `maxRetries + 1` times. At that point its `attempts` counter equals `maxRetries + 1`.

If `dlq retry` did **not** reset attempts, the job would re-enter the queue with `attempts` already at the limit. The very first failure after the DLQ retry would find `shouldRetry()` returning `false` (because `attempts > maxRetries`) and the job would immediately return to the DLQ — giving the operator zero actual retry budget. This would make `dlq retry` functionally useless.

By resetting `attempts = 0`:
- The job gets a **fresh, full retry budget** — the operator's intent when they manually trigger a retry.
- It distinguishes a **manual, operator-driven requeue** from the automatic failure chain.
- The job still retains its original `maxRetries` snapshot from enqueue time — so the policy still applies, just from a clean slate.

**Automatic worker retries** (mid-failure-chain) do **not** reset `attempts` — only DLQ recovery does. This distinction is intentional: automatic retries are part of the same failure chain; DLQ retries are a human decision to give the job another chance.

---

## 4. What designs did you consider and reject for `worker stop` (cross-process signaling), and why?

QueueCTL uses two complementary mechanisms: a **PID file** and a **MongoDB stop flag**. Here is why several alternatives were considered and rejected:

### Rejected: Named pipes / Unix sockets

**Considered:** Open a named socket (`/tmp/queuectl.sock`) so `worker stop` could send a message directly to the running worker process.

**Rejected because:**
- Requires the socket file to be created by the running worker at startup and cleaned up on exit — fragile on crash.
- Only works on the same machine; breaks in containerized or distributed deployments.
- Adds file-descriptor management and cleanup complexity with no meaningful benefit over SIGTERM.

### Rejected: In-memory shared state / `SharedArrayBuffer`

**Considered:** Use a shared memory segment or `SharedArrayBuffer` to set a "stop" flag that worker threads/processes could poll.

**Rejected because:**
- Node.js worker threads share memory but OS-forked child processes do not — each `fork()` gets a separate memory space.
- Would require migrating to `worker_threads` instead of `child_process.fork()`, which changes the entire process isolation model.
- Doesn't survive process restarts at all.

### Rejected: HTTP endpoint on the worker

**Considered:** Workers could expose a local HTTP server; `worker stop` would `POST /stop` to it.

**Rejected because:**
- Requires port management, port conflict detection, and cleanup on crash.
- Adds a server-side attack surface to what is intentionally a CLI tool.
- Overly complex for a problem that SIGTERM already solves cleanly.

### Rejected: Polling a local file flag

**Considered:** `worker stop` writes a `.stop` file; workers poll the filesystem every second.

**Rejected because:**
- Redundant given MongoDB is already the source of truth.
- Adds a second stateful artifact (file) that must be cleaned up and can desync from database state.
- No benefit over the MongoDB registry stop flag, which already provides the same polling mechanism with richer metadata.

### What was chosen and why

| Mechanism | Reason |
|-----------|--------|
| **PID file + SIGTERM** | Instant, OS-native, works across terminal sessions, requires no additional infrastructure |
| **MongoDB `stopRequestedAt` flag** | Survives cases where PID file is stale; provides a database-backed stop signal visible to all workers; enables graceful stop of distributed workers |

Foreground mode (`--count 1`) runs directly in the current process, so `Ctrl+C` (`SIGINT`) is the natural stop mechanism — no PID file needed.

---

## 5. If priorities were added tomorrow (high-priority jobs jump the queue), which parts of your design survive unchanged and which break?

### What survives unchanged ✅

| Component | Why it survives |
|-----------|-----------------|
| **Atomic claim query** | The `sort: { priorityRank: 1, createdAt: 1 }` is already in the `findOneAndUpdate` call. Adding or changing priority rules is a sort-key change only — no new locks, no race conditions introduced. |
| **`priority` and `priorityRank` fields** | Both fields already exist on every job document. `HIGH=1, MEDIUM=2, LOW=3` is already persisted and indexed. |
| **MongoDB index** | The compound index `{ state, nextRetryAt, priorityRank, createdAt }` already covers priority-aware claiming. |
| **Job schema and model** | No migration needed — `priority` and `priorityRank` are already part of the Mongoose schema with validation. |
| **CLI enqueue payload** | `{"command":"...", "priority":"HIGH"}` already works today. |
| **Worker loop** | Workers already use the priority-sorted claim query — no code change needed to make high-priority jobs jump the queue. |

### What breaks or needs attention ⚠️

| Component | Why it breaks / needs change |
|-----------|------------------------------|
| **`dlq retry`** | Today it requeues with `nextRetryAt = now` but does not preserve or elevate priority. A retried dead job re-enters at its original priority, which might be correct — but if the intent is "urgent retry", there is no mechanism to escalate priority on DLQ retry without a code change. |
| **`worker stop` graceful drain** | If a high-priority job arrives while a worker is draining (has set `isRunning = false`), the worker will finish its current job and then exit — the high-priority job will sit pending until a new worker starts. There is no "priority preemption" in the current graceful shutdown path. |
| **`status` and `metrics` display** | Currently shows counts by state only. If priority SLAs matter (e.g., "all HIGH jobs must start within 5s"), there is no per-priority latency metric today — this would need to be added to `MetricsService`. |
| **Starvation of LOW jobs** | If HIGH jobs arrive continuously, LOW jobs can wait indefinitely because the claim query always takes the lowest `priorityRank` first. A weighted fair-queue or aging mechanism (promote LOW jobs after N minutes) would need to be added to prevent starvation. |

### Summary

The **core atomicity guarantee is completely unaffected** — priority is just a sort key in the atomic claim. What breaks is higher-level policy: starvation prevention, priority-aware draining, and SLA observability. These are addable without redesigning the worker loop or data model.
