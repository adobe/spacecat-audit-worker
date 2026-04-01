# commerce-config-validation Specification

## Purpose
TBD - created by archiving change agentcom-509-skip-audit-missing-config. Update Purpose after archive.
## Requirements
### Requirement: Audit SHALL skip when commerceLlmoConfig is missing
The commerce-product-enrichments audit (both regular and yearly variants) SHALL validate that the site has a `commerceLlmoConfig` with at least one valid store view before proceeding to the import/scrape pipeline. If validation fails, the audit MUST return a `SKIPPED` status and MUST NOT trigger downstream import-worker or content-scraper work.

#### Scenario: Site has no commerceLlmoConfig
- **GIVEN** a site with no `commerceLlmoConfig` in its config state
- **WHEN** Step 1 (`importTopPages`) is invoked for the regular audit
- **THEN** the audit MUST return `{ auditResult: { status: 'SKIPPED', reason: 'Missing commerceLlmoConfig' } }` and MUST NOT proceed to Step 2

#### Scenario: Site has empty commerceLlmoConfig
- **GIVEN** a site with `commerceLlmoConfig` set to an empty object `{}`
- **WHEN** Step 1 (`importTopPages`) is invoked for the regular audit
- **THEN** the audit MUST return `{ auditResult: { status: 'SKIPPED', reason: 'Missing commerceLlmoConfig' } }` and MUST NOT proceed to Step 2

#### Scenario: Site has commerceLlmoConfig with incomplete store view
- **GIVEN** a site with `commerceLlmoConfig` containing one store view that is missing `storeViewCode`
- **WHEN** Step 1 (`importTopPages`) is invoked for the regular audit
- **THEN** the audit MUST return `{ auditResult: { status: 'SKIPPED', reason: 'No valid store views in commerceLlmoConfig' } }` and MUST NOT proceed to Step 2

#### Scenario: Site has valid commerceLlmoConfig
- **GIVEN** a site with `commerceLlmoConfig` containing at least one store view with all required fields (`environmentId`, `websiteCode`, `storeCode`, `storeViewCode`)
- **WHEN** Step 1 (`importTopPages`) is invoked for the regular audit
- **THEN** the audit MUST proceed normally to import top pages

#### Scenario: Yearly audit skips when commerceLlmoConfig is missing
- **GIVEN** a site with no `commerceLlmoConfig` in its config state
- **WHEN** Step 1 (`discoverSitemapUrlsAndSubmitForScraping`) is invoked for the yearly audit
- **THEN** the audit MUST return `{ auditResult: { status: 'SKIPPED', reason: 'Missing commerceLlmoConfig' } }` and MUST NOT proceed to scraping

#### Scenario: Yearly audit proceeds with valid config
- **GIVEN** a site with `commerceLlmoConfig` containing at least one valid store view
- **WHEN** Step 1 (`discoverSitemapUrlsAndSubmitForScraping`) is invoked for the yearly audit
- **THEN** the audit MUST proceed normally to discover sitemap URLs

### Requirement: Remote config fallback SHALL log deprecation warning
The `getCommerceConfig` remote fallback used in Step 3 when `commerceLlmoConfig` is absent SHALL emit a deprecation warning log.

#### Scenario: Remote fallback triggered in Step 3
- **GIVEN** a site that reaches Step 3 without `commerceLlmoConfig` (e.g., via direct invocation)
- **WHEN** `runAuditAndProcessResults` falls through to `getCommerceConfig`
- **THEN** the system MUST log a warning containing "deprecated" before calling `getCommerceConfig`

