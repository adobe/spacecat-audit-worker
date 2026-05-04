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

### Upsert conflict keys

Each sync module uses `ON CONFLICT (...) DO UPDATE`. The conflict key determines
which existing row is matched, and all non-key columns are overwritten on every
run. Any value set out-of-band (e.g. by a manual SQL update) will be reset to
the config value on the next sync.

| Table | Conflict key (upsert identity) | Compared fields (change detection) |
|---|---|---|
| `categories` | `(organization_id, category_id)` | `name`, `origin`, `status` |
| `topics` | `(organization_id, topic_id)` | `name`, `description`, `status` |
| `prompts` | derived `prompt_id` (uuid-v5 of text + topic) | `name`, `regions`, `category_id`, `status`, `origin`, `source` |
| `brand_aliases` | `(brand_id, alias)` | `regions` |
| `competitors` | `(brand_id, name)` | `aliases`, `regions`, `url` |
| `topic_categories` | `(topic_id, category_id)` | _(junction — rows are either present or deleted, no field comparison)_ |

**Important — "INSERT" label in diff logs vs. actual DB operation:**
The diff classifies a row as `INSERT` when no matching entry is found in the
fetched existing-state map. If the DB already contains a row matching the
conflict key (e.g. a topic row with `brand_id = NULL` that was excluded from the
brand-scoped fetch), the upsert will **UPDATE** that row rather than inserting a
new one. No duplicates are created; the diff label is simply a pre-write
classification, not the final DB verb.

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

### Brand scoping for `topics` and `prompts`

Both `topics` and `prompts` are org-scoped tables that also carry a `brand_id`
column. A single org can contain multiple brands. The original sync (PR #2210)
filtered both tables by `organization_id` only, while the writes used a
hard-coded brand. This created a read/write scope mismatch with two distinct
symptoms:

1. **Topics — wrong-brand orphan deletion.** `fetchExistingState` loaded all
   brands' topics into `topicLookup`. `syncTopicCategories` then classified
   another brand's `topic_categories` rows as orphans and would have deleted
   them. New topic rows were also written without `brand_id`, leaving them
   un-attributed.
2. **Prompts — silent dedup against other brands' rows** (LLMO-4470).
   `fetchPromptsBatched` loaded every prompt in the org. The dedup key
   `(text, topic_id)` plus a `PROMPT_COMPARE_FIELDS` list that omits `brand_id`
   meant a config prompt matching a different brand's row by text + topic was
   classified `unchanged` and never written for the target brand. The
   2026-04-15 adobe.com sync reported 35 175 prompts as `unchanged` for this
   reason; only 5 365 of an expected ~34 000 prompts were present in the DB
   under the Adobe brand.

The sync was updated in this PR to apply the same brand filter to both fetches:

- `fetchExistingState` calls `.eq('brand_id', brandId)` on the topics query.
- `fetchPromptsBatched` calls `.eq('brand_id', brandId)` on the prompts query.
- Topic rows now include `brand_id` on every write (`buildTopicRows`,
  `ensureDeletedRefEntities`). Prompt rows already wrote `brand_id`; the bug
  was solely on the read path.

The `categories` table has no `brand_id` column; categories remain org-scoped.

**Production scale check:** the adobe.com org contained topic rows from
**15 distinct brands** (1 652 topic rows total). Without these fixes the
worker would have read and operated on all of them on every sync.

**Pre-existing data anomaly:** SQL analysis also surfaced 256 rows where
`prompts.brand_id ≠ topics.brand_id`. These rows pre-date this PR. They are
tracked as a separate investigation item below.

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
