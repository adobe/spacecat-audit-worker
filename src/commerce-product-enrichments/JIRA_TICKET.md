# Commerce Product Enrichments Audit - Initial Scaffolding

## Summary

Implement the initial scaffolding for the `commerce-product-enrichments` audit type in SpaceCat. This ticket covers the boilerplate setup, registration across all SpaceCat services, and a functional pipeline that retrieves top pages, submits them for scraping, and logs the results before actual processing logic is implemented.

---

## Issue Type

Story

## Priority

Medium

## Labels

`commerce`, `audit`, `scaffolding`, `spacecat`

## Components

- spacecat-audit-worker
- spacecat-shared
- spacecat-api-service

---

## Description

### Background

The Commerce Product Enrichments audit is a new audit type designed to analyze commerce/product pages and identify enrichment opportunities. This initial implementation establishes the foundational infrastructure required before the actual audit logic can be developed.

### Objective

Create the complete audit scaffolding that:
1. Follows the established SpaceCat 3-step audit pattern (matching `product-metatags` implementation)
2. Registers the audit type across all required SpaceCat services
3. Successfully retrieves top pages from Ahrefs data and site configuration
4. Submits pages for content scraping via the scrape client
5. Receives scraped content and logs results (placeholder for future processing)

### Out of Scope

- Actual commerce page analysis logic
- SEO checks and issue detection
- Opportunity and suggestion generation
- AI-powered recommendations
- Traffic impact calculations

---

## Acceptance Criteria

### 1. Audit Type Registration

- [ ] `COMMERCE_PRODUCT_ENRICHMENTS: 'commerce-product-enrichments'` added to `AUDIT_TYPES` enum in `spacecat-shared`
- [ ] Handler registered in `spacecat-audit-worker/src/index.js`
- [ ] Audit type added to `ALL_AUDITS` array in `spacecat-api-service` for Slack bot support

### 2. Handler Implementation (spacecat-audit-worker)

- [ ] Create `src/commerce-product-enrichments/` directory structure
- [ ] Implement `constants.js` with audit type identifier and log prefix
- [ ] Implement `handler.js` with 3-step audit pattern using `AuditBuilder`
- [ ] Create `README.md` documentation

### 3. Step 1: Import Top Pages (`importTopPages`)

- [ ] Receives audit context with site and finalUrl
- [ ] Creates S3 bucket path reference for scrape results
- [ ] Returns metadata for import worker with:
  - `type: 'top-pages'`
  - `siteId`
  - `auditResult: { status: 'preparing', finalUrl }`
  - `fullAuditRef` (S3 path)
- [ ] Logs step start and completion

### 4. Step 2: Submit for Scraping (`submitForScraping`)

- [ ] Retrieves top pages from database via `SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global')`
- [ ] Retrieves included URLs from site configuration via `site.getConfig().getIncludedURLs('commerce-product-enrichments')`
- [ ] Combines and deduplicates URL lists
- [ ] Filters out PDF files (`.pdf` extension)
- [ ] Throws error if no URLs found
- [ ] Returns payload for scrape client with:
  - `urls` (array of URL objects)
  - `siteId`
  - `type: 'commerce-product-enrichments'`
- [ ] Logs URL counts and filtering results

### 5. Step 3: Run Audit and Process Results (`runAuditAndProcessResults`)

- [ ] Receives `scrapeResultPaths` Map from scrape client
- [ ] Logs all scraped page URLs and S3 paths
- [ ] Logs stop point message indicating initial implementation placeholder
- [ ] Returns minimal result with:
  - `status: 'complete'`
  - `auditResult.status: 'initial-implementation'`
  - `auditResult.pagesScraped` count
- [ ] Does NOT process scraped content (placeholder for future ticket)

### 6. Logging Standards

- [ ] All log messages prefixed with `[COMMERCE-PRODUCT-ENRICHMENTS]`
- [ ] Info-level logs for step transitions and key metrics
- [ ] Debug-level logs for detailed data
- [ ] Error-level logs for failures

