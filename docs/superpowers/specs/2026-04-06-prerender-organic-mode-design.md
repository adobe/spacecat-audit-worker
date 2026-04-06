---
title: Prerender Organic Mode — Slack Command Extension
date: 2026-04-06
status: Accepted
repos:
  - spacecat-audit-worker
  - spacecat-api-service
---

# Prerender Organic Mode

## Problem Statement

The prerender audit was moved to a schedule-based approach. As a result, there is no way to manually trigger it exclusively for organic (SEO top-pages) traffic. The existing `run audit {site} prerender` command runs on a merged set of organic and agentic (LLM/AI) URLs. Operators need a targeted way to re-run prerender scoped only to organic pages — for example, to validate fixes or investigate issues for a site without the overhead of also processing agentic URLs.

## Goals

- Allow operators to trigger the prerender audit on organic pages only via Slack.
- Reuse the existing prerender pipeline; no duplication of audit logic.
- Keep the change minimal and consistent with the existing `mode:ai-only` pattern already in the handler.

## Non-Goals

- Adding a new standalone audit type or new SQS handler.
- Changing the scheduled prerender behaviour (continues to run organic + agentic).
- Supporting organic-only mode via the `run audit {site} all` path.

## Design

### Slack Command (spacecat-api-service)

**File:** `src/support/slack/commands/run-audit.js`

Extend `handleExecution` to detect the positional-argument pattern `prerender organic` and normalize it before calling `runAuditForSite`:

```
if auditTypeInputArg === 'prerender' && auditDataInputArg === 'organic':
    auditDataInputArg = '{"mode":"organic"}'
```

Usage: `run audit <site-url> prerender organic`

- Entitlement checks, site lookup, and handler-enabled checks apply unchanged.
- `run audit {site} all` is unaffected — the `ALL_AUDITS` list does not change.
- `organic` is only special-cased when the audit type is `prerender`; other types receive `organic` as raw audit data (unchanged behaviour).

### Audit Worker (spacecat-audit-worker)

#### `src/prerender/utils/constants.js`

Add:
```js
export const MODE_ORGANIC = 'organic';
```

#### Step 2 — `submitForScraping`

Existing pattern: `getModeFromData(data)` is already called at the top of this function (for `MODE_AI_ONLY`).

Add: when `mode === MODE_ORGANIC`, skip `getTopAgenticUrls()` and build the scrape payload exclusively from `getTopOrganicUrlsFromSeo()`. All existing logic (recent-URL deduplication, batch size, URL normalization via `mergeAndGetUniqueHtmlUrls`) applies unchanged.

#### Step 3 — `processContentAndGenerateOpportunities`

The primary path (when `scrapeResultPaths` is populated) needs no change — it processes whatever was scraped.

The fallback path (when `scrapeResultPaths` is empty) currently calls both `getTopAgenticUrls()` and `getTopOrganicUrlsFromSeo()`. When `mode === MODE_ORGANIC`, skip the agentic fetch so the fallback is consistent with what step 2 submitted.

#### Step 1 — `importTopPages`

No change — mode-agnostic, passes `auditContext` through as-is.

## Data Flow

```
Slack: "run audit <site> prerender organic"
  → run-audit.js normalizes auditData to '{"mode":"organic"}'
  → triggerAuditForSite(site, 'prerender', '{"mode":"organic"}', ...)
  → SQS message: { type: 'prerender', data: '{"mode":"organic"}' }

audit-worker step 1 (importTopPages):
  → mode-agnostic, passes through

audit-worker step 2 (submitForScraping):
  → getModeFromData(data) === 'organic'
  → skips getTopAgenticUrls()
  → fetches only getTopOrganicUrlsFromSeo() (≤200 URLs)
  → submits organic-only URL list for scraping

audit-worker step 3 (processContentAndGenerateOpportunities):
  → processes scrape results as normal
  → fallback path: skips agentic fetch when mode === 'organic'
```

## Testing

### spacecat-api-service

- `run audit https://example.com prerender organic` → `triggerAuditForSite` called with `auditType='prerender'`, `auditData='{"mode":"organic"}'`
- Normalization does NOT fire for `run audit {site} lhs-mobile organic` (other audit types unaffected)

### spacecat-audit-worker

- `submitForScraping` with `data='{"mode":"organic"}'`: `getTopAgenticUrls` is never called; only `getTopOrganicUrlsFromSeo` is called
- `processContentAndGenerateOpportunities` fallback path with organic mode: agentic fetch is skipped
- 100% line/branch/statement coverage maintained on all modified files

## Alternatives Considered

**Accept plain-string modes in `getModeFromData`:** Would allow `organic` to arrive as a raw string without JSON wrapping. Rejected — makes the mode-dispatch implicitly permissive; any non-JSON audit data string would be treated as a mode.

**New `prerender-organic` audit type:** Full pipeline duplication for a one-line URL-source difference. Rejected as overkill.
