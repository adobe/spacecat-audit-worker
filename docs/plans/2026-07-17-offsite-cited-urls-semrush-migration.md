# Migrate Offsite Cited-URL Sourcing to the Semrush API

**Status:** Draft / proposal
**Author:** (TBD)
**Date:** 2026-07-17
**Scope:** `spacecat-audit-worker` (`offsite-brand-presence` audit) + `spacecat-api-service` (SR AI Visibility layer)

---

## 1. Goal

Today the `offsite-brand-presence` audit selects the cited URLs it feeds to DRS
(YouTube, Reddit, and top third-party "cited" sources) from **internal Brand-Presence
execution data** — PostgREST for brandalf-enabled orgs, with a SharePoint Excel
fallback. We want to source those same URLs — filtered by platform and ordered by
citation count — from the **Semrush API** instead.

Downstream of URL selection (URL store, DRS scraping, poll, and the
`cited-analysis` / `youtube-analysis` / `reddit-analysis` audits that hand off to
Mystique) is **unchanged**. This migration only replaces the *data acquisition and
ranking input*.

---

## 2. Current pipeline (what we are replacing)

All in `spacecat-audit-worker/src/offsite-brand-presence/`.

| Step | Code | Notes |
|---|---|---|
| Determine weeks | `getPreviousWeeks` (`utils/offsite-brand-presence-enrichment.js`) | multi-week window |
| Load data | `loadBrandPresenceData` (`utils/offsite-brand-presence-enrichment.js:~368`) | **two paths, same downstream shape:** (1) **PostgREST** — for brandalf-enabled orgs, `loadBrandPresenceDataFromPostgrest` (`utils/offsite-brand-presence-postgrest.js`) reads `brand_presence_executions` + nested `brand_presence_sources` over the multi-week window from `getPreviousWeeks`, maps rows to the legacy `{ Sources, Region, Prompt, ... }` shape (`Sources` = cited URLs). Defaults to **`US` region only** (`DEFAULT_REGION_CODE`). (2) **SharePoint** — for non-brandalf orgs, or when PostgREST returns no rows, reads `brandpresence-*-wNN-YYYY` Excel sheets via `createLLMOSharepointClient`; `Sources` column holds cited URLs |
| Parse + classify | `extractUrlsAndTopics` → `classifyAndNormalize` (`handler.js:259`, `:165`) | splits `row.Sources` on `[;\n]`, filters `ACCEPTED_REGIONS`, drops owned/social/brand-lookalike hosts, classifies `youtube.com`/`reddit.com` by regex, tags `wikipedia.org` as excluded. Builds `allUrls: Map<url, { count, domain }>` where **`count` = citation frequency** |
| Rank + bucket | `selectTopUrls(allUrls, DRS_URLS_LIMIT, excluded)` (`handler.js:644`) | sort by `count` desc → `topByDomain['youtube.com']`, `topByDomain['reddit.com']` (cap 70 each) + `topCited` (top 70, excl. offsite + wikipedia) |
| Store | `addUrlsToUrlStore` (`handler.js:316`) | writes `AuditUrl` tagged with `youtube-analysis` / `reddit-analysis` / `cited-analysis` |
| Scrape | `triggerDrsScraping` → `@adobe/spacecat-shared-drs-client` | YouTube videos/comments, Reddit posts/comments, top-cited via BrightData |
| Poll + trigger | `offsite-brand-presence-drs-status` handler | fires the analysis audits when each bucket completes |

Relevant constants (`offsite-brand-presence/constants.js`):

```js
export const OFFSITE_DOMAINS = { 'youtube.com': {...}, 'reddit.com': {...} };
export const CITED_ANALYSIS_DRS_CONFIG = { auditType: CITED_ANALYSIS, ... };
export const DRS_URLS_LIMIT = 70;
export const ACCEPTED_REGIONS = new Set(['US','GB','CA','AU','IE','NZ']);
export const YOUTUBE_URL_REGEX = /.../;  export const REDDIT_URL_REGEX = /.../;
export const TOP_CITED_EXCLUDED_DOMAINS = ['wikipedia.org'];
```

**Migration surface = produce `allUrls: Map<url, { count, domain }>` from Semrush,
then let the existing `classifyAndNormalize` / `selectTopUrls` / DRS path run
unchanged.** `count` must be a citation-volume proxy so the top-70 ranking is
preserved.

**Data-source note:** Semrush replaces whichever path `loadBrandPresenceData` took
(PostgREST or SharePoint). The PostgREST path is increasingly the live path for
brandalf orgs; SharePoint remains the fallback. Region behavior also differs today:
PostgREST is US-only, while `ACCEPTED_REGIONS` allows six markets — the Semrush
loader should call per region (see §5.3).

