# Bot Protection Implementation - Audit Worker

## Overview

This document describes the bot protection detection and handling implementation in the SpaceCat Audit Worker. The audit worker detects when content scraping is blocked by bot protection systems (Cloudflare, Akamai, etc.) and aborts audit processing when bot protection is detected.

---

## Architecture

### Single Source of Truth: CloudWatch Logs

The audit worker queries **CloudWatch logs** (not SQS messages or DynamoDB) to detect bot protection. This ensures:
- ✅ Centralized, structured logging from Content Scraper
- ✅ No coupling between services via message flags
- ✅ Audit worker can make independent decisions
- ✅ Historical data is queryable for debugging

### Universal Bot Protection Check

Bot protection checking is implemented in the **`StepAudit` base class**, which means:
- ✅ **All audits** that use scraping automatically get bot protection detection
- ✅ No changes needed in individual audit implementations (meta-tags, cwv, broken-backlinks, etc.)
- ✅ Consistent behavior across all audit types
- ✅ Future audits automatically inherit this functionality

---

## Implementation Details

### 1. Core Function: `checkBotProtection()`

**Location**: `src/common/step-audit.js` (lines 28-115)

This async function:
1. Queries CloudWatch logs for bot protection events
2. Gathers detailed statistics (HTTP status codes, blocker types)
3. Logs comprehensive warning with bot protection details
4. Returns early response to abort audit processing

**Key Features**:
- Uses `siteId` for precise log filtering
- Applies 5-minute buffer to handle clock skew and log ingestion delays
- Aggregates statistics by HTTP status and blocker type
- Returns structured response with `skipped: true` flag

**Example Log Output**:
```
[BOT-BLOCKED] Audit aborted for type meta-tags for site https://example.com (site-123) 
with bot protection details: HTTP Status Counts: [403: 5, 200: 2], 
Blocker Types: [cloudflare: 5, akamai: 2], 
Bot Protected URLs: [https://example.com/page1, https://example.com/page2, ...]
```

---

### 2. Integration in Audit Workflow

**Location**: `src/common/step-audit.js` (lines 225-245)

The `run()` method in `StepAudit` class automatically checks for bot protection when:
- A `scrapeJobId` is present in the audit context (lines 225-245)
- Before loading scrape results
- Before running the audit step handler

**Flow**:
```javascript
if (hasScrapeJobId) {
  stepContext.scrapeJobId = auditContext.scrapeJobId;
  const scrapeClient = ScrapeClient.createFrom(context);
  stepContext.scrapeResultPaths = await scrapeClient
    .getScrapeResultPaths(auditContext.scrapeJobId);

  // ✅ Check for bot protection and abort if detected
  const botProtectionResult = await checkBotProtection({
    site,
    siteId,
    auditType: type,
    auditContext,
    stepContext,
    context,
    scrapeClient,
  });

  if (botProtectionResult) {
    return botProtectionResult; // ❌ Abort audit
  }
}

// ✅ Continue with audit if no bot protection detected
const stepResult = await step.handler(stepContext);
```

---

### 3. CloudWatch Query Utility

**Location**: `src/utils/cloudwatch-utils.js`

#### `queryBotProtectionLogs(siteId, context, searchStartTime)`

Queries CloudWatch Logs for bot protection events using:

**Filter Pattern**:
```javascript
filterPattern: `"[BOT-BLOCKED]" "${siteId}"`
```

**Time Window**:
- Start: `searchStartTime - 5 minutes` (buffer for clock skew and log ingestion delays)
- End: `Date.now()`

**Limit**: 500 events (increased from 100)

**Features**:
- Parses JSON log messages from Content Scraper
- Extracts bot protection metadata (URL, blocker type, HTTP status, confidence)
- Handles malformed log messages gracefully
- Returns structured array of bot protection events

**Example CloudWatch Event**:
```json
{
  "jobId": "abc-123",
  "siteId": "site-456",
  "url": "https://example.com/page",
  "blockerType": "cloudflare",
  "confidence": 0.99,
  "httpStatus": 403,
  "errorCategory": "bot-protection"
}
```

---

## Time Window Strategy

### Audit Creation Timestamp

The bot protection check uses **`audit.getAuditedAt()`** as the search start time:

**Why This Works**:
1. ✅ Audit is created **after the first step completes** but **before scraping starts**
2. ✅ This timestamp is always BEFORE the Content Scraper runs
3. ✅ Captures all relevant bot protection logs from the current scrape job
4. ✅ 5-minute buffer provides additional safety margin

**Timeline Example**:
```
10:00:00  Step 1 (submit-for-import) completes
10:00:00  ✅ Audit created with auditedAt = 10:00:00
10:00:01  Step 2 (submit-for-scraping) creates scrape job
10:00:05  Content Scraper starts scraping
10:00:10  Content Scraper logs bot protection to CloudWatch
10:00:15  Step 3 (run-audit) checks bot protection
          Query: 09:55:00 to 10:00:15 (5min buffer)
          ✅ Finds log from 10:00:10
          ❌ Audit aborted
```

### Standalone Audit Runs

For audits triggered via `run audit` command (not onboarding):
- Uses `audit.getAuditedAt()` directly
- No `onboardStartTime` available
- Still works correctly because audit timestamp is before scraping

---

## Changes Made

### Files Modified

1. **`src/common/step-audit.js`**
   - Added `checkBotProtection()` async function (lines 28-115)
   - Integrated bot protection check in `run()` method (lines 231-244)
   - Added CloudWatch query import

