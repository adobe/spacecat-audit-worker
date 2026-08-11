# Spec: Brand Claims Scheduled Trigger (`brand-claims` audit)

- Status: Implemented
- Epic: LLMO-5741 (Brand Claims: GA Readiness)

## Problem Statement

Brand Claims needs a **weekly, per-site trigger**: for each enabled site, the
`brand_claims_enabled` gate must be on and the DRS `BRAND_PRESENCE_SHEET_WRITTEN`
ready-signal must be (re)published so the mystique Brand Claims consumer runs. Today this
is only doable by hand via two api-service Slack commands (`enable-brand-claims` +
`run-brand-claims`). There is no automated, scheduled path.

## Goals

- One operation, per `siteId`, that (1) enables the brand's `brand_claims_enabled` gate and
  (2) publishes the ready-signal for the brand's latest Brand Presence sheet.
- Schedulable weekly through the audit worker's existing dispatch (no new infrastructure).
- Reuse the api-service command logic (same S3 discovery + event contract) so the automated
  and manual paths stay consistent.

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

1. Resolve the site (prefetched `context.site` or `Site.findById`) and its IMS org.
2. Resolve the single active brand for the site via PostgREST (`brands` table;
   `organization_id` + `status='active'` + `site_id`, deterministic tiebreak, LLMO-4592).
3. **Enable** — set `brand_claims_enabled = true` on that brand (idempotent: skip the write
   if already on; if the write matches no row — brand soft-deleted mid-flight — warn and stop).
4. **Run** — build the S3 prefix `{siteId}/{brandSlug}/analytics/chatgpt_free/` (brand slug
   via `sanitizePathComponent`, byte-for-byte with DRS) and select the latest sheet (max by
   S3 date partition, then `LastModified`).
5. **Emit** — publish `BRAND_PRESENCE_SHEET_WRITTEN` to `SQS_BP_SHEET_READY_QUEUE_URL` with
   the DRS-shaped event (`organization_id` = IMS org, `brand_id`, `brand` slug, `site_id`,
   `week`, `year`, `cadence: "weekly"`, `sheet_date`, `platform`, `s3_bucket`, `s3_key`).

Env (from Vault): `SQS_BP_SHEET_READY_QUEUE_URL`, `DRS_BP_BUCKET`.

**Failure policy.** Infra/config faults throw so SQS retries and the message hits the DLQ:
missing `SQS_BP_SHEET_READY_QUEUE_URL` / `DRS_BP_BUCKET` / PostgREST client, PostgREST
errors, S3 listing failure, SQS publish failure. Genuine business no-ops warn + ack:
missing `siteId`, no active brand, brand slug empty, no sheet yet, enable matched no row.

**Why not `AuditBuilder`.** This handler audits no URL and persists no audit result — it is
a side-effecting operational trigger (enable a flag + publish an SQS event). `AuditBuilder`'s
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
- Enable is idempotent; re-runs don't churn `updated_at`.
- 100% line/branch/statement coverage on `src/brand-claims/handler.js`.
