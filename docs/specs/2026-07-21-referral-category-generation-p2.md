# Referral Category Generation for Sites Without CDN Logs — Phase 2

**Ticket:** [LLMO-6257](https://jira.corp.adobe.com/browse/LLMO-6257)
**Design of record:** `mysticat-data-service` `docs/plans/2026-07-17-llmo-6257-referral-category-generation.md` (merged). This repo-local spec covers the **audit-worker** slice of Phase 2 and the cross-service flow it participates in.
**Supersedes:** the Phase-1-era `docs/specs/2026-07-15-referral-category-generation.md` (generation in `cdn-logs-report` writing `agentic_url_classifications`) — rejected in review; do not build on it.

> **Revision (2026-07-22):** realigned to the **write-time-in-service** population model after @cwjwisse's P1 review. The earlier draft of this spec had category materialized by a projector `postSuccessMessage` cascade that invoked the in-DB `wrpc_classify_referral_urls` — that is the P1 CDN **backfill** RPC only, and using it as the ongoing path is the exact spec divergence P1 was corrected for. The correct model computes category **in the producing service (JS)** and imports it through the projector single-writer FIFO.

## Summary

Phase 1 decoupled the Referral Traffic category filter onto a referral-owned `referral_url_classifications` table. Phase 2 fills that table for **non-CDN sites** — sites whose referral data comes only from optel / GA4 / Adobe Analytics / CJA and so never got category rules from the agentic `cdn-logs-report` path.

Per the merged spec, population is **write-time-in-service, per source**: each producing service classifies its own URLs against the shared `agentic_url_category_rules` and the result is imported through the **projector single-writer FIFO** as an idempotent `(site_id, host, url_path)` upsert. This repo (`spacecat-audit-worker`) owns **optel** (and cdn) via `llmo-referral-traffic-daily`; DRS owns GA4/AA/CJA at its write time.

`wrpc_classify_referral_urls` is **not** used here — it is the P1 one-time CDN backfill only.

## Topology (context)

| Source | Producer | Owner |
|---|---|---|
| optel | `llmo-referral-traffic-daily` (this repo) | **this spec** |
| cdn | `llmo-referral-traffic-daily` / cdn export (this repo) | this spec (reuses the same contract) |
| ga4 / adobe_analytics / cja | DRS `analytics_publisher` | DRS spec (separate) |

Category is a property of the site's URL space, not the channel, so **rules are shared** (`agentic_url_category_rules`) and category is source-independent. The classification sink (`referral_url_classifications`) is shared, category-only, and written by idempotent `(site_id, host, url_path)` upserts — safe across the multiple source writers (spec "multi-writer concurrency").

## Technical design (audit-worker slice)

### 1. Rule generation in `llmo-referral-traffic-daily` (create-if-missing) — design-stable

Non-CDN sites have no category rules. Generate them, reusing the agentic machinery (this is a relocation + trim of `#2769`'s `generateReferralPatternsWorkbook`, dropping the in-DB apply):

1. **Corpus:** `rpc_referral_traffic_top_urls(p_site_id, p_limit)` → top referral `url_path`s (wrapper `fetchReferralTopUrls`, relocated from `#2769`).
2. **Create-if-missing:** read active rules via `fetchAgenticUrlClassificationRules` (`src/common/agentic-url-classification-rules.js`). If rules already exist, **skip** — do not re-hit the LLM and do not re-`replace` (a whole-site DELETE+INSERT resets `created_by`/purges soft-deletes).
3. **Generate (only when absent):** `analyzeProducts(domain, paths, context)` → `{ category: regex }`, then `mergePatternRules` (validates regexes, preserves `source='human'`, stamps `source='ai'`/`sort_order`), persist via `wrpc_replace_agentic_url_classification_rules` (`replaceAgenticUrlClassificationRules`). `pageTypeRules` preserved.
4. **No classification and no agentic sink here** — drop `#2769`'s `applyCategoryRulesToReferral`. Category materialization is step 2 below.

This chunk is contract-independent (rules must exist under any population design) and is built first.

### 2. Write-time category classification + projector import (population — **Option A**)

The grounded population path (mirrors how agentic classifications already ride the projector bundle import into `agentic_url_classifications`; the referral single-file traffic import RPC stays untouched):

1. **Compute category in JS.** For each unique `(host, url_path)` in the run, apply the site's active rules to `url_path`: fetch pre-sorted rules (`fetchAgenticUrlClassificationRules` already orders `sort_order ASC, name ASC`), first match wins, an uncompilable regex is a no-match (JS analogue of `_safe_regex_match`; reuse the `compileAthenaRegex` `(?i)`→`i` transform for `~*` parity), an unmatched URL gets **no row** (category is never empty). No JS rule-matcher exists today — add a small `classifyUrlPath(rules, urlPath)` util.
2. **Emit a classification dataset.** Write a second CSV (`host,url_path,category_name,updated_by`) and emit a **second** projector message with a new `pipeline_id = referral_url_classifications`, FIFO `MessageGroupId = referral_url_classifications:${siteId}` (all sources serialize on one group).
3. **New projector config** (`mysticat-projector-service`) handles that `pipeline_id` → new data-service RPC.
4. **New data-service RPC** `wrpc_import_referral_url_classifications(p_s3_uri, p_site_id, …)` upserts `referral_url_classifications` on `(site_id, host, url_path)` (`DO UPDATE … WHERE category_name IS DISTINCT FROM excluded` — the upsert body already in `wrpc_classify_referral_urls`, minus the fact-table scan).

Rejected alternatives: **B** (bundle-ify the referral traffic import — changes the single-file contract for all 5 sources, high blast radius); **C** (`category_name` column on the traffic fact CSV — spec explicitly rejects a category column on fact tables, decision 2); **D** (`postSuccessMessage` cascade — carries no row data, so it can only populate via the in-DB classify RPC, i.e. the rejected mechanism).

### 3. Canonicalization contract

Rules match `url_path` with the same canonical form on every producer (host-stripped, query-stripped, leading slash, no trailing slash except root). Today optel emits `url_path = row.path` **raw** (`handler.js`) while the CDN path strips query — these must converge before category joins are reliable. Versioned contract with conformance fixtures on both the JS and DRS sides.

## Chunks (each its own PR)

1. **audit-worker rule-gen** (this repo) — create-if-missing rule generation in `llmo-referral-traffic-daily`. *Design-stable; build first.*
2. **audit-worker classify + emit** (this repo) — `classifyUrlPath` util + emit the classification dataset (Option A step 1-2). *Depends on the Option A contract being agreed.*
3. **data-service import RPC** — `wrpc_import_referral_url_classifications` (Option A step 4).
4. **projector config** — route the `referral_url_classifications` pipeline (Option A step 3).
5. **DRS** (GA4/AA/CJA) — the same write-time-in-service idiom in Python.
6. **canonicalization contract** — shared `url_path` form + fixtures (JS + Python).

## Decisions

- **Rules shared, create-if-missing, first-writer-wins** — reuse `agentic_url_category_rules` + `mergePatternRules`; rename deferred to [LLMO-6372](https://jira.corp.adobe.com/browse/LLMO-6372).
- **Classify write-time-in-service, import via projector** (Option A) — not in the DB, not a fact-table column, not `wrpc_classify_referral_urls`.
- **Region-agnostic MVP** — category only; region continues via `extractCountryCode`.

## Open items / follow-ups

- **Option A contract** (new `pipeline_id`, `wrpc_import_referral_url_classifications` signature, classification CSV schema) needs a @cwjwisse/@akshaymagapu nod before the cross-service chunks (3/4) are built — it introduces a new import RPC + projector config (the same class of decision as the P1 review).
- **P1 dependency** — `referral_url_classifications` ships in P1 (#827); chunk 2+ validate end-to-end only after it merges. Unit tests mock the RPC/emit.
- **Precedence when a site later gains CDN** — create-if-missing means first-writer-wins; documented as intended.
