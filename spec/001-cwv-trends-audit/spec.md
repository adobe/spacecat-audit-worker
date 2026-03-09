# CWV Trends Audit - spacecat-audit-worker Implementation

**Feature ID:** 001-cwv-trends-audit
**Repository:** spacecat-audit-worker
**Branch:** 001-cwv-trends-audit
**Created:** 2026-03-09

---

## Feature Overview

### What
A weekly audit job that reads pre-imported Core Web Vitals (CWV) and engagement data from S3, calculates performance distribution percentages (Good/Needs Improvement/Poor) over 28 days, generates Web Performance Trends Reports, and creates device-specific opportunities in SpaceCat. The audit runs **twice per site** - once for mobile and once for desktop - creating separate opportunities for each device type.

### Why
Provides site owners with automated weekly performance trend analysis without requiring manual data collection or calculation. Enables proactive performance monitoring by tracking CWV metrics (LCP, CLS, INP) and engagement metrics (bounce rate, click rate) over 28-day periods, surfacing degradations or improvements as actionable device-specific opportunities.

### Success Criteria
- [ ] Audit runs successfully every Sunday on schedule for both mobile and desktop
- [ ] Reads and processes 28 days of CWV data from S3 for each configured site
- [ ] Generates accurate trend data with Good/NI/Poor percentages based on Web Vitals thresholds
- [ ] Creates device-specific opportunities (Mobile/Desktop Web Performance Trends Report)
- [ ] Audit results are persisted to DynamoDB with proper fullAuditRef
- [ ] URL filtering works correctly (minimum 1000 pageviews, device-specific metrics)
- [ ] Fails gracefully if any S3 data is missing (logs error with specific dates)
- [ ] Updates existing opportunities or creates new ones per device type

---

## Changes Required in This Repository

### Summary
New audit handler implementation using StepAudit pattern. This repository contains the core audit logic for reading S3 data, calculating CWV trends, and creating device-specific opportunities with suggestions.

### Specific Changes

**What changes:**
- Implement cwv-trends-audit handler using StepAudit pattern (not RunnerAudit - needs two steps like CWV audit)
- Step 1: S3 data reading logic for 28-day CWV data and trend calculation
- Step 2: Opportunity and suggestion sync using `convertToOpportunity` + `syncSuggestions`
- CWV categorization logic (Good/NI/Poor calculation)
- URL filtering by device type and pageviews
- Opportunity data mapper for device-specific opportunities with comparison function
- Device-specific opportunity matching (compare by type AND device)

**Key files to modify:**
- `src/cwv-trends-audit/handler.js` (new)
- `src/cwv-trends-audit/opportunity-data-mapper.js` (new)
- `src/cwv-trends-audit/opportunity-sync.js` (new)
- `src/cwv-trends-audit/constants.js` (new)
- `src/index.js` (add handler to HANDLERS map)
- `src/support/` (may need S3 utility helpers if not already available)

**Dependencies:**
- Updated `@adobe/spacecat-shared-data-access` with new audit type
- AWS SDK for S3 access (already available)
- `convertToOpportunity` and `syncSuggestions` from existing audit patterns

**Testing requirements:**
- Unit tests for CWV categorization logic
- Unit tests for URL filtering and device type selection
- Unit tests for missing data detection
- Integration tests with mock S3 data
- End-to-end test with sample S3 files for both device types

---

## Implementation Tasks

### Phase 2: spacecat-audit-worker Tasks

#### Task 2.1: Update spacecat-shared Dependency
- **Description:** Bump dependencies to latest versions
- **Files to modify:**
  - `package.json`
- **Commands:**
  ```bash
  npm install @adobe/spacecat-shared-data-access@latest @adobe/spacecat-shared-utils@latest
  ```
- **Dependencies:** Task 1.3 from spacecat-shared (published version)
- **Estimated effort:** S
- **Testing:** `npm install` completes successfully
- **Status:** [ ] Not started

