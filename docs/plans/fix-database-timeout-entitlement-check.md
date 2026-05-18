# Fix Database Timeout Issue in Entitlement Checking

## Context

Preflight job `d272041d-f014-4792-a1a1-944e5c0c57ab` was incorrectly **cancelled** on March 31, 2026 due to a database connection pool timeout (`PGRST003`). The entitlement check in `checkProductCodeEntitlements()` caught the transient infrastructure error and returned `false`, causing the system to treat it as "site not entitled" and set the job status to `CANCELLED`.

The problem: **All errors are treated equally** - transient infrastructure failures (database timeouts, network issues) are handled the same as legitimate "site not entitled" scenarios. This causes jobs to be cancelled instead of allowing Lambda/SQS to retry.

### Error Flow from Logs
1. Database: `PGRST003: Timed out acquiring connection from connection pool`
2. TierClient throws error → caught at `/src/common/audit-utils.js:38-40`
3. Returns `false` → `isAuditEnabledForSite()` returns `false`
4. AsyncJobRunner sets `AsyncJob.Status.CANCELLED` (line 91)
5. Job skipped with reason: "preflight audits disabled for site"

### Expected Behavior
- **Transient errors** (database timeouts, network failures) → Throw error, let Lambda retry
- **Permanent errors** (not entitled, not found) → Return `false`, cancel job gracefully

## Solution Approach

**Strategy**: Distinguish transient from permanent errors and **rethrow transient errors** to trigger Lambda/SQS retry mechanism (no local retry logic).

**Why no local retry?** 
- Lambda/SQS provides automatic retries with backoff and DLQ
- Local retry adds complexity and consumes Lambda timeout budget
- Matches existing pattern in codebase (internal-links lets "SQS retry complete finalization")

## Implementation Plan

### 1. Create Error Classifier Utility

**New file**: `/src/common/tier-client-error-classifier.js`

Create `isTransientTierClientError(error)` function to classify errors:

**Transient patterns** (should retry):
- Database: `PGRST000`, `PGRST001`, `PGRST002`, `PGRST003`, `connection pool`, `timeout`, `ECONNREFUSED`, `ETIMEDOUT`
  - PGRST000: Could not connect with database (503)
  - PGRST001: Could not connect due to internal error (503)
  - PGRST002: Could not connect when building schema cache (503)
  - PGRST003: Timed out acquiring connection from connection pool (504)
- Network: `ENOTFOUND`, `ECONNRESET`, `EAI_AGAIN`, `socket hang up`, `network error`
- HTTP: 408, 429, 500, 502, 503, 504 (if exposed)
- Generic: `temporary failure`, `service unavailable`

**Permanent patterns** (skip audit):
- HTTP: 401, 403, 404
- PostgREST: `PGRST100-122` (bad request), `PGRST200-204` (not found), `PGRST300` (config error)
- Business: `not enrolled`, `no entitlement`, `invalid product code`

Implementation:
```javascript
export function isTransientTierClientError(error) {
  const message = error?.message?.toLowerCase() || '';
  const code = error?.code?.toUpperCase() || '';
  const statusCode = error?.statusCode || error?.status;
  
  // Database errors - PostgREST connection and timeout issues
  const transientPostgrestCodes = ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'];
  if (transientPostgrestCodes.includes(code)) return true;
  
  if (message.includes('connection pool') || message.includes('timed out')) return true;
  
  // Network errors
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(code)) return true;
  if (message.includes('network error') || message.includes('socket hang up')) return true;
  
  // HTTP errors
  if ([408, 429, 500, 502, 503, 504].includes(statusCode)) return true;
  
  // Default to permanent (conservative)
  return false;
}
```

### 2. Update `checkProductCodeEntitlements()`

**File**: `/src/common/audit-utils.js` (lines 25-48)

**Changes**:
1. Import classifier: `import { isTransientTierClientError } from './tier-client-error-classifier.js';`
2. Update inner catch block (line 37-40):
   ```javascript
   } catch (error) {
     if (isTransientTierClientError(error)) {
       context.log.error(`Transient error checking entitlement for product ${productCode}, will retry:`, error);
       throw new Error(`Transient entitlement check error for ${productCode}: ${error.message}`, { cause: error });
     }
     context.log.warn(`Site not entitled for product code ${productCode}:`, error);
     return false;
   }
   ```
3. Update outer catch block (line 44-47):
   ```javascript
   } catch (error) {
     // If we reach here, a transient error was thrown from inner loop
     context.log.error('Transient error in entitlement check, job will retry:', error);
     throw error; // Propagate to trigger Lambda retry
   }
   ```

### 3. Update `checkSiteRequiresValidation()`

**File**: `/src/utils/site-validation.js` (lines 54-65)

Add error classification:
```javascript
} catch (e) {
  if (isTransientTierClientError(e)) {
    context?.log?.error?.(`Transient error checking validation requirement for site ${site.getId?.()}: ${e.message}`);
    throw new Error(`Transient entitlement check error: ${e.message}`, { cause: e });
  }
  context?.log?.warn?.(`Entitlement check failed for site ${site.getId?.()}: ${e.message}`);
}
```

### 4. Update `isPaidLLMOCustomer()`

**File**: `/src/prerender/utils/utils.js` (lines 116-119)

Add error classification:
```javascript
} catch (e) {
  if (isTransientTierClientError(e)) {
    log.error(`Transient error checking paid LLMO status for siteId=${site.getId()}: ${e.message}`);
    throw new Error(`Transient entitlement check error: ${e.message}`, { cause: e });
  }
  log.warn(`Prerender - Failed to check paid LLMO customer status for siteId=${site.getId()}: ${e.message}`);
  return false;
}
```