---

## 3. Which URLs? — `MENTIONS_TARGET` vs the (B) union

Semrush's `sources` universe is **all URLs cited in AI answers for the brand's
prompts**. The source-category enum (`third-party/ai-seo-ts/v2/source/enums_pb.d.ts`)
only sub-classifies those cited URLs by whether their content mentions the brand —
it is a **separate axis** from how many times a URL was cited:

| Category | Meaning | Notes |
|---|---|---|
| `OWNED_BY_TARGET` (1) | Brand's own URLs | today's `/brands/cited-pages` "owned" tab; **excluded** from offsite scraping |
| `MENTIONS_TARGET` (2) | Non-owned cited URLs Semrush **already classified as mentioning the brand** | narrower set; a URL can be here with *few* citations (citation count is independent) |
| `MISSES_TARGET` (3) | Non-owned cited URLs that do **not** mention the brand | |

Two options:

- **Option A — `MENTIONS_TARGET` only.** Non-owned URLs Semrush is *already sure*
  mention the brand. Smaller, pre-filtered set. Changes behavior: the top-cited
  bucket shrinks and only ever contains pages Semrush thinks mention the brand.
- **Option B — union of `MENTIONS_TARGET` + `MISSES_TARGET`.** All non-owned cited
  URLs — i.e. the URL Inspector "cited third-party" concept. Whether the page
  actually mentions the brand is decided **downstream** by the DRS scrape + the
  cited/sentiment analysis in Mystique, not pre-filtered by Semrush.

> **Recommendation: Option B (union).** This matches today's behavior — the current
> `classifyAndNormalize` keeps *all* earned, non-owned, non-social cited URLs and
> never pre-filters on "mentions the brand." Use Option A only if you deliberately
> want a tighter, mentions-confirmed cited bucket.

Implementation note: a single `sources` gRPC call takes **one** category, so the
union is **two calls (`MENTIONS_TARGET` + `MISSES_TARGET`) merged**, or one call
with `UNSPECIFIED` (0) filtered to drop `OWNED_BY_TARGET` — to be confirmed against
the gRPC behavior.

---

## 4. The time-window constraint (read before choosing an option)

Semrush SR data is a **point-in-time snapshot, not a rolling date range**. The
request field `SourcesRequest.target_date` accepts `YYYY-MM` (monthly) **or**
`YYYY-MM-DD` (single day) — there is no "last 7 days" range on the v2 gRPC API.
(`Range` in the request is pagination only: `limit`/`offset`.)

Consequence for weekly audit runs:
- A `YYYY-MM` snapshot is month-to-date and grows through the month. Two runs a week
  apart return a **heavily overlapping** set. The URL store already dedups
  (`addUrlsToUrlStore` skips existing URLs), so weekly runs effectively **top up**
  with newly-cited URLs and the set only fully refreshes at **month rollover**.
- This is a **behavior change** from today's multi-week Excel aggregation.

The **only** Semrush surface that supports a true weekly rolling window is the
**v4-raw Element-level API** (`start_date`/`end_date`, daily granularity). That
drives the choice between Option 1 and Option 2 below.

---

## 5. Implementation options — easiest → hardest

### Option 1 — HTTP via SR AI Visibility (snapshot). **Easiest. Recommended default.**

Reuse the Semrush integration already wired into `spacecat-api-service` (gRPC
transport, auth, normalization). The audit-worker calls a new HTTP endpoint.

**Trade-off:** snapshot semantics (monthly/daily), not weekly ranges (see §4). Best
when weekly freshness is not a hard requirement.

#### 5.1 Backend changes (`spacecat-api-service`)

The exposed `/brands/cited-pages` hardcodes owned URLs and cannot serve third-party:

```js
// src/support/ai-visibility/handlers/brands.js  (handleBrandCitedPages)
const listReq = {
  country, llm: llmEnum, target,
  category: SOURCE_CATEGORY_ENUM.OWNED_BY_TARGET,   // <-- owned only
  order, range: { limit, offset },
};
```

Add a third-party cited-URLs endpoint:

1. **New handler** `handleBrandCitedSourceUrls(sp, clients)` in
   `src/support/ai-visibility/handlers/brands.js`:
   - Read `domain`, `country`/`region`, `month` (`YYYY-MM`), `engine` (`llm`),
     `limit`, `offset`, and a new `category` (default = union).
   - For **Option B (union)**: call `clients.sourceClient.sources(...)` once per
     category (`MENTIONS_TARGET`, `MISSES_TARGET`), `order: { by: PROMPTS_COUNT }`,
     merge by URL, sum `prompts_count`.
   - For **Option A**: single call with `MENTIONS_TARGET`.
   - Map rows with the existing `mapSourceRowToCitedPage` → `{ pageUrl, responses }`.
