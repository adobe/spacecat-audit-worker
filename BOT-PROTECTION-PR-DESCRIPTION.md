# Bot Protection Detection and Audit Abortion - Audit Worker

## 🎯 Summary

This PR implements bot protection detection in the Audit Worker by querying CloudWatch logs from the Content Scraper. When bot protection is detected, audits are automatically aborted to avoid wasting resources on blocked sites.

**Key Feature**: Bot protection checking is implemented in the `StepAudit` base class, which means **all audits** (meta-tags, cwv, broken-backlinks, accessibility, etc.) automatically get this functionality without any audit-specific code changes.

---

## 🚀 What's Changed

### Core Implementation

1. **Universal Bot Protection Check** (`src/common/step-audit.js`)
   - Added `checkBotProtection()` async function (lines 28-115)
   - Queries CloudWatch logs for `[BOT-BLOCKED]` events
   - Aggregates statistics by HTTP status code and blocker type
   - Returns early to abort audit when bot protection is detected
   - Integrated into `run()` method (lines 231-244) to check before processing scrape results

2. **CloudWatch Query Utility** (`src/utils/cloudwatch-utils.js`)
   - New utility file for CloudWatch Logs interactions
   - `queryBotProtectionLogs(siteId, context, searchStartTime)` function
   - Filters by `siteId` and `[BOT-BLOCKED]` prefix
   - Applies 5-minute buffer to handle clock skew and log ingestion delays
   - Queries up to 500 events (increased from 100)
   - Parses JSON log messages and extracts bot protection metadata

3. **Comprehensive Testing**
   - `test/common/step-audit.test.js`: Bot protection scenarios, edge cases
   - `test/utils/cloudwatch-utils.test.js`: CloudWatch query tests
   - ✅ 100% code coverage maintained

---

## 🔍 How It Works

### Audit Flow with Bot Protection

```
1. Audit Step 1 completes → Audit created (auditedAt = T0)
2. Audit Step 2 creates scrape job
3. Content Scraper runs and logs bot protection to CloudWatch
4. Audit Step 3 starts:
   a. Load scrape result paths
   b. ✅ Check CloudWatch for bot protection logs (T0 - 5min to now)
   c. If detected → ❌ Abort audit with detailed statistics
   d. If not detected → ✅ Continue audit normally
```

### CloudWatch Query Strategy

- **Filter**: `"[BOT-BLOCKED]" "${siteId}"`
- **Time Window**: `audit.getAuditedAt() - 5 minutes` to `now`
- **Why 5 minutes?**: Handles clock skew and CloudWatch log ingestion delays
- **Why audit timestamp?**: Set before scraping starts, captures all relevant logs

### Log Message Format

When bot protection is detected:
```
[BOT-BLOCKED] Audit aborted for type meta-tags for site https://example.com (site-123) 
with bot protection details: HTTP Status Counts: [403: 5, 200: 2], 
Blocker Types: [cloudflare: 5, akamai: 2], 
Bot Protected URLs: [https://example.com/page1, https://example.com/page2, ...]
```

---

## ✅ Benefits

### 1. Universal Coverage
- ✅ All audits that use scraping automatically get bot protection detection
- ✅ No changes needed in individual audit implementations
- ✅ Future audits inherit this functionality automatically

### 2. Resource Efficiency
- ✅ Audits abort immediately when bot protection is detected
- ✅ No wasted processing on blocked sites
- ✅ Clear feedback about why audit cannot proceed

### 3. Detailed Diagnostics
- ✅ HTTP status code distribution (403, 200, etc.)
- ✅ Blocker type distribution (Cloudflare, Akamai, etc.)
- ✅ List of affected URLs
- ✅ Easy debugging and investigation

### 4. Clean Architecture
- ✅ No coupling between services via SQS message flags
- ✅ No DynamoDB schema changes needed
- ✅ CloudWatch logs as single source of truth
- ✅ No `scrape.json` files created for bot-protected URLs

---

## 📋 Affected Audits

The following audits automatically benefit from bot protection detection:

- ✅ `meta-tags`
- ✅ `cwv` (Core Web Vitals)
- ✅ `broken-backlinks`
- ✅ `accessibility`
- ✅ `prerender`
- ✅ `readability`
- ✅ `structured-data`
- ✅ `page-citability`
- ✅ All future audits that use scraping

**No audit-specific code changes required!**

---

## 🧪 Testing

### Test Coverage
- ✅ 100% line coverage
- ✅ 100% branch coverage
- ✅ 100% statement coverage

