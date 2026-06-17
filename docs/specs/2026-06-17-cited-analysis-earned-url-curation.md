# Spec: Cited-Analysis Earned-URL Curation

- **Date:** 2026-06-17
- **Status:** Accepted
- **Audit:** `cited-analysis` (write path lives in `offsite-brand-presence`)

## Problem Statement

The cited-analysis URL Store currently accepts URLs that are not genuine
third-party **earned editorial** citations. For `lovesac.com`, the top-cited
list included:

- Search / social / deal-aggregator pages — `google.com/search`,
  `facebook.com/groups/...`, `groupon.com/coupons/lovesac`,
  `instagram.com/...`.
- Brand-owned lookalike domains that are **not** subdomains of the brand apex —
  e.g. `lovedbylovesac.com` (owned by Lovesac, but `lovedbylovesac.com` does not
  end in `.lovesac.com`, so the existing apex/subdomain filter keeps it).

These pollute offsite brand-perception reporting, which should only measure
**earned, non-branded, non-social** citations.

`youtube.com` and `reddit.com` are already routed to their own dedicated
analyses via `OFFSITE_DOMAINS` and are therefore already excluded from the
top-cited bucket — no change needed for them.

## Goals

1. Drop social/search/deal-aggregator domains (`google.com`, `facebook.com`,
   `instagram.com`, `groupon.com`) from cited URLs.
2. Drop brand-owned lookalike domains (`lovedbylovesac.com`) that the existing
   apex/subdomain owned-domain filter cannot catch.
3. Apply the exclusion **before URLs are written to the URL Store** (write path,
   `offsite-brand-presence`), and re-apply at read time in the cited-analysis
   handler as defense-in-depth (so URLs already stored before this change are
   also filtered).

## Non-Goals

- Mirroring this filter into the Mystique repo (out of scope; Mystique already
  mirrors owned-domain filtering via `_is_owned_url`).
- Changing `youtube.com` / `reddit.com` routing.

## Technical Design

### Shared helpers — `src/utils/offsite-audit-utils.js`

- `NON_EARNED_EXCLUDED_DOMAINS` — frozen list:
  `['google.com', 'facebook.com', 'instagram.com', 'groupon.com']`.
- `computeBrandTokens(siteHostname, brandKeywords)` — returns a `Set` of
  lowercase tokens used for branded-lookalike matching:
  - the site apex label (`lovesac.com` → `lovesac`), and
  - each configured brand keyword, normalized to `[a-z0-9]` only.
  - Tokens shorter than 3 chars are dropped to limit catastrophic false
    positives.
- `isExcludedCitedHost(hostname, brandTokens)` — returns `true` when the
  www-stripped host equals or is a subdomain of a `NON_EARNED_EXCLUDED_DOMAINS`
  entry, **or** the host contains any brand token as a substring.

### Write path — `src/offsite-brand-presence/handler.js`

- The orchestrator computes `brandTokens` from `siteHostname` +
  `site.getConfig().getBrandKeywords()`.
- `brandTokens` is threaded through `extractUrlsAndTopics` →
  `classifyAndNormalize`.
- `classifyAndNormalize` returns `null` (fully drops the URL, same as the
  owned-site check) when `isExcludedCitedHost(hostname, brandTokens)` is true.
  This runs after the owned-site check and before `OFFSITE_DOMAINS` routing,
  so excluded hosts never enter `allUrls`, `topByDomain`, or `topCited`, and are
  never written to the URL Store.

### Read path (defense-in-depth) — `src/cited-analysis/handler.js`

- After the existing `partitionOwnedUrls` step, drop any remaining URL whose
  host satisfies `isExcludedCitedHost(host, brandTokens)`, where `brandTokens`
  is computed from the site baseURL apex + `getBrandKeywords()`.

## Matching Semantics (accepted trade-off)

Branded matching is a **substring match on the host** only — never the path.

| URL | Result | Why |
|-----|--------|-----|
| `techradar.com/is-lovesac-good` | **kept** | host `techradar.com` has no brand token |
| `lovedbylovesac.com/...` | dropped | host contains `lovesac` |
| `lovesac-reviews.com/...` | dropped | host contains `lovesac` (accepted false positive) |
| `google.com/search` | dropped | non-earned domain |

The `lovesac-reviews.com`-style false positive (an independent reviewer whose
host contains the brand name) is an accepted trade-off, confirmed with the
requester.

## Success Criteria

- The lovesac example list no longer stores `google.com`, `facebook.com`,
  `groupon.com`, `instagram.com`, or `lovedbylovesac.com` URLs.
- Genuine third-party reviewers on neutral hosts are retained.
- 100% line/branch/statement coverage on all changed source files.
