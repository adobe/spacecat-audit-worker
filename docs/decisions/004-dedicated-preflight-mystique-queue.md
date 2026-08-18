# 004 — Dedicated SQS Queue + Consumer Pool for Preflight-to-Mystique Traffic

- **Status:** Proposed
- **Date:** 2026-08-17
- **Repos affected:** spacecat-infrastructure, spacecat-audit-worker, mystique

## Context

Preflight's readability "suggest" step sends one SQS message per flagged
paragraph to Mystique on the shared `spacecat-to-mystique` queue, and the
job (`readability-suggest` guidance handler) only completes once **all**
per-paragraph answers return — there is no timeout or partial-completion
path.

In the incident that prompted this ADR (SITES-49801), a customer
(Dover, via CS) ran Preflight on `motor-bearing-protection.html`
(`inpro-seal.com`) and the suggest step spun for 30+ minutes before the
MFE's `AuditTimeoutError` fired (`MAX_POLLING_TIME = 1800s`). The job
actually completed ~62 minutes in — long after the UI had stopped
listening. Traced root cause:

1. **`spacecat-to-mystique` is a single shared queue** for ~40 audit
   types' outbound Mystique traffic, bulk/scheduled and interactive
   Preflight alike. `MessageGroupId`-based fairness in audit-worker's
   `src/support/sqs.js` is a no-op today because the queue is a
   *standard*, not FIFO, queue.
2. On the Mystique side, the consumer is a single in-process
   `ThreadPoolExecutor` (`TASK_WORKERS=2`, `MAX_TASK_QUEUE_SIZE=4`) shared
   across all message types. `is_queue_at_capacity()` halts **all**
   receiving — interactive included — once more than 2 opportunities are
   already tracked. No heartbeat/visibility-extension happens while a
   message waits for a free worker; only after a worker starts does it
   extend the visibility timeout. Combined with the default 3600s
   visibility timeout, a message can sit invisible for up to an hour
   before redelivery.
3. Confirmed via Langfuse that the AI compute itself is fast and healthy
   (~14s/paragraph, no retries, no errors) — the entire delay is
   consumer pickup/scheduling latency, not model compute. 7-day queue
   stats show this isn't a one-off: oldest-message age p50 15.4h, p90
   52.1h, backlog spikes to ~13,000, with two other slow-run traceIds
   (`bed87e2d…`, `c63fe808…`) showing the same pattern.
4. Preflight's all-or-nothing completion makes this worse than for bulk
   audits: it just takes one straggler paragraph, caught behind a bulk
   burst, to hold an entire user-facing run hostage.

Because Preflight is an on-demand feature with a user watching the
screen, and Walmart is ramping up to ~300 authors on legacy V1 Preflight
imminently, we need to decouple Preflight's Mystique traffic from bulk
audit traffic rather than just tuning shared capacity.