#### Task 2.2: Create Audit Handler Directory Structure
- **Description:** Create directory with standard structure
- **Files to create:**
  - `src/cwv-trends-audit/handler.js`
  - `src/cwv-trends-audit/opportunity-data-mapper.js`
  - `src/cwv-trends-audit/opportunity-sync.js`
  - `src/cwv-trends-audit/constants.js`
- **Dependencies:** Task 2.1
- **Estimated effort:** S
- **Testing:** Files exist in correct location
- **Status:** [ ] Not started

#### Task 2.3: Implement Constants File
- **Description:** Define audit-specific constants
- **Files to modify:**
  - `src/cwv-trends-audit/constants.js`
- **Dependencies:** Task 2.2
- **Estimated effort:** S
- **Testing:** Import constants in handler
- **Status:** [ ] Not started

#### Task 2.4: Implement S3 Data Reading Logic
- **Description:** Create function to read 28 days of S3 files; fail if any missing
- **Files to modify:**
  - `src/cwv-trends-audit/handler.js`
- **Dependencies:** Task 2.3
- **Estimated effort:** M
- **Testing:** Unit test with mock S3 client; test missing file scenario
- **Status:** [ ] Not started

#### Task 2.5: Implement URL Filtering and Device Type Selection
- **Description:** Filter URLs by device type and pageviews threshold
- **Files to modify:**
  - `src/cwv-trends-audit/handler.js`
- **Dependencies:** Task 2.4
- **Estimated effort:** M
- **Testing:** Unit tests with various device types and pageview thresholds
- **Status:** [ ] Not started

#### Task 2.6: Implement CWV Categorization Logic
- **Description:** Categorize URLs as Good/Needs Improvement/Poor
- **Files to modify:**
  - `src/cwv-trends-audit/handler.js`
- **Dependencies:** Task 2.5
- **Estimated effort:** M
- **Testing:** Unit tests covering all threshold boundaries and null handling
- **Status:** [ ] Not started

#### Task 2.7: Generate Trend Data and urlDetails
- **Description:** Build trendData array (28 entries) and flat urlDetails array
- **Files to modify:**
  - `src/cwv-trends-audit/handler.js`
- **Dependencies:** Task 2.6
- **Estimated effort:** M
- **Testing:** Unit test with sample daily data
- **Status:** [ ] Not started

#### Task 2.8: Implement Step 1 - Collect Trend Data
- **Description:** First step: read S3, calculate trends, persist audit result
- **Files to modify:**
  - `src/cwv-trends-audit/handler.js`
- **Dependencies:** Task 2.4, 2.5, 2.6, 2.7
- **Estimated effort:** L
- **Testing:** Integration test with mock S3 data
- **Status:** [ ] Not started

#### Task 2.9: Implement Opportunity Data Mapper
- **Description:** Map audit result to device-specific opportunity structure
- **Files to modify:**
  - `src/cwv-trends-audit/opportunity-data-mapper.js`
- **Dependencies:** Task 2.8
- **Estimated effort:** M
- **Testing:** Unit test with sample audit result
- **Status:** [ ] Not started

#### Task 2.10: Implement Step 2 - Sync Opportunities and Suggestions
- **Description:** Second step: create/update opportunity and sync suggestions
- **Files to modify:**
  - `src/cwv-trends-audit/opportunity-sync.js`
- **Dependencies:** Task 2.9
- **Estimated effort:** L
- **Testing:** Integration test with mock dataAccess
- **Status:** [ ] Not started

#### Task 2.11: Wire Up StepAudit Handler
- **Description:** Assemble both steps using AuditBuilder
- **Files to modify:**
  - `src/cwv-trends-audit/handler.js`
- **Dependencies:** Task 2.8, 2.10
- **Estimated effort:** M
- **Testing:** End-to-end test with full audit flow
- **Status:** [ ] Not started

#### Task 2.12: Register Handler in HANDLERS Map
- **Description:** Add audit handler to routing map
- **Files to modify:**
  - `src/index.js`
