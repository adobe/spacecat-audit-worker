# LLM Error Pages: HEAD-Check & Excel↔DB Consistency

## Problem

Two independent issues converged into customer-visible bugs in the
`llm-error-pages` audit:

1. Mystique's `BrokenLinksFlow` URL validator builds an
   `alternative_urls` pool by locale-filtering candidate URLs, but does
   not HEAD-verify the survivors against the live site. The audit-worker
   was persisting suggestions that returned `404` on click, which
   damaged user trust in the audit output.
2. A long-standing "skip empty-suggestion rows" gate dropped rows from
   the Excel report when Mystique returned no replacement URL, while
   the DB suggestion rows for the same opportunity were still written.
   Excel and the DB diverged on the same audit run, making operator
   triage unreliable.

## Solution

- **Defence-in-depth HEAD check** at the audit-worker boundary via the
  new `src/llm-error-pages/url-health-check.js`. Confident `4xx`/`5xx`
  → drop. Inconclusive (timeout, network error, `405`) → keep. Per-host
  concurrency cap of `3`, global cap of `10`, Adobe-identifying
  User-Agent. Uses `redirect: 'manual'` so that an attacker-controlled
  `3xx` target cannot bypass the SSRF guard applied to the original URL.
- **Shared SSRF guard** in the new `src/support/url-safety.js`: scheme
  allowlist (http/https only), rejection of IP literals in
  private/loopback/link-local ranges, and DNS-based rejection of
  hostnames that resolve to non-public addresses.
- **`tracingFetch`** is used so Honeycomb / Coralogix can see every
  outbound HEAD as part of the audit's trace.
- **`head-check-summary` structured log** is emitted on every invocation
  with counts of kept / dropped / inconclusive URLs for dashboarding.
- **Excel↔DB consistency**: the empty-suggestion skip-gate is removed.
  Empty-suggestion rows are now persisted in both Excel and the DB. The
  HEAD-check pass clears `aiRationale` on rows whose only
  `suggested_urls` failed the probe, so the surfaced report remains
  internally consistent (no orphan rationale text).

## Key Decisions

- Defence-in-depth at the consumer side rather than tightening Mystique
  upstream: Mystique releases on a longer cycle and the customer impact
  is already live. The Mystique-side fix is on the follow-up list and
  the audit-worker check will retire once it ships.

## Files Changed

| File | Change |
|------|--------|
| `src/llm-error-pages/url-health-check.js` | **NEW** — HEAD-reachability filter with per-host / global concurrency caps, fail-open on inconclusive results |
| `src/llm-error-pages/guidance-handler.js` | Calls `filterOutConfirmedBrokenUrls`; removes the empty-suggestion skip gate; clears `aiRationale` when all suggestions filter out |
| `src/support/url-safety.js` | **NEW** — canonical SSRF guard helpers shared across audits |
| `src/site-detection/handler.js` | Pointer comment to the new canonical helpers |
| `test/audits/llm-error-pages/url-health-check.test.js` | **NEW** — covers reachability matrix, SSRF guard, per-host cap, fail-open |
| `test/audits/llm-error-pages/guidance-handler.test.js` | Updated to cover the new HEAD-check integration and the Excel↔DB persistence parity |

## Known Risks (Accepted)

1. **DNS-rebinding TOCTOU window** between the guard's DNS lookup and
   `fetch()`'s own lookup. Documented inline in `url-safety.js`;
   mitigated in this Lambda environment by IMDSv2 hop-limit = 1 and
   VPC egress rules.
2. **Per-host cap of 3** may still trip aggressive WAFs on rows with
   many suggested URLs. Fail-open behaviour keeps the customer's
   suggestions in that case at the cost of letting some 404s slip
   through until the WAF clears.
3. **Site-detection fork drift**: `src/site-detection/handler.js` still
   carries its own copy of `isPrivateIP` and `resolvesToPublicAddress`
   until that audit is next touched.

## Follow-ups

- Mystique: verify `locale_filtered_urls` against live HEAD before
  emitting `alternative_urls`. Retires this defensive layer once
  shipped.
- Site-detection: migrate to `src/support/url-safety.js` import.
- Pin the resolved IP via undici `lookup` option to close the
  DNS-rebinding TOCTOU window.
