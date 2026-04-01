## Context

The `commerce-product-enrichments` audit has a 3-step pipeline: Step 1 (import top pages / discover sitemap), Step 2 (submit for scraping), Step 3 (process results). The commerce configuration (`commerceLlmoConfig`) is only checked in Step 3, meaning Steps 1 and 2 run wastefully for unconfigured sites. Of 31 enabled sites, only 1 has a valid config — the other 30 generate ~800 useless Step 1 invocations per day.

When `commerceLlmoConfig` is missing, Step 3 falls through to `getCommerceConfig()` which calls the deprecated PSS-AI remote endpoint, which also fails for most sites.

## Goals / Non-Goals

**Goals:**
- Fail fast in Step 1 for sites missing `commerceLlmoConfig`, preventing pipeline waste
- Apply validation to both regular and yearly audit variants
- Log a deprecation warning when remote config fallback is used
- Return a structured `SKIPPED` status so audit results are observable

**Non-Goals:**
- Removing the `getCommerceConfig` remote fallback entirely (needs separate migration)
- Changing the `commerceLlmoConfig` schema or validation beyond presence check
- Modifying the AuditBuilder pipeline infrastructure

## Decisions

**1. Validate in Step 1 entry points, not in AuditBuilder middleware**
- Rationale: Validation is audit-type-specific. Adding to AuditBuilder would couple infrastructure to domain logic. Step 1 is the natural gate.
- Alternative: A `withPreValidator()` hook on AuditBuilder — rejected as over-engineering for a single audit type.

**2. Extract a shared validation helper function**
- Rationale: Both `importTopPages` and `discoverSitemapUrlsAndSubmitForScraping` need identical validation. A shared `validateCommerceConfig(site, log)` function avoids duplication.
- The function returns `{ valid: boolean, reason?: string }`.

**3. Return structured result instead of throwing**
- Rationale: Throwing would mark the audit as failed. Returning `{ auditResult: { status: 'SKIPPED' } }` communicates that skipping is intentional and expected.

**4. Required fields: environmentId, websiteCode, storeCode, storeViewCode**
- These are the four fields consumed by the enrichment API payload. A store view entry missing any of these cannot produce a valid enrichment request.

## Risks / Trade-offs

- **Risk**: A site might have `commerceLlmoConfig` with empty store views → Mitigation: Validate that at least one store view has all 4 required fields, not just that the config key exists.
- **Risk**: Breaking the remote fallback path for the one configured site → Mitigation: Remote fallback only triggers when `commerceLlmoConfig` is absent. The one configured site already has it, so no impact.