2. **Register the route** in `src/controllers/ai-visibility.js` `ROUTE_MAP` and
   `src/routes/index.js`:
   ```js
   // ROUTE_MAP
   ['/brands/cited-source-urls', handleBrandCitedSourceUrls],
   // routes/index.js
   'GET /llmo/ai-visibility/brands/cited-source-urls': aiVisibilityController.getBrandsCitedSourceUrls,
   ```
3. **Tests** in `test/support/ai-visibility/handlers/brands.test.js`.

**Proposed API**

```
GET /llmo/ai-visibility/brands/cited-source-urls
  ?domain=adobe.com
  &region=US
  &month=2026-06            # YYYY-MM snapshot (or YYYY-MM-DD)
  &engine=ALL
  &category=union           # union | mentions
  &limit=200&offset=0
```

```jsonc
// 200
{
  "data": [
    { "pageUrl": "https://www.reddit.com/r/.../comments/...", "responses": 42 },
    { "pageUrl": "https://www.youtube.com/watch?v=...",       "responses": 31 }
  ],
  "total": 1234, "offset": 0, "limit": 200
}
```

#### 5.2 Audit-worker changes (`spacecat-audit-worker`)

The worker has **no** SR/Semrush client today (confirmed) — add a thin HTTP client.

1. **New module** `src/offsite-brand-presence/semrush-source.js`:
   `loadCitedUrlsFromSemrush(site, context, { regions, month, engine, category })`
   - For each region in `ACCEPTED_REGIONS`, call
     `/llmo/ai-visibility/brands/cited-source-urls` with pagination, collecting
     **enough** rows to fill 70 YouTube + 70 Reddit + 70 top-cited (these are
     long-tail, so page well past 70 total — e.g. until `offset >= total` or a page
     cap).
   - Build `allUrls: Map<url, { count, domain }>`, `count = sum(responses)` across
     regions, `domain = null` (let `classifyAndNormalize` assign it), shaped
     **exactly** like today's `extractUrlsAndTopics` output.
   - Config: base URL (spacecat-api-service) + auth from `context.env`.
2. **Swap the source** in `handler.js` behind a flag:
   ```js
   const raw = useSemrushSource
     ? await loadCitedUrlsFromSemrush(site, context, { regions: [...ACCEPTED_REGIONS], month, engine, category })
     : await loadBrandPresenceData(...);   // legacy SharePoint path
   ```
   Feed `raw` through the **existing** `classifyAndNormalize` (keeps YouTube/Reddit
   regex filtering, owned/social/brand exclusion, wikipedia tagging), then
   `selectTopUrls(allUrls, DRS_URLS_LIMIT, ...)` unchanged.
3. **Topic enrichment** (`trackTopicUrl`) has no Semrush equivalent from
   cited-source-urls alone — either drop topic enrichment on the Semrush path or
   backfill it from another SR endpoint (decide during build).

#### 5.3 Parameter / semantics mapping

| Concept | Today | Semrush (Option 1) | Action |
|---|---|---|---|
| Time window | multi-week aggregation | monthly/daily snapshot | pick `month=YYYY-MM` (month-to-date) — see §4 |
| Region | `ACCEPTED_REGIONS` (US/GB/CA/AU/IE/NZ) | `country` enum (`resolveCountry`, WW→US) | one call per region, aggregate |
| Citation count | # appearances in `Sources` | `responses` / `prompts_count` | ranking proxy — validate top-70 overlap |
| Engine | model-agnostic | `llm` (default `ALL`) | default `ALL` |
| Owned exclusion | `classifyAndNormalize` drops owned | exclude `OWNED_BY_TARGET` | category selection |

---

### Option 2 — v4-raw Element API (weekly range). **Hardest. Needed for 100% behavioral replacement.**

Use Semrush's Element-level API directly — the same data the URL Inspector UI shows,
and the **only** path that supports a true weekly rolling window
(`start_date`/`end_date`).

**When to choose:** weekly freshness is non-negotiable and you want to preserve
today's rolling multi-week semantics exactly.

**Cost:** does **not** reuse the SR gRPC layer — the worker (or a new
api-service endpoint) must talk to Semrush directly with an API key, workspace id,
element ids, and a region→project mapping.

#### 5.4 Elements (from the Brand Presence Data API mapping)

