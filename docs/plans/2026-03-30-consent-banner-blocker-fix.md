# Fix Paid-Cookie-Consent Audit Pipeline

**Goal:** Fix the paid-cookie-consent audit pipeline so that high-severity consent banner issues create opportunities with suggestions, and null/empty guidance no longer crashes the handler. All fixes are in the audit-worker only — no Mystique changes needed.

**Architecture:** Audit-worker-only fix. The pipeline was working until March 5, when PR #2077 added an `isNonEmptyArray(suggestions)` gate. Mystique has always sent `suggestions: []` for this task type (the audit-worker builds its own suggestions via `mapToPaidSuggestion` from the guidance body). The gate was incorrect and broke all opportunity creation. This fix removes the gate, fixes the null guidance crash, and tightens the severity filter.

**Tech Stack:** Node.js (audit-worker, Mocha/Chai/Sinon tests)

---

## Background & Root Cause Analysis

### Timeline

| Date | Event |
|------|-------|
| Through 2026-02-15 | Pipeline working — 150 consent-banner opportunities created with suggestions |
| 2026-03-05 | PR #2077 merged: added `isNonEmptyArray(suggestions)` gate to guidance-handler.js |
| 2026-03-05 → present | Zero opportunities created — Mystique sends `suggestions: []`, gate blocks all |
| 2026-03-30 | Investigation reveals two additional issues: null guidance crashes (178/day) and severity threshold mismatch |

### Three bugs fixed