- **Dependencies:** Task 2.11
- **Estimated effort:** S
- **Testing:** Verify handler is invoked for cwv-trends-audit type
- **Status:** [ ] Not started

---

## Dependencies

### External Dependencies
- AWS SDK S3 client (already available in audit-worker)
- `@adobe/spacecat-shared-data-access` (needs new version with audit type)
- `@adobe/spacecat-shared-utils` (needs new version with constants)

### Internal Dependencies

**Depends on:**
- spacecat-shared - Task 1.3 (Publish New Version) must be completed first

---

## Code Patterns & Examples

### Pattern 1: StepAudit with Two Steps

**Where to apply:** Main handler assembly

**Example:**
```javascript
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export default new AuditBuilder()
  .addStep('collectTrendData', collectTrendData, AUDIT_STEP_DESTINATIONS.DEFAULT)
  .addStep('syncOpportunityAndSuggestions', syncOpportunityAndSuggestionsStep)
  .build();
```

**Notes:** First step persists audit result automatically; second step works with persisted audit

### Pattern 2: Device-Specific Opportunity Matching

**Where to apply:** opportunity-data-mapper.js

**Example:**
```javascript
export function compareOpportunityByDevice(existingOppty, newOpptyInstance) {
  const existingDevice = existingOppty.getData()?.deviceType;
  const newDevice = newOpptyInstance.data?.deviceType;
  return existingDevice === newDevice;
}
```

**Notes:** Ensures mobile and desktop opportunities are tracked separately

### Pattern 3: S3 File Reading with Error Collection

**Where to apply:** S3 reading logic

**Example:**
```javascript
const missingDates = [];
for (let date = startDate; date <= endDate; date.setDate(date.getDate() + 1)) {
  try {
    // Read S3 file
  } catch (error) {
    missingDates.push(dateStr);
  }
}

if (missingDates.length > 0) {
  throw new Error(`Missing data for: ${missingDates.join(', ')}`);
}
```

**Notes:** Collect all missing dates before failing; provides complete error context

---

## Testing Requirements

### Unit Tests
- CWV categorization (all thresholds, boundary cases)
- URL filtering (pageviews, device type)
- Device type selection from metrics array
- Percentage calculations
- Null/missing metric handling
- Missing file detection
- Opportunity data mapper
- Comparison function for device matching

### Integration Tests
- S3 data reading with 28 days of mock data
- S3 missing file scenario (audit fails)
- Step 1: Collect trend data flow
- Step 2: Sync opportunities and suggestions
- Both mobile and desktop device configurations
- Device-specific opportunity matching

### End-to-End Tests
- Run audit for mobile device type
- Run audit for desktop device type
- Verify DynamoDB audit result persistence (both devices)
- Verify opportunity creation with correct titles
- Verify suggestions created for URLs
- Test with 28 days of complete data
- Test with missing file (audit fails gracefully)

### Test Commands
```bash
# Run all tests
npm test

# Run specific test file
npm run test:spec -- test/cwv-trends-audit/handler.test.js

# Run tests with coverage
npm run test:coverage
```

---

## References

- [Full Feature Spec](../../specs/001-cwv-trends-audit/spec.md)
- [Implementation Guide](../../specs/001-cwv-trends-audit/implementation.md)
- [Quick Start](../../specs/001-cwv-trends-audit/quickstart.md)
- [Workspace Rules](../../CLAUDE.md)
- [Example S3 Payload](../../specs/001-cwv-trends-audit/cwv-trends-daily-2026-03-06.json)
- [CWV Audit Handler Reference](../cwv/handler.js)
- [Opportunity Sync Pattern Reference](../cwv/opportunity-sync.js)
- [Web Vitals Documentation](https://web.dev/articles/vitals)

---

## Implementation Notes

[Space for notes during implementation]

---

**Status:** Not Started
**Progress:** 0 / 12 tasks completed
**Last Updated:** 2026-03-09