> Concrete workspace/element IDs and the environment host are **internal** — do not
> commit them to this public repo. Pull the actual values from the internal
> *Brand Presence & URL Inspector Data API — Semrush Mapping* doc at build time
> (URL Inspector §1.3 "Cited Domains" and §1.4 "Domain URLs" elements).

```
Base (backend):  https://api.semrush.com/apis/v4-raw/external-api/v1/
                 workspaces/{WORKSPACE_ID}/products/ai/elements/{ELEMENT_ID}/data
Workspace:       {WORKSPACE_ID}                 # internal — see mapping doc

Cited Domains (rollup):  {CITED_DOMAINS_ELEMENT_ID}   # internal — URL Inspector §1.3
Domain URLs (per-URL):   {DOMAIN_URLS_ELEMENT_ID}     # internal — URL Inspector §1.4 / §1.2
```

`POST` body (per PDF), with a true date range:

```jsonc
{
  "render_data": {
    "filters": {
      "simple": { "CBF_date__start": "2026-06-11", "CBF_date__end": "2026-06-17" },
      "advanced": { "op": "and", "filters": [
        { "op": "eq", "val": "search-gpt", "col": "CBF_model" }
        // + hostname scoping for youtube.com / reddit.com (confirm exact CBF column
        //   for third-party source hostname against the Element-level API guide)
      ]}
    }
  }
}
```

Returned per-URL fields (`domain-urls`): `urlId`, `url`, `contentType`,
`citations`, `promptsCited`, `categories`, `regions`, `totalCount`.

#### 5.5 Flow (Option 2)

1. **Per platform** (`youtube.com`, `reddit.com`): call `domain-urls` scoped to that
   hostname over the trailing weekly window, order by `citations`, take top 70.
2. **Top-cited bucket**: call `cited-domains` for the top third-party hostnames
   (exclude owned + offsite + `wikipedia.org`), then `domain-urls` per hostname to
   collect URLs, merge, rank by `citations`, take top 70. (Or a broader
   all-third-party element if available — confirm.)
3. Build `allUrls: Map<url, { count: citations, domain }>` → feed the existing
   `classifyAndNormalize` / `selectTopUrls` path unchanged.
4. **Where the call lives:** either (a) new `spacecat-api-service` endpoint that
   proxies the element API (keeps the key server-side, mirrors Option 1's transport),
   or (b) a direct client in the worker. (a) preferred for secret handling.

#### 5.6 Extra work vs Option 1

- Secret management for the Semrush API key (env/secret store) — never in the worker
  bundle.
- Region → Semrush `CBF_project` mapping (regions map to projects in Semrush).
- Confirm the exact `CBF_*` column for third-party hostname scoping.
- Two-hop retrieval for the top-cited bucket (`cited-domains` → `domain-urls`).

---

## 6. Recommendation & difficulty ladder

| | Option 1 — HTTP / SR snapshot | Option 2 — Element API / weekly |
|---|---|---|
| Difficulty | **Low** | **High** |
| Reuses existing Semrush transport/auth | Yes | No |
| Time window | Monthly/daily snapshot | True weekly range (matches today) |
| Behavioral parity with today | Approximate (snapshot) | 100% (rolling window) |
| New secrets/config | Minimal | Semrush key + workspace/element ids + region→project map |
| Retrieval hops | 1 endpoint | 2 (domains → urls) for top-cited |

- **Start with Option 1 (union / Option B category).** Simplest, reuses everything,
  ships behind a flag; accept snapshot semantics.
- **Escalate to Option 2 only if** weekly freshness / exact rolling-window parity is
  required.
- Both feed the **same** `classifyAndNormalize` → `selectTopUrls` → DRS path; the
  only difference is the loader module and the time-window semantics.

---

## 7. Rollout

1. Land backend endpoint (Option 1) + tests.
2. Land worker loader + flag (`useSemrushSource`, per-site/env).
3. **Shadow-run**: compute Semrush top-70 (youtube/reddit/cited) and diff against the
   current SharePoint-selected set for a known site; confirm parity with the URL
   Inspector view already validated.
4. Cut over per site; retire the SharePoint read once parity holds.

---

## 8. Open decisions

- [ ] Category: **Option B (union)** [recommended] vs Option A (`MENTIONS_TARGET`).
- [ ] Window: **monthly snapshot (Option 1)** [recommended] vs weekly range (Option 2).
- [ ] Topic enrichment on the Semrush path: drop vs backfill.
- [ ] Union mechanics: two-call merge vs `UNSPECIFIED` minus owned (confirm gRPC).
- [ ] Option 2 only: exact `CBF_*` column for third-party hostname scoping.
