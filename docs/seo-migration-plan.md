# Audit-Worker: Ahrefs → SEO Client Migration Plan

**Branch**: `feat/switch-to-seo-client`
**PR**: #2276
**Status**: Addressing review feedback + completing remaining migration

---

## Review Feedback Items (PR #2276)

### Critical
- [x] **KPI metrics bands incompatible with authority score** — `src/backlinks/kpi-metrics.js:16-22`
  - `TRAFFIC_BANDS` calibrated for traffic volume (10K–25M), new client returns 0–100 authority score
  - Fix: Recalibrate bands for 0–100 range, update test fixtures

### Important
- [x] **`traffic_domain` semantics changed** — `src/backlinks/handler.js:330,335`
  - Now holds authority score (0–100) not traffic volume (thousands–millions)
  - Fix: Rename to `authority_score` in suggestion data mapping, add code comment
- [x] **Stale "Ahrefs" references in handler** — `src/backlinks/handler.js:238,248,457`
  - Error message says "Ahrefs import required", SiteTopPage queries use source `'ahrefs'`
  - Fix: Change source to `'seo'`, update error message

### Minor
- [x] **README references old env vars** — `README.md:112`
- [x] **Test fixtures use old-scale values** — update to 0–100 authority scores

---

## Remaining Migration (beyond PR review)

### Source queries: `'ahrefs'` → `'seo'` (SiteTopPage)
Import-worker PR writes SiteTopPage with source `'seo'`, so all readers must match.

- [x] `src/backlinks/handler.js:238` — `allBySiteIdAndSourceAndGeo(..., 'ahrefs', ...)`
- [x] `src/backlinks/handler.js:457` — same
- [x] `src/summarization/handler.js:38,67`
- [x] `src/image-alt-text/url-utils.js:50`
- [x] `src/metatags/handler.js:497`
- [x] `src/llm-blocked/handler.js:81`
- [x] `src/llm-error-pages/handler.js:51,109,252`
- [x] `src/canonical/handler.js:85`
- [x] `src/internal-links/scrape-submission.js:48`
- [x] `src/internal-links/opportunity-suggestions.js:143`
- [x] `src/health-check/handler.js:120`
- [x] `src/utils/data-access.js:119`
- [x] `src/utils/audit-input-urls.js:133`
- [x] `src/commerce-product-enrichments/handler.js:177`
- [x] `src/product-metatags/handler.js:811`
- [x] `src/structured-data/handler.js:168,195`
- [x] `src/prerender/handler.js:189`
- [x] `src/readability/opportunities/handler.js:39`
- [x] `src/accessibility/handler.js:71`

### S3 path updates: `ahrefs/` → `seo/`
Import-worker PR writes to `metrics/{siteId}/seo/` paths.

- [x] `src/support/utils.js:381` — `metrics/${siteId}/ahrefs/organic-traffic.json`
- [x] `src/backlinks/kpi-metrics.js:58` — `{ source: 'ahrefs', metric: 'organic-traffic' }`
- [x] `src/paid-keyword-optimizer/handler.js:90` — `metrics/${siteId}/ahrefs/paid-pages.json`
- [x] `src/paid-cookie-consent/ahrefs-cpc.js:34` — `metrics/${siteId}/ahrefs/agg-metrics.json`

### CPC file rename: `ahrefs-cpc.js` → `seo-cpc.js`
The SEO data provider returns equivalent CPC data (org_cost/org_traffic from getMetrics). The import-worker
already writes `seo/agg-metrics.json` with the same structure. This is a rename + path update.

- [x] Rename `src/paid-cookie-consent/ahrefs-cpc.js` → `src/paid-cookie-consent/seo-cpc.js`
- [x] Update import paths in `audit-data-provider.js` and `handler.js`
- [x] Update S3 key, log messages, source string, field names (ahrefs → seo)
- [x] Update `audit-data-provider.js:229` — `cpcData.source === 'seo'`
- [x] Update `handler.js:387-389` — `cpcSource === 'seo'`
- [x] Update `guidance-opportunity-mapper.js:180-181` — field names

### Import type constants (keep as-is for now)
- `'llmo-prompts-ahrefs'` in geo-brand-presence and llmo-customer-analysis — these are import
  type identifiers shared across services. Renaming requires coordinated change across
  import-worker, data-access, and all consumers. **Deferred to a separate PR.**

### README
- [x] `README.md:112` — update env var reference