2. **`src/utils/cloudwatch-utils.js`**
   - Created new utility file for CloudWatch interactions
   - Implemented `queryBotProtectionLogs()` function
   - Added 5-minute buffer constant
   - Simplified filter pattern to use `siteId` only (removed `jobId`)
   - Increased query limit from 100 to 500 events

3. **`test/common/step-audit.test.js`**
   - Added comprehensive tests for bot protection scenarios
   - Added test for missing `httpStatus` or `blockerType` fields
   - Updated existing tests to handle bot protection response structure
   - Removed obsolete time fallback tests

4. **`test/utils/cloudwatch-utils.test.js`**
   - Created comprehensive test suite for CloudWatch utility
   - Tests for successful queries, empty results, errors
   - Tests for proper time range and filter pattern
   - Tests for log message parsing

### Dependencies Added

- **`@aws-sdk/client-cloudwatch-logs`**: For querying CloudWatch Logs
  - Added to `package.json`
  - Used to create `CloudWatchLogsClient` and `FilterLogEventsCommand`

---

## Behavior

### When Bot Protection is Detected

1. **Query CloudWatch**: Search for `[BOT-BLOCKED]` logs for the site
2. **Gather Statistics**: Aggregate HTTP status codes and blocker types
3. **Log Warning**: Output detailed bot protection information
4. **Abort Audit**: Return early with `skipped: true` flag
5. **No Scrape Results Processed**: Audit step handler is never called

**Response Structure**:
```javascript
{
  status: 200,
  body: {
    skipped: true,
    reason: 'bot-protection-detected',
    botProtectedUrlsCount: 5,
    totalUrlsCount: 10,
    botProtectedUrls: [
      { url: '...', blockerType: 'cloudflare', httpStatus: 403, confidence: 0.99 },
      ...
    ],
    stats: {
      totalCount: 5,
      byHttpStatus: { 403: 5 },
      byBlockerType: { cloudflare: 5 }
    }
  }
}
```

### When No Bot Protection is Detected

1. **Query Returns Empty**: No `[BOT-BLOCKED]` logs found
2. **Continue Normally**: Audit proceeds as usual
3. **Process Scrape Results**: Step handler runs and processes scraped data
4. **Complete Audit**: Results saved and opportunities created

---

## Testing

### Test Coverage

- ✅ 100% line coverage
- ✅ 100% branch coverage
- ✅ 100% statement coverage

### Test Scenarios

1. **Bot Protection Detected**
   - Verifies audit aborts with correct response
   - Validates log message format with statistics
   - Ensures scrape client methods are called

2. **No Bot Protection**
   - Verifies audit continues normally
   - Validates scrape result processing

3. **Edge Cases**
   - Missing `httpStatus` field (defaults to 'unknown')
   - Missing `blockerType` field (defaults to 'unknown')
   - Malformed log messages (gracefully skipped)
   - Empty CloudWatch response (audit continues)

4. **CloudWatch Query Errors**
   - Logs error and throws exception
   - Ensures proper error handling

---

## Configuration

### Environment Variables

- **`CONTENT_SCRAPER_LOG_GROUP`**: CloudWatch log group name for Content Scraper
  - Default: `/aws/lambda/spacecat-services--content-scraper`
- **`AWS_REGION`**: AWS region for CloudWatch client
  - Required for CloudWatch queries

### Constants

- **`BUFFER_MS`**: 5 minutes (300,000 ms)
  - Applied once in `cloudwatch-utils.js`
  - Handles clock skew and log ingestion delays
- **`Query Limit`**: 500 events
  - Maximum bot protection events to retrieve per query

---

## Benefits

### 1. Universal Protection
- ✅ All audits automatically get bot protection detection
- ✅ No audit-specific code changes needed
- ✅ Future audits inherit this functionality

### 2. Accurate Detection
- ✅ Uses structured CloudWatch logs from Content Scraper
- ✅ No false positives from stale data
- ✅ Time-bound queries prevent picking up old logs

### 3. Detailed Reporting
- ✅ HTTP status code distribution
- ✅ Blocker type distribution (Cloudflare, Akamai, etc.)
- ✅ List of affected URLs
- ✅ Easy to debug and investigate issues

### 4. Clean Architecture
- ✅ No coupling between services via message flags
- ✅ No DynamoDB schema changes needed
- ✅ CloudWatch as single source of truth
- ✅ Separation of concerns

---

## Future Enhancements

### Potential Improvements

1. **Retry Logic**: Automatically retry failed audits after allowlisting
2. **Metrics**: CloudWatch metrics for bot protection detection rates
3. **Alerting**: Proactive notifications to customers
4. **Analytics**: Dashboard showing bot protection trends by site
5. **Auto-allowlist**: Automatic allowlist requests for trusted sites

---

## Related Documentation

- **Content Scraper Bot Protection**: `spacecat-content-scraper/BOT-PROTECTION-IMPLEMENTATION.md`
- **Task Processor Bot Protection**: `spacecat-task-processor/BOT-PROTECTION-IMPLEMENTATION.md`
- **API Service Bot Protection**: `spacecat-api-service/docs/bot-protection.md`
- **Shared Library**: `@adobe/spacecat-shared-utils` - `detectBotBlocker()` function

---

## Summary

The Audit Worker bot protection implementation provides:
- ✅ **Universal coverage** for all audits using scraping
- ✅ **Accurate detection** using CloudWatch logs
- ✅ **Detailed logging** for debugging and investigation
- ✅ **Clean architecture** with no service coupling
- ✅ **100% test coverage** ensuring reliability

This implementation ensures that audits are not wasted on bot-protected sites, saving resources and providing clear feedback about why audits cannot proceed.
