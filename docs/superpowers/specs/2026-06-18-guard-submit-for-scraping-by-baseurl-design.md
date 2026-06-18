# Guard `submitForScraping` by `site.baseUrl`

**Date:** 2026-06-18
**Branch:** `feat/subpath/guard-url-processing-by-baseurl`
**Status:** Accepted

---

## Problem

`submitForScraping` in `src/prerender/handler.js` collects URLs from three sources — organic SEO top pages, config-included URLs, and agentic Athena URLs — and also accepts explicit CSV URLs via `auditContext.urls`. After collecting, all URLs are rebased to the `preferredBase` (resolved from `getPreferredBaseUrl`), which only swaps the origin (protocol + host). The URL path is preserved unchanged.

When a site's `baseUrl` includes a subpath (e.g. `https://www.example.com/en`), organic or agentic URLs from other parts of the site (e.g. `https://www.example.com/fr/page`) survive the rebase and get submitted for scraping even though they are outside the scoped subpath. This produces scrape results and suggestions for URLs the site operator does not intend to prerender.

---

## Goals

- Only submit URLs to the scraper that fall under `site.baseUrl` (same origin, pathname starts with the base pathname).
- Apply the guard to both the CSV path and the normal organic/agentic/included path.
- Zero regression for whole-domain sites (root `basePath = /`).
- Keep per-source metrics unambiguous — baseUrl filtering is counted separately from non-HTML extension filtering.

---

## Design

### Helper: `isUnderBaseUrl(url, baseUrl)`

Add to `src/prerender/utils/utils.js`:

```js
export function isUnderBaseUrl(url, baseUrl) {
  try {
    const { origin: urlOrigin, pathname: urlPath } = new URL(url);
    const { origin: baseOrigin, pathname: basePath } = new URL(baseUrl);
    if (urlOrigin !== baseOrigin) return false;
    if (basePath === '/') return true;
    return urlPath === basePath || urlPath.startsWith(basePath + '/');
  } catch {
    return false;
  }
}
```

**Invariants:**
- Origin must match exactly (protocol + host + port).
- `basePath === '/'` → whole-domain site → all same-origin URLs pass (no regression).
- Exact match (`urlPath === basePath`) covers the base URL itself.
- Prefix uses `basePath + '/'` to prevent `/english` matching base `/en`.
- Unparseable URLs return `false` (excluded), never throws.

---

### Changes to `submitForScraping`

The filter anchor is `preferredBase` (result of `getPreferredBaseUrl(site, context)`), since that's what `rebaseUrl` targets and what the scraper will operate against.

**CSV path** — filter after rebase, before dedup:

```js
const rebasedCsvUrls = auditContext.urls.map((url) => rebaseUrl(url, preferredBase, log));
const baseUrlFilteredCsvUrls = rebasedCsvUrls.filter((url) => isUnderBaseUrl(url, preferredBase));
const csvBaseUrlFilteredCount = rebasedCsvUrls.length - baseUrlFilteredCsvUrls.length;
if (csvBaseUrlFilteredCount > 0) {
  log.info(`${LOG_PREFIX} Filtered ${csvBaseUrlFilteredCount} CSV URL(s) outside baseUrl. baseUrl=${preferredBase}`);
}
const { urls: explicitUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(
  baseUrlFilteredCsvUrls,
  { includeQueryParams: true },
);
```

**Normal path** — filter each source right after rebase:

```js
const rebasedTopPagesUrls = topPagesUrls
  .map((url) => rebaseUrl(url, preferredBase, log))
  .filter((url) => isUnderBaseUrl(url, preferredBase));

const rebasedIncludedURLs = (site.getConfig()?.getIncludedURLs(AUDIT_TYPE) ?? [])
  .map((url) => rebaseUrl(url, preferredBase, log))
  .filter((url) => isUnderBaseUrl(url, preferredBase));
```

Agentic URLs are not rebased — filter immediately after retrieval:

```js
const agenticUrls = (await getTopAgenticUrls(site, context))
  .filter((url) => isUnderBaseUrl(url, preferredBase));
```

The existing `filteredCount` in the metrics log (from `mergeAndGetUniqueHtmlUrls`) only tracks non-HTML extension filtering. BaseUrl-filtered counts are separate log entries, keeping both metrics independently attributable.

---

### Error handling

- `isUnderBaseUrl` never throws — malformed `url` or `baseUrl` returns `false`.
- If `preferredBase` is malformed, all URLs are excluded, resulting in `urls: []`. The existing `submittedUrls=0` log path handles this gracefully without new error paths.

---

## Testing

All tests in `test/audits/prerender/handler.test.js`:

1. **`isUnderBaseUrl` unit tests:**
   - Root base (`/`) passes all same-origin URLs.
   - Subpath base passes exact match and child paths.
   - Subpath base rejects sibling paths (e.g. `/english` does not match `/en`).
   - Cross-origin returns `false`.
   - Malformed URL returns `false`.

2. **CSV path — subpath base:** Stub `auditContext.urls` with in-scope and out-of-scope URLs; assert only in-scope appear in returned `urls`, and filtered count is info-logged.

3. **Normal path — subpath base:** Stub organic/agentic/included to include out-of-scope URLs; assert `urls: []` and warn log.

4. **Root base regression:** `baseUrl = https://www.example.com` — all same-domain URLs pass through unchanged.

---

## Files changed

| File | Change |
|------|--------|
| `src/prerender/utils/utils.js` | Add `isUnderBaseUrl` helper |
| `src/prerender/handler.js` | Apply filter in CSV path and normal path (3 sources) |
| `test/audits/prerender/handler.test.js` | Unit + integration tests for all paths |