**This ADR is explicitly a stopgap, not the destination.** A different
team hit the same class of problem — legacy-stack task starvation
blocking a customer-critical flow — for Impact Engine (IME) traffic
inside Mystique. They shipped an isolated request/response queue pair
(`ime-to-mystique` / `mystique-to-ime`, mystique#4179) as a fast interim
fix, explicitly labeled "Alternative Design / Approach B" against a
wiki spec, and reviewers pushed back hard on doing it at the legacy V1
level at all — citing product-decision concerns (prioritization
shouldn't be hardcoded per one-off caller) and destabilization risk
from running three parallel stacks (v1, v1-extended, v2) at once.
Approach B shipped anyway given IME's low volume and a real deadline,
but was then **fully reverted** (mystique#4284) once the durable fix —
routing through Blackboard V2's `control_task_queue` at `priority=1`,
riding the same fleet-wide `ORDER BY priority DESC` claim path every
other V2 task already uses (mystique#4285, "Approach C") — landed.
Reviewers raised the identical concern on this ADR's own thread; we're
proceeding anyway for the same reason IME did (small volume, real
customer deadline, weeks until Preflight V2 can absorb this natively),
but with the explicit understanding that this queue has the same
retire-on-V2-arrival lifecycle IME's did — see Decision #4 and
Follow-ups.

## Decision

Introduce an isolated request lane for Preflight's SQS traffic to
Mystique, spanning three repos:

1. **spacecat-infrastructure** — provision a new standard SQS queue
   `spacecat-to-mystique-preflight` (`modules/sqs/queues.tf`), mirroring
   the existing `spacecat_queue_spacecat_to_mystique` resource, with its
   own DLQ so preflight-specific backlog/age metrics are distinguishable
   from bulk's. Output the queue URL for downstream env wiring.
2. **spacecat-audit-worker** — in
   `src/readability/shared/async-mystique.js`, `sendPreflightMessages`
   branches on `mode === 'preflight'` to publish to a new
   `env.QUEUE_SPACECAT_TO_MYSTIQUE_PREFLIGHT` instead of
   `env.QUEUE_SPACECAT_TO_MYSTIQUE`. `sendOpportunityBatch` (bulk path)
   is untouched. Scope is intentionally limited to readability-preflight
   — the proven offender — not all ~40 handlers that currently share
   `QUEUE_SPACECAT_TO_MYSTIQUE`.
3. **mystique** — add a second, independent consumer modeled directly
   on the existing `BpEventConsumer` precedent
   (`app/services/claims/bp_event_consumer.py`, which already mirrors
   `opportunity_service.py`'s transport/poll shape with its own queue
   URL and its own capacity gate). The new consumer reads a new
   `SQS_SPACECAT_TO_MYSTIQUE_PREFLIGHT_QUEUE_URL`, owns its own
   `TaskManager` sized by its own env vars (independent of the bulk
   pool's `TASK_WORKERS`/`MAX_TASK_QUEUE_SIZE`), and reuses the existing
   `guidance:readability` task/routing logic unchanged (routing is
   already keyed by message `type`/`mode`, not by queue). Started/stopped
   in `server.py`'s lifespan alongside `opportunity_service` and
   `bp_event_consumer`; no-ops when the env var is unset, per existing
   convention.
4. **Kill switch (spacecat-audit-worker)** — gate the mode-based branch
   in `sendPreflightMessages` behind an explicit
   `PREFLIGHT_MYSTIQUE_QUEUE_ENABLED` flag, checked *in addition to*
   `mode === 'preflight'`. When unset or `false`, preflight traffic
   falls back to the existing shared `QUEUE_SPACECAT_TO_MYSTIQUE` path
   unconditionally — so the new lane can be turned off instantly via a
   config change in the per-environment Helix Deploy params, with no
   code revert or PR. This was requested explicitly during ADR review
   (see References) precisely because this is a stopgap: we want a
   one-flag rollback available while we watch it in prod, not a
   git-revert-and-redeploy cycle. The mystique-side consumer already
   gets the equivalent for free — it no-ops at startup if
   `SQS_SPACECAT_TO_MYSTIQUE_PREFLIGHT_QUEUE_URL` is unset — but that
   requires a redeploy to take effect, which is why the producer-side
   flag is the one that actually matters operationally.

## Alternatives Considered

- **Increase shared `TASK_WORKERS`/`MAX_TASK_QUEUE_SIZE` globally.**
  Rejected: raises the ceiling for everyone, but bulk-audit bursts are
  free to consume the added capacity too — doesn't guarantee Preflight
  gets serviced promptly, which is the actual requirement.
- **Batch all paragraphs into a single SQS message** (reduce fan-out
  from N messages to 1, reusing the `sendOpportunityBatch` pattern for
  preflight). This was raised in the incident thread as a quick
  mitigation and narrows exposure, but doesn't remove shared-queue
  starvation risk — a single batched message can still starve behind
  bulk traffic. Treat as a complementary, independent hardening step,
  not a substitute for queue isolation.
- **Bounded wait / partial-completion in the guidance handler** so one
  late paragraph can't hold the whole job open past the client's
  1800s budget. Also complementary — improves user-visible behavior
  under residual tail latency, but doesn't address root cause. Worth
  doing regardless of this ADR's outcome.
- **Dedicated Mystique pod/deployment for Preflight** (full
  infrastructure-level isolation via `mystique-deploy`). Deferred: an
  in-process second consumer with its own thread pool is sufficient to
  decouple scheduling from bulk traffic today; pod-level isolation is a
  future step if noisy-neighbor effects persist at the infra level too.
- **Route V1 Preflight readability onto the V2 direct-HTTP path**
  (Preflight V2 already bypasses SQS/Mystique-queue entirely via
  in-process `PreflightExecutor`). Rejected for now: not all legacy V1
  crews (including `guidance:readability`) are ported to V2 yet, and the
  migration timeline doesn't fit before the Walmart rollout. Revisit
  once readability's V2 migration lands — this queue may become
  obsolete at that point.

## Consequences

- New env vars needed across three repos:
  `QUEUE_SPACECAT_TO_MYSTIQUE_PREFLIGHT` (audit-worker + infrastructure);
  `SQS_SPACECAT_TO_MYSTIQUE_PREFLIGHT_QUEUE_URL` plus
  worker-pool-sizing vars (mystique).
- New DLQ and CloudWatch metrics give preflight-specific observability
  (age, backlog, not-visible count) separate from bulk audit traffic —
  net improvement for future triage.
- Preflight capacity is structurally decoupled from bulk-audit burst
  behavior; the existing bulk pool and its callers are unaffected.
- Slightly more operational surface inside Mystique (two consumers to
  monitor/tune instead of one).
- Does not fix underlying LLM-provider variability if that ever becomes
  the bottleneck — out of scope; Langfuse confirms compute is healthy
  today.
- Does not require a dedicated *response* queue (unlike IME's
  `mystique-to-ime`, see Context). IME needed one because its caller
  (Impact Engine / LLMO) had no pre-existing consumer on
  `mystique-to-spacecat` at all — there was no shared return leg to
  hook into. Preflight doesn't have that gap: on the Mystique side,
  every task-completion path (`OpportunityService`, confirmed in
  `app/services/opportunity_service.py`) publishes results via a single
  `SQSClient.send_message()` call that always targets
  `SQS_MYSTIQUE_TO_SPACECAT_QUEUE_URL`, regardless of which request
  queue the task came from. Our new preflight consumer publishing
  through that same shared client is enough — spacecat-audit-worker's
  existing `mystique-to-spacecat` consumer already routes replies by
  `auditId`/`siteId` (`AsyncJob.findById`, per
  `src/readability/preflight/guidance-handler.js`), not by source queue.

## Rollout Plan

1. **spacecat-infrastructure**: provision queue + DLQ, publish output.
2. **mystique**: ship the new consumer env-var-gated (no-op until
   configured), deploy, and validate against a manually-sent test
   message before any producer depends on it.
3. **spacecat-audit-worker**: flip `sendPreflightMessages` to the new
   queue once the mystique consumer is confirmed live.
4. Burn-in: monitor `ApproximateAgeOfOldestMessage` and
   `ApproximateNumberOfMessagesNotVisible` on the new queue against the
   SITES-49801 baseline before declaring done.

## Follow-ups

- **File a separate ADR/story for Preflight's V2 migration** — the
  durable replacement for this queue, analogous to IME's Approach C
  (mystique#4285): route Preflight's Mystique-bound work through
  Blackboard V2's priority-aware dispatch instead of a bespoke SQS
  lane. Once that lands and is verified, revert this ADR's dedicated
  queue the same way mystique#4284 reverted mystique#4179. This ADR's
  scope is deliberately limited to buying time until that follow-up
  ships, not to building V1 out further.
- Current `MessageGroupId` fairness logic in audit-worker's
  `src/support/sqs.js` is a no-op on standard queues; revisit whether
  the new preflight queue should be FIFO if fairness *within* preflight
  traffic itself becomes necessary.
- Consider a shorter visibility timeout for the new consumer specifically
  (vs. Mystique's 3600s default), given Preflight's latency sensitivity.
- Pod-level isolation for the new consumer in `mystique-deploy`, if
  noisy-neighbor issues persist after this change ships.
- Land the bounded-wait/partial-completion guidance-handler change
  (see Alternatives) independent of this ADR's timeline.

## References

- Jira: [SITES-49801](https://jira.corp.adobe.com/browse/SITES-49801)
  (linked to SITES-48938, "[Preflight] V2 API performance & efficiency")
- Slack (incident triage): https://cq-dev.slack.com/archives/C0A91S5UKRC/p1786561838978239
- Slack (customer report): https://cq-dev.slack.com/archives/C08LJBRDQ4S/p1786544952696649
- Slack (IME precedent thread, referenced during this ADR's review):
  https://cq-dev.slack.com/archives/C0A91S5UKRC/p1786018489506739
- IME precedent PRs: mystique#4179 (isolated `ime-to-mystique` queue,
  stopgap), mystique#4284 (revert of #4179), mystique#4285 (durable
  fix — `control_task_queue` priority dispatch, "Approach C")
