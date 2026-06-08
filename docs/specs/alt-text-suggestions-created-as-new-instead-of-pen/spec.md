## Spec: spacecat-audit-worker

### Problem

The `guidance:missing-alt-text` handler (`src/image-alt-text/guidance-missing-alt-text-handler.js`) is invoked when Mystique sends back AI-generated alt-text suggestions over SQS. The function `mapMystiqueSuggestionsToSuggestionDTOs()` (line 28) builds DTOs without a `status` field, so `opportunity.addSuggestions()` falls back to the schema default of `NEW`.

Every other audit type that calls `syncSuggestions()` (from `src/utils/data-access.js`) correctly reads `context.site.requiresValidation` and sets `PENDING_VALIDATION` for PAID-tier sites. The alt-text guidance handler bypasses this path entirely, which is why the TODO comment at line 82 already flags the gap.

The consequence: PAID-tier ASO customers see alt-text suggestions in the UI immediately without ESE review, violating the validation workflow agreed upon for the PAID tier.

**Error chain (as documented in the issue):**
1. Audit triggered for PAID-tier site
2. Main handler sets `site.requiresValidation = true` in `context`
3. Mystique processes pages and sends `guidance:missing-alt-text` SQS message back
4. `guidance-missing-alt-text-handler.js` runs; `context.site?.requiresValidation` is not forwarded into this handler's context
5. `mapMystiqueSuggestionsToSuggestionDTOs()` builds DTOs without a `status` field
6. Schema default `NEW` is applied
7. Suggestions appear in UI without ESE review

### Implementation Tasks

#### Task 1 — Import `checkSiteRequiresValidation` and call it after site fetch
**File:** `src/image-alt-text/guidance-missing-alt-text-handler.js`

At the top of the file, add:
```js
import { checkSiteRequiresValidation } from '../utils/site-validation.js';
```

In the `handler()` function, after `const site = await Site.findById(siteId)` (currently line 153), call:
```js
const requiresValidation = await checkSiteRequiresValidation(site, context, AUDIT_TYPE);
```

`checkSiteRequiresValidation` is already tested and handles all cases: non-PAID tier returns `false`, PAID ASO or LA-override returns `true`, LLMO/excluded orgs return `false`.

**Dependencies:** None — `checkSiteRequiresValidation` exists at `src/utils/site-validation.js`

**Testing:** See Task 3

---

#### Task 2 — Update `mapMystiqueSuggestionsToSuggestionDTOs` to accept and propagate `requiresValidation`
**File:** `src/image-alt-text/guidance-missing-alt-text-handler.js`

Change the function signature from:
```js
function mapMystiqueSuggestionsToSuggestionDTOs(mystiquesuggestions, opportunityId)
```
to:
```js
function mapMystiqueSuggestionsToSuggestionDTOs(mystiquesuggestions, opportunityId, requiresValidation)
```

In the returned object, add an explicit `status` field:
```js
return {
  opportunityId,
  type: SuggestionModel.TYPES.CONTENT_UPDATE,
  status: requiresValidation
    ? SuggestionModel.STATUSES.PENDING_VALIDATION
    : SuggestionModel.STATUSES.NEW,
  data: {
    recommendations: [recommendation],
  },
  rank: 1,
};
```

**Dependencies:** Task 1 must provide `requiresValidation`

**Testing:** See Task 3

---

#### Task 3 — Pass `requiresValidation` into `mapMystiqueSuggestionsToSuggestionDTOs` at its call site
**File:** `src/image-alt-text/guidance-missing-alt-text-handler.js`

Update the call at the existing location (currently line 202):
```js
const mappedSuggestions = mapMystiqueSuggestionsToSuggestionDTOs(
  suggestions,
  altTextOppty.getId(),
  requiresValidation,  // <-- add this argument
);
```

No changes needed to `addAltTextSuggestions()` in `opportunityHandler.js` — it already passes the DTOs as-is to `opportunity.addSuggestions()`, which respects whatever `status` is present in each DTO.

