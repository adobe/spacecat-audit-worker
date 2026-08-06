# Spec: Offsite cited-URL source from the Semrush URL-Inspector API

**Status:** Proposed
**Author:** Andrei Paraschiv
**Date:** 2026-08-05
**Epic:** [LLMO-6488](https://jira.corp.adobe.com/browse/LLMO-6488) · **Story:** [LLMO-6709](https://jira.corp.adobe.com/browse/LLMO-6709)
**Related:** ADR `docs/decisions/002-offsite-cited-urls-semrush-source.md` · migration plan `docs/plans/2026-07-17-offsite-cited-urls-semrush-migration.md` · PR #2847

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

**Non-goals (known gaps, tracked)**
- The generic "cited" (top third-party) bucket — needs a `cited-domains` discovery hop;
  tracked as a follow-up under LLMO-6709. This spec covers **YouTube + Reddit** only.
- **Region scoping.** The legacy path spans `ACCEPTED_REGIONS` (six markets) while this loader
  sends **no region param**. If the endpoint defaults to a single region, non-US orgs will
  diverge from legacy. Deferred to LLMO-6710 (region + platform mapping) — must be closed
  before non-US parity is claimed.
- Changing ranking, bucketing, DRS, or the analysis audits.
- Per-URL prompt attribution (LLMO-6712) and topic/category enrichment (LLMO-6708).

## 3. Technical design

### 3.1 Endpoint (spacecat-api-service wrapper)

`GET {SPACECAT_API_URI}/v2/orgs/:spaceCatId/brands/:brandId/serenity/brand-presence/url-inspector/domain-urls?hostname={host}&startDate=&endDate=&pageSize=100`

Served by the api-service **Elements proxy** (`src/controllers/elements.js` →
`listDomainUrls`, Semrush element `STATS_PER_URL`). Response: `{ urls: [{ url, citations,
promptsCited, categories, regions, contentType, urlId }] }`. `llmo.experiencecloud.live/api/v1`
is an edge alias for the same service. Path segments (`spaceCatId`, `brandId`) are URL-encoded.

`pageSize=100` covers the per-surface top-70 in one page. A server-side citations-descending
sort is **assumed but not confirmed**; the loader logs a truncation warning on a full page so a
capped/unsorted response is visible rather than silently dropping high-citation URLs. Each
request carries a 10s timeout; requests run concurrently.

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
2. For each `OFFSITE_DOMAINS` hostname (`youtube.com`, `reddit.com`) × each configured platform,
   call `domain-urls` and fold rows into `allUrls`:
   - normalize + classify via the shared `classifyAndNormalize` (owned-URL filtering, youtu.be
     canonicalization, domain assignment);
   - **enforce `YOUTUBE_URL_REGEX` / `REDDIT_URL_REGEX`** (parity with `handler.js:199-204`) so
     non-thread Reddit URLs and lookalike YouTube hosts are dropped, matching the legacy path;
   - `count = row.citations` (exact); sum across platforms for the same URL.
3. Handler branch: when `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED === 'true'` it tries Semrush
   **first**; if the loader yields no usable URLs (auth failure, no brand, outage, empty result)
   it **falls back** to the legacy `loadBrandPresenceData` (PostgREST → SharePoint) +
   `extractUrlsAndTopics`, so a Semrush problem can never silently zero out offsite. Flag off =
   legacy only. `selectTopUrls` onward is unchanged in every case.
   A Slack-triggered `offsite-brand-presence`/`cited-analysis`/`youtube-analysis`/`reddit-analysis`
   run can override this env var for that single run via the `enableSemrush` custom arg
   (`auditContext.messageData.enableSemrush`, resolved by `resolveEnableSemrush` — same
   tri-state mechanism as `enableBrandProfile`); `cited-analysis`/`youtube-analysis`/
   `reddit-analysis` forward it through `requestOffsiteScrape` so the override survives when
   they trigger a scoped `offsite-brand-presence` re-scrape. See ADR-002 decision 6.

### 3.4 Platform aggregation

Omitting `platform` does **not** aggregate across engines on `domain-urls`/`cited-domains` —
the proxy resolves an absent value to a single default engine. So the loader queries an
**explicit engine list** — the full offsite provider set mapped to serenity models via
`SEMRUSH_PLATFORM_BY_PROVIDER` (offsite `constants.js`): `google-ai-mode`, `search-gpt`,
`microsoft-copilot`, `gemini-2.5-flash`, `google-ai-overview`, `perplexity` — and **sums**
citations per URL, mirroring the legacy multi-engine mix. `OFFSITE_SEMRUSH_PLATFORMS`
(comma-separated) queries each engine and **sums citations per URL**. (LLMO-6710.)

### 3.5 Config

| Env | Default | Purpose |
|---|---|---|
| `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` | (off) | `"true"` switches source to Semrush |
| `SPACECAT_API_URI` | `https://spacecat.experiencecloud.live/api/v1` | api-service base |
| `OFFSITE_SEMRUSH_PLATFORMS` | full provider set (`SEMRUSH_PLATFORM_BY_PROVIDER`) | override: engines to query + sum |
| `enableSemrush` (Slack custom arg, not an env var) | (unset — env var applies) | per-run override of `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` |

## 4. Alternatives considered

- **Build a new SR AI-Visibility endpoint** / **direct v4-raw Semrush client** (Options 1 & 2 in
  the migration plan) — superseded: the api-service wrapper already exists and is UI-validated.
- **Route Semrush rows through the existing `extractUrlsAndTopics`** — rejected: it recounts by
  repetition and would discard the exact citation numbers.

## 5. Behavioral-parity note (reviewer follow-up)

There are two `classifyAndNormalize` functions: the enrichment one (hostname match +
normalization) and the stricter `handler.js` one (adds `YOUTUBE_URL_REGEX` / `REDDIT_URL_REGEX`
+ `isExcludedCitedHost`). The loader normalizes with the former and **re-applies the two
regexes** to match the legacy filter for its YouTube/Reddit scope. `isExcludedCitedHost` /
brand-token filtering only affect the top-cited bucket and will be applied when that bucket is
added.

## 6. Success criteria

- Flag off ⇒ byte-for-byte today's behavior (no regression).
- Flag on ⇒ YouTube/Reddit cited URLs come from Semrush with exact citation counts; strict
  format filtering matches the legacy path.
- Env-enabled + Semrush fails ⇒ automatic fallback to the legacy PostgREST → SharePoint
  source (no offsite gap).
- `enableSemrush:true` (Slack override) + Semrush fails ⇒ **hard stop** (`success:false`,
  `dataSource:'semrush'`, no fallback) so the failure is visible during LLMO-6709 testing.
- Shadow-run (LLMO-6711) shows acceptable top-70 overlap per surface vs the legacy source.
- 100% test coverage on the new module; full suite green.
