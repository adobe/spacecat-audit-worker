# Referral Traffic "Market" Derivation — fix garbage markets and invisible home market

**Ticket:** [LLMO-7346](https://jira.corp.adobe.com/browse/LLMO-7346)
**Status:** Proposed (spec-first; no implementation yet)
**Author:** Omair Temurian
**Reported by:** KDDI — "JP market doesn't show in the Market dropdown."
**Related:** [LLMO-7315](https://jira.corp.adobe.com/browse/LLMO-7315) (referral traffic vs. site URL structure)

> **Review (2026-09-04):** ran through a review-kit panel (architecture, implementation, SRE, security). Net effect: the fix **shrinks** — reuse the existing `validateCountryCode` instead of building a new util; use the existing per-site ignore list instead of editing shared regexes; the agentic path is already normalized so that chunk drops to a verify. And it **hardens** — add a feature flag, observability, backfill/rollback, and a corrected Phase 2 semantic. This revision folds all of that in. Findings are marked [arch]/[impl]/[sre]/[sec] where they originated.

## Summary

The **Market** filter on the LLMO Referral Traffic dashboard is derived from the **URL path** — we read a country/locale code out of the first path segment. There is no real visitor-geography signal in the pipeline today. This produces two customer-visible failures:

1. **Home market is invisible.** A site whose primary content is served at the root with no locale prefix (KDDI's Japanese pages under `/iphone/...`, `/support/...`) never matches a country pattern, so all of it collapses into `GLOBAL` ("Global (WW)"). KDDI has **no `JP` market at all**.
2. **Fake markets appear.** Any 2-letter first path segment becomes a "market": languages (`EN`), site sections (`CS`, `LP`), brands (`UQ`), and coincidental locales (`/my-au/` → `AU`).

This is **systemic** (not KDDI-specific) and **not a regression/outage** — the traffic is counted, just mislabeled. It is a data-quality defect in how the market dimension is derived.

The fix reuses machinery the codebase already has: the agentic-traffic path already runs its region through `validateCountryCode` (an ISO allow-list + per-site ignore list); referral is the one path that skips it. Phase 1 closes that gap; Phase 2 makes the home market visible via the existing `site.region`; Phase 3 (real geo) is out of scope.

## Problem statement / evidence

The market dropdown is 100% data-driven: the UI (`project-elmo-ui/src/constants/filters.ts:811-819`) renders the distinct `region` values from the referral filter-dimensions API verbatim (dropping only empties); `GenericFilter.tsx` maps `global`→"Global (WW)" and resolves other codes to a country name, unknown codes to the raw code (hence "CS (CS)", "UQ (UQ)"). Whatever `region` we write is what the customer sees.

**KDDI `au.com` (prod, `referral_traffic_cdn` + `_optel`):** `GLOBAL` 365K pv (optel 495K) = the actual JP home-market pages (`/iphone/support/...`, `/support/`, `/mobile/...`); `AU` 32K (from `/my-au/`); then `PR`/`ID`/`CS`/`LP`/`UQ`/`CM`/`TV`/`EN`. **Zero** `/jp/`, `/ja/`, `ja-jp` paths — `JP` can never be produced by a path heuristic.

**Systemic (prod, `referral_traffic_cdn`, distinct sites/region):** `GLOBAL` **578 sites / ~42M pv**; `EN` (a language) **238 sites**; `US` 147; `AU` 90; `MY` 51; `CS` 21; `LP` 18; `GO` 11; `TV` 10; `VA` 3; `UQ` 1.

## Current behavior (code trace)

Region is derived from the URL path using the shared regex set `DEFAULT_COUNTRY_PATTERNS` (`src/common/country-patterns.js`, 10 patterns). The last-resort `path_2letter_full` matches **any** first 2-letter segment; `locale_dash_full` (`[a-z]{2}-([a-z]{2})`) captures the second half of an `xx-yy` segment (so `/my-au/` → `AU`); unmatched → `GLOBAL`.

| # | Consumer | Engine | Writes | On the dropdown data path? |
|---|---|---|---|---|
| 1 | `src/llmo-referral-traffic/handler.js:169` (`extractCountryCode`) | JS | a **SharePoint Excel** report (`referral-traffic-wNN-YYYY.xlsx`); the file is `/* c8 ignore */` | **No** — cosmetic report, not `referral_traffic.region` [arch] |
| 2 | `src/llmo-referral-traffic-daily/handler.js:90` (`extractCountryCode`, def `:36`) | JS | `referral_traffic_optel.region` (CSV → projector) | **Yes** |
| 3 | `src/cdn-logs-report/utils/query-builder.js:52` `buildCountryExtractionSQL()` → `referral-daily-export.js:83` `row.region \|\| 'GLOBAL'` | Athena SQL | `referral_traffic_cdn.region` | **Yes** |
| 4 | agentic daily report (`query-builder.js` + `agentic-traffic-mapper.js:185`) | Athena SQL → JS | `agentic_traffic_daily/weekly.region` | Already validated (see below) |
| 5 | `src/llm-error-pages/utils.js:139` `buildCountryExtractionSQL()` | Athena SQL | error-pages `country_code` **stat** (not a market filter) | No |

So only **consumers 2 and 3** feed the referral Market dropdown. `extractCountryCode` is duplicated verbatim in consumers 1 and 2; `buildCountryExtractionSQL` is duplicated in consumers 3 and 5 [impl/sec].

## Existing machinery to reuse (verified)

`src/cdn-logs-report/utils/report-utils.js` already provides exactly the normalizer this fix needs:

- `ISO_3166_ALPHA2_COUNTRY_CODES` (`:32-49`) — the full enumerated ISO-3166-1 alpha-2 set (**`JP` is present**).
- `validateCountryCode(code, siteIgnoreList = [])` (`:55-83`) — returns the code if it is in the ISO set, else `'GLOBAL'`; drops `globalIgnoreCodes = ['TV','ST']`; applies a per-site `siteIgnoreList`; has a `countryAliases` map. 30+ existing tests.
- The **agentic** path already uses it: `agentic-traffic-mapper.js:185` `validateCountryCode(row.country_code, siteIgnoreList)`, where `siteIgnoreList = site.getConfig()?.getLlmoCountryCodeIgnoreList?.() || []` (`:146`).

Consequences that reshape this spec: (a) do **not** build a new ISO set — reuse this one [arch/impl/sec]; (b) **agentic (consumer 4) is already clean** — referral is the only unvalidated path; (c) a **per-site ignore list already exists and is wired**, which is how we kill valid-but-wrong codes like KDDI's `/my-au/`→`AU` without touching shared regexes.

What the allow-list removes vs. keeps (verified against the ISO set): removed → `EN`, `CS`, `LP`, `UQ`, `GO` (not ISO) and `TV`, `ST` (ignored). Kept as valid ISO → `AU`, `PR`, `ID`, `CM`, `VA`, `US`, `MY` — genuine countries when real, valid-but-wrong when a path coincidence (handled per-site via the ignore list).

## Goals

- Stop emitting non-country values as referral markets.
- Let a site's home/primary market appear as a real market (KDDI → JP).
- Reuse existing machinery; no new ISO set, no new schema, no shared-regex edits.
- Ship a customer-visible change safely (flagged, observable, reversible).

## Non-goals

- Real visitor geolocation (Phase 3 — no country signal exists in the pipeline today; `grep` confirms none in `cdn-logs-analysis`).
- Distinguishing genuinely-foreign traffic on unprefixed pages from home-market traffic — impossible without geo; see Phase 2 semantics.
- The residual valid-but-wrong locale class that an ignore list does not cover site-by-site (e.g. a brand-new `/xx/` section that is a real ISO code). Bounded and documented, not silently accepted.

## Technical design

### Phase 1 — validate referral region against the ISO allow-list

Reuse `validateCountryCode`. Lift it (and the ISO set) to `src/common/` so referral and the cdn-logs paths share one source of truth, then apply at the two referral choke points:

- **cdn (consumer 3):** `referral-daily-export.js:83` → `validateCountryCode(row.region, site.getConfig()?.getLlmoCountryCodeIgnoreList?.() || [])`. No Athena change — the SQL still extracts a candidate; JS validates it (mirrors the agentic path). Verified single choke point [impl].
- **optel (consumer 2):** keep the path→candidate regex, wrap the result: `validateCountryCode(extractCountryCode(path), siteIgnoreList)`. Extraction (regex → candidate) and validation (allow-list) stay separate steps.
- Optionally give `src/common/` the regex-loop half too and delete the duplicate `extractCountryCode` in consumers 1+2; do **not** re-implement the ISO set.
- **Data-contract fix (one line, this chunk):** the referral `region` columns are documented "ISO country code or empty for aggregated data" but we write the literal `'GLOBAL'` sentinel (agentic's column blesses `GLOBAL`; referral's does not). Align the `mysticat-data-service` column comment to bless `GLOBAL` [arch].

Consumer 1 (SharePoint Excel) is off the dropdown path and `/* c8 ignore */`; wrapping it too is a cosmetic consistency nicety, not required for the fix.

### Phase 1b — KDDI `/my-au/`→AU via the per-site ignore list

`AU` is valid ISO, so the allow-list keeps it. Rather than tighten the shared `locale_dash_full` regex (blast radius: agentic + error-pages), add `AU` to KDDI's `getLlmoCountryCodeIgnoreList()` [arch/impl]. Zero new code, zero shared-pattern risk. Reserve any shared-pattern edit for a false positive no ignore-list entry can cover (none identified today) — the earlier "Decision 2 / tighten `locale_dash_full`" is **dropped**.

### Phase 2 — home-market attribution (reuse `site.region`), semantics-corrected

The Site model already carries `region` (ISO-3166-1 alpha-2, `site.schema.js:67-71`), `language`, `isPrimaryLocale`. No new schema. When a URL yields no country match, attribute it to `site.getRegion()` if set; unset → unchanged `GLOBAL`.

**Correctness caveat (must be explicit) [sre]:** `site.region` means "the site's home country," but this uses it as "the market for *all* otherwise-unattributed traffic." A JP-primary site still receives genuine non-JP referral traffic on unprefixed pages that today correctly lands in `GLOBAL`; Phase 2 relabels it `JP`. With no geo signal these cannot be told apart, so Phase 2 is **plausibly-wrong for the (usually small) foreign slice** and **confidently wrong if `site.region` is stale** (e.g. set to org-HQ `US` would flip *all* root traffic to US). Therefore Phase 2 is:

- **Per-site opt-in**, gated on `site.region` being set (unset = silent no-op, so it fixes nothing on its own — see the ownership dependency below).
- Shipped behind its **own** flag, independent of Phase 1.
- Paired with an **over-attribution alert** (below): flag when enabling a site moves >Y% of pageviews `GLOBAL`→one country.
- Requires a **plumbing change** the earlier draft hid: optel's `buildCsvRows(records, host)` does not receive `site`, so it needs a signature change to reach `site.getRegion()`; the cdn `mapToReferralCsvRows(rawRows, site, …)` already has it [impl].

Open product decision (for Chris): is "call unprefixed traffic JP" acceptable for KDDI (i.e. the `Global (WW)` bucket effectively disappears for that site)? See Decisions.

### Phase 3 — real visitor geography (future, out of scope)

The only fully-correct fix; needs a country signal we do not collect (CDN edge/client country; BYOCDN-Other may lack it; AA/CJA/GA4 have geo natively). Separate ticket after a feasibility check. **This is the point a data-privacy review attaches** (IP→country), not this spec [sec].

## Operational plan (new)

- **Feature flag + staged rollout [sre].** Phase 1 changes ~578 live dashboards on the next deploy. Gate it behind an env/LaunchDarkly flag (LD client exists; the DRS referral-classify work shipped dark behind `REFERRAL_CATEGORY_CLASSIFICATION_ENABLED`). Roll out to KDDI + a few sites, verify, then widen. Phase 2 independently flaggable.
- **Cutover cost, stated accurately [sre].** Runs are forward-only (yesterday only) and partitions are never auto-dropped, so old rows keep their old region until they age out of the *dashboard window* = **28 days (default) / up to 56 days (max custom range)**. During that window the region dimension blends old and new logic across the date axis: KDDI's `JP` grows while `GLOBAL` shrinks; `EN`/`CS`/`UQ` decay toward zero. This is "weeks of visibly shifting markets," not "transient."
- **Backfill (recommended, replaces "no backfill") [sre].** The import is idempotent delete-then-insert per day (`wrpc_import_referral_traffic`), and a date-driven re-run path already exists (`agentic-db-export.js:131`, `auditContext.date`). A bounded backfill of the visible window (≤56 days × affected sites), behind the same flag, makes the cutover instantaneous and is the fast rollback tool. If we stay forward-only, say so explicitly and state the convergence windows.
- **Observability / detectors [sre].** (a) assert count of non-ISO region values written per run → 0 after Phase 1, logged at the write choke point; (b) per-site pre/post region-histogram diff over the trailing window — alert when a country bucket loses >X% into `GLOBAL` (Phase 1 over-collapse) or when a site's `GLOBAL`→country flip exceeds >Y% (Phase 2 over-attribution).
- **Rollback runbook + customer comms [sre].** Reverting the PR does not restore overwritten rows (MTTR = convergence window unless backfilled). Document revert + backfill-to-restore, and give CS a canned explanation; tell large accounts (KDDI) before their `JP` market "appears" and numbers move.
- **Stale saved filters [sre].** `p_region` is a filter on every referral RPC; a saved view / deep link with `region=EN|CS|AU` returns empty after Phase 1, and the UI shares one param across Traffic Insights + Business Impact (`ReferralTrafficPgDashboard.tsx:700-709`) so both tabs blank together. Note in release notes.

## Security notes

- **No ReDoS** — empirically verified: all 10 patterns over 150k-char adversarial inputs run in ~1ms, linear scaling; no nested unbounded quantifiers, and `[^/]+` is bounded by a following literal `/`. Does **not** re-open LLMO-6772/6773 (those were customer-authored *rule* regexes; these are static dev-authored patterns matched against attacker-influenced input) [sec].
- **Latent SQL nit [sec].** `buildCountryExtractionSQL` interpolates `'${regex}'` without `sqlEscape` in both copies (`query-builder.js:54`, `llm-error-pages/utils.js:141`), while sibling builders in the same files do escape. Safe today (static patterns, no quotes). Add `sqlEscape` + a unit test asserting no pattern contains a raw `'`, so a future pattern edit can't break/inject the Athena string.
- The `(?i)` inline flag in the patterns is a JS↔engine divergence (JS must strip it before `new RegExp`, same class as LLMO-6773) — the shared `src/common/` compile helper should own the strip and be unit-tested to compile every pattern in JS [sec].

## Scope

**Scope A (referral-first), confirmed [arch/sec].** Phase 1 touches only the referral JS choke points; `country-patterns.js` and both `buildCountryExtractionSQL` copies stay byte-for-byte unchanged, so agentic (already validated) and error-pages are untouched. The allow-list only ever *narrows* `region` toward the ISO set (unknown→`GLOBAL`) — it cannot emit a new value, so it can't break a downstream consumer's trust in the column's domain.

## Chunks (each its own PR)

1. **Phase 1 — reuse `validateCountryCode` at the referral choke points** (this repo): lift `validateCountryCode`/ISO set to `src/common/`, apply at optel (consumer 2) + cdn (consumer 3), dedupe `extractCountryCode`, align the `GLOBAL` column comment, add the write-choke-point non-ISO=0 assertion + `sqlEscape` test. Behind a flag. Tests to 100%.
2. **Phase 1b — KDDI `AU` ignore-list entry** (config): add `AU` to KDDI's `getLlmoCountryCodeIgnoreList()`. Quick win, no code.
3. **Verify agentic parity** (this repo): confirm consumer 4's output is already ISO-clean; add a regression test. Likely a no-op, not a fix [arch].
4. **Phase 2 — home-market attribution** (this repo): `site.region` fallback at consumers 2+3 (thread `site` into optel `buildCsvRows`), own flag, over-attribution alert.
5. **Ownership — populate `site.region`** (owner TBD → **must be assigned before Phase 2 ships**): a populate-and-verify process for affected sites (KDDI = `JP`). **Hard dependency of the ticket's Definition of Done** — without it Phase 2 is a silent no-op and the reported ticket stays broken in prod even though all code merged [arch].
6. **Observability** (this repo + dashboards): the detectors above.
7. **Phase 3 (future)**: real-geo feasibility + design — separate ticket.

## Alternatives considered

- **New `src/common/market-region.js` with its own ISO set** — rejected: duplicates `validateCountryCode`, a second list that will drift [arch/impl/sec].
- **Tighten the shared `locale_dash_full` regex** to fix `/my-au/` — rejected: blast radius to agentic + error-pages; the per-site ignore list does it with none.
- **Blocklist of junk segments** — rejected: unbounded; the ISO allow-list is closed and self-maintaining.
- **Forward-only, no backfill** — de-recommended: leaves a 28–56 day seam and no fast rollback; bounded backfill reuses existing machinery.
- **Fix only KDDI** — rejected: systemic (238 sites show `EN`).

## Decisions (for review)

1. Confirm **Scope A** (referral-first) — recommend yes.
2. Drop the shared-regex tightening in favor of the per-site ignore list — recommend yes.
3. **Phase 2 source: reuse `site.region` vs. a new `home_market` field** — resolve with a usage inventory of `site.region`'s current readers/writers (note a separate `regions` table exists); reuse only if nothing reads it with a conflicting meaning [arch].
4. **Phase 2 semantics:** accept that with `site.region` set the `Global (WW)` bucket effectively disappears for that site and the small genuinely-foreign slice is mislabeled as the home market? Or scope Phase 2 down / keep a distinct bucket? Product call for KDDI [sre].
5. **Owner** for populating `site.region` (Chunk 5) — must be named before Phase 2 starts.
6. **Backfill** the visible window on cutover (recommended) vs. forward-only.

## Success criteria

- Referral Market dropdown shows **no** `EN`, `CS`, `LP`, `UQ`, `GO` (and no `TV`/`ST`); the per-run non-ISO-region count is 0. `VA` and other valid ISO codes remain unless a site ignore-lists them (they are valid ISO — not "garbage") [sec].
- KDDI shows `JP` (once `site.region='JP'`), `/my-au/`→`AU` is gone (ignore list), and JP page volume moves from `Global (WW)` to `JP`.
- Agentic traffic and error-pages country stats unchanged (Scope A) — verified, no split-brain.
- Change ships behind a flag with the over-collapse / over-attribution detectors live; a rollback path exists.
- 100% test coverage on new/changed `src/**` (repo gate).
