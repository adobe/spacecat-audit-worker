# ADR 001 — LLMO config-to-Postgres sync scope

**Status:** Accepted
**Date:** 2026-04-29
**Ticket:** [LLMO-4477](https://jira.corp.adobe.com/browse/LLMO-4477)
**Parent:** [LLMO-4403](https://jira.corp.adobe.com/browse/LLMO-4403) (Group A — v2 config foundation)

---

## Context

`spacecat-audit-worker/src/llmo-config-db-sync/handler.js` (added in PR #2210,
[LLMO-3918](https://jira.corp.adobe.com/browse/LLMO-3918)) syncs LLMO customer
config from S3 (`llmo-config.json`) to Postgres via PostgREST. Under
LLMO-4403 the Data Retrieval Service (DRS) is being migrated from reading S3
directly to reading Postgres when `data_source_pg=true` is set for an
organisation. Any config field that DRS reads from PG **must** be written by
the sync worker before the flag is flipped; otherwise the feature silently
returns empty results.

This ADR enumerates every top-level key of `llmo-config.json`, assigns each a
sync authority, and records the rationale.

---

## Decision

### Sync-authority table

| Config key | DB target | Decision | Rationale |
|---|---|---|---|
| `categories` | `categories` | **PG-authoritative** (already synced) | DRS reads category metadata for filtering. Synced in PR #2210. |
| `topics` | `topics` | **PG-authoritative** (already synced) | DRS reads topics for content selection. Synced in PR #2210. |
| `aiTopics` | `topics` (merged) | **PG-authoritative** (already synced) | Same table as `topics`; treated identically in sync. |
| `topics[*].prompts` (active) | `prompts` (status=active) | **PG-authoritative** (already synced) | DRS reads prompts to construct queries. Synced in PR #2210. |
| `deleted.prompts` | `prompts` (status=deleted) | **PG-authoritative** (already synced) | Needed for parity with S3 read path; marks prompts as retired. |
| `ignored.prompts` | `prompts` (status=ignored) | **PG-authoritative — added in this PR** | DRS must honour ignored-prompt filtering in the PG read path. Config field is sparsely populated today but schema is stable. |
| `brands.aliases` | `brand_aliases` | **PG-authoritative — added in this PR** | DRS uses brand aliases for alias-based brand matching; returning empty breaks matching for all enabled orgs. |
| `competitors.competitors` | `competitors` | **PG-authoritative — added in this PR** | DRS uses competitor data for competitor presence analysis; absence breaks the feature on all enabled orgs. |
| topic→category relation (`topics[*].category`) | `topic_categories` | **PG-authoritative — added in this PR** | DRS joins via this junction; empty junction means every topic-category query returns zero results. |
| topic↔prompt relation | `topic_prompts` | **PG-authoritative — added in this PR (provisional)** | Populated for parity. See LLMO-4465 for the open question of whether this junction is still needed. If LLMO-4465 determines it is redundant, this sync step can be removed. |
| `entities` | _(no mapping)_ | **Not synced — S3-authoritative / pending** | The field is `{}` in all observed configs and no DRS query targets this key. No Postgres table is defined. Revisit if a concrete consumer appears. |
| `experimentationTopics` | _(no mapping)_ | **Not synced — unused** | Not present in observed configs; excluded from scope by PR #2210 and confirmed unused. Re-evaluate when an experiment pipeline consumer exists. |
| `cdnBucketConfig` | _(N/A)_ | **S3-authoritative** | Read by the CDN log ingestion pipeline directly from S3. No Postgres consumer; keeping it S3-side is intentional. |

---

## Sync implementation notes

### Brand aliases

Config shape: `brands.aliases[].aliases: string[]` plus optional `region` and
`category`. The DB `brand_aliases` table has `(brand_id, alias, regions[])`.
`category` and `aliasMode` fields from config are not persisted — no DB column
exists. Region is normalised to uppercase. Sync uses upsert-by-`(brand_id, alias)`
+ delete for removed aliases.

### Competitors

Config shape: `competitors.competitors[].urls: string[]` (array). DB column
`competitors.url` is a single text field. Only `urls[0]` is persisted; a
warning is logged when more than one URL is present. This is a known schema
mismatch and may be resolved in a future migration.

### Junctions

`topic_categories` and `topic_prompts` are derived from the config on every
sync run. Orphaned rows (topic changed category; prompt moved topic) are
explicitly deleted before inserting the desired set.

---

## Out of scope for this PR

- **Dynamic brand resolution.** The handler hard-codes two brand UUIDs
  (`PROD_BRAND_ID` / `DEV_BRAND_ID`). Creating brand rows from config requires
  a separate design: site-to-brand mapping logic, brand metadata source, and
  whether the ELMO UI `POST /v2/orgs/:id/brands` endpoint is the only write
  path. This is a known blocker for full LLMO-4403 rollout and must be
  addressed before disabling the hard-coded IDs.
- **Reverse cleanup for dropped prompts.** Tracked in LLMO-4473.
- **Dedup fix for prompt sync.** Tracked in LLMO-4470.
- **`topic_prompts` deprecation decision.** Tracked in LLMO-4465.

---

## Consequences

- Enabling `data_source_pg=true` for an org after this PR ships will return
  correct data for brand-alias matching, competitor analysis, and
  topic-category/topic-prompt joins, provided a full sync has run.
- The `entities` and `experimentationTopics` config sections continue to be
  read from S3 even under `data_source_pg=true`; this is an explicit exception
  and must be documented in the DRS read-path code.
- The competitors `urls[0]`-only behaviour must be communicated to the UI team;
  the UI should either only write one URL or a DB migration to `urls text[]`
  should be considered.
