# CWV Trends Audit endDate Fix — spacecat-audit-worker

**Created:** 2026-04-06
**Status:** Completed

---

## Feature Overview

The `cwv-trends-audit` runner supports a custom `endDate` to process historical CWV data up to a specific date. However, when the audit is triggered via the SpaceCat Slack bot (`run-audit {site} audit:cwv-trends-audit endDate:2026-04-05`), the `endDate` value arrives in `auditContext.messageData.endDate` (placed there by the `RunnerAudit` framework), but the runner only reads `auditContext.endDate` — one level too shallow. The result is that `endDate` is silently ignored and today's date is always used.

This is a self-contained fix in the audit worker. No changes to `spacecat-api-service` are required — the Slack bot already serializes keyword args into `message.data`, which the `RunnerAudit` framework correctly surfaces as `auditContext.messageData`. The runner just needed to look there.

### Why

Operators need to re-run the audit against historical data windows (e.g. to backfill reports or debug regressions). The Slack bot command `run-audit {site} audit:cwv-trends-audit endDate:2026-04-05` already forwards the value correctly through the pipeline — the only missing piece was the runner reading it.

### Success Criteria

- [x] `run-audit {site} audit:cwv-trends-audit endDate:2026-04-05` produces an audit result with end date `2026-04-05`
- [x] Direct `auditContext.endDate` (SQS path) continues to work as before
- [x] Omitting `endDate` still defaults to today
- [x] 100% unit test coverage maintained

---

## What This Repo Does

Update a single line in `cwvTrendsRunner` (`src/cwv-trends-audit/utils.js`) to check both `auditContext.endDate` and `auditContext.messageData?.endDate`, preferring the direct field and falling back to the nested one.

---

## Requirements

1. **Read endDate from messageData as fallback**
   - When `auditContext.endDate` is `undefined`, the runner must check `auditContext.messageData?.endDate`
   - Acceptance criteria: audit uses the provided date, not today, when passed via Slack keyword args

2. **Preserve existing behavior**
   - Direct `auditContext.endDate` takes precedence over `messageData.endDate`
   - Absent `endDate` in both locations defaults to today via `parseEndDate`

---

## Data Flow

```
Slack: run-audit {site} audit:cwv-trends-audit endDate:2026-04-05
  → api-service: serialized as message.data = '{"endDate":"2026-04-05"}'
    → SQS audit-jobs queue
      → RunnerAudit.buildRunnerAuditContext():
          auditContext = { slackContext: {...}, messageData: { endDate: "2026-04-05" } }
        → cwvTrendsRunner(finalUrl, context, site, auditContext)
            endDate = parseEndDate(auditContext.endDate ?? auditContext.messageData?.endDate)
                                   ↑ undefined         ↑ "2026-04-05"  ✓
```

---

## Implementation

### Change: `src/cwv-trends-audit/utils.js`

```js
// Before
const endDate = parseEndDate(auditContext.endDate, log);

// After
const endDate = parseEndDate(auditContext.endDate ?? auditContext.messageData?.endDate, log);
```

### Tests added: `test/audits/cwv-trends-audit/utils.test.js`

1. `auditContext = { messageData: { endDate: '2026-04-05' } }` → runner uses `2026-04-05`
2. `auditContext = { endDate: '2026-04-05' }` → runner uses `2026-04-05` (regression)
3. `auditContext = {}` → runner uses today (regression)

---

## Code Patterns

The fix follows the same optional-chaining fallback pattern already used elsewhere in the codebase for `auditContext` fields. No new utilities or helpers are needed — `parseEndDate` already handles `undefined` gracefully by returning today's date.

---

## Testing

- Run full test suite: `npm test`
- Run specific test: `npm run test:spec -- test/audits/cwv-trends-audit/utils.test.js`
- Result: 26 passing

---

## Dependencies on Other Repos

**None.** This fix is entirely self-contained within `spacecat-audit-worker`.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `messageData` structure changes in RunnerAudit framework | Low | Optional chaining `?.endDate` is safe if `messageData` is absent or restructured |
| Invalid date string in `messageData.endDate` | Low | `parseEndDate` already validates and falls back to today for any invalid input |
