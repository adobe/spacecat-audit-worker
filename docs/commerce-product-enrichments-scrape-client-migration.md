# Commerce Product Enrichments - SCRAPE_CLIENT Migration Plan

## Overview
Migrate commerce-product-enrichments from old `CONTENT_SCRAPER` pattern to new `SCRAPE_CLIENT` pattern for better tracking, resilience, and efficient S3 access.

## Changes Required

### 1. Update Audit Builder Destination
**File**: `src/commerce-product-enrichments/handler.js:311`

```javascript
// Before:
.addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)

// After:
.addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
```

### 2. Update Step 2: submitForScraping
**File**: `src/commerce-product-enrichments/handler.js:74-156`

**Changes**:
- Remove `jobId`, `processingType`, `allowCache`, `completionQueueUrl` fields
- Return payload matching SCRAPE_CLIENT format
- Add `maxScrapeAge: 0` to force rescrape on every run

```javascript
// Return format:
return {
  urls: filteredUrls,  // Array of URL strings
  processingType: 'default',
  options: {},
  maxScrapeAge: 0,  // Force rescrape (no cache)
};
```

Reference: `src/product-metatags/handler.js:169-177` for example.

### 3. Update Step 3: runAuditAndProcessResults
**File**: `src/commerce-product-enrichments/handler.js:166-306`

**Changes**:
- Replace `data?.scrapeResults` with `scrapeResultPaths` from context
- Iterate over Map instead of array
- Remove S3 bucket/location handling (paths provided)

```javascript
export async function runAuditAndProcessResults(context) {
  const {
    site, audit, finalUrl, log, scrapeResultPaths, s3Client, env,
  } = context;

  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    // Handle no results...
  }

  // Iterate over Map<url, s3Path>
  const processResults = await Promise.all(
    [...scrapeResultPaths].map(async ([url, s3Path]) => {
      const scrapeData = await getObjectFromKey(s3Client, bucketName, s3Path, log);
      // ... process for product detection
    })
  );
}
```

Reference: `src/product-metatags/handler.js:205-330` for full example.

### 4. Update Tests
**File**: `test/audits/commerce-product-enrichments/handler.test.js`

- Update Step 2 tests to expect new return format
- Update Step 3 tests to provide `scrapeResultPaths` Map instead of `data.scrapeResults`
- Add `scrapeJobId` to auditContext in test fixtures

## Benefits After Migration

1. **Resilient**: Scrape jobs tracked in DynamoDB, partial completions handled
2. **Efficient**: Direct S3 paths, no scanning required
3. **Traceable**: Job status visible in database
4. **Scalable**: Worker parallelization instead of single Lambda timeout
5. **Forced Rescrape**: `maxScrapeAge: 0` ensures fresh data on every audit run

## Verification

1. Run tests: `npm test -- test/audits/commerce-product-enrichments/handler.test.js`
2. Trigger audit manually and verify:
   - ScrapeJob record created in DynamoDB
   - ScrapeUrl records created for each URL
   - Step 3 receives scrapeResultPaths Map
   - Product detection logic works correctly
