# CWV Trends Audit endDate Fix — spacecat-audit-worker

**Status:** Completed
**Branch:** `cwv-trends-audit-enddate-slack-fix`
**Commit:** `e7accf85`

---

## What Was Changed

### `src/cwv-trends-audit/utils.js`

**Line 260** — `cwvTrendsRunner` now reads `endDate` from both `auditContext.endDate` and `auditContext.messageData?.endDate`:

```js
// Before
const endDate = parseEndDate(auditContext.endDate, log);

// After
const endDate = parseEndDate(auditContext.endDate ?? auditContext.messageData?.endDate, log);
```

### `test/audits/cwv-trends-audit/utils.test.js`

Added one new test case:

- `uses endDate from auditContext.messageData when auditContext.endDate is absent`

---

## Why

When the `cwv-trends-audit` is triggered via the SpaceCat Slack bot (`run-audit {site} audit:cwv-trends-audit endDate:2026-04-05`), the keyword args are serialized into `message.data` by the API service. The `RunnerAudit` framework then places the parsed data at `auditContext.messageData`, not at the top level of `auditContext`. The runner was only checking `auditContext.endDate`, so `endDate` was silently ignored and today's date was always used.

The fix adds a fallback: `auditContext.endDate ?? auditContext.messageData?.endDate`. This covers both the Slack bot path (via `messageData`) and the direct SQS/HTTP trigger path (via top-level `auditContext.endDate`), with existing behavior preserved when `endDate` is absent.

---

## Testing

```bash
npm run test:spec -- test/audits/cwv-trends-audit/utils.test.js
# 26 passing
```

---

## Related

- Paired with `spacecat-api-service` change that registers `cwv-trends-audit` in `GET /trigger` with `endDate` query param support
- [Workspace spec](../../../../../docs/specs/cwv-trends-audit-enddate-slack-fix/spec.md)
