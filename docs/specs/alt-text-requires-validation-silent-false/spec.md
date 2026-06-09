# `checkSiteRequiresValidation` silently returns `false` for PAID sites — diagnostic + fix plan

**Status:** Diagnostic deploy proposed
**Date:** 2026-06-09
**Related:** SITES-42095 (PAID alt-text suggestions land as NEW), PR #2592 (alt-text fix, merged), mystique PR #2601 (related cross-org content-fetch fix)
**Affected envs:** prod (confirmed), dev (confirmed)
**Affected handlers:** all audit-worker code paths that gate suggestion status on `context.site.requiresValidation` — not alt-text-specific

## Summary

PR #2592 added `checkSiteRequiresValidation(site, context, AUDIT_TYPE)` to the alt-text guidance handler so PAID-tier sites would get `PENDING_VALIDATION` instead of `NEW`. The PR shipped to prod on 2026-06-05 (release `1.461.1`). Three days later, with the fix code definitively running on prod, alt-text suggestions for the PAID customer Asian Paints (`beta.asianpaints.com`, ASO entitlement `tier: "PAID"` verified via API) **still land as `NEW`**.

This means `checkSiteRequiresValidation` is returning `false` for a known-PAID site, with the fix code present, and **without raising the only logged warning** (`Entitlement check failed for site …`). The function is silently taking one of its `return false` branches.

## Why this is broader than alt-text

`src/index.js:308-324` calls `checkSiteRequiresValidation` once per SQS message and stamps the result onto `site.requiresValidation`. Every guidance handler that reads `Boolean(context.site?.requiresValidation)` is affected by the same silent failure. Grep confirms ~10+ handlers consume this flag:

```
src/no-cta-above-the-fold/guidance-opportunity-mapper.js
src/paid-traffic-analysis/guidance-handler.js
src/experimentation-opportunities/guidance-high-organic-low-ctr-handler.js
src/paid-keyword-optimizer/guidance-opportunity-mapper.js
src/internal-links/suggestions-generator.js
src/internal-links/opportunity-suggestions.js
src/permissions/suggestion-data-mapper.js
src/metatags/handler.js
src/paid-cookie-consent/guidance-opportunity-mapper.js
src/backlinks/handler.js
src/image-alt-text/guidance-missing-alt-text-handler.js (PR #2592)
src/utils/data-access.js (syncSuggestions defaultNewSuggestionStatus)
```

When `requiresValidation` silently returns `false` for a PAID site, every one of these writes `NEW` instead of `PENDING_VALIDATION`. The reason this isn't visible across the board is that the failure mode is silent — no warning, no thrown error, just the default `NEW` value.

## Evidence

### Prod — direct DB observation

Asian Paints alt-text opportunity `3730fc86-db80-43e9-b884-6b484029eed4`, 2026-06-08:

- Org `160da889-39a2-4019-9315-82bbd4da59e7` — ASO entitlement `tier: "PAID"`, created 2025-09-25 (verified via `GET /v1/organizations/{orgId}/entitlements`)
- Mystique alt-text guidance handler ran end-to-end (Splunk: `Generated 5 alt text suggestions for opportunity 72c71d9e-…` at 08:09:45 UTC)
- audit-worker received `guidance:missing-alt-text` callback and wrote 9 suggestions (DB: 9 rows with `createdAt: 2026-06-08T08:12:38.349Z`)
- **Every row landed as `status: "NEW"`. Zero `PENDING_VALIDATION`.**

PR #2592 (merge commit `6ea7d12b`) shipped as release `1.461.1` on 2026-06-05 14:06 UTC and contains the 3-parameter `mapMystiqueSuggestionsToSuggestionDTOs(mystiquesuggestions, opportunityId, requiresValidation)` signature. Verified that no later commit on main has touched `src/image-alt-text/guidance-missing-alt-text-handler.js` since the merge.

So: the fix code IS running on prod, and it IS being called for this site, and the result is still `NEW`. The only consistent explanation is `requiresValidation = false`.

### Coralogix — no "Entitlement check failed" warning

A search for `Entitlement check failed for site` (the only warning emitted by `site-validation.js`) returns zero hits in `spacecat-services-prod` for the affected sites in the last 24h. So the entitlement check is not throwing — it's returning a value that doesn't match `PAID + ASO` in the strict-equality comparison.

### Dev — confirmed same behavior