**Dependencies:** Tasks 1 and 2

**Testing:** See Task 4

---

#### Task 4 — Update unit tests for `guidance-missing-alt-text-handler.js`
**File:** `test/audits/image-alt-text/guidance-missing-alt-text-handler.test.js` (or the current test location)

Add or update test scenarios:

1. **PAID-tier site (requiresValidation = true):**
   - Mock `checkSiteRequiresValidation` to return `true`
   - Assert that all created suggestion DTOs have `status === 'PENDING_VALIDATION'`
   - Verify `opportunity.addSuggestions` is called with DTOs containing `PENDING_VALIDATION`

2. **Free-tier / non-PAID site (requiresValidation = false):**
   - Mock `checkSiteRequiresValidation` to return `false`
   - Assert all suggestion DTOs have `status === 'NEW'`

3. **Edge case — `checkSiteRequiresValidation` resolves to `false` for LLMO/excluded orgs:**
   - Verify suggestions are created with `NEW` status (no regression on existing behaviour)

Use `esmock` to mock `../utils/site-validation.js` for isolated unit tests. Follow the existing `MockContextBuilder` pattern for context setup.

Coverage requirement: 100% lines, branches, and statements (enforced in CI).

---

#### Task 5 — Remove the TODO comment
**File:** `src/image-alt-text/guidance-missing-alt-text-handler.js`

After implementing the fix, remove the TODO block at lines 82–84:
```js
/**
* TODO: ASSETS-59781 - Update alt-text opportunity to use syncSuggestions
* instead of current approach. This will enable handling of PENDING_VALIDATION status.
*/
```

Replace with a brief inline comment explaining the long-term intent if useful (optional, only if the WHY is non-obvious to future readers). The ASSETS-59781 migration ticket is the right place for tracking the `syncSuggestions` migration.

---

### Affected Files

| File | Change |
|------|--------|
| `src/image-alt-text/guidance-missing-alt-text-handler.js` | Import `checkSiteRequiresValidation`; add `requiresValidation` param to DTO mapper; call `checkSiteRequiresValidation` in handler; pass flag to mapper; remove TODO |
| `test/audits/image-alt-text/guidance-missing-alt-text-handler.test.js` | Add PAID-tier and free-tier test cases covering explicit status assignment |

No other files require changes.

### Testing Strategy

- **Unit tests only** — this is a behaviour change in a single handler; no integration tests or E2E tests are needed
- Run: `npm run test:spec -- test/audits/image-alt-text/guidance-missing-alt-text-handler.test.js`
- Verify full coverage: `npm test` must pass at 100% lines/branches/statements
- Manual smoke test (optional): trigger an alt-text audit for a PAID-tier site in the dev environment and confirm the resulting suggestions have `PENDING_VALIDATION` status in the database

### Dependencies on Other Repos

None. All required constants (`SuggestionModel.STATUSES.PENDING_VALIDATION`), the `checkSiteRequiresValidation` utility, and the existing `opportunity.addSuggestions()` contract are already in place.

### Notes

- This is the **short-term fix**. The long-term migration to `syncSuggestions()` (which handles `PENDING_VALIDATION` automatically via `defaultNewSuggestionStatus`) is tracked under ASSETS-59781 and should be implemented as a follow-up. When that migration lands, it will supersede the `requiresValidation` parameter added here.
- The bug affects **all** PAID-tier customers with alt-text audits (not just the three originally reported), because `checkSiteRequiresValidation` returns `true` for any PAID ASO site. Any site that completed a Mystique alt-text pass will have incorrectly-statused suggestions in the DB. A one-time data correction (backfill of existing `NEW` suggestions to `PENDING_VALIDATION` for PAID sites) may be needed separately — that is outside this spec's scope.
- `clearSuggestionsForPagesAndCalculateMetrics()` marks stale suggestions `OUTDATED` via `Suggestion.bulkUpdateStatus()` — that path is unaffected by this fix and does not need updating.
