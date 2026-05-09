# Cookie Consent SEO Importer Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `importAhrefPaidStep` in the "paid" (cookie-consent) audit to auto-enable the `ahref-paid-pages` import on the site config before triggering the import, matching the existing pattern used by the traffic-analysis import steps.

**Architecture:** The `importAhrefPaidStep` currently sends an `ahref-paid-pages` import request to the import worker without checking if the site has that import type enabled. The import worker's `paidPagesConfigProvider` calls `defaultConfigProvider`, which throws `"Site X is not configured for ahref-paid-pages import"` for sites without the import enabled. The fix adds the same `isImportEnabled` / `enableImport` guard already used in `createImportStep` (traffic-analysis). This is a minimal, isolated change to one function plus its tests.

**Tech Stack:** Node.js 24, ESM, Mocha + Chai + Sinon, 100% branch/line/statement coverage required.

---

## Background

- The "paid" audit type (`src/paid-cookie-consent/handler.js`) is a 6-step StepAudit.
- Step 1 (`importAhrefPaidStep`) triggers an `ahref-paid-pages` import via the import worker.
- Steps 2–5 (`createImportStep(0..3)`) trigger `traffic-analysis` imports — these correctly check `isImportEnabled()` and call `enableImport()` if the import isn't configured on the site.
- Step 1 skips this check entirely. In production (April 13, 2026), 33 out of 38 import requests failed with `"Site X is not configured for ahref-paid-pages import"`.
- The `enableImport` helper and `isImportEnabled` utility already exist in this file (lines 38–52).

## File Inventory

- **Modify:** `src/paid-cookie-consent/handler.js` — `importAhrefPaidStep` function (lines 456–472)
- **Modify:** `test/audits/paid-cookie-consent/paid.test.js` — `describe('importAhrefPaidStep')` block (lines 747–795)

No new files needed.

---

## Task 1: Add tests for enableImport behavior in importAhrefPaidStep

**Files:**
- Modify: `test/audits/paid-cookie-consent/paid.test.js:747-795`

- [ ] **Step 1: Add test — enables import when not already enabled**

In `test/audits/paid-cookie-consent/paid.test.js`, add a new test inside the existing `describe('importAhrefPaidStep')` block, after the existing two tests (after line 794):

```javascript
  it('should enable ahref-paid-pages import when not already enabled', async () => {
    const stepContext = {
      site,
      log: logStub,
      finalUrl: auditUrl,
    };

    await importAhrefPaidStep(stepContext);

    expect(site.getConfig().enableImport).to.have.been.calledWith('ahref-paid-pages');
    expect(site.save).to.have.been.called;
  });
```

- [ ] **Step 2: Add test — skips enableImport when already enabled**

Add another test right after:

```javascript
  it('should not enable import when ahref-paid-pages is already enabled', async () => {
    const mockConfigWithImport = createMockConfig(sandbox, {
      getImports: () => [{ type: 'ahref-paid-pages', enabled: true }],
    });
    const siteWithImport = getSite(sandbox, {
      getConfig: () => mockConfigWithImport,
    });

    const stepContext = {
      site: siteWithImport,
      log: logStub,
      finalUrl: auditUrl,
    };

    await importAhrefPaidStep(stepContext);

    expect(mockConfigWithImport.enableImport).to.not.have.been.called;
  });
```

- [ ] **Step 3: Add test — throws when site config is null**

Add another test right after:

```javascript
  it('should throw error when site config is null', async () => {
    const siteWithNullConfig = getSite(sandbox, {
      getConfig: () => null,
    });

    const stepContext = {
      site: siteWithNullConfig,
      log: logStub,
      finalUrl: auditUrl,
    };

    await expect(importAhrefPaidStep(stepContext))
      .to.be.rejectedWith(/site config is null/);
  });
```

- [ ] **Step 4: Run tests to verify the new tests fail**

Run: `npm run test:spec -- test/audits/paid-cookie-consent/paid.test.js`

Expected: The 3 new tests FAIL because `importAhrefPaidStep` doesn't call `enableImport` yet:
- "should enable ahref-paid-pages import when not already enabled" — FAIL (enableImport not called)
- "should not enable import when ahref-paid-pages is already enabled" — may PASS (enableImport was never called anyway)
- "should throw error when site config is null" — FAIL (no error thrown)

---

## Task 2: Add enableImport logic to importAhrefPaidStep

**Files:**
- Modify: `src/paid-cookie-consent/handler.js:456-472`

- [ ] **Step 1: Update importAhrefPaidStep to check and enable import**

Replace the existing `importAhrefPaidStep` function (lines 456–472) with:

```javascript
export async function importAhrefPaidStep(context) {
  const { site, finalUrl, log } = context;
  const siteId = site.getId();

  log.info(`[paid-audit] [Site: ${finalUrl}] Triggering ${IMPORT_TYPE_AHREF_PAID_PAGES} import`);

  const siteConfig = site.getConfig();
  const imports = siteConfig?.getImports() || [];

  if (!isImportEnabled(IMPORT_TYPE_AHREF_PAID_PAGES, imports)) {
    log.debug(`[paid-audit] [Site: ${finalUrl}] Enabling ${IMPORT_TYPE_AHREF_PAID_PAGES} import for site ${siteId}`);
    await enableImport(site, IMPORT_TYPE_AHREF_PAID_PAGES, log);
  }

  return {
    auditResult: {
      status: 'processing',
      message: `Importing ${IMPORT_TYPE_AHREF_PAID_PAGES} data`,
    },
    fullAuditRef: finalUrl,
    type: IMPORT_TYPE_AHREF_PAID_PAGES,
    siteId,
    allowCache: true,
  };
}
```

The only addition is the `isImportEnabled` / `enableImport` block (same pattern as `createImportStep` lines 417–424). The `enableImport` function (line 42) handles the `siteConfig === null` case by throwing an error, which covers the null-config test.

- [ ] **Step 2: Run all tests to verify they pass**

Run: `npm run test:spec -- test/audits/paid-cookie-consent/paid.test.js`

Expected: All tests PASS, including the 3 new ones.

- [ ] **Step 3: Run the full test suite to check coverage**

Run: `npm test`

Expected: All tests PASS, coverage at 100% lines/branches/statements.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: No lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/paid-cookie-consent/handler.js test/audits/paid-cookie-consent/paid.test.js
git commit -m "fix: enable ahref-paid-pages import on site config before triggering import

The importAhrefPaidStep was sending ahref-paid-pages import requests to the
import worker without first enabling the import type on the site config. This
caused the import worker to reject most requests with 'Site X is not configured
for ahref-paid-pages import'. Adds the same isImportEnabled/enableImport guard
used by the traffic-analysis import steps.

Refs: SITES-40765"
```

---

## Verification

- **Package manager**: npm
- **Test command**: `npm test` (full suite) / `npm run test:spec -- test/audits/paid-cookie-consent/paid.test.js` (targeted)
- **Lint command**: `npm run lint`
- **Coverage thresholds**: lines 100%, branches 100%, statements 100%
- **Pre-commit hooks**: yes (`.husky/pre-commit`)
- **Test cases for new/changed branches**:
  - [x] `isImportEnabled` returns false → `enableImport` called with `'ahref-paid-pages'`, `site.save()` called
  - [x] `isImportEnabled` returns true → `enableImport` NOT called
  - [x] `site.getConfig()` returns null → throws error with "site config is null"