In the same investigation we invoked the dev Lambda version `8066` directly with a synthetic `guidance:missing-alt-text` payload for `sunstargum.com` (`d2960efd-a226-4b15-b5ec-b64ccb99995e`). Lambda `8066` bundles the PR's code (`mapMystiqueSuggestionsToSuggestionDTOs(..., requiresValidation)`). The resulting suggestion landed as `NEW`. The org's ASO entitlement is `tier: "PAID"`, verified via the dev API. AWS Secrets Manager confirmed `ASO_PLG_EXCLUDED_ORGS` is not set on the dev audit-worker.

### Suggestive timing — possible v3.71→3.73 `spacecat-shared-data-access` regression

For `sunstargum.com` on dev:

| Date | Audit type | `PENDING_VALIDATION`? |
|---|---|---|
| 2026-05-24 | `a11y-color-contrast` | **YES** (135 rows) |
| 2026-06-01 | `no-cta-above-the-fold` | NO |
| 2026-06-04 | `cwv` | NO |
| 2026-06-05 | `alt-text` (Option-3 manual test) | NO |
| 2026-06-08 | `alt-text` (Asian Paints, prod) | NO |

The same site that produced 135 `PENDING_VALIDATION` rows on May 24 has produced zero across all audit types since June 1. In that window, the only audit-worker change to the validation chain was an unrelated env-var bypass (PR #2518 on 2026-05-19, before the regression window); the `@adobe/spacecat-shared-data-access` library bumped 3.71.2 → 3.72.1 → 3.73.1 between May 26 and May 31. **Circumstantial, not proven** — the diagnostic below resolves it.

## Hypotheses still open (cannot disambiguate from existing logs)

| # | Hypothesis | Returns false at |
|---|---|---|
| H1 | `auditType` happens to be in `IS_LLMO_OPPTY` on prod (e.g. via an unexpected env-var override of the constant) | line 39-41 |
| H2 | `ASO_PLG_EXCLUDED_ORGS` is set on prod and contains the org id of every affected customer | line 49-50 |
| H3 | `TierClient.checkValidEntitlement()` returns `{}` — `findByOrganizationIdAndProductCode(orgId, "ASO")` returns null even though the row exists in the DB (potential `spacecat-shared-data-access` regression) | line 67-68 → fall-through line 77 |
| H4 | Tier or productCode value mismatch — DB returns `tier: "PAID"` but the strict `===` against `Entitlement.TIERS.PAID` (`"PAID"`) fails due to whitespace, case, or a constant drift between the installed library version and the comparison | line 70 |
| H5 | `Entitlement.TIERS.PAID` resolves to a different string in the bundled library than in the runtime data (e.g. the bundled enum value differs from what the migrating DB writes) | line 70 |

The diagnostic log below distinguishes between all five in a single Coralogix line.

## Proposed action

### Step 1 — ship this PR (this branch) to dev

This PR adds one diagnostic `[rv-debug]` log per `return` path in `checkSiteRequiresValidation`, plus the entitlement state when the entitlement lookup succeeds. The added lines are INFO-level and include `siteId`, `orgId`, env-var presence, entitlement found/not, `tier` (`JSON.stringify`'d to expose whitespace/case), `productCode`, and the two constants used in the comparison.

Code change is in `src/utils/site-validation.js`. No behavior change — only adds observability.

### Step 2 — deploy to dev and run a controlled invocation

```sh
# from this branch
npm run deploy-dev
```

Capture the new Lambda version number from the deploy output. Then either:

- **Manual invoke (preferred — quickest signal):** use the same Option-3 pattern from the original investigation. Synthesize a `guidance:missing-alt-text` SQS payload referencing a real `auditId` for a known-PAID dev site (e.g. `sunstargum.com`, audit id from any recent run). Invoke `audit-worker:<new-version>` directly with `aws lambda invoke`.
- **End-to-end:** trigger via `@spacecat run audit alt-text https://sunstargum.com` and wait for the Mystique callback (depends on Mystique-side fix from PR #2601 landing for cross-org sites; sunstargum is dev, default-org, should work).

### Step 3 — read the `[rv-debug]` line in Coralogix

```
source logs
| filter $l.subsystemname == 'spacecat-services-dev'
| filter $d ~~ 'rv-debug'
| choose $m.timestamp, $d.message
| orderby $m.timestamp desc
| limit 20
```

One line resolves the hypothesis:

| `[rv-debug]` output | Hypothesis confirmed | Next step |
|---|---|---|
| `auditType=… → false (in IS_LLMO_OPPTY)` | H1 | Check if the deployed list differs from the source (it shouldn't — list is hardcoded, not env-var-driven). Likely impossible in practice; included for completeness. |
| `ASO_PLG_EXCLUDED_ORGS_set=true … → false (org in ASO_PLG_EXCLUDED_ORGS)` | H2 | Read the env var value; remove affected org ids OR document why they belong there. |
| `entitlementFound=false …` | H3 | File issue against `spacecat-shared-data-access`: auto-generated `findByOrganizationIdAndProductCode(orgId, "ASO")` returns `null` despite a matching row in `entitlements`. Likely a regression in v3.71-3.73 — point reviewer at the version bump timeline above. |
| `entitlementFound=true tier="PAID" productCode="ASO" … fell through to default` | H4 — constant mismatch | Compare `Entitlement.TIERS.PAID` printed value against the literal `"PAID"`. If they differ, the bundled library's enum drifted; bump the dep and verify. |
| `entitlementFound=true tier="FREE_TRIAL"` (or other non-PAID value) | Data issue, not code | The DB row doesn't say PAID for this site/org. Confirm via direct API; may indicate stale dev seeding. |

### Step 4 — implement the real fix based on the diagnostic

Most likely outcomes (in order of probability based on circumstantial evidence):

- **H3 (entitlement lookup returns null):** file `spacecat-shared-data-access` issue. Workaround in audit-worker: fall back from `findByOrganizationIdAndProductCode` to scanning the org's full entitlements via the `Entitlements` collection — slower but correct. Land a defensive guard in `site-validation.js` until the upstream finder is fixed.
- **H4 (constant mismatch):** bump `@adobe/spacecat-shared-data-access` to the version where the constants match the deployed DB schema, or normalize the comparison in `site-validation.js` (`tier?.trim?.()?.toUpperCase?.() === 'PAID'`).
- **H2 (env-var bypass):** purely operational — edit the secret, force Lambda cold start, restore after testing.

### Step 5 — remove the diagnostic + ship the fix

Once the branch fires and the real fix lands:

- Revert the `[rv-debug]` additions from `site-validation.js`.
- Verify in Coralogix that the next prod audit on any PAID site produces `PENDING_VALIDATION` end-to-end. Lexmark, Walmart corporate, Asian Paints, Okta are good samples (Lexmark/Walmart corporate depend on the Mystique fix from PR #2601 landing first; Asian Paints does not).
- Backfill: one-shot script to PATCH existing `NEW` rows on PAID sites to `PENDING_VALIDATION`. Scope: type=alt-text + status=NEW + isManuallyEdited≠true + site's org has PAID ASO entitlement. Estimated ~150-300 rows across the SITES-42095 customer list.

## Non-goals

- Does **not** fix the Mystique-side cross-org content fetch issue (tracked separately on `mystique` PR #2601). Without that fix, PAID customers like Walmart corporate / Lexmark / Okta will continue to have alt-text suggestions stuck at `setting to retry` until the Mystique message expires — independent of this validation issue.
- Does **not** add per-suggestion telemetry beyond `requiresValidation` — that's a separate observability concern.
- Does **not** rewrite or replace `checkSiteRequiresValidation` — the function's logic is correct; the question is which path runs at the customer-prod level.

## Test plan

- [x] Diagnostic log added at every `return` in `checkSiteRequiresValidation`
- [x] Existing tests still pass (no behavioral change — only logging additions). Run `npm run test:spec -- test/utils/site-validation.test.js`.
- [ ] Deploy to dev (`npm run deploy-dev`)
- [ ] Manual invocation produces exactly one `[rv-debug]` line per call in CloudWatch
- [ ] Branch confirmed → real fix PR follows on a separate branch
- [ ] Diagnostic reverted before the fix is merged to main

## Appendix — what the diagnostic looks like

Sample expected output for a PAID site that returns the correct `true`:

```
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… ASO_PLG_EXCLUDED_ORGS_set=false
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… entitlementFound=true entitlementId=… tier="PAID" productCode="ASO" Entitlement.TIERS.PAID="PAID" ASO_PRODUCT_CODE="ASO"
[rv-debug] siteId=d2960efd-… → true (PAID ASO entitlement matched)
```

Sample for the silent-false bug (H3):

```
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… ASO_PLG_EXCLUDED_ORGS_set=false
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… entitlementFound=false entitlementId=null tier=null productCode=null Entitlement.TIERS.PAID="PAID" ASO_PRODUCT_CODE="ASO"
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… → false (fell through to default)
```

Sample for the constant-mismatch bug (H4):

```
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… ASO_PLG_EXCLUDED_ORGS_set=false
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… entitlementFound=true entitlementId=421004c2-… tier="paid" productCode="ASO" Entitlement.TIERS.PAID="PAID" ASO_PRODUCT_CODE="ASO"
[rv-debug] siteId=d2960efd-… orgId=44568c3e-… → false (fell through to default)
```

Either way the next step is unambiguous.
