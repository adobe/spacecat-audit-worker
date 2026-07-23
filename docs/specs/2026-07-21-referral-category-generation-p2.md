# Referral Category Generation for Sites Without CDN Logs — Phase 2

**Ticket:** [LLMO-6257](https://jira.corp.adobe.com/browse/LLMO-6257)
**Design of record:** `mysticat-data-service` `docs/plans/2026-07-17-llmo-6257-referral-category-generation.md` (merged). This repo-local spec covers the **audit-worker** slice of Phase 2 and the cross-service flow it participates in.
**Supersedes:** the Phase-1-era `docs/specs/2026-07-15-referral-category-generation.md` (generation in `cdn-logs-report` writing `agentic_url_classifications`) — rejected in review; do not build on it.

> **Revision (2026-07-22):** realigned to the **write-time-in-service** population model after @cwjwisse's P1 review. The earlier draft of this spec had category materialized by a projector `postSuccessMessage` cascade that invoked the in-DB `wrpc_backfill_referral_categories` — that is the P1 CDN **backfill** RPC only, and using it as the ongoing path is the exact spec divergence P1 was corrected for. The correct model computes category **in the producing service (JS)** and imports it through the projector single-writer FIFO.
>
> **Revision (2026-07-22, later) — as-built:** two changes emerged during implementation. (1) **The DRS sources (GA4/AA/CJA) classify in-DB at referral-traffic import time**, not write-time-in-service: DRS runs in a separate AWS account and **cannot reach PostgREST** to read the rules, so the data-service — which already holds both the rules and the just-imported traffic — classifies them via `wrpc_apply_referral_categories`, invoked by `wrpc_import_referral_traffic`. So "write-time-in-service, per source" holds for the **audit-worker** sources (optel + cdn), which *can* read the rules; the DRS sources use the co-located in-DB path. (2) `wrpc_classify_referral_urls` was renamed `wrpc_backfill_referral_categories` (P1, CDN-fenced). **CDN classification is now implemented** in `cdn-logs-report`'s referral daily export (reusing the optel `classify.js` matcher + emit pattern), so all four audit-worker+DRS sources now populate `referral_url_classifications`.

## Summary

Phase 1 decoupled the Referral Traffic category filter onto a referral-owned `referral_url_classifications` table. Phase 2 fills that table for **non-CDN sites** — sites whose referral data comes only from optel / GA4 / Adobe Analytics / CJA and so never got category rules from the agentic `cdn-logs-report` path.

Population is **per source**. The **audit-worker** sources (optel via `llmo-referral-traffic-daily`, cdn via `cdn-logs-report`) classify **write-time-in-service** — each classifies its own URLs against the shared `agentic_url_category_rules` in JS and imports the result through the **projector single-writer FIFO** as an idempotent `(site_id, host, url_path)` upsert. The **DRS** sources (GA4/AA/CJA) classify **in-DB at import** (`wrpc_apply_referral_categories`, invoked by `wrpc_import_referral_traffic`) because DRS cannot reach PostgREST to read the rules. Either way the sink is the shared, category-only `referral_url_classifications`.

`wrpc_backfill_referral_categories` (formerly `wrpc_classify_referral_urls`) is **not** the ongoing path — it is the P1 one-time, CDN-fenced backfill only.

## Topology (context)

| Source | Producer | Owner |
|---|---|---|
| optel | `llmo-referral-traffic-daily` (this repo) — write-time-in-service | **this spec** ✅ |
| cdn | `cdn-logs-report` referral daily export (this repo) — write-time-in-service | **this spec** ✅ |
| ga4 / adobe_analytics / cja | DRS `analytics_publisher` → data-service `wrpc_apply_referral_categories` (in-DB at import) | data-service (DRS can't read rules) ✅ |

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
4. **New data-service RPC** `wrpc_import_referral_url_classifications(p_s3_uri, p_site_id, …)` upserts `referral_url_classifications` on `(site_id, host, url_path)` (`DO UPDATE … WHERE category_name IS DISTINCT FROM excluded` — the upsert body already in `wrpc_backfill_referral_categories`, minus the fact-table scan). This is the audit-worker (optel + cdn) import path; the DRS sources instead upsert the same table via `wrpc_apply_referral_categories` at traffic-import time.

Rejected alternatives: **B** (bundle-ify the referral traffic import — changes the single-file contract for all 5 sources, high blast radius); **C** (`category_name` column on the traffic fact CSV — spec explicitly rejects a category column on fact tables, decision 2); **D** (`postSuccessMessage` cascade — carries no row data, so it can only populate via the in-DB classify RPC, i.e. the rejected mechanism).

### 3. Canonicalization contract — implemented (chunk 7)

Rules match `url_path`, so the form written must be consistent. The DRS-side cross-language concern is **moot** because DRS classifies in-DB against the same `url_path` the traffic import stored — the read-RPC join keys line up by construction, no JS/Python parity needed. The remaining concern was **within audit-worker (JS)**: optel emitted `url_path = row.path` **raw** while the CDN path stripped only the query string, so the same page fragmented into different `referral_url_classifications` rows across sources. Resolved by a single shared `canonicalizeUrlPath(path)` in `classify.js` (host-stripped, query- and fragment-stripped, duplicate slashes collapsed, one leading slash, no trailing slash except root), applied **at each producer's `url_path` derivation** — `buildCsvRows` (optel) and `mapToReferralCsvRows` (cdn) — so the value flows identically into both that source's traffic export and its classification emit. That keeps each source's exact-match read-RPC join (`ruc.url_path = referral_traffic_<source>.url_path`) intact while converging optel and cdn on one form. As a bonus, optel now consolidates query-string variants of the same page (matching long-standing cdn behaviour).

**Accepted one-time cutover cost.** Introducing `canonicalizeUrlPath` changes the `url_path` form optel/cdn write. Rows already persisted under the old form (optel wrote `row.path` raw; cdn stripped only the query) will not match newly-written canonical rows for the same page, so pre-cutover traffic reads as **uncategorized** until it ages out of the query window, and per-page aggregation is split across the cutover date for historical windows. This is an accepted, self-healing one-time cost — not backfilled — mirroring how the P1 CDN cutover cost was explicitly named. A backfill of the partitioned `referral_traffic_optel`/`referral_traffic_cdn` tables was considered and rejected as disproportionate operational risk for a transient effect.

## Chunks (each its own PR)

1. **audit-worker rule-gen** (this repo) — create-if-missing rule generation in `llmo-referral-traffic-daily`. ✅ done.
2. **audit-worker classify + emit — optel** (this repo) — `classifyUrlPath`/`buildClassificationRows` (`classify.js`) + emit the classification dataset. ✅ done.
3. **data-service import RPC** — `wrpc_import_referral_url_classifications` (imports the audit-worker optel/cdn write-time CSV). ✅ done.
4. **projector config** — route the `referral_url_classifications` pipeline. ✅ done.
5. **data-service in-DB classify — GA4/AA/CJA** — `wrpc_apply_referral_categories`, invoked by `wrpc_import_referral_traffic` (DRS can't read rules, so this replaced the planned "same idiom in Python"). ✅ done.
6. **audit-worker classify + emit — cdn** (this repo) — reuse `classify.js` + the emit pattern in `cdn-logs-report`'s referral daily export, `updated_by='spacecat:cdn'`. ✅ done.
7. **canonicalization contract** — shared `canonicalizeUrlPath` (`classify.js`) applied at optel's `buildCsvRows` and cdn's `mapToReferralCsvRows` so both converge on one `url_path` form (JS only; DRS moot per §3). ✅ done.

## Decisions

- **Rules shared, create-if-missing, first-writer-wins** — reuse `agentic_url_category_rules` + `mergePatternRules`; rename deferred to [LLMO-6372](https://jira.corp.adobe.com/browse/LLMO-6372).
- **Classify write-time-in-service, import via projector** (Option A) for the audit-worker sources (optel + cdn) — not a fact-table column, not the `wrpc_backfill_referral_categories` backfill. **Exception:** the DRS sources classify in-DB (`wrpc_apply_referral_categories`) because DRS cannot read the rules; that is co-located compute at import, not the fenced backfill.
- **Region-agnostic MVP** — category only; region continues via `extractCountryCode`.

## Open items / follow-ups

- **Option A contract** — ✅ confirmed by @cwjwisse (2026-07-22, "everything is in spec"); the DRS in-DB pivot (`wrpc_apply_referral_categories`) is a data-service-local decision that reuses the same `referral_url_classifications` sink — a courtesy heads-up to @cwjwisse is owed since it is technically in-DB.
- **P1 dependency** — `referral_url_classifications` ships in P1 (#827, approved + merged); the cross-service chunks validate end-to-end once P1 is on `main`. Unit tests mock the RPC/emit.
- **Canonicalization (chunk 7)** — ✅ done: shared `canonicalizeUrlPath` in `classify.js` applied at both audit-worker producers' `url_path` derivation. DRS does not participate (in-DB, moot per §3).
- **Precedence when a site later gains CDN** — create-if-missing means first-writer-wins; documented as intended.
