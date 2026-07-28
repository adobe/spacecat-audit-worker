# Preserve the Original System-Generated Suggestion Content Across Manual Edits (All Opportunity Types)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | anagarwa@adobe.com |
| **Created** | 2026-07-28 |
| **Jira** | TBD — related: [LLMO-6537](https://jira.corp.adobe.com/browse/LLMO-6537) (surface manual-edit state in the UI for all content opportunities, currently TOC-only) |
| **Related** | [Slack thread](https://cq-dev.slack.com/archives/C09UYE3U48P/p1785128909750199?thread_ts=1784627235.593889&cid=C09UYE3U48P) — why manual-edit detection must be a dedicated flag, not `updatedBy` |
| **Related repos** | `project-elmo-ui` (primary implementation — the `isEdited` flag must be set explicitly by each opportunity type's edit-save UI action), `spacecat-audit-worker` (this repo — extend the existing per-type `isEdited`-guard pattern to the types that lack it) |

---

## Summary

Across TOC, summarization, readability, faqs, and metatags, the same pattern repeats: once a customer or internal team member edits a suggestion, the system-generated ("AI"/audit) value that existed immediately before the edit is discarded with no trace. There is no way today to show "the system originally suggested X, this was changed to Y," and no way to revert an edit.

TOC already has the right shape for detecting a manual edit: a dedicated `data.isEdited` flag, explicitly set by the UI at the moment of a genuine content edit, and explicitly checked by TOC's own audit-worker merge function to avoid overwriting the edited field on the next audit run. Metatags already does something similar with its own flag (`is_edited`). **Summarization, readability, and faqs have no such flag at all today** — this is a real gap, separately tracked in part by LLMO-6537, and a prerequisite for this spec's core ask in those three types.

This spec proposes:
1. **Extend the `isEdited`-flag pattern** (flag + audit-worker merge guard), and confirm/close the `edgeDeployed`/`edgeOptimizeStatus` protection TOC already has, for every type that's missing either — summarization, readability, faqs, and metatags.
2. **On top of that flag, add a "preserve original" snapshot** — a paired field capturing the system-generated content immediately before the *first* edit, so both versions coexist. This generalizes the exact mechanism TOC would need for its own `transformRules`/`originalTransformRules` pair to every other type's equivalent field(s).

---

## Background

### Why `isEdited` (not `updatedBy`) is the right signal — from team review

Per the [Slack thread](https://cq-dev.slack.com/archives/C09UYE3U48P/p1785128909750199?thread_ts=1784627235.593889&cid=C09UYE3U48P): a prior fix detected manual edits generically off the entity-level `updatedBy` field, but `updatedBy` also changes for legitimate system/engineering writes that aren't content edits — e.g. the `prompts` field written by the Impact Engine measurement pipeline — so it can't reliably signal "a human edited this content." The thread also noted that "manually edited" should cover edits by internal teams, not just customers, and that saving both the original and edited content has a second use beyond UI display: it can feed back into the suggestion-generation pipeline to produce better suggestions. The dedicated `isEdited` flag TOC already has — explicitly set only by the edit-save UI action, never inferred from bookkeeping fields — satisfies all of this and is the pattern this spec extends.

### Current state per opportunity type

| Opportunity type | Has a dedicated manual-edit flag today? | Flag name | Field(s) the flag protects | Audit-worker guard today |
|---|---|---|---|---|
| **TOC** | ✅ | `data.isEdited` | `transformRules.value` | Field-level (`src/toc/handler.js:744-748`) |
| **Metatags** | ✅ | `data.is_edited` | `editedSuggestion` (kept **separate** from `aiSuggestion`, which already refreshes every run — metatags is the one type that already avoids the "original is lost" problem, for one field) | Field-level (`src/metatags/handler.js:80-97`) |
| **Summarization** | ❌ **missing** | — | — | Whole-suggestion, gated on `edgeDeployed`/`edgeOptimizeStatus` only (`src/summarization/guidance-handler.js:60-68`) — an edit with neither of those set is fully overwritten by the next audit |
| **Readability (opportunities)** | ❌ **missing** | — | — | `opportunities/handler.js` uses the plain default merge (no guard at all); `guidance-handler.js` has the same `edgeDeployed`/`edgeOptimizeStatus`-only whole-suggestion guard as summarization |
| **Faqs** | ❌ **missing** | — | — | Whole-suggestion, gated on `edgeDeployed` only (`src/faqs/guidance-handler.js:339-346`) — also missing `edgeOptimizeStatus` |

**Summarization, readability, and faqs are the three types with the real, actionable gap**: with no dedicated flag, an edit to their suggestion content can be fully overwritten by the next audit unless the suggestion happens to also be `edgeDeployed` or mid-experiment. This is the prerequisite this spec's "preserve original" mechanism depends on for those three types, and is part of what LLMO-6537 is meant to cover (surfacing edit state in the UI implies having a flag to surface).

---

## Goals

- Every opportunity type that supports manual edits has its own explicit `isEdited`-style flag, set only by that type's edit-save UI action — never inferred from `updatedBy` or any other generic bookkeeping field.
- Every such type's audit-worker merge logic checks *that* flag (not `updatedBy`) before regenerating/overwriting edited content, so a human edit — customer or internal team — is never silently overwritten by the next audit run.
- Every such type also keeps the suggestion intact across the next audit while it's `edgeDeployed` or mid-experiment (`edgeOptimizeStatus`), matching what TOC already does — not just for manual edits.
- On top of the flag, preserve the system-generated content that existed immediately before the *first* edit, paired alongside the edited value, for every opportunity type — not just TOC.
- Lay the groundwork for feeding the original-vs-edited pair back into the suggestion-generation pipeline — not implemented in this spec, but the data model should not preclude it.

## Non-Goals

- **Full edit history.** One snapshot of the pre-*first*-edit state per suggestion, not a version log of every subsequent edit.
- **Backfilling suggestions already edited today.** Their pre-edit value is already gone; nothing to recover.
- **Changing what any existing preserved field means** — `transformRules.value`, `editedSuggestion`, etc. keep meaning exactly what they mean today.
- **Surfacing an "N suggestions edited" indicator in the UI** without requiring the customer to expand every suggestion — a UI-only feature that would consume the same `isEdited` flag this spec establishes, but is not itself part of this spec's scope.
- **Building the suggestion-generation feedback loop** that consumes the original/edited pair — future work, not this spec.

---

## Proposed Solution

### Step 1 — Add the `isEdited` flag, and close the `edgeDeployed`/`edgeOptimizeStatus` gaps, for every type missing either

TOC already checks **three** things before letting an audit regenerate a suggestion's content: (a) `edgeDeployed`, (b) `edgeOptimizeStatus` (mid-experiment), and (c) `isEdited` (`src/toc/handler.js:720-722,744-748`). The other types are inconsistent about which of these three they have:

| Type | `isEdited`-style flag | `edgeDeployed` guard | `edgeOptimizeStatus` guard | Gap to close |
|---|---|---|---|---|
| **Summarization** | ❌ missing | ✅ (`guidance-handler.js:60-68`, whole-suggestion) | ✅ (same guard) | Add `isEdited` flag + field-level guard |
| **Readability** | ❌ missing | ✅ in `guidance-handler.js`; ❌ absent in `opportunities/handler.js` (plain default merge) | ✅ in `guidance-handler.js`; ❌ absent in `opportunities/handler.js` | Add `isEdited` flag + field-level guard; confirm/add `edgeDeployed`/`edgeOptimizeStatus` guard on the `opportunities/handler.js` path too |
| **Faqs** | ❌ missing | ✅ (`guidance-handler.js:339-346`, whole-suggestion) | ❌ **missing** | Add `isEdited` flag + field-level guard; add the missing `edgeOptimizeStatus` half |
| **Metatags** | ✅ (`is_edited`) | ❌ **missing** | ❌ **missing** | Add both `edgeDeployed` and `edgeOptimizeStatus` guards (the `isEdited`-style flag is already there) |

- **UI** (`project-elmo-ui`): on save-edit, set `data.isEdited = true` explicitly for summarization/readability/faqs — the same way `TOCOpportunitySection.tsx`'s `handleSaveEdit` does today. This is a deliberate signal set only by the human-facing edit action — it must never be derived from any other field.
- **`spacecat-audit-worker`**: for each row above, add whichever guard(s) are marked missing, following TOC's exact pattern (`edgeDeployed || edgeOptimizeStatus` → skip the whole suggestion; `isEdited` → preserve the specific edited field(s)).
- This step is a correctness fix independent of Step 2 — a suggestion mid-edge-deploy, mid-experiment, or manually edited for summarization/readability/faqs/metatags can be silently overwritten by the next audit today.

### Step 2 — Preserve the original alongside the edit, for every type that has (or, after Step 1, now has) the flag

For each opportunity type, at the moment its edit-save UI action is about to set `isEdited: true`, guard on whether this is the *first* edit and snapshot the current (system-generated) value into a paired field before overwriting:

```tsx
// pattern, illustrated for TOC; the same shape applies per type with that type's own field name(s)
const isFirstEdit = !editingSuggestion.data?.isEdited

const newData = {
    ...editingSuggestion.data,
    ...(isFirstEdit && editingSuggestion.data?.transformRules
        ? { originalTransformRules: editingSuggestion.data.transformRules }
        : {}),
    transformRules: {
        ...editingSuggestion.data.transformRules,
        value: hastValue
    },
    isEdited: true
}
```

- **First edit** (`isEdited` was falsy going in): snapshot the current system-generated field(s) into the paired `original<Field>` key before overwriting.
- **Subsequent edit** (`isEdited` already `true`): skip the snapshot — the current value at that point is already the *previous edit*, not the system baseline, so re-snapshotting would corrupt the "original" into "previous edit."
- **Per-type field naming**, following each type's own editable field: `originalTransformRules` (TOC), `originalSummarizationText` (summarization), similarly for readability and faqs once their editable field is confirmed. Metatags is largely moot here, since it already keeps `aiSuggestion` fresh and separate from `editedSuggestion`.
- **No `spacecat-audit-worker` change needed for this step specifically** — every merge function inspected (default, toc, metatags, summarization, readability, faqs) is built on a top-level object spread, so a new sibling key that the freshly computed audit suggestion never produces survives every merge untouched (the same reasoning applies to TOC's own `originalTransformRules`). Step 1's audit-worker changes are about the `isEdited`/`edgeDeployed`/`edgeOptimizeStatus` guards themselves; Step 2 rides along for free once Step 1 lands.
- **Nest as a top-level sibling of the editable field, never nested inside it.** For TOC specifically, `transformRules` is rebuilt wholesale every audit run (`src/toc/handler.js:726-730`) and the top-level spread replaces it entirely — a snapshot nested inside `transformRules` itself would be silently dropped every re-audit unless specially re-injected, the same class of special-casing the existing `isEdited` block already needs for `.value`. A top-level sibling key avoids that. The same caution applies to any type whose editable field is itself a structured object rebuilt wholesale each run (check case-by-case during implementation).

---

## Cross-Repo Coordination

### `project-elmo-ui` — primary implementation

- Add `data.isEdited = true` (Step 1) to the save-edit action in `SummarizationOpportunitySection.tsx`, `ReadabilityOpportunitySection.tsx`, `FAQOpportunitySection.tsx`.
- Add the "preserve original" snapshot (Step 2) to `TOCOpportunitySection.tsx` (the original motivating case) and to the three components above once Step 1 lands. Given the shared shape of the guard across types, consider a shared helper (e.g. `buildFirstEditSnapshot(existingData, editableFieldKeys)`) rather than duplicating the `isFirstEdit` check per component.

### `spacecat-audit-worker` (this repo)

- **Real functional change** (Step 1): add the missing guards per the table above to `src/summarization/guidance-handler.js`, `src/readability/opportunities/guidance-handler.js` (and `opportunities/handler.js`), `src/faqs/guidance-handler.js`, and `src/metatags/handler.js`.
- **No functional change** for Step 2 (the paired snapshot field) — verification/regression tests only, confirming the new sibling key passes through every merge function unchanged, exactly as already proven for TOC.

---

## File Inventory

### Modify (`project-elmo-ui`)
- `SummarizationOpportunitySection.tsx`, `ReadabilityOpportunitySection.tsx`, `FAQOpportunitySection.tsx` — add `isEdited` flag on save (Step 1).
- `TOCOpportunitySection.tsx` and the three components above — add the "preserve original" snapshot on first edit (Step 2).
- Consider extracting the shared `isFirstEdit`/snapshot guard into a common helper used across components.

### Modify (`spacecat-audit-worker`, this repo)
- `src/summarization/guidance-handler.js` — add `isEdited` guard.
- `src/readability/opportunities/guidance-handler.js` (and `opportunities/handler.js`) — add `isEdited` guard; add `edgeDeployed`/`edgeOptimizeStatus` guard on the `opportunities/handler.js` path.
- `src/faqs/guidance-handler.js` — add `isEdited` guard; add the missing `edgeOptimizeStatus` half.
- `src/metatags/handler.js` — add `edgeDeployed` and `edgeOptimizeStatus` guards.
- Corresponding test files for each, plus a regression test confirming an unrecognized additive `data` key (the future `original<Field>` snapshot) survives every merge function unchanged — same contract already relied on for TOC.

### No changes
- `spacecat-api-service` — no backend endpoint change is needed; the flag is carried inside the `data` payload the UI already sends through the existing generic `patchSuggestion` endpoint, same as TOC does today.
