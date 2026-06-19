# 001. Reuse agentic URL classification rules for referral traffic topic/category

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-06-10 |
| **Author** | Christopher Wisse |
| **Deciders** | Christopher Wisse |
| **Supersedes** | N/A |
| **Superseded by** | N/A |

## Context

### Technical Context

Referral traffic reports — the weekly `llmo-referral-traffic` (Excel) and the
daily `llmo-referral-traffic-daily` (CSV) audits — carried no topic or
page-type category per URL. The agentic CDN-logs report (`cdn-logs-report`)
already derives both per URL via a **two-tier regex-rule classifier**:

- **Tier A (rare, cached):** an LLM (`gpt-4o-mini`, batched) authors POSIX/Trino
  regex rules once per site and persists them to the Postgres tables
  `agentic_url_category_rules` (topic) and `agentic_url_page_type_rules`
  (page type). This tier is skipped when rules already exist, so it is paid at
  most once per site.
- **Tier B (every run, zero LLM):** the stored rules are read back and applied
  per URL. For Athena-backed reports this is emitted as a SQL
  `CASE WHEN REGEXP_LIKE(...)` expression in
  `src/cdn-logs-report/utils/query-builder.js` (`buildTopicExtractionSQL` and
  `generatePageTypeClassification`).

The deleted `page-intent` audit produced a comparable `topic` field but did so
with N sequential per-URL LLM calls — costly — and its only live consumer
(weekly referral) used the intent enum, not the topic.

### Business Context

We want topic + category on referral traffic reports without paying a per-URL
LLM cost, and we want those labels to agree with what the agentic CDN-logs
report assigns for the same site, so that a customer sees one consistent
taxonomy across reports.

### Constraints

- No per-URL LLM cost may be reintroduced (the reason `page-intent` was
  retired).
- The daily audit classifies parquet rows **in JavaScript**, not via Athena, so
  it cannot host the agentic SQL `CASE` expression.
- The stored regex source is authored for the Trino/Athena engine (RE2J),
  but the daily audit must evaluate it under V8's `RegExp` (Irregexp). The two
  regex dialects are not identical.
- Referral rows expose only a URL **path**, whereas agentic rules are authored
  against the full `url` (scheme + host + path).
- Downstream consumers of the daily CSV (the `referral_traffic_optel`
  ingestion pipeline) and the existing agentic mapper read fixed column/field
  names; changing those names risks breaking them.

## Decision

Reuse the existing agentic classification rules for referral traffic rather
than generating referral-specific classifications. Concretely:

1. Read the rules via the existing `fetchAgenticUrlClassificationRules`
   (`src/common/agentic-url-classification-rules.js`).
2. Add a **JS twin** of the agentic SQL classifier in
   `src/common/agentic-url-classification.js` that mirrors
   `buildTopicExtractionSQL` (topic: named `CASE` → unnamed `REGEXP_EXTRACT`
   group 1 → `'Other'`) and `generatePageTypeClassification` (category: named
   `CASE` → `'Other'`). The twin exposes `createClassifier` (compile-once,
   reuse-per-row) and `hasClassificationRules` (the rules-present gate).
   `classifyTopic` / `classifyPageType` are exported for the SQL-twin parity
   test only; both handlers go through `createClassifier`.
3. Wire both referral handlers to classify on the URL **path** and gate
   enrichment on a **rules-present** check (`hasClassificationRules` /
   `createClassifier` returning non-null): when a site has no rules — or the
   fetch errors — skip enrichment rather than tagging every row as `'Other'`.

Scope is **topic + category only**. This is not a `page-intent` replacement; the
intent enum is not covered by the agentic regex tiers.

## Rationale

### Options Considered

**Option A — Reuse agentic rules via a JS twin of the SQL classifier (chosen).**
- *Pros:* zero per-URL LLM cost (Tier A already paid by the agentic pipeline);
  labels consistent with the agentic CDN-logs report; one shared module to
  evolve the semantics; works for both Athena (weekly) and JS/parquet (daily)
  paths.
- *Cons:* introduces a JS-vs-Trino regex dialect risk; classification quality
  for referral depends on agentic rules existing for the site; path-only
  matching drops host/scheme-dependent rules.

**Option B — Generate referral-specific classifications via LLM per URL.**
- *Pros:* self-contained; no dependency on the agentic pipeline.
- *Cons:* reintroduces the exact per-URL LLM cost that made `page-intent`
  expensive; would also diverge from the agentic taxonomy.

**Option C — Share the SQL `CASE` expression across both audits.**
- *Pros:* a single source of truth with no dialect risk.
- *Cons:* not possible — the daily audit classifies parquet rows in JS, with no
  Athena query to host the `CASE`.

**Option D — Emit `'Other'` for every row at sites that have no rules.**
- *Pros:* keeps a uniform column population.
- *Cons:* pollutes reports with a column of meaningless values, misleading
  consumers into thinking classification ran.

