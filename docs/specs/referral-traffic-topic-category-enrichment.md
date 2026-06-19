# Referral Traffic Topic/Category Enrichment

| Field | Value |
|-------|-------|
| **Status** | Implemented |
| **Author** | Christopher Wisse |
| **Created** | 2026-06-10 |
| **Updated** | 2026-06-10 |
| **Decided** | 2026-06-10 |
| **Approvers** | N/A |
| **Jira** | N/A |

## Summary

Add per-URL **topic** and **page-type category** to the referral traffic reports
(weekly `llmo-referral-traffic` Excel and daily `llmo-referral-traffic-daily`
CSV) by **reusing** the agentic CDN-logs regex-rule classifier rather than
generating new classifications. A JavaScript twin of the agentic SQL classifier
applies the already-cached per-site rules to URL paths at zero per-URL LLM cost,
keeping referral labels consistent with the agentic report.

## Problem Statement

### Current State

Referral traffic reports list LLM-referred pageviews per URL but carry no topic
or page-type information. Separately, the agentic CDN-logs report
(`cdn-logs-report`) already classifies each URL into a topic and a page-type
category using a two-tier regex-rule classifier:

- **Tier A (rare):** an LLM authors POSIX/Trino regex rules once per site and
  caches them in Postgres (`agentic_url_category_rules`,
  `agentic_url_page_type_rules`).
- **Tier B (every run):** the cached rules are applied per URL. For Athena
  reports this is emitted as a SQL `CASE`/`REGEXP_EXTRACT` expression
  (`src/cdn-logs-report/utils/query-builder.js`).

The retired `page-intent` audit produced a topic but via per-URL LLM calls,
which was expensive; it was deleted.

### Desired State

Both referral reports show topic and category per URL, agreeing with the agentic
report's taxonomy for the same site, with no per-URL LLM cost added.

### Gap Analysis

- The weekly audit is Athena-backed and could in principle reuse the SQL `CASE`,
  but the daily audit reads parquet and classifies **in JavaScript** — there is
  no Athena query to host a SQL `CASE`.
- The cached rules are authored for the Trino/Athena regex engine; applying them
  in JS requires a compatible (and risk-aware) JS implementation.
- Referral rows expose only a URL path, while agentic rules are authored against
  the full `url`.

## Goals and Non-Goals

### Goals

- Populate `topic` and `category` per URL in both referral reports using the
  existing cached agentic rules.
- Keep referral labels consistent with the agentic CDN-logs report for the same
  site.
- Add **no** per-URL LLM cost.
- Keep both report schemas stable and predictable regardless of whether a site
  has rules.
- Make any rule-application divergence observable in logs.

### Non-Goals

- This is **not** a replacement for the deleted `page-intent` audit. The intent
  enum is out of scope; only topic and page-type category are covered.
- Not authoring new classification rules — rule generation remains owned by the
  agentic pipeline (Tier A).
- Not backfilling historical referral reports.
- Not introducing a transactional/versioned coupling that pins a referral report
  to the exact rule set an agentic report used.
- Not renaming the misleadingly named `category` field (see Risks).

## Proposed Solution

### Overview

Introduce a single shared JavaScript module,
`src/common/agentic-url-classification.js`, that is the in-process twin of the
agentic SQL classifier. Both referral handlers fetch the cached rules, gate on
whether usable rules exist, and — when they do — classify each row's URL path
into `{ topic, category }`. When no usable rules exist, enrichment is skipped and
the topic/category cells are left empty.

### Technical Design

**Two-tier classifier reuse.** Tier A (LLM rule authoring) is untouched and
remains owned by the agentic pipeline. This work only adds a new Tier-B consumer:
the referral handlers read the cached rules via the existing
`fetchAgenticUrlClassificationRules`
(`src/common/agentic-url-classification-rules.js`).

**JS twin of the SQL classifier.** `agentic-url-classification.js` mirrors the
two SQL builders:

- *Topic* (`buildTopicExtractionSQL`): named rules act as a `CASE` (first match
  wins, in `sort_order`); unnamed rules act as `REGEXP_EXTRACT(url, rx, 1)`
  inside a `COALESCE` (first non-empty capture group 1 wins); fallback `'Other'`.
- *Category / page type* (`generatePageTypeClassification`): a `CASE` over all
  page rules (first match wins). An empty/missing rule name returns `''` (to
  match the SQL builder, which emits a `THEN '<name>'` arm for every rule), and
  only a no-match falls back to `'Other'`.

