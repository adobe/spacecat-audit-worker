# Alt-Text Audit: URL Fallback Chain

## Problem

The alt-text audit (`processScraping` and `processAltTextWithMystique`) relied solely on Ahrefs top pages as the URL source. If Ahrefs returned no data for a site, the audit would fail immediately with no recovery path.

## Solution

Implemented a three-tier URL fallback chain, applied identically in both audit steps:

1. **Ahrefs** (primary) — `SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global')`
2. **RUM** (fallback) — `traffic-acquisition` query via `RUMAPIClient`, sorted by organic traffic (`earned`) descending
3. **`getIncludedURLs('alt-text')`** (last resort) — manually configured URLs from site config

If all three sources return empty, the audit throws an error as before.

## Key Design Decisions

- **`includedURLs` is no longer merged** in the happy path. Previously it was always combined with Ahrefs results. Now it is strictly a last-resort fallback.
- **RUM URLs are normalized** with `https://` scheme prefix, since RUM returns domain-relative URLs (e.g., `www.example.com/page`) while Ahrefs returns full URLs (`https://example.com/page`).
- **Page limits are consistent** across all sources. The same `pageLimit` (20 for summit-plg, 100 for regular) applies regardless of URL source via the existing `getTopPagesWindow` function.
- **`dataSources` in opportunity metadata** stays hardcoded as `[RUM, SITE, AHREFS]` for simplicity.

## Files Changed

| File | Change |
|------|--------|
| `src/image-alt-text/url-utils.js` | **NEW** — `getTopPageUrls` function implementing the fallback chain |
| `src/image-alt-text/handler.js` | Replaced direct Ahrefs calls with `getTopPageUrls` in both `processScraping` and `processAltTextWithMystique`; removed `includedURLs` merge; updated code from SiteTopPage objects to plain URL strings |
| `test/audits/image-alt-text/url-utils.test.js` | **NEW** — 9 test cases covering all fallback paths, sorting, normalization, and error handling |
| `test/audits/image-alt-text/handler.test.js` | Updated esmock setup to mock `getTopPageUrls`; converted all SiteTopPage object mocks to plain URL string mocks |

## Known Risks (Accepted)

1. **Offset drift across source changes**: If Ahrefs is available on run N but RUM on run N+1, the stored offset may exceed the new list length. The existing `getTopPagesWindow` wrap-around logic handles this.
2. **Source inconsistency between steps**: `processScraping` and `processAltTextWithMystique` run in separate SQS messages and fetch URLs independently. If Ahrefs availability changes between steps, they may use different sources.
3. **RUM URL format**: RUM may return URLs with `www.` prefix while Ahrefs does not. Normalization adds `https://` but does not strip/add `www.`.