### Test Scenarios
- ✅ Bot protection detected → audit aborts
- ✅ No bot protection → audit continues
- ✅ Missing httpStatus field → defaults to 'unknown'
- ✅ Missing blockerType field → defaults to 'unknown'
- ✅ Malformed log messages → gracefully skipped
- ✅ CloudWatch query errors → proper error handling
- ✅ Empty results → audit continues

---

## 📦 Dependencies

### Added
- `@aws-sdk/client-cloudwatch-logs`: AWS SDK for CloudWatch Logs queries

### Environment Variables
- `CONTENT_SCRAPER_LOG_GROUP`: CloudWatch log group name (default: `/aws/lambda/spacecat-services--content-scraper`)
- `AWS_REGION`: AWS region for CloudWatch client

---

## 🔗 Related Changes

This PR is part of a coordinated effort across multiple services:

1. **Content Scraper**: Detects bot protection, logs to CloudWatch, does not create `scrape.json`
2. **Audit Worker** (this PR): Reads CloudWatch logs, aborts audits
3. **Task Processor**: Reads CloudWatch logs, sends Slack alerts, aborts processing
4. **API Service**: Uses shared library for bot detection during onboarding

---

## 📖 Documentation

- **Implementation Details**: See `BOT-PROTECTION-IMPLEMENTATION.md`
- **Flow Diagrams**: Included in documentation
- **Configuration Guide**: Environment variables and constants

---

## 🎬 Example Scenarios

### Scenario 1: Bot Protection Detected

**Input**: Meta-tags audit for `example.com`, Content Scraper detected Cloudflare blocking 5/10 URLs

**Output**:
```json
{
  "status": 200,
  "body": {
    "skipped": true,
    "reason": "bot-protection-detected",
    "botProtectedUrlsCount": 5,
    "totalUrlsCount": 10,
    "stats": {
      "totalCount": 5,
      "byHttpStatus": { "403": 5 },
      "byBlockerType": { "cloudflare": 5 }
    }
  }
}
```

**Log**:
```
[BOT-BLOCKED] Audit aborted for type meta-tags for site https://example.com (site-123) 
with bot protection details: HTTP Status Counts: [403: 5], 
Blocker Types: [cloudflare: 5], 
Bot Protected URLs: [https://example.com/page1, ...]
```

### Scenario 2: No Bot Protection

**Input**: CWV audit for `safe-site.com`, no bot protection logs found

**Output**: Audit completes normally, opportunities created

**Log**: `No bot protection logs found for site safe-site.com`

---

## 🚦 Deployment Notes

### Prerequisites
- ✅ Content Scraper must be deployed with bot protection logging
- ✅ CloudWatch log group must be accessible
- ✅ AWS credentials must have `logs:FilterLogEvents` permission

### Rollout
- ✅ Backward compatible (no breaking changes)
- ✅ Works independently if Content Scraper hasn't been updated (no logs = no detection)
- ✅ No infrastructure changes required

### Monitoring
- Check CloudWatch logs for `[BOT-BLOCKED]` entries
- Monitor audit completion rates (should increase as bot-protected audits abort faster)
- Verify Slack alerts are sent by Task Processor

---

## 🔍 Code Review Focus Areas

1. **Time Window Logic**: Verify `audit.getAuditedAt()` is always before scraping starts
2. **CloudWatch Query**: Ensure filter pattern matches Content Scraper log format
3. **Error Handling**: Verify CloudWatch errors are caught and logged
4. **Test Coverage**: Confirm all branches and edge cases are tested
5. **Performance**: Verify CloudWatch queries are efficient (5-minute window, indexed by time)

---

## 📝 Checklist

- [x] Bot protection detection implemented in `StepAudit` base class
- [x] CloudWatch query utility created and tested
- [x] All tests passing with 100% coverage
- [x] Linter errors fixed
- [x] Documentation created (`BOT-PROTECTION-IMPLEMENTATION.md`)
- [x] No breaking changes
- [x] Backward compatible with existing audits
- [x] Works for all audit types automatically

---

## 🎯 Success Metrics

After deployment, we expect:
- ✅ Reduced wasted audit processing on bot-protected sites
- ✅ Faster feedback to users about bot protection issues
- ✅ Detailed bot protection statistics for debugging
- ✅ Clearer logs for investigating customer issues
- ✅ Consistent bot protection handling across all audits

---

## 📚 Additional Resources

- [Bot Protection Flow Diagram](./docs/bot-protection-flow.md)
- [CloudWatch Logs Documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/)
- [SpaceCat Shared Utils - detectBotBlocker](https://github.com/adobe/spacecat-shared/tree/main/packages/spacecat-shared-utils#detectbotblocker)
