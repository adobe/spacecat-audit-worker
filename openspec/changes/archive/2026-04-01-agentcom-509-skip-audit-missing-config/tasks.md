## 1. Config Validation Helper

- [ ] 1.1 Create `validateCommerceConfig(site, log)` helper function in `handler.js` that checks `site.getConfig().state.commerceLlmoConfig` for presence and at least one store view with all required fields (environmentId, websiteCode, storeCode, storeViewCode)
- [ ] 1.2 Write unit tests for `validateCommerceConfig`: missing config, empty config, incomplete store view, valid config

## 2. Step 1 Early Validation (Regular Audit)

- [ ] 2.1 Add `validateCommerceConfig` call at the start of `importTopPages`; return SKIPPED result if invalid
- [ ] 2.2 Write unit tests: importTopPages returns SKIPPED when config missing/empty/incomplete, proceeds when valid

## 3. Step 1 Early Validation (Yearly Audit)

- [ ] 3.1 Add `validateCommerceConfig` call at the start of `discoverSitemapUrlsAndSubmitForScraping`; return SKIPPED result if invalid
- [ ] 3.2 Write unit tests: discoverSitemapUrlsAndSubmitForScraping returns SKIPPED when config missing, proceeds when valid

## 4. Deprecation Warning for Remote Fallback

- [ ] 4.1 Add deprecation warning log before `getCommerceConfig` call in `runAuditAndProcessResults` (Step 3)
- [ ] 4.2 Write unit test verifying deprecation warning is logged when remote fallback is triggered

## 5. Verify and Finalize

- [ ] 5.1 Run full test suite (`npm test`) and ensure 100% coverage on handler.js
- [ ] 5.2 Archive OpenSpec change