### 5. Add Clarifying Comment to AsyncJobRunner

**File**: `/src/common/async-job-runner.js` (line 89-99)

Add comment:
```javascript
// Note: CANCELLED status is for sites explicitly not entitled or with audits disabled.
// Transient errors (database timeouts, network issues) will throw and trigger Lambda retry.
if (!(await isAuditEnabledForSite(type, site, context))) {
```

## Testing Plan

### New Test File: `test/common/tier-client-error-classifier.test.js`

Test cases:
- ✅ PGRST000, PGRST001, PGRST002, PGRST003 → returns true (transient)
- ✅ Connection pool timeout → returns true
- ✅ Network errors (ECONNREFUSED, ETIMEDOUT) → returns true
- ✅ HTTP 429, 500, 502, 503, 504 → returns true
- ✅ HTTP 401, 403, 404 → returns false (permanent)
- ✅ PostgREST permanent errors (PGRST100, PGRST202, PGRST300) → returns false
- ✅ Generic errors → returns false (conservative default)
- ✅ Null/undefined error → returns false

### Update `test/common/audit-utils.test.js`

Add test cases after line 295:
- ✅ PGRST003 error throws (doesn't return false)
- ✅ Connection timeout throws
- ✅ Network error throws
- ✅ 404 error returns false (existing behavior preserved)
- ✅ Mixed: one transient, one permanent → throws immediately
- ✅ Mixed: one transient, one succeeds → throws immediately

### Update `test/utils/site-validation.test.js`

Add transient error test cases for `checkSiteRequiresValidation()`

### Update `test/audits/prerender/utils.test.js`

Add transient error test cases for `isPaidLLMOCustomer()`

## Verification

### Unit Tests
```bash
npm test -- test/common/tier-client-error-classifier.test.js
npm test -- test/common/audit-utils.test.js
npm test -- test/utils/site-validation.test.js
npm test -- test/audits/prerender/utils.test.js
```

### Integration Test
Mock PGRST003 error and verify:
1. Job throws error (doesn't return false)
2. Job status is NOT set to CANCELLED
3. Lambda retry mechanism triggered
4. Logs contain "Transient error" messages

### Observability
Query Coralogix for:
```dataprime
source logs 
| filter $l.subsystemname == 'spacecat-services-prod' 
  && $d.message ~ 'Transient error'
| orderby $m.timestamp desc
```

## Critical Files

**Source**:
- `src/common/tier-client-error-classifier.js` (NEW)
- `src/common/audit-utils.js` (MODIFY lines 25-48)
- `src/utils/site-validation.js` (MODIFY lines 54-65)
- `src/prerender/utils/utils.js` (MODIFY lines 116-119)
- `src/common/async-job-runner.js` (ADD COMMENT line 89)

**Tests**:
- `test/common/tier-client-error-classifier.test.js` (NEW)
- `test/common/audit-utils.test.js` (ADD TESTS after line 295)
- `test/utils/site-validation.test.js` (ADD TESTS)
- `test/audits/prerender/utils.test.js` (ADD TESTS)

## Backwards Compatibility

✅ **Preserved**: Sites without entitlements still return `false`, job `CANCELLED`
✅ **Preserved**: Permanent errors (404, not found) still return `false`
⚠️ **Changed**: Transient errors now throw instead of returning `false`

**Impact**: Jobs previously cancelled due to database timeouts will now retry via Lambda/SQS until successful or DLQ.

## Scope Analysis: Why This Fix Is Sufficient

### Investigation: Other Database Operations

A comprehensive search was conducted to identify if similar issues exist elsewhere in the codebase.

**Finding**: **TierClient entitlement checks were the only vulnerable area.**

### Why Other Database Operations Are Safe:

1. **Configuration.findLatest() calls** (~40+ locations)
   - These properly **throw errors** on failure, not return false
   - Throwing causes Lambda to fail/retry (correct behavior)
   - Example: Multiple handlers use this pattern without fail-safe catching

2. **Data access utilities** (`src/utils/data-access.js`)
   - Functions like `retrieveSiteBySiteId()` and `retrieveAuditById()` throw on error:
     ```javascript
     } catch (e) {
       throw new Error(`Error getting site ${siteId}: ${e.message}`);
     }
     ```
   - Errors propagate to Lambda for retry

3. **Most audit handlers**
   - Database errors naturally bubble up and cause Lambda failure/retry
   - No fail-safe pattern that misinterprets transient errors

### Why TierClient Was Unique:

The issue was specific to **pre-audit entitlement gating**:
- Runs in `AsyncJobRunner` **before** audit execution
- Occurs in: `isAuditEnabledForSite()` → `checkProductCodeEntitlements()` → TierClient
- Returning `false` triggers `AsyncJob.Status.CANCELLED` (line 91)
- **Transient infrastructure errors were misinterpreted as "site not entitled"**

### Conclusion:

This fix addresses **all vulnerable locations**:
- ✅ `checkProductCodeEntitlements()` - Main entitlement gate
- ✅ `checkSiteRequiresValidation()` - Validation requirement check
- ✅ `isPaidLLMOCustomer()` - LLMO tier check

**Future Watch**: Any new entitlement checks should use `isTransientTierClientError()` to avoid this pattern.

## Rollout

1. Deploy to dev, verify unit tests pass
2. Monitor CloudWatch for "Transient error" logs
3. Verify no false positives (legitimate "not entitled" being retried)
4. Deploy to stage, monitor 24-48 hours
5. Deploy to prod with CloudWatch alarm for DLQ depth