1. **`isNonEmptyArray(suggestions)` gate (PR #2077):** The gate checked the `suggestions` field from Mystique's SQS payload, but Mystique has always sent `suggestions: []` for paid-cookie-consent. The audit-worker builds its own suggestion data from the guidance body via `mapToPaidSuggestion()` — it never needed this field. The gate silently blocked all 229 sites/day. **Fix: remove the gate.**

2. **`getGuidanceObj()` crash:** The function unconditionally spreads `guidance[0]` without checking for undefined/null/empty guidance, causing 178 TypeErrors/day. **Fix: return null for invalid guidance, handler skips gracefully.**

3. **Severity threshold mismatch:** The old `isLowSeverityGuidanceBody` skipped only "low" and "none", allowing medium severity through. Medium-severity guidance lacks the screenshot data needed for complete suggestions, causing downstream errors. **Fix: rename to `isHighSeverityGuidanceBody`, require explicit high severity with optional chaining for null safety.**

### Why audit-worker only (no Mystique changes)

- Mystique never populated the `suggestions` SQS field for paid-cookie-consent — the 150 working opportunities were all created before the suggestions gate existed
- The audit-worker builds its own suggestions from guidance body data (`mapToPaidSuggestion`)
- Removing the gate restores pre-March-5 behavior
- Mystique deploys are slow and complex; this fix avoids that dependency

## Accepted Risks & Notes

- **Missing `issueSeverity` field:** Sites whose Mystique response lacks `issueSeverity` will no longer create opportunities (previously they did). Accepted — these are edge cases from malformed crew output and should not produce opportunities.
- **No DLQ concern:** The current 178 crashes are caught by the outer try/catch in `src/index.js`. Messages are consumed on failure, not sent to DLQ. No replay needed after deployment.
- **100% test coverage required** for all `src/**/*.js` files in audit-worker.

---

## Changes

**Files:**
- `src/paid-cookie-consent/guidance-handler.js`
- `src/paid-cookie-consent/guidance-opportunity-mapper.js`
- `test/audits/paid-cookie-consent/guidance.test.js`

### 1. Remove suggestions gate (`guidance-handler.js`)

- Remove `isNonEmptyArray` import (no longer used)
- Remove `suggestions` from destructuring of `data`
- Remove the `if (!isNonEmptyArray(suggestions))` check block (lines 68-72)

### 2. Fix null guidance crash (`guidance-handler.js`)

Replace `getGuidanceObj`:
```javascript
function getGuidanceObj(guidance) {
  if (!guidance || !guidance[0]) {
    return null;
  }
  const { body } = guidance[0];
  return { ...guidance[0], body };
}
```

Add null check before severity check:
```javascript
const guidanceParsed = getGuidanceObj(guidance);
if (!guidanceParsed) {
  paidLog.skipping('no guidance from guidance engine', siteId, url, auditId);
  return ok();
}
```

### 3. Change severity gate (`guidance-opportunity-mapper.js`)

Rename `isLowSeverityGuidanceBody` → `isHighSeverityGuidanceBody`:
```javascript
export function isHighSeverityGuidanceBody(body) {
  if (body?.issueSeverity) {
    const sev = body.issueSeverity.toLowerCase();
    return sev.includes('high');
  }
  return false;
}
```

Update import and usage in `guidance-handler.js`:
```javascript
if (!isHighSeverityGuidanceBody(guidanceParsed.body)) {
  paidLog.skipping('severity not high enough', siteId, url, auditId);
  return ok();
}
```

### 4. Test changes (`guidance.test.js`)

- **Added:** 3 tests for undefined/null/empty guidance → skip gracefully
- **Added:** 1 test for body without `issueSeverity` field → skip (covers `return false` branch)
- **Updated:** Low/medium/none severity tests → expect "severity not high enough" log
- **Updated:** Medium severity test → now expects skip (was previously expecting opportunity creation)
- **Updated:** All 14+ tests expecting opportunity creation → added `issueSeverity: 'high'` to guidance body
- **Removed:** 3 suggestions-gate tests (gate removed)
- **Removed:** `suggestions` field from all test message objects

---

## Post-Deployment Observability Plan

After deploy, verify the fix using Coralogix queries against `spacecat-services-prod`:

### Immediate checks (within 1 hour)

| What to check | Dataprime query | Expected |
|---|---|---|
| **Crashes eliminated** | `source logs \| filter $l.subsystemname == 'spacecat-services-prod' \| filter $d.message ~ 'guidance:paid-cookie-consent' && $d.message ~ 'failed' \| count` | Drop from ~178/day to 0 |
| **Null guidance handled** | `source logs \| filter $l.subsystemname == 'spacecat-services-prod' \| filter $d.message ~ 'paid-audit' && $d.message ~ 'Skipping' && $d.message ~ 'no guidance from guidance engine' \| count` | New — should appear for previously-crashing sites |
| **Severity filter working** | `source logs \| filter $l.subsystemname == 'spacecat-services-prod' \| filter $d.message ~ 'paid-audit' && $d.message ~ 'Skipping' && $d.message ~ 'severity not high enough' \| count` | Should include low + medium severity sites |

### After next full audit cycle (~24h)

| What to check | Dataprime query / PostgREST | Expected |
|---|---|---|
| **Opportunities created** | `source logs \| filter $l.subsystemname == 'spacecat-services-prod' \| filter $d.message ~ 'paid-cookie-consent' && $d.message ~ 'created opportunity' \| count` | Should be > 0 (was 0 since March 5) |
| **Suggestions created** | `source logs \| filter $l.subsystemname == 'spacecat-services-prod' \| filter $d.message ~ 'paid-cookie-consent' && $d.message ~ 'created suggestion' \| count` | Should match opportunity count |
| **consent-banner opportunities in DB** | PostgREST: `/opportunities?type=eq.consent-banner&created_at=gte.<deploy-date>&select=id,site_id,status&limit=100` | Non-empty results |

### Baseline comparison

Before deploy:
- Errors: ~178/cycle
- Low severity skips: ~216/cycle
- No suggestions skips: ~229/cycle (from removed gate)
- Opportunities created: 0/cycle (since March 5)

After deploy:
- Errors: 0
- No guidance skips: appears for previously-crashing sites
- Severity skips: low + medium combined
- Opportunities created: > 0 (high severity sites)

---

## Verification — spacecat-audit-worker

- **Package manager**: npm
- **Test command**: `npm test`
- **Lint command**: `npm run lint`
- **Coverage thresholds**: 100% lines, branches, statements (all `src/**/*.js`)
- **Pre-commit hooks**: yes (husky)
- **Test cases for new/changed branches**:
  - [x] guidance is undefined → returns ok, logs skip
  - [x] guidance is null → returns ok, logs skip
  - [x] guidance is empty array → returns ok, logs skip
  - [x] body has no issueSeverity field → skips (isHighSeverityGuidanceBody returns false)
  - [x] severity is high → proceeds to create opportunity
  - [x] severity is medium → skips (severity not high enough)
  - [x] severity is low → skips (severity not high enough)
  - [x] severity is none → skips (severity not high enough)
  - [x] body is null/undefined → isHighSeverityGuidanceBody returns false (optional chaining)
  - [x] suggestions gate removed — no longer blocks opportunity creation
