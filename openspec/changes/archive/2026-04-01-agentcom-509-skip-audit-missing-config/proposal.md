## Why

The commerce-product-enrichments handler is enabled for 31 sites, but only 1 has a valid `commerceLlmoConfig`. The remaining 30 sites trigger the full audit pipeline (import top pages, scrape, process), wasting import-worker and content-scraper resources (~800 Step 1 invocations/day) that can never produce results. Without `commerceLlmoConfig`, the audit falls through to a deprecated `getCommerceConfig` remote fallback (PSS-AI), which also fails for most sites.

## What Changes

- Add early validation in Step 1 of `commerce-product-enrichments` (`importTopPages`) to check that `commerceLlmoConfig` exists with at least one store view containing all required fields (`environmentId`, `websiteCode`, `storeCode`, `storeViewCode`)
- Add the same early validation in Step 1 of `commerce-product-enrichments-yearly` (`discoverSitemapUrlsAndSubmitForScraping`)
- Return `status: SKIPPED` with a warning log when validation fails, preventing the pipeline from proceeding to import/scrape steps
- Mark the `getCommerceConfig` remote fallback as deprecated for this audit type via a deprecation warning log

## Capabilities

### New Capabilities
- `commerce-config-validation`: Early validation of commerce configuration completeness before triggering the audit pipeline

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Code**: `src/commerce-product-enrichments/handler.js` (both `importTopPages` and `discoverSitemapUrlsAndSubmitForScraping` functions)
- **Dependencies**: `site.getConfig().state.commerceLlmoConfig` — reads site config to validate presence
- **Systems**: Reduces unnecessary load on import-worker and content-scraper services for unconfigured sites
- **APIs**: No external API changes; audit result now includes `SKIPPED` status for missing config
