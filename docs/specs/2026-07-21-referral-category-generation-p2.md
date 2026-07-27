# Referral Category Generation for Sites Without CDN Logs — Phase 2

**Ticket:** [LLMO-6257](https://jira.corp.adobe.com/browse/LLMO-6257)
**Design of record:** `mysticat-data-service` `docs/plans/2026-07-17-llmo-6257-referral-category-generation.md` (merged). This repo-local spec covers the **audit-worker** slice of Phase 2 and the cross-service flow it participates in.
**Supersedes:** the Phase-1-era `docs/specs/2026-07-15-referral-category-generation.md` (generation in `cdn-logs-report` writing `agentic_url_classifications`) — rejected in review; do not build on it.

> **Revision (2026-07-22):** realigned to the **write-time-in-service** population model after @cwjwisse's P1 review. The earlier draft of this spec had category materialized by a projector `postSuccessMessage` cascade that invoked the in-DB `wrpc_backfill_referral_categories` — that is the P1 CDN **backfill** RPC only, and using it as the ongoing path is the exact spec divergence P1 was corrected for. The correct model computes category **in the producing service (JS)** and imports it through the projector single-writer FIFO.
>
> **Revision (2026-07-23) — as-built:** (1) **All sources classify write-time-in-service.** An earlier revision classified the DRS sources (GA4/AA/CJA) **in-DB** (`wrpc_apply_referral_categories`, invoked by `wrpc_import_referral_traffic`) as a workaround for "DRS can't reach PostgREST to read the rules"; that drifted from the design-of-record and was **unwound** per @cwjwisse's review. DRS classification returns to **write-time-in-service on the DRS side (Python)** — reading the rules via a spacecat-api proxy and emitting into the shared `wrpc_import_referral_url_classifications` sink. That is **deferred and NOT implemented in these PRs** (owned by the DRS-side work). (2) `wrpc_classify_referral_urls` was renamed `wrpc_backfill_referral_categories` (P1, CDN-fenced). **CDN classification is implemented** in `cdn-logs-report`'s referral daily export (reusing the optel `classify.js` matcher + emit). Net: the **audit-worker sources (optel + cdn) are done** write-time-in-service; the **DRS sources (ga4/aa/cja) are pending** on the DRS side.

## Summary

Phase 1 decoupled the Referral Traffic category filter onto a referral-owned `referral_url_classifications` table. Phase 2 fills that table for **non-CDN sites** — sites whose referral data comes only from optel / GA4 / Adobe Analytics / CJA and so never got category rules from the agentic `cdn-logs-report` path.

Population is **write-time-in-service for every source**. The **audit-worker** sources (optel via `llmo-referral-traffic-daily`, cdn via `cdn-logs-report`) classify their own URLs against the shared `agentic_url_category_rules` in JS and import the result through the **projector single-writer FIFO** as an idempotent `(site_id, host, url_path)` upsert — **done**. The **DRS** sources (GA4/AA/CJA) classify the same way on the **DRS side (Python, `analytics_publisher`)**, reading the rules via a spacecat-api proxy (DRS can't reach PostgREST directly) and emitting into the same import RPC — **deferred to the DRS-side work, not in these PRs**. Either way the sink is the shared, category-only `referral_url_classifications`.

`wrpc_backfill_referral_categories` (formerly `wrpc_classify_referral_urls`) is **not** the ongoing path — it is the P1 one-time, CDN-fenced backfill only.

## Topology (context)

| Source | Producer | Owner |
|---|---|---|
| optel | `llmo-referral-traffic-daily` (this repo) — write-time-in-service | **this spec** ✅ |
| cdn | `cdn-logs-report` referral daily export (this repo) — write-time-in-service | **this spec** ✅ |
| ga4 / adobe_analytics / cja | DRS `analytics_publisher` (Python write-time; reads rules via a spacecat-api proxy) → `wrpc_import_referral_url_classifications` | DRS-side ⏳ deferred |

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
4. **New data-service RPC** `wrpc_import_referral_url_classifications(p_s3_uri, p_site_id, …)` upserts `referral_url_classifications` on `(site_id, host, url_path)` (`DO UPDATE … WHERE category_name IS DISTINCT FROM excluded` — the upsert body already in `wrpc_backfill_referral_categories`, minus the fact-table scan). This is the shared import path for **every** source — audit-worker (optel + cdn) today, and the DRS sources (ga4/aa/cja) once their DRS-side write-time classification emits into it.

Rejected alternatives: **B** (bundle-ify the referral traffic import — changes the single-file contract for all 5 sources, high blast radius); **C** (`category_name` column on the traffic fact CSV — spec explicitly rejects a category column on fact tables, decision 2); **D** (`postSuccessMessage` cascade — carries no row data, so it can only populate via the in-DB classify RPC, i.e. the rejected mechanism).

### 3. Canonicalization contract — implemented (chunk 7)

Rules match `url_path`, so the form written must be consistent. **Cross-language (JS ↔ Python) parity is a real pre-go-live gate** (design-of-record §65/§105): now that DRS classifies write-time in Python and emits into the *same* shared `referral_url_classifications` sink, its Python `url_path` derivation must match `canonicalizeUrlPath`'s output exactly, verified by a versioned contract + conformance fixtures on both sides. That contract + the Python side are owned by the DRS-side work (an earlier revision wrongly called this "moot" on the assumption DRS classified in-DB against the stored `url_path`; that assumption is gone with the unwind). The **within-audit-worker (JS)** concern is resolved here: optel emitted `url_path = row.path` **raw** while the CDN path stripped only the query string, so the same page fragmented into different `referral_url_classifications` rows across sources. Resolved by a single shared `canonicalizeUrlPath(path)` in `classify.js` (host-stripped, query- and fragment-stripped, duplicate slashes collapsed, one leading slash, no trailing slash except root), applied **at each producer's `url_path` derivation** — `buildCsvRows` (optel) and `mapToReferralCsvRows` (cdn) — so the value flows identically into both that source's traffic export and its classification emit. That keeps each source's exact-match read-RPC join (`ruc.url_path = referral_traffic_<source>.url_path`) intact while converging optel and cdn on one form. As a bonus, optel now consolidates query-string variants of the same page (matching long-standing cdn behaviour).

**Accepted one-time cutover cost.** Introducing `canonicalizeUrlPath` changes the `url_path` form optel/cdn write. Rows already persisted under the old form (optel wrote `row.path` raw; cdn stripped only the query) will not match newly-written canonical rows for the same page, so pre-cutover traffic reads as **uncategorized** until it ages out of the query window, and per-page aggregation is split across the cutover date for historical windows. This is an accepted, self-healing one-time cost — not backfilled — mirroring how the P1 CDN cutover cost was explicitly named. A backfill of the partitioned `referral_traffic_optel`/`referral_traffic_cdn` tables was considered and rejected as disproportionate operational risk for a transient effect.

## Chunks (each its own PR)

1. **audit-worker rule-gen** (this repo) — create-if-missing rule generation in `llmo-referral-traffic-daily`. ✅ done.
2. **audit-worker classify + emit — optel** (this repo) — `classifyUrlPath`/`buildClassificationRows` (`classify.js`) + emit the classification dataset. ✅ done.
3. **data-service import RPC** — `wrpc_import_referral_url_classifications` (imports the audit-worker optel/cdn write-time CSV). ✅ done.
4. **projector config** — route the `referral_url_classifications` pipeline. ✅ done.
5. **DRS write-time classify — GA4/AA/CJA** — Python classification in DRS `analytics_publisher`, reading rules via a spacecat-api proxy, emitting into `wrpc_import_referral_url_classifications`. ⏳ **deferred — DRS-side, not in these PRs** (an in-DB `wrpc_apply_referral_categories` attempt was unwound per review; see the 2026-07-23 revision).
6. **audit-worker classify + emit — cdn** (this repo) — reuse `classify.js` + the emit pattern in `cdn-logs-report`'s referral daily export, `updated_by='spacecat:cdn'`. ✅ done.
7. **canonicalization contract** — shared `canonicalizeUrlPath` (`classify.js`) applied at optel's `buildCsvRows` and cdn's `mapToReferralCsvRows` so both converge on one `url_path` form (JS only; DRS moot per §3). ✅ done.

## Decisions

- **Rules shared, create-if-missing, first-writer-wins** — reuse `agentic_url_category_rules` + `mergePatternRules`; rename deferred to [LLMO-6372](https://jira.corp.adobe.com/browse/LLMO-6372).
- **Classify write-time-in-service, import via projector** (Option A) for **all** sources — not a fact-table column, not the `wrpc_backfill_referral_categories` backfill. Audit-worker (optel + cdn) does this in JS; DRS (ga4/aa/cja) does it in Python on the DRS side, reading rules via a spacecat-api proxy (deferred). No in-DB classify path (an earlier `wrpc_apply_referral_categories` attempt was unwound per review).
- **Region-agnostic MVP** — category only; region continues via `extractCountryCode`.

## Open items / follow-ups

- **Option A contract** — ✅ confirmed by @cwjwisse (2026-07-22, "everything is in spec"). The DRS in-DB attempt (`wrpc_apply_referral_categories`) was **rejected in review and unwound** (2026-07-23); DRS classification is now write-time-in-service on the DRS side (Python) — deferred.
- **DRS-side deliverable (pending, @cwjwisse/DRS):** ga4/aa/cja Python write-time classification in `analytics_publisher` + a spacecat-api rules-proxy endpoint (DRS can't reach PostgREST) + the Python side of the canonicalization conformance fixtures. **Open gap:** create-if-missing rule generation currently runs only in the optel audit, so a ga4/aa/cja-only site never gets rules generated → never classified; the DRS work must also seed rules for those sites (the corpus RPC `rpc_referral_traffic_top_urls` already unions all sources for this).
- **P1 dependency** — `referral_url_classifications` ships in P1 (#827, approved + merged); the cross-service chunks validate end-to-end once P1 is on `main`. Unit tests mock the RPC/emit.
- **Canonicalization (chunk 7)** — ✅ done for the JS producers: shared `canonicalizeUrlPath` in `classify.js` applied at both audit-worker producers' `url_path` derivation. The **DRS Python side must match this exact form** (conformance fixtures both sides) — a real pre-go-live gate owned by the DRS-side work (see §3).
- **Precedence when a site later gains CDN** — create-if-missing means first-writer-wins; documented as intended.