### Why Option A Was Chosen

Option A is the only choice that delivers consistent labels across reports at
near-zero runtime cost while supporting both the Athena-backed weekly path and
the JS/parquet daily path. Its principal risk (dialect divergence) is bounded
and made observable (see Negative consequences and Implementation), and the
rules-present gate cleanly handles sites without rules.

### Why Alternatives Were Rejected

- **Option B** reintroduces the per-URL LLM cost the team explicitly removed
  with `page-intent`, and would produce labels inconsistent with the agentic
  report.
- **Option C** is technically infeasible for the daily audit.
- **Option D** degrades report quality; the rules-present gate (Option A) is a
  strictly better way to handle rule-less sites.

## Consequences

### Positive

- Topic/category for referral is effectively free at runtime: the LLM cost is
  paid once per site by the agentic pipeline and reused.
- Referral and agentic reports share one classifier, so labels stay consistent
  and a single module is the place to evolve the semantics.
- The dialect-divergence and ReDoS risks are concentrated in one well-documented
  module rather than spread across audits.

### Negative

- **Coupling to agentic rules:** referral classification quality now depends on
  agentic rules existing for the site. Sites with referral traffic but no
  agentic rules get no topic/category (by design — the gate avoids misleading
  `'Other'` columns).
- **Regex dialect drift (JS vs Trino):** the stored rules are authored for
  Trino/Athena (RE2J / Java `re2` syntax) but the JS twin compiles them under
  V8's Irregexp engine (ECMAScript `RegExp`). Constructs valid in Trino —
  POSIX character classes (`[[:alpha:]]`), possessive quantifiers (`a++`),
  scoped/mid-pattern inline flags (`(?s)`, `(?i:...)`) — either throw at
  `new RegExp(...)` (and are dropped) or compile to a different match set. A
  rule that is dropped or matches differently in JS while still matching in the
  SQL report causes the JS label to **drift** from the report label for that
  URL. Mitigation: only a leading `(?i)` is normalised to the JS `i` flag; all
  other dropped/rejected patterns are counted and surfaced via an aggregated
  `log.warn` so the divergence is observable, but the drift is not eliminated.
- **No sync guarantee between runs:** referral classification and the agentic
  output are not transactionally coupled. If the agentic rules change between an
  agentic run and a referral run (or between the weekly and daily referral
  runs), the labels can drift for that window. There is no locking or
  versioning that pins a referral report to the exact rule set the agentic
  report used.
- **Path-only matching:** referral rows expose only the path, whereas agentic
  rules are authored against the full `url`. Rules that depend on host/scheme do
  not match in the referral context. The JS twin documents this and matches on
  the path (the best available signal).
- **ReDoS exposure on attacker-influenceable input:** URL paths can originate
  from referral data and are fed to regexes. The input cap bounds only
  polynomial blow-up; exponential catastrophic backtracking is independent of
  input length and is screened only by a known-incomplete, over-broad pattern
  heuristic (see Implementation). The mitigation reduces exposure but is **not**
  a hard guarantee.

### Neutral

- The daily CSV now always emits a **stable 14-column schema**; the `topic` and
  `category` cells are **empty** when the site has no rules (they are not filled
  with `'Other'`). This is a fixed schema regardless of rule availability — see
  Implementation. (This supersedes an earlier design that switched between a
  12-column and a 14-column schema conditionally.)
- The weekly Excel report uses an explicit, fixed column list with
  `topic`/`category` always present (empty when not classifying), so the layout
  cannot drift with the SQL projection or enrichment state.
- The `category` field carries the **page type** sourced from
  `agentic_url_page_type_rules`, not a topic sub-category. The name is retained
  for consistency with the agentic mapper and downstream consumers; see the
  Notes section.

## Implementation

### Next Steps

1. Add `src/common/agentic-url-classification.js` exposing `createClassifier`,
   `classifyTopic`, `classifyPageType`, and `hasClassificationRules`
   (`classifyTopic` / `classifyPageType` are exported for the parity test;
   both handlers consume `createClassifier`). Compilation mirrors the agentic
   SQL: topic rules
   split into named (`CASE`) and unnamed (`REGEXP_EXTRACT` group 1) arms; page
   rules are all treated as named `CASE` arms (an empty/missing name returns
   `''`, matching the SQL builder, not `'Other'`).