The module exposes:
- `createClassifier(rules, { log })` — compiles all patterns **once**, applies
  the ReDoS guards up front, and returns `{ classify(urlPath) }`, or `null` when
  rules are not usable. Both handlers consume this.
- `classifyTopic` / `classifyPageType` — single-dimension helpers, exported for
  the mechanical SQL-twin parity test.
- `hasClassificationRules(rules)` — the rules-present predicate.

**Rules-present gate.** Enrichment runs only when `hasClassificationRules`
returns true (equivalently, when `createClassifier` returns non-null): the result
must exist, have no `error`, and contain at least one topic or page pattern. When
the gate is closed (no rules, or the fetch errored), the handlers skip
classification and leave topic/category empty rather than tagging every row
`'Other'`. The weekly handler distinguishes the two closed-gate cases in logs
(absent rules → `info`; fetch error → `warn`).

**Path-only matching.** Agentic rules are authored against the full `url`, but
referral rows expose only the path. The twin matches against the path (the best
available signal); rules that depend on host/scheme will not match. This is
documented in the module.

**ReDoS guard (no new dependency).** Because URL paths can be
attacker-influenceable, the twin applies two guards:
- inputs are capped to `MAX_URL_LENGTH` (2048) characters before matching;
- rule sources longer than `MAX_PATTERN_LENGTH` (1000) characters, or matching a
  catastrophic-backtracking heuristic, are rejected (the rule is dropped, not
  applied). The heuristic covers nested unbounded quantifiers (`(a+)+`),
  alternation overlap (`(a|a)+`, `(a|aa)+`), doubly-nested groups in both
  forms — inner group quantified (`(([a-z])+)+`) and inner group merely
  containing an unbounded quantifier (`((a+))+`, `((a*))*`) —
  bounded-repeat-of-greedy (`(.*a){20}`), and a bounded-range group `{m,n}`
  that is itself repeated (`(a{1,3})+`).

**The input cap does NOT bound exponential blow-up.** It bounds only
**polynomial** runtime (cost that scales with input length). Exponential
catastrophic backtracking is driven by the number of ambiguous match paths over
a fixed prefix — independent of total input length — so a short malicious input
can still hang. Exponential shapes are screened **only** by the pattern
heuristic, which is **known-incomplete** (unrecognised shapes pass) and
**over-broad** (it rejects some safe patterns). The two guards reduce exposure;
they are **not** a hard guarantee. There is also no per-match wall-clock
timeout: the V8 `RegExp` runs synchronously and cannot be interrupted without a
worker thread or a non-backtracking engine, so an unrecognised catastrophic
shape still hangs the call. A hard guarantee would need a non-backtracking
engine (e.g. RE2) — explicitly rejected here to avoid a new dependency.

**Dialect handling.** The stored regex source targets Trino/Athena (RE2J). The
twin compiles it under V8 (Irregexp / ECMAScript `RegExp`). Only a leading
`(?i)` is normalised to the JS `i` flag. Patterns using Trino-only constructs
(POSIX classes, possessive quantifiers, scoped inline flags) either throw at
compile time (and are dropped) or match differently. Dropped/rejected patterns
are counted and surfaced via a single aggregated `log.warn` so divergence is
observable.

**Output schemas** (fixed, schema-stable regardless of rule availability):

*Daily CSV — 14 columns, in order:*
```
traffic_date, host, url_path, trf_platform, device, region,
topic, category,
pageviews, consent, trf_type, trf_channel, bounced, updated_by
```
`topic`/`category` are empty strings when the site has no rules; the column set
does not change with rule availability.

*Weekly Excel — fixed columns, in order:*
```
path, trf_type, trf_channel, trf_platform, device, date,
pageviews, consent, bounced, page_intent, region, topic, category
```
Headers are written explicitly (never inferred from data), so `topic`/`category`
are always present and empty when not classifying.

### Implementation Phases

This is a single focused enhancement, not a phased rollout:

1. Add the shared JS twin module with ReDoS guards and dialect handling.
2. Wire the weekly handler (compile-once via `createClassifier`).
3. Wire the daily handler (fetch rules, classify paths, fixed 14-column CSV).
4. Tests to 100% coverage on the new module and the touched handler paths.

## Alternatives Considered

