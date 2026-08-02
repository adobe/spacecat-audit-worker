# Accessibility Fix Entity Migration — spacecat-audit-worker

**Created:** 2026-04-01
**Status:** Draft

---

## Feature Overview

Accessibility (non-forms) code patches are currently stored directly in `Suggestion.data` (`patchContent` / `isCodeChangeAvailable`). Multiple suggestions can share the same code fix via `aggregationKey`, but because each suggestion carries its own copy of the patch, this creates duplicates and causes 413 errors. This migration stores patches in FixEntity records and links them to suggestions via the existing junction table.

### Why

The 1-to-M relationship between a code fix and its suggestions is not modeled with distinct DB entities. The `aggregationKey` maps multiple suggestions to the same fix, but each suggestion duplicates the patch content. This causes payload bloat and HTTP 413 responses.

### Success Criteria

- [ ] FixEntity records are created with embedded patch content in `changeDetails` for new accessibility code fixes
- [ ] Suggestions are linked to their FixEntity via `setSuggestionsForFixEntity()`
- [ ] `patchContent` and `isCodeChangeAvailable` are no longer written to suggestion.data (immediate, no dual-write)
- [ ] `handleAccessibilityRemediationGuidance` continues to work unchanged (it handles guidance, not patches)
- [ ] Existing tests continue to pass

---

## What This Repo Does

This repo runs the code fix processing pipeline for accessibility audits. The key change is in `processCodeFixUpdates()` in `codefix-handler.js`, which currently:

1. Reads code fix reports from S3
2. Matches suggestions by `aggregationKey`
3. Writes `patchContent` and `isCodeChangeAvailable` into each matched suggestion's data

After this change, step 3 becomes:
3. Creates a FixEntity with the patch in `changeDetails`
4. Links all matched suggestions to that FixEntity via the junction table

The `handleAccessibilityRemediationGuidance` function is unaffected — it enriches suggestion `htmlWithIssues` with Mystique guidance (generalSuggestion, updateTo, userImpact), which is separate from code patches.

---

## Requirements

1. **Create FixEntity instead of writing to suggestion.data**
   - When `processCodeFixUpdates()` processes a code fix report, create a FixEntity with type `CODE_CHANGE`, status `PENDING`, and `changeDetails` containing the diff
   - Acceptance: FixEntity exists in DB with correct fields after code fix processing

2. **Link suggestions to FixEntity**
   - All suggestions matching the aggregationKey must be linked to the FixEntity
   - Acceptance: `GET /fixes/:fixId/suggestions` returns the matched suggestions

3. **Stop writing patchContent to suggestion.data**
   - Do not set `patchContent` or `isCodeChangeAvailable` on suggestion data for new accessibility fixes
   - Acceptance: New suggestions have no `patchContent` in their data object

4. **Do not change handleAccessibilityRemediationGuidance**
   - This function handles Mystique guidance enrichment, not code patches — it must remain unchanged
   - Acceptance: Existing guidance tests pass without modification

---

## Data Flow

```
S3 Code Fix Report
       │
       ▼
processCodeFixUpdates()
       │
       ├─ Read report.json from S3 (contains diff)
       ├─ Match suggestions by aggregationKey
       │
       ▼  (BEFORE - current)
  suggestion.setData({ patchContent: diff, isCodeChangeAvailable: false })
       
       ▼  (AFTER - new)
  opportunity.addFixEntities([{
    type: 'CODE_CHANGE',
    status: 'PENDING',
    changeDetails: { patchContent: diff, aggregationKey, description }
  }])
       │
       ▼
  FixEntityDataAccess.setSuggestionsForFixEntity(opportunityId, fixEntity, matchedSuggestions)
```

---

## Implementation Tasks

### Task 1: Create FixEntity in processCodeFixUpdates

- **Description:** Replace the suggestion data update with FixEntity creation. After matching suggestions by aggregationKey, build a FixEntity payload and add it to the opportunity. Then link matched suggestions.
- **Files:**
  - `src/common/codefix-handler.js` — `processCodeFixUpdates()` (lines ~164-372)
  - Specifically the block around lines 164-168 where `patchContent` is set on suggestion data
  - The aggregationKey matching block (lines ~265-315)
- **Dependencies:** FixEntity and FixEntitySuggestion models from `@adobe/spacecat-shared-data-access` (already imported in `src/utils/data-access.js`)
- **Testing:** Verify FixEntity created, suggestions linked, suggestion.data clean

### Task 2: Structure changeDetails

- **Description:** Build the `changeDetails` object for the FixEntity:
  ```javascript
  {
    description: `Accessibility code fix for ${aggregationKey}`,
    patchContent: reportData.diff,
    aggregationKey,
  }
  ```
- **Files:** `src/common/codefix-handler.js`
- **Dependencies:** Task 1
- **Testing:** Verify changeDetails shape

### Task 3: Verify handleAccessibilityRemediationGuidance unchanged

- **Description:** Review `handleAccessibilityRemediationGuidance` to confirm it has no coupling to `patchContent`. It should only enrich `htmlWithIssues` with guidance objects. No code changes expected.
- **Files:** `src/accessibility/utils/generate-individual-opportunities.js` (lines ~1011-1191) — review only
- **Dependencies:** None
- **Testing:** Run existing tests

### Task 4: Unit tests (after implementation stabilizes)

- **Description:** Write/update unit tests for the modified codefix-handler. Wait for implementation to stabilize before writing tests.
- **Files:** `test/common/codefix-handler.test.js` (or equivalent)
- **Dependencies:** Tasks 1-3
- **Testing:** `npm test`

---

## Code Patterns

**Existing FixEntity creation pattern** (from `src/utils/data-access.js`, lines ~450-535):

```javascript
// This repo already uses FixEntity in reconcileDisappearedSuggestions:
const fixPayload = buildFixEntityPayload(suggestion);
await opportunity.addFixEntities([fixPayload]);
```

**Existing setSuggestionsForFixEntity usage** (from spacecat-shared):

```javascript
await FixEntityDataAccess.setSuggestionsForFixEntity(
  opportunityId,
  createdFixEntity,
  matchedSuggestions, // array of Suggestion models
);
```

Follow these existing patterns for consistency.

---

## Testing Requirements

- Wait for implementation to stabilize before writing unit tests
- Run ALL existing tests to verify backwards compatibility: `npm test`
- Key test scenarios:
  - FixEntity created with correct `type`, `status`, `changeDetails`
  - Suggestions linked via junction table
  - Suggestion.data does NOT contain `patchContent` for new fixes
  - `handleAccessibilityRemediationGuidance` unaffected

---

## Dependencies on Other Repos

- **experience-success-studio-ui** — must be updated AFTER this repo to consume FixEntity data. The UI has a backwards-compatible fallback to `suggestion.data.patchContent` for pre-migration suggestions.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| UI briefly shows no patches for new suggestions | Low | UI deploys shortly after; backwards compat fallback handles transition |
| FixEntity creation fails silently | Medium | Add logging around `addFixEntities` call; monitor in Coralogix |
