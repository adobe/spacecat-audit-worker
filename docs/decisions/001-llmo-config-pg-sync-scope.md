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
| topic↔prompt relation | `topic_prompts` | **DB-trigger-authoritative — not synced from worker** | The `prompts_sync_junction_tables` trigger on `prompts` (LLMO-4288) auto-populates `topic_prompts` and `category_prompts` from each prompt's `topic_id` / `category_id` columns on every insert/update. The worker writing to `topic_prompts` would be redundant and risks drift with the trigger. See LLMO-4465 for the open question of whether `topic_prompts` is still needed at all. |
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

### Audit fields (`created_by` / `updated_by`)

The S3 config carries `updatedBy` on most entities (brands, competitors,
prompts) but no `createdBy` field. The sync writes:

- `updated_by` ← `entry.updatedBy || null` (truthful: this is the last editor)
- `created_by` ← `entry.createdBy || null` (currently always `null`, since the
  config field doesn't exist; reads through if it's ever added)

We deliberately do **not** write `updatedBy` into `created_by` even though it
would be non-null more often: an `updatedBy` value attributed as `created_by`
is misleading attribution. NULL is honest — "we don't know who created this
from the config". All five sync target tables (`brand_aliases`, `competitors`,
`prompts`, `categories`, `topics`) allow NULL on `created_by`.

Note: this is a per-run upsert, so any out-of-band manual population of
`created_by` will be overwritten on the next sync. If `created_by` ever needs
to be write-once, that's a separate change (split insert/update paths or
column-scoped upsert).

### Topics — brand scoping

The `topics` table has a nullable `brand_id` column. An org can contain topics
belonging to multiple brands. Without brand filtering, `fetchExistingState` would
load all brands' topics into `topicLookup`, causing:

- Orphan deletion in `syncTopicCategories` to target topics from **other brands**
  (their existing `topic_categories` rows would be classified as orphans and deleted).
- New topic rows upserted without `brand_id`, leaving them un-attributed.

The sync was updated in this PR to:
- Filter the topics fetch with `.eq('brand_id', brandId)` so `topicLookup` and
  `existingTopics` only contain the synced brand's rows.
- Include `brand_id` in every topic row written (`buildTopicRows`,
  `ensureDeletedRefEntities`).

This was confirmed against production data: the adobe.com org contained rows from
**15 distinct brands** (1 652 topic rows total); without the fix, the worker would
have operated on all of them.

**Note:** SQL analysis also revealed 256 pre-existing rows where
`prompts.brand_id ≠ topics.brand_id` (prompt and its linked topic belong to
different brands). These rows pre-date this PR and are not caused by it. They
are tracked as a separate investigation item.

### Junctions

`topic_categories` is derived from the config on every sync run. Orphaned rows
(topic changed category) are deleted in batches grouped by `topic_id` before
inserting the desired set.

`topic_prompts` is **not** written by the worker. The
`prompts_sync_junction_tables` trigger on the `prompts` table maintains it
automatically (LLMO-4288). Because the worker uses `ON CONFLICT DO UPDATE`
upserts (which fire `AFTER UPDATE` triggers), every prompt write keeps the
junction in sync.

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
- **Cross-brand prompt-topic mismatches (pre-existing).** Production data
  contains 256 rows where `prompts.brand_id ≠ topics.brand_id`. Root cause
  is unknown (likely prior sync runs without brand filtering). Needs a
  dedicated investigation and backfill before `data_source_pg=true` is
  enabled for multi-brand orgs.

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
