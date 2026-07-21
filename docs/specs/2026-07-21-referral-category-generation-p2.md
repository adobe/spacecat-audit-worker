# Referral Category Generation for Sites Without CDN Logs — Phase 2

**Ticket:** [LLMO-6257](https://jira.corp.adobe.com/browse/LLMO-6257)
**Design of record:** `mysticat-data-service` `docs/plans/2026-07-17-llmo-6257-referral-category-generation.md` (merged). This repo-local spec covers the **audit-worker** slice of Phase 2 and the cross-service flow it participates in.
**Supersedes:** the Phase-1-era `docs/specs/2026-07-15-referral-category-generation.md` (which put generation in `cdn-logs-report` and wrote `agentic_url_classifications`). That approach was rejected in review; do not build on it.

## Summary

Phase 1 (data-service, shipped separately) decoupled the Referral Traffic category filter onto a referral-owned `referral_url_classifications` table and added `wrpc_classify_referral_urls` (applies a site's active `agentic_url_category_rules` to its referral URLs). Phase 2 fills that table for **non-CDN sites** — sites whose referral data comes only from optel / GA4 / Adobe Analytics / CJA and therefore never got category rules from the agentic `cdn-logs-report` path.

Generation is **per-source, per-service**: this repo (`spacecat-audit-worker`) owns **optel** via `llmo-referral-traffic-daily`; DRS (`llmo-data-retrieval-service`) owns GA4/AA/CJA at its write time. Both feed the same shared rules table and the same `referral_url_classifications` sink through the projector single-writer pipeline.

## Problem statement

`llmo-referral-traffic-daily` runs for exactly these non-CDN (OpTel RUM) sites but only produces referral *traffic* rows — it never generates category *rules*, so `referral_url_classifications` stays empty for them and their category dropdown is "All Categories" only. We need rule generation on this path, create-if-missing, reusing the agentic LLM machinery.

## Topology (context)

| Source | Producer | Owner |
|---|---|---|
| optel | `llmo-referral-traffic-daily` (this repo) | **this spec** |
| cdn | `cdn-logs-report` (agentic path) | already has rules |
| ga4 / adobe_analytics / cja | DRS `analytics_publisher` | DRS spec (separate) |

Category is a property of the site's URL space, not the channel, so **rules are shared** (`agentic_url_category_rules`) and category is source-independent. The classification sink (`referral_url_classifications`) is shared and category-only.

## Technical design (audit-worker slice)

### Rule generation in `llmo-referral-traffic-daily` (create-if-missing)

Add a rule-generation step to the daily runner (`src/llmo-referral-traffic-daily/handler.js`), reusing the existing agentic machinery rather than forking it:

1. **Corpus:** `rpc_referral_traffic_top_urls(p_site_id, p_since, p_limit)` → top referral `url_path`s (the Postgres analogue of the CDN Athena top-URLs query). Wrapper `fetchReferralTopUrls` already exists in `src/cdn-logs-report/utils/report-utils.js`.
2. **Create-if-missing:** read the site's active rules via `fetchAgenticUrlClassificationRules` (`src/common/agentic-url-classification-rules.js`). If rules already exist (CDN/agentic sites, or a prior referral run), **skip generation** — do not re-hit the LLM and do not re-`replace` (a whole-site DELETE+INSERT would reset `created_by` / purge soft-deletes). This is the reuse short-circuit already in `generateReferralPatternsWorkbook`.
3. **Generate (only when absent):** `analyzeProducts(domain, paths, context)` → `{ category: regex }`, then `mergePatternRules` (validates regexes, preserves any `source='human'` rows, stamps `source='ai'` / `derivation_method='llm'` / `sort_order`), then persist via `wrpc_replace_agentic_url_classification_rules` (wrapper `replaceAgenticUrlClassificationRules`). `pageTypeRules` unchanged/preserved.
4. **No classification here.** Unlike the superseded design, this path does **not** call an apply RPC and does **not** write any classification table — materialization is the projector's job (below). This keeps the write serialized under the projector FIFO and avoids the audit-worker racing DRS on the shared sink.

This is a relocation + trim of the superseded `generateReferralPatternsWorkbook` (from the `#2769` branch): keep the corpus + create-if-missing + `analyzeProducts` + `mergePatternRules` + `replace`; **drop** the `applyCategoryRulesToReferral` call and the `agentic_url_classifications` sink.

### Sequencing

Rule generation runs **synchronously inside the audit** before it emits `batch.completed` for the optel import. The projector then imports `referral_traffic_optel` and cascades the classify step (below), by which point the site's rules exist — so first-run classification is not starved. (Worst case for a brand-new site if generation fails: classify no-ops that day and self-heals next run; log at warn.)

### Projector classify cascade (companion chunk, projector repo)

`wrpc_classify_referral_urls(p_site_id, p_source, p_since, p_updated_by)` classifies server-side from the rules — it takes no per-row category and ignores the CSV — so **category is not a CSV column**. Instead the projector adds a `postSuccessMessage` cascade off the `referral_traffic_optel` import (mirroring `agenticTrafficAnalyticsConfig.postSuccessMessages`): a new RPC config with `functionName: 'wrpc_classify_referral_urls'`, `buildParams → { p_site_id, p_source: 'optel', p_since, p_updated_by }`, under `MessageGroupId = referral_url_classifications:${siteId}` so all sources' classifications for a site serialize on one FIFO group. Tracked as its own chunk/PR in `mysticat-projector-service`.

### Canonicalization invariant

Rules match `url_path` with `_safe_regex_match`; correctness depends on every producer emitting `url_path` in one canonical form (host-stripped, query-stripped, leading slash, no trailing slash except root). This cannot be a single shared function (Spacecat JS + DRS Python), so it is a **versioned contract with conformance fixtures on both sides**. This repo's fixtures live alongside the daily-runner tests; DRS owns its own.

## Decisions

- **Rules shared, create-if-missing, first-writer-wins** (agentic vs referral) — reuse `agentic_url_category_rules` + `mergePatternRules`; the rename to `url_category_rules` is deferred to [LLMO-6372](https://jira.corp.adobe.com/browse/LLMO-6372).
- **Classify via the projector cascade, not in the audit** — keeps the shared sink write single-writer and lets the audit stay a pure rule-generator.
- **Region-agnostic MVP** — category only; region continues via the existing `extractCountryCode` write-time path.

## Success criteria

- A non-CDN (OpTel-only) site with no rules gets rules generated on a daily run, and (after the projector cascade) non-empty `referral_url_classifications` → its category dropdown lists real categories.
- A site that already has rules is a no-op (no LLM call, no `replace`).
- Coverage gate (100%) holds; LLM-only code is `c8 ignore`-wrapped per repo convention.

## Open items / follow-ups

- **Backfill of existing non-CDN sites** — one-time run vs. natural daily-run convergence (same open question as P1's CDN backfill; settle with the projector cascade in place).
- **Precedence when a site later gains CDN** — create-if-missing means first-writer-wins; documented as intended.
- **DRS slice** (GA4/AA/CJA) and the **projector cascade** are companion chunks tracked separately.
