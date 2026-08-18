# Spec: Offsite cited-URL source from the Semrush URL-Inspector API

**Status:** Proposed
**Author:** Andrei Paraschiv
**Date:** 2026-08-05
**Epic:** [LLMO-6488](https://jira.corp.adobe.com/browse/LLMO-6488) · **Story:** [LLMO-6709](https://jira.corp.adobe.com/browse/LLMO-6709)
**Related:** ADR `docs/decisions/002-offsite-cited-urls-semrush-source.md` · migration plan `docs/plans/2026-07-17-offsite-cited-urls-semrush-migration.md` · PR #2847 (original per-hostname × per-engine design) · PR #2868 (single-request revision) · [LLMO-6844](https://jira.corp.adobe.com/browse/LLMO-6844) (optional `hostname`) · [LLMO-6818](https://jira.corp.adobe.com/browse/LLMO-6818) (`platform=all`)

---

## 1. Problem statement

The `offsite-brand-presence` audit selects the cited URLs it feeds to DRS (YouTube, Reddit,
and top third-party "cited" sources) from **internal Brand-Presence execution data** —
PostgREST for brandalf-enabled orgs, with a SharePoint Excel fallback
(`loadBrandPresenceData`). We want those same URLs — ranked by citation volume — sourced from
the **Semrush URL-Inspector API** instead, without changing anything downstream of URL
selection.

## 2. Goals / non-goals

**Goals**
- Add a flag-gated data source that returns the exact `allUrls: Map<url, { count, domain }>`
  contract the existing pipeline consumes, with `count = exact Semrush citations`.
- Preserve today's selection semantics: `selectTopUrls` (per-surface top-70, ranked by
  citations) and the DRS scrape / poll / analysis path are **unchanged**.
- Behavioral parity with the legacy path for the URL set it produces.
- Source **all three buckets — youtube.com, reddit.com, and third-party "cited"** — from a
  **single** `domain-urls` request per audit run (LLMO-6844 + LLMO-6818).

**Non-goals (known gaps, tracked)**
- **Per-domain diversity within the cited bucket.** The loader does not cap how many URLs a
  single third-party domain contributes; `selectTopUrls` downstream ranks by citations only.
- Changing ranking, bucketing, DRS, or the analysis audits.
- Per-URL prompt attribution (LLMO-6712) and topic/category enrichment (LLMO-6708).

## 3. Technical design

### 3.1 Endpoint (spacecat-api-service wrapper)

**One** `url-inspector` endpoint call, served by the api-service **Elements proxy**
(`src/controllers/elements.js` → `listDomainUrls`, Semrush element `STATS_PER_URL`); path
segments (`spaceCatId`, `brandId`) are URL-encoded:

```
GET {SPACECAT_API_URI}/v2/orgs/:spaceCatId/brands/:brandId/serenity/brand-presence
    /url-inspector/domain-urls?platform=all&startDate=&endDate=&pageSize=1000
```

No `hostname` is sent — LLMO-6844 made it optional, so the endpoint returns URLs across
**every** source host instead of one. `platform=all` (LLMO-6818) aggregates citations across
every AI engine **server-side**. Response:
`{ urls: [{ url, citations, promptsCited, categories, regions, contentType, urlId }],
totalCount }`, sorted by citations descending.

The request carries a 10s timeout. `PAGE_SIZE` (1000, a fixed constant — §3.4) matches the
`domain-urls` server-side `pageSize` clamp — the max we can actually get in one page. The
loader logs a truncation warning on a full page, since the sort is global across every host
and a low-citation bucket can be starved by too small a page.

### 3.2 Auth

The loader mints a **service IMS token** via **v2 `ImsClient.getServiceAccessToken()`**
(`authorization_code` grant, default IMS client — the same S2S path commerce/vulnerabilities/
permissions use) and sends `Authorization: Bearer`. (v3 `getServiceAccessTokenV3()` /
`client_credentials` returned IMS `400 unauthorized_client` — the default client isn't
provisioned for that grant; only a dedicated integration like `CONTENTAI_*` is.) The proxy's
`requireImsBearer` forwards it **unchanged** to Semrush
(`docs/elements/semrush-elements-api-reference.md` §Authentication) — no `x-promise-token`
needed for a service caller. **Open risk (LLMO-6709):** the wrapper is designed around a real
user's IMS token, so the worker's service token must be authorized upstream by Semrush; the
flag stays off until verified (test one canary run via the `enableSemrush:true` Slack override).

### 3.3 Flow (`src/utils/offsite-brand-presence-semrush.js`)

1. Resolve `spaceCatId = site.getOrganizationId()`, `brandId = resolveBrandForSite(...)`,
   `{ startDate, endDate } = getDateWindowForPreviousWeeks(previousWeeks)`.
