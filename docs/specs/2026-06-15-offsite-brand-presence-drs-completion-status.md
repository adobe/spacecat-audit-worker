# Spec: DRS job completion status for `offsite-brand-presence`

- **Status:** Proposed
- **Date:** 2026-06-15
- **Audit:** `offsite-brand-presence`

## Problem statement

When the `offsite-brand-presence` audit is triggered manually from Slack, it submits
one or more scrape jobs to the LLMO Data Retrieval Service (DRS) and immediately posts
a Slack message listing the created `job_id`s (`notifyDrsResults` in
`src/offsite-brand-presence/handler.js`). The Lambda then exits.

DRS scrape jobs run asynchronously and finish minutes later. Today there is **no
feedback in Slack about whether those jobs actually completed**. A user who triggered
the command has to look up each `job_id` in DRS by hand to learn the outcome.

We want a follow-up Slack message, in the same thread, reporting the final status of
the jobs once they finish.

## Goals

- Post **one summary message** to the same Slack thread once **all** submitted jobs
  reach a terminal DRS status.
- Include per-job final status and surface the error for any failed job.
- Bound the wait: if some jobs are still running after a maximum budget (~20 minutes),
  post the summary anyway and mark those jobs as still running.
- Ship entirely within `spacecat-audit-worker`. **No changes** to DRS, the
  `spacecat-shared-drs-client`, or infrastructure.
- Only applies to **manual Slack-triggered runs** (those that carry a `slackContext`).
  Scheduled runs have no Slack thread and are unaffected.

## Non-goals

- Per-job streaming updates (a message as each individual job finishes).
- Persisting completion status to the audit result DB record.
- Event-driven (SNS) tracking or DRS-side batch-aggregation events.
- Tracking jobs that failed *at submission time* — those are already reported by the
  existing immediate `notifyDrsResults` message and have no `job_id` to poll.

## Background

`drsClient.getJob(jobId)` (`GET /jobs/{job_id}`) returns the job record, including:

- `status` — one of `QUEUED`, `RUNNING`, `PENDING_SCRAPES` (non-terminal) or
  `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED`, `CANCELLED` (terminal).
- `error_message` / `error_type` — populated on failure.

Scrape jobs typically finish in ~2–5 minutes; async providers can take longer.

The audit worker already supports delayed self-re-enqueue: handlers call
`context.sqs.sendMessage(queueUrl, message, msgGroupId, delaySeconds)` against the
`audits` queue (`configuration.getQueues().audits`), capped at the SQS
`DelaySeconds` hard limit of 900s. This is the same mechanism `cdn-analysis` uses to
stagger `cdn-logs-report` triggers.

`postMessageOptional(context, channelId, text, { threadTs })` posts only when both
`channelId` and `threadTs` are present, otherwise no-ops.

## Technical design

### Approach: delayed polling via SQS self-re-enqueue

A new lightweight message type, `offsite-brand-presence-drs-status`, is enqueued by the
runner after a successful DRS submission and handled by a dedicated poll handler that
re-enqueues itself with a delay until all jobs are terminal or the deadline passes.

### 1. Runner change (`src/offsite-brand-presence/handler.js`)

Unchanged: `notifyDrsResults` still posts the immediate `job_id` notification.

After that, when **both** of these hold:
- a `slackContext` with `channelId` and `threadTs` is present, and
- at least one job was submitted successfully (has a `job_id`),

enqueue a delayed poll message to the `audits` queue:

```js
{
  type: 'offsite-brand-presence-drs-status',
  siteId,
  auditContext: {
    baseURL,
    slackContext: { channelId, threadTs },
    jobs: [{ domain, datasetId, jobId }, ...],   // successful jobs only
    deadline: Date.now() + DRS_POLL_MAX_WAIT_SECONDS * 1000,
  },
}
```

Sent with `delaySeconds = DRS_POLL_INTERVAL_SECONDS` (first poll is delayed, not
immediate). The runner's own return value is unchanged.

### 2. Poll handler (`src/offsite-brand-presence/drs-status-handler.js`)

Registered in `src/index.js` `HANDLERS` as `'offsite-brand-presence-drs-status'`. A
plain `async (message, context)` handler (same shape as `drsPromptGenerationHandler`).

Logic per invocation:

