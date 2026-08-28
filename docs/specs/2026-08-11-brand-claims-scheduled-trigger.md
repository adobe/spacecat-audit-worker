# Spec: Brand Claims Scheduled Trigger (`brand-claims` audit)

- Status: Implemented
- Epic: LLMO-5741 (Brand Claims: GA Readiness)
- Related: [LLMO-7177](https://jira.corp.adobe.com/browse/LLMO-7177) (per-site DRS-vs-Semrush
  source decision on the trigger) · ADR
  [`docs/decisions/006-brand-claims-drs-vs-semrush-source.md`](../decisions/006-brand-claims-drs-vs-semrush-source.md)

## Problem Statement

Brand Claims needs a **weekly, per-site trigger**: for each enabled site, the DRS
`BRAND_PRESENCE_SHEET_WRITTEN` ready-signal must be (re)published so the mystique Brand
Claims consumer runs. Today this is only doable by hand via the api-service
`run-brand-claims` Slack command. There is no automated, scheduled path.

## Goals

- One operation, per `siteId`, that publishes the ready-signal for the brand's latest Brand
  Presence sheet (the **run**).
- Schedulable weekly through the audit worker's existing dispatch (no new infrastructure).
- Reuse the api-service command logic (same S3 discovery + event contract) so the automated
  and manual paths stay consistent.

**Enabling is out of scope — the gate is the opt-in list.** Flipping the brand's
`brand_claims_enabled` gate is done separately (the existing `enable-brand-claims` Slack
command) and is deliberately kept out of this handler. The flag is the per-site opt-in
switch: this audit **reads** it and, when it is off, skips the run entirely (no ready-signal
published). That lets us schedule the audit broadly while only the enabled sites generate
claims — disabling a site's gate stops its weekly claims without touching the schedule, and
sites whose existing claims we don't want to override are simply left disabled.

## Non-Goals

- No scraping / distribution — DRS produces the BP sheets; this only re-publishes the
  ready-signal for an already-written sheet.
- No new queues / CDK / provider framework. (A DRS-provider implementation was prototyped
  and rejected as disproportionate — see Alternatives.)
- Weekly scheduling wiring itself (a `spacecat-jobs-dispatcher` cron + per-site handler
  enablement in the Configuration) is a config change tracked separately, not part of this
  handler.