| Alternative | Decision | Rationale |
|-------------|----------|-----------|
| Reuse agentic rules via a JS twin (chosen) | Accepted | Zero per-URL LLM cost; consistent labels; works for both Athena and JS/parquet paths. |
| Generate referral-specific classifications via per-URL LLM | Rejected | Reintroduces the per-URL cost that made `page-intent` expensive; diverges from the agentic taxonomy. |
| Share the SQL `CASE` expression across both audits | Rejected | Infeasible — the daily audit classifies parquet rows in JS with no Athena query to host the `CASE`. |
| Emit `'Other'` for sites lacking rules | Rejected | Pollutes reports with meaningless values; the rules-present gate is cleaner. |

See `docs/decisions/001-reuse-agentic-url-classification-for-referral-traffic.md`
for the full decision record.

## Success Criteria

### Functional Requirements

- Sites with agentic rules get populated `topic`/`category` in both reports;
  sites without get empty cells (never `'Other'` due to absent rules).
- Referral labels match the agentic CDN-logs report labels for the same site's
  paths, within the documented path-only and dialect-drift exceptions.
- Both report schemas are stable: daily CSV always 14 columns; weekly Excel
  always includes `topic`/`category`.

### Non-Functional Requirements

- No per-URL LLM calls added; runtime classification cost is regex application
  only.
- ReDoS magnitude is bounded by the input cap and pattern guards, with no new
  dependency added.
- Dropped/rejected pattern counts are emitted to logs so drift is observable.
- 100% line/branch/statement coverage on new and touched source (project rule).

### Validation Plan

- Unit tests over the JS twin: named/unnamed topic arms, page-type empty-name
  reconciliation, `'Other'` fallbacks, `(?i)` normalisation, dropped Trino-only
  patterns, oversize/nested-quantifier rejection, input capping, and the
  `hasClassificationRules` gate.
- Handler tests asserting the fixed schemas and empty cells when the gate is
  closed.
- Manual spot-check on a sampled site comparing referral labels against the
  agentic CDN-logs report.

## Dependencies

### External Dependencies

- Cached agentic rules in Postgres (`agentic_url_category_rules`,
  `agentic_url_page_type_rules`), authored by the agentic CDN-logs pipeline's
  Tier A.

### Internal Dependencies

- `src/common/agentic-url-classification-rules.js` (`fetchAgenticUrlClassificationRules`).
- `src/cdn-logs-report/utils/query-builder.js` — the SQL classifier the twin
  must stay faithful to (`buildTopicExtractionSQL`,
  `generatePageTypeClassification`).
- Both referral handlers: `src/llmo-referral-traffic/handler.js`,
  `src/llmo-referral-traffic-daily/handler.js`.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Regex dialect drift (JS Irregexp vs Trino RE2J): valid-in-Trino patterns throw or match differently in JS | Medium — some URLs mislabeled or unlabeled vs the agentic report | Medium | Normalise leading `(?i)`; drop patterns that fail to compile; count + `log.warn` dropped/rejected patterns so drift is observable. Not fully eliminated. |
| No sync guarantee between runs: rules can change between agentic and referral runs (or weekly vs daily) | Low–Medium — transient label drift for the changed window | Low | Documented; accepted. No transactional coupling. Revisit if a hard guarantee is requested. |
| ReDoS on attacker-influenceable URL paths | High if unbounded | Low | Input cap (2048), pattern length cap (1000), nested/adjacent unbounded-quantifier + bounded-range-group rejection; no new dependency. Bounds magnitude, not a hard guarantee. |
| Coupling to agentic rules existing | Low — rule-less sites get no enrichment | Medium | Rules-present gate leaves cells empty rather than misleading `'Other'`. |
| Path-only matching drops host/scheme-dependent rules | Low — a subset of rules never match referral rows | Medium | Documented; path is the best available signal. |
| `category` field actually carries page type, not a sub-category | Low — naming confusion | High (naming is in place) | Retain the name (downstream `referral_traffic_optel` + agentic mapper depend on it); flagged as future cleanup. |

## Open Questions

- Should a future iteration add a versioned/pinned rule set so a referral report
  can guarantee it used the same rules as a given agentic report? (Currently out
  of scope.)
- Should the `category` field eventually be renamed to `page_type` once
  downstream consumers can be coordinated? (Tracked as future cleanup.)

## References

- ADR: `docs/decisions/001-reuse-agentic-url-classification-for-referral-traffic.md`
- `src/common/agentic-url-classification.js`
- `src/common/agentic-url-classification-rules.js`
- `src/cdn-logs-report/utils/query-builder.js`

## Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-06-10 | Christopher Wisse | Initial spec, written alongside implementation. |