2. Make the single `domain-urls` request (§3.1) and classify each row (`classifyRow`):
   - normalize + classify via the shared `classifyAndNormalize` (owned-URL filtering, youtu.be
     canonicalization, domain assignment);
   - every other row is the third-party "cited" bucket (`domain: null`), **unless**
     `contentType: "Owned"`, the host is in `TOP_CITED_EXCLUDED_DOMAINS` (e.g.
     `wikipedia.org`), or `isExcludedCitedHost` (social/search/brand-owned-lookalike + brand
     tokens) flags it — the legacy top-cited gate, applied per URL row instead of per
     domain-level rollup;
   - `count = row.citations` (exact, already summed across every engine server-side); citations
     are clamped (`Math.max(0, …)`) and a zero-citation URL is dropped; duplicate URLs within
     the page are summed defensively.
   - **Region scoping (LLMO-6710, closed).** The request itself still sends no region param
     (§3.1), but each classified row's `regions` field (comma-joined codes, e.g. `"US,GB"`) is
     checked client-side against `ACCEPTED_REGIONS` — mirroring the legacy path's gate. A row
     with no `regions` value (Semrush didn't resolve one) is kept as "unknown", not rejected,
     so a metadata gap can't silently zero out a run. When every classified row is dropped for
     region, a warning is logged (`All N classified row(s) were skipped: region not in
     ACCEPTED_REGIONS`) so this is distinguishable from a genuine zero-citation result.
3. **Format parity.** The loader re-applies `YOUTUBE_URL_REGEX` / `REDDIT_URL_REGEX`
   (matching the legacy `handler.js` classify) to `youtube.com` / `reddit.com` rows so
   non-thread Reddit and lookalike YouTube hosts are dropped identically.
4. Handler branch: when `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED === 'true'` it tries Semrush
   **first**; if the loader yields no usable URLs (auth failure, no brand, outage, empty result)
   it **falls back** to the legacy `loadBrandPresenceData` (PostgREST → SharePoint) +
   `extractUrlsAndTopics`, so a Semrush problem can never silently zero out offsite. Flag off =
   legacy only. `selectTopUrls` onward is unchanged in every case.
   A Slack-triggered `offsite-brand-presence`/`cited-analysis`/`youtube-analysis`/`reddit-analysis`
   run can override this env var for that single run via the `enableSemrush` custom arg
   (`auditContext.messageData.enableSemrush`, resolved by `resolveEnableSemrush` — same
   tri-state mechanism as `enableBrandProfile`). See ADR-002 decision 7.

### 3.4 Config

| Env | Default | Purpose |
|---|---|---|
| `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` | (off) | `"true"` switches source to Semrush |
| `SPACECAT_API_URI` | `https://spacecat.experiencecloud.live/api/v1` | api-service base |
| `enableSemrush` (Slack custom arg, not an env var) | (unset — env var applies) | per-run override of `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` |

## 4. Alternatives considered

- **Build a new SR AI-Visibility endpoint** / **direct v4-raw Semrush client** (Options 1 & 2 in
  the migration plan) — superseded: the api-service wrapper already exists and is UI-validated.
- **Route Semrush rows through the existing `extractUrlsAndTopics`** — rejected: it recounts by
  repetition and would discard the exact citation numbers.
- **Per-hostname × per-engine fan-out, summing citations client-side, plus a two-hop
  `cited-domains` → `domain-urls` discovery walk for the third-party bucket.** Superseded once
  LLMO-6844 (optional `hostname`) and LLMO-6818 (`platform=all`) landed: the single
  hostname-less, `platform=all` request already returns every host's URLs, aggregated, in one
  citations-sorted page — the same exact-citation-count contract with 1 request instead of up
  to 78, with no separate domain-discovery hop.

## 5. Behavioral-parity note (reviewer follow-up)

There are two `classifyAndNormalize` functions: the enrichment one (hostname match +
normalization) and the stricter `handler.js` one (adds `YOUTUBE_URL_REGEX` / `REDDIT_URL_REGEX`
+ `isExcludedCitedHost`). The loader normalizes with the former and re-creates the stricter
filter itself in `classifyRow`: it **re-applies the two regexes** to the YouTube/Reddit rows,
and applies `TOP_CITED_EXCLUDED_DOMAINS` + `isExcludedCitedHost` + brand tokens to the
third-party "cited" rows — matching the legacy filter for each bucket.

## 6. Success criteria

- Flag off ⇒ byte-for-byte today's behavior (no regression).
- Flag on ⇒ YouTube/Reddit and top-cited third-party URLs come from Semrush with exact
  citation counts (server-side-aggregated across engines via `platform=all`); strict format
  filtering and the top-cited earned-host gate match the legacy path.
- Flag on + Semrush unavailable ⇒ automatic fallback to the legacy PostgREST → SharePoint
  source (no offsite gap).
- `enableSemrush:true` (Slack override) + Semrush fails ⇒ **hard stop** (`success:false`,
  `dataSource:'semrush'`, no fallback) so the failure is visible during LLMO-6709 testing.
- Shadow-run (LLMO-6711) shows acceptable top-70 overlap per bucket vs the legacy source.
- Exactly one `domain-urls` request per audit run when Semrush is enabled.
- 100% test coverage on the new module; full suite green.