- DRS-side de-duplication (suppressing DRS's own on-upload emit for scheduled sites) is a
  separate change in `llmo-data-retrieval-service` (PR #2912).

## Technical Design

New audit type `brand-claims`, registered in `src/index.js` `HANDLERS`. It is a **plain
`async (message, context) => Response` handler, not an `AuditBuilder` audit** — see below.

Flow (`src/brand-claims/handler.js`), for a message `{ type: 'brand-claims', siteId }`:

1. Resolve the site (prefetched `context.site` or `Site.findById`) and its SpaceCat org UUID.
2. Resolve the single active brand for the site via PostgREST (`brands` table;
   `organization_id` + `status='active'` + `site_id`, deterministic tiebreak, LLMO-4592).
   The read is inspection-only — the handler never writes the `brands` table (enable is
   out of scope; see Problem Statement).
3. **Gate** — if `brand_claims_enabled` is off, log and ack with no further work (no S3
   listing, no ready-signal). Only enabled brands proceed.
3b. **Source decision (per site, LLMO-7177)** — decide DRS-sheet vs Semrush-feed for THIS
   site before running. Semrush is chosen only when it is enabled for the run (env
   `BRAND_CLAIMS_SEMRUSH_ENABLED=true`, or the per-run Slack override `enableSemrush` —
   tri-state, override wins over env, mirroring `offsite-brand-presence`'s `resolveEnableSemrush`)
   **AND** the brand is entitled to it (`resolveSemrushEntitlement` — the shared "serenity flag
   AND resolvable Semrush workspace" gate, fail-closed with reason codes). Anything else —
   disabled, non-entitled, an inconclusive entitlement check, or no parseable base URL for the
   feed's `domain` — falls back to the unchanged DRS path, so a Semrush hiccup can never zero
   out a site that has a DRS sheet. The decision runs **before** the `brandSlug` guard: the
   Semrush feed is keyed by `domain`, not the S3 brand-slug path component, so a brand whose
   name sanitizes to an empty slug can still run on the feed path.
4. **Run** —
   - *DRS branch:* build the S3 prefix `{siteId}/{brandSlug}/analytics/chatgpt_free/` (brand
     slug via `sanitizePathComponent`, byte-for-byte with DRS) and select the latest sheet
     (max by S3 date partition, then `LastModified`).
   - *Semrush branch:* **skip the S3 prefix build and sheet lookup entirely** — there is no
     sheet. Derive the registrable `domain` from the site's base URL (shared `toApexHost`) and
     the `(week, year)` run window (explicit `week`+`year` from the message if supplied and
     valid — replay-stable across a DLQ redrive — else the current ISO week).
5. **Emit** — publish `BRAND_PRESENCE_SHEET_WRITTEN` to `SQS_BP_SHEET_READY_QUEUE_URL`.
   `organization_id` = SpaceCat org UUID (the BP consumer feeds it into
   `/v2/orgs/{spaceCatId}/…`, which 400s on an IMS org id), plus `brand_id`, `brand` slug,
   `site_id`, `week`, `year`, `cadence: "weekly"`, `platform`. **New in LLMO-7177:** the event
   carries an additive `ingest_source` on **both** branches (default `brand_presence_s3` when
   absent, so a pre-7177 consumer is unaffected) — `brand_presence_s3` on the DRS branch,
   `semrush_feed` on the Semrush branch — and `domain` (the registrable domain) on the Semrush
   branch. Sheet-scoped fields differ by branch: the DRS branch sets `sheet_date`, `s3_bucket`,
   `s3_key` from the resolved sheet; the Semrush branch sets all three to `null`. Same queue,
   backward-compatible.

Env (from Vault): `SQS_BP_SHEET_READY_QUEUE_URL`, `DRS_BP_BUCKET`. Feature gate (env, optional,
default off): `BRAND_CLAIMS_SEMRUSH_ENABLED` — see ADR 006.

**Failure policy.** Infra/config faults throw so SQS retries and the message hits the DLQ:
missing `SQS_BP_SHEET_READY_QUEUE_URL` / `DRS_BP_BUCKET` / PostgREST client, PostgREST
errors, S3 listing failure, SQS publish failure. Genuine business no-ops warn/info + ack:
missing `siteId`, no active brand, brand not enabled for claims, brand slug empty, no sheet yet.

**Why not `AuditBuilder`.** This handler audits no URL and persists no audit result — it is
a side-effecting operational trigger (publish an SQS event). `AuditBuilder`'s
validate-site / resolve-URL / persist / post-process machinery does not apply. This matches
the existing plain-handler precedent in the repo (`rum-config-refresh`,
`offsite-brand-presence-drs-status`, `dummy`), now documented in CLAUDE.md.

## Alternatives

- **DRS `brand_claims` provider** (llmo-data-retrieval-service): a new SYNC provider + CDK
  nested stack (2 SQS queues + DLQ + ESM) + IAM/SSM. Rejected — ~700 lines of infra to send
  one weekly message; the audit-worker path reuses existing dispatch for a fraction of the
  code.
- **Keep the manual Slack commands.** Rejected — not scheduled / not automatable.

## Success Criteria

- A scheduled weekly run emits exactly one ready-signal per enabled site (with DRS-side
  suppression, PR #2912, preventing a duplicate on-upload emit).
- Infra/config errors surface via SQS retry + DLQ (never silently acked); business no-ops
  ack without retry.
- The handler is read-only against the `brands` table (no enable side-effect).
- A brand with `brand_claims_enabled = false` is skipped: no S3 listing, no ready-signal.
- 100% line/branch/statement coverage on `src/brand-claims/handler.js`.