1. Read `jobs`, `slackContext`, `baseURL`, `deadline` from `auditContext`.
2. For each tracked job, call `drsClient.getJob(jobId)` and read `status`.
   - A `getJob` call that throws is treated as **not yet terminal** for this cycle, so
     a transient DRS error makes us keep polling rather than abort.
3. If **every** job is terminal (`DRS_TERMINAL_STATUSES`):
   - Post the summary to the Slack thread via `postMessageOptional`.
   - Return `ok()`.
4. Else if `Date.now() >= deadline`:
   - Post the summary anyway; jobs that are still non-terminal are reported as
     `still running (timed out waiting after 20m)`.
   - Return `ok()`.
5. Else (jobs pending, budget remaining):
   - Re-enqueue the **same** message (unchanged `deadline`) with
     `delaySeconds = min(DRS_POLL_INTERVAL_SECONDS, secondsUntilDeadline, 900)`.
   - Return `ok()`.

Using an absolute `deadline` (rather than an attempt counter) keeps re-enqueues
stateless and holds the wait budget regardless of variable SQS delivery timing.

### 3. Summary message format

```
:checkered_flag: offsite-brand-presence DRS jobs complete for example.com:
• reddit / reddit_comments → COMPLETED
• youtube / youtube → COMPLETED_WITH_ERRORS
:x: Failed (1):
• top-cited / top_cited → FAILED: <error_message>
```

Jobs still running at the deadline are listed with a `still running (timed out
waiting)` note.

### 4. Constants (`src/offsite-brand-presence/constants.js`)

```js
export const DRS_POLL_INTERVAL_SECONDS = 120;   // 2 min between polls
export const DRS_POLL_MAX_WAIT_SECONDS = 1200;  // 20 min total budget
export const DRS_TERMINAL_STATUSES = new Set([
  'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED',
]);
```

## Files

| Action | File |
|--------|------|
| edit | `src/offsite-brand-presence/handler.js` — enqueue poll after successful submission |
| new  | `src/offsite-brand-presence/drs-status-handler.js` — poll handler |
| edit | `src/offsite-brand-presence/constants.js` — constants |
| edit | `src/index.js` — register `offsite-brand-presence-drs-status` handler |
| new  | `test/audits/offsite-brand-presence-drs-status.test.js` — tests (100% coverage) |

## Testing

New test file covering, at minimum:

- All jobs terminal on first poll → single summary posted, no re-enqueue.
- Mixed outcomes (`COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED` with error) → summary
  lists each, failures show error message.
- Some jobs still pending, budget remaining → re-enqueue with correct delay, no Slack post.
- Deadline passed with pending jobs → summary posted, pending jobs marked still running.
- `getJob` throws for a job → treated as non-terminal, re-enqueue happens.
- Missing/empty `slackContext` → guard; no post (defensive, even though the runner
  gates enqueue).

Runner test additions:

- With `slackContext` + ≥1 successful job → poll message enqueued with expected shape
  and delay.
- Without `slackContext` (scheduled run) → no poll message enqueued.
- All jobs failed at submission (no `job_id`) → no poll message enqueued.

Coverage must remain 100% lines/branches/statements.

## Alternatives considered

- **Event-driven via existing DRS SNS → `audit-jobs` subscription (LLMO-1819).**
  Idiomatic and real-time, mirroring `drs-prompt-generation`. Rejected for now because
  DRS completion events arrive one-per-job, so producing a *single* summary requires a
  persistent run-state store, an expected-count, concurrency handling, and an infra
  filter-policy change to admit the scrape `provider_id`. Higher cost for this feature.

- **DRS batch aggregation (`BATCH_AGGREGATION_COMPLETED`).** Cleanest if DRS already
  emits a single batch-completion event for scrape jobs. Rejected because it likely
  requires DRS-side changes and verification; out of scope for an audit-worker-only
  change.

Polling was chosen because the single-summary requirement becomes trivial (the handler
sees all jobs and the Slack context in one message), it needs no DB, no DRS metadata
round-trip, and no infra change.

## Success criteria

- A manual Slack `offsite-brand-presence` run posts a completion summary in the same
  thread within ~20 minutes of the immediate `job_id` notification.
- The summary correctly reflects each job's terminal status and shows errors for
  failures.
- Scheduled runs post no completion summary and incur no polling.
- No regressions in existing `offsite-brand-presence` behavior; coverage stays at 100%.