### 7. AuditBuilder Configuration

- [ ] URL resolver: `site.getBaseURL()`
- [ ] Step 1 destination: `AUDIT_STEP_DESTINATIONS.IMPORT_WORKER`
- [ ] Step 2 destination: `AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT`
- [ ] Step 3: No destination (final step)

---

## Technical Details

### File Structure

```
spacecat-audit-worker/src/commerce-product-enrichments/
├── constants.js      # AUDIT_TYPE, LOG_PREFIX
├── handler.js        # 3-step audit handler
└── README.md         # Documentation
```

### Dependencies

- `@adobe/spacecat-shared-data-access` - Audit model, AUDIT_STEP_DESTINATIONS
- `../common/audit-builder.js` - AuditBuilder class

### Configuration Requirements

After code deployment, register audit via API:

```bash
curl -X POST 'https://spacecat.experiencecloud.live/api/ci/configurations/audits' \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "auditType": "commerce-product-enrichments",
    "isEnabled": true,
    "excludeFromUptime": true,
    "manual": true,
    "interval": "never"
  }'
```

---

## Testing

### Manual Testing

1. Deploy changes to dev environment
2. Register audit configuration via API
3. Enable audit for test site:
   ```
   @spacecat-dev audit enable <test-site> commerce-product-enrichments
   ```
4. Trigger audit:
   ```
   @spacecat-dev run audit commerce-product-enrichments <test-site>
   ```
5. Verify in Coralogix:
   - Search: `"[COMMERCE-PRODUCT-ENRICHMENTS]"`
   - Confirm all 3 steps execute
   - Confirm scraped pages are logged
   - Confirm stop point message appears

### Expected Log Output

```
[COMMERCE-PRODUCT-ENRICHMENTS] Step 1: importTopPages started for site: <siteId>
[COMMERCE-PRODUCT-ENRICHMENTS] Step 1: importTopPages completed
[COMMERCE-PRODUCT-ENRICHMENTS] Step 2: submitForScraping started for site: <siteId>
[COMMERCE-PRODUCT-ENRICHMENTS] Retrieved X top pages from database
[COMMERCE-PRODUCT-ENRICHMENTS] Step 2: submitForScraping completed, returning X URLs for scraping
[COMMERCE-PRODUCT-ENRICHMENTS] Step 3: runAuditAndProcessResults started
[COMMERCE-PRODUCT-ENRICHMENTS] Successfully retrieved X scraped pages
[COMMERCE-PRODUCT-ENRICHMENTS] ============================================
[COMMERCE-PRODUCT-ENRICHMENTS] AUDIT STOP POINT - Initial Implementation
[COMMERCE-PRODUCT-ENRICHMENTS] ============================================
```

---

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Code follows existing patterns from `product-metatags` audit
- [ ] Changes deployed to dev/stage environment
- [ ] Manual testing completed successfully
- [ ] Audit configuration registered
- [ ] PR approved and merged

---

## Related Links

- [Developer Guide: Creating a New Audit Type in SpaceCat](https://wiki.corp.adobe.com/pages/viewpage.action?spaceKey=EntComm&title=Developer+Guide%3A+Creating+a+New+Audit+Type+in+SpaceCat)
- [Product Metatags PR #1271](https://github.com/adobe/spacecat-audit-worker/pull/1271) - Reference implementation
- [Product Metatags PR #1631](https://github.com/adobe/spacecat-audit-worker/pull/1631) - AC-* headers support

---

## Follow-up Tickets

This scaffolding enables future implementation work:

1. **Commerce Page Analysis Logic** - Implement actual page content analysis in Step 3
2. **SEO Checks** - Create `seo-checks.js` for commerce-specific issue detection
3. **Opportunity Generation** - Create opportunities and suggestions from detected issues
4. **Traffic Impact** - Calculate projected traffic value using RUM data
5. **AI Suggestions** - Integrate with GenVar for AI-powered recommendations
