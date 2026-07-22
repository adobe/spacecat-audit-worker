# CWV Trends Audit endDate Fix

**Status:** Completed
**Branch:** `cwv-trends-audit-enddate-slack-fix`
**Commit:** `e7accf85`

---

## Problem

Running `@spacecat run-audit {site} audit:cwv-trends-audit endDate:2026-04-05` always used today's date instead of the provided `endDate`. The audit result window was never shifted to the requested date.

## Root Cause

The Slack bot serializes keyword args (e.g. `endDate:2026-04-05`) into `message.data`. The `RunnerAudit` framework parses `message.data` and places it at `auditContext.messageData.endDate`. The `cwvTrendsRunner` was only reading `auditContext.endDate` (top-level), so the value was silently ignored.

This fix is **self-contained in this repo** — the Slack bot and API service already forward the value correctly through the pipeline.

## Fix

**`src/cwv-trends-audit/utils.js`** — one line change:

```js
// Before
const endDate = parseEndDate(auditContext.endDate, log);

// After
const endDate = parseEndDate(auditContext.endDate ?? auditContext.messageData?.endDate, log);
```

## Tests

**`test/audits/cwv-trends-audit/utils.test.js`** — one new test added:

- `uses endDate from auditContext.messageData when auditContext.endDate is absent`

```bash
npm run test:spec -- test/audits/cwv-trends-audit/utils.test.js
# 26 passing
```

## Usage (after fix)

```
@spacecat run-audit www.example.com audit:cwv-trends-audit endDate:2026-04-05
```

The audit will now process the 28-day window ending on `2026-04-05` instead of today.