2. Apply ReDoS guards in the JS twin **without adding a dependency**:
   - cap each input path to `MAX_URL_LENGTH` (2048) characters before matching;
   - reject any rule whose regex source exceeds `MAX_PATTERN_LENGTH` (1000)
     characters or trips a catastrophic-backtracking heuristic. The heuristic
     rejects nested unbounded quantifiers (`(a+)+`), alternation overlap
     (`(a|a)+`, `(a|aa)+`), doubly-nested groups in both forms — the inner
     group quantified (`(([a-z])+)+`) and the inner group merely containing an
     unbounded quantifier (`((a+))+`, `((a*))*`) — bounded-repeat-of-greedy
     (`(.*a){20}`), and a bounded-range group `{m,n}` that is itself repeated
     (`(a{1,3})+`).

   **Important — what the input cap does and does not bound.** The input cap
   bounds only **polynomial** blow-up (runtime that scales with input length).
   It does **not** bound **exponential** blow-up: catastrophic backtracking is
   driven by the number of ambiguous ways the engine can match a fixed prefix,
   which is independent of total input length, so a short malicious input can
   still hang. Exponential shapes are screened **only** by the pattern
   heuristic, which is **known-incomplete** (shapes it does not recognise pass
   through) and **over-broad** (it rejects some safe patterns). Together the two
   guards are a screen that reduces exposure; they are **not** a proof of
   safety. There is also no per-match wall-clock timeout: the V8 `RegExp` runs
   synchronously and cannot be interrupted mid-match without a worker thread or
   a non-backtracking engine, so a catastrophic shape the heuristic does not
   recognise still hangs the call. A hard guarantee would require a
   non-backtracking engine (e.g. RE2), which was explicitly rejected to avoid
   adding a dependency.
3. Wire the weekly handler (`src/llmo-referral-traffic/handler.js`) to build a
   `createClassifier` once and enrich each row's `topic`/`category`, defaulting
   to `''` when the classifier is null.
4. Wire the daily handler (`src/llmo-referral-traffic-daily/handler.js`) to
   fetch rules, classify each row's path, and emit the fixed 14-column CSV with
   empty `topic`/`category` cells when no rules are present.

### Output schemas

**Daily CSV (`llmo-referral-traffic-daily`) — fixed 14 columns, in order:**

```
traffic_date, host, url_path, trf_platform, device, region,
topic, category,
pageviews, consent, trf_type, trf_channel, bounced, updated_by
```

`topic` and `category` are **empty strings** when the site has no agentic rules
(or the fetch errored); they are never `'Other'` at the row level due to absent
rules. The schema does not change with rule availability.

**Weekly Excel (`llmo-referral-traffic`) — fixed columns, in order:**

```
path, trf_type, trf_channel, trf_platform, device, date,
pageviews, consent, bounced, page_intent, region, topic, category
```

Headers are written explicitly (never inferred from the data), so `topic` and
`category` are always present and empty when not classifying.

### Migration Path

For sites that already have agentic rules, the next referral run enriches
automatically — no backfill of historical reports is performed. Sites without
rules see empty topic/category cells until their agentic pipeline authors rules.

### Reversibility

To back the change out:

1. Remove the classification wiring from both handlers (the
   `fetchAgenticUrlClassificationRules` call, the `createClassifier` usage, and
   the row enrichment).
2. Revert the daily CSV to its pre-change 12-column schema (drop the `topic` and
   `category` columns) and remove the `topic`/`category` columns from the weekly
   `WEEKLY_COLUMNS` list.
3. Optionally delete `src/common/agentic-url-classification.js` and its tests
   once no other audit imports it.

The agentic CDN-logs pipeline is unaffected by a rollback; it owns rule
authoring independently.

### Timeline

Delivered as a single focused enhancement on the
`feat/delete-page-intent-audit` line of work; no phased rollout required.

## Validation

### Success Metrics

- Daily CSV and weekly Excel emit populated `topic`/`category` for sites with
  agentic rules and empty cells for sites without, with no per-URL LLM calls
  added.
- For a sampled site, referral labels match the agentic CDN-logs report labels
  for the same paths (allowing for the documented path-only and dialect-drift
  exceptions).
- Dropped/rejected pattern counts are visible in logs (`log.warn`) so drift is
  observable in production.

### Review Date

Revisit if dialect-drift warnings become frequent in production, or if a
downstream consumer requests a hard topic/category sync guarantee.

## Related Decisions

- Spec: `docs/specs/referral-traffic-topic-category-enrichment.md` — the
  proposal this ADR ratifies.

## References

- `src/common/agentic-url-classification.js` — the JS twin classifier.
- `src/common/agentic-url-classification-rules.js` — rule fetch.
- `src/cdn-logs-report/utils/query-builder.js` — the agentic SQL classifier this
  twin mirrors (`buildTopicExtractionSQL`, `generatePageTypeClassification`).
- `src/llmo-referral-traffic/handler.js`,
  `src/llmo-referral-traffic-daily/handler.js` — the two enriched handlers.

## Notes

**Category-naming hazard (future cleanup).** The `category` field actually
carries the **page type** produced from `agentic_url_page_type_rules`, not a
topic sub-category. The name `category` is inherited from the agentic mapper and
is consumed under that name by the `referral_traffic_optel` pipeline and the
existing agentic code. Renaming it now would risk breaking those downstream
consumers, so the name is deliberately retained. This is flagged as future
cleanup, not a change to make as part of this work.
