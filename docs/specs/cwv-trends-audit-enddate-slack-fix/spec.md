# CWV Trends Audit endDate Fix — spacecat-audit-worker

**Created:** 2026-04-06
**Status:** Completed

---

## Feature Overview

The `cwv-trends-audit` runner supports a custom `endDate` to process historical CWV data up to a specific date. However, when the audit is triggered via the SpaceCat Slack bot (`run-audit {site} audit:cwv-trends-audit endDate:2026-04-05`), the `endDate` value arrives in `auditContext.messageData.endDate` (placed there by the `RunnerAudit` framework), but the runner only reads `auditContext.endDate` — one level too shallow. The result is that `endDate` is silently ignored and today's date is always used.

### Why

Operators need to re-run the audit against historical data windows (e.g. to backfill reports or debug regressions). Without this fix there is no supported way to do this via the Slack bot or HTTP trigger.

### Success Criteria

- [ ] `run-audit {site} audit:cwv-trends-audit endDate:2026-04-05` produces an audit result with end date `2026-04-05`
- [ ] Direct `auditContext.endDate` (SQS path) continues to work as before
- [ ] Omitting `endDate` still defaults to today
- [ ] 100% unit test coverage maintained

---

## What This Repo Does

Update a single line in `cwvTrendsRunner` (`src/cwv-trends-audit/utils.js`) to check both `auditContext.endDate` and `auditContext.messageData?.endDate`, preferring the direct field and falling back to the nested one.

---

## Requirements

1. **Read endDate from messageData as fallback**
   - When `auditContext.endDate` is `undefined`, the runner must check `auditContext.messageData?.endDate`
   - Acceptance criteria: audit uses the provided date, not today, when passed via Slack keyword args

2. **Preserve existing behavior**
   - Direct `auditContext.endDate` (set by direct SQS or HTTP trigger) takes precedence over `messageData.endDate`
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

## Implementation Tasks

### Task 1.1: Fallback endDate read from messageData

- **Description:** Update the `parseEndDate` call in `cwvTrendsRunner` to use `auditContext.endDate ?? auditContext.messageData?.endDate`
- **Files:** `src/cwv-trends-audit/utils.js` — line 260
- **Dependencies:** None
- **Testing:** Task 1.2

**Change:**
```js
// Before
const endDate = parseEndDate(auditContext.endDate, log);

// After
const endDate = parseEndDate(auditContext.endDate ?? auditContext.messageData?.endDate, log);
```

### Task 1.2: Unit tests

- **Description:** Add three test cases to the `cwvTrendsRunner` test suite
- **Files:** `test/audits/cwv-trends-audit/utils.test.js` (or equivalent)
- **Dependencies:** Task 1.1
- **Testing:** `npm run test:spec -- test/audits/cwv-trends-audit/utils.test.js`

Test scenarios:
1. `auditContext = { messageData: { endDate: '2026-04-05' } }` → runner uses `2026-04-05`
2. `auditContext = { endDate: '2026-04-05' }` → runner uses `2026-04-05` (regression)
3. `auditContext = {}` → runner uses today (regression)

---

## Code Patterns

The fix follows the same optional-chaining fallback pattern already used elsewhere in the codebase for `auditContext` fields. No new utilities or helpers are needed — `parseEndDate` already handles `undefined` gracefully by returning today's date.

---

## Testing Requirements

- Maintain 100% line/branch/statement coverage (enforced by CI)
- Run full test suite: `npm test`
- Run specific test: `npm run test:spec -- test/audits/cwv-trends-audit/utils.test.js`

---

## Dependencies on Other Repos

- **None required before this change** — this fix is self-contained and safe to deploy independently
- `spacecat-api-service` will separately add an HTTP trigger path for `cwv-trends-audit`; that change is independent

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `messageData` structure changes in RunnerAudit framework | Low | Optional chaining `?.endDate` means the read is safe if `messageData` is absent or restructured |
| Invalid date string in `messageData.endDate` | Low | `parseEndDate` already validates and falls back to today for any invalid input |
