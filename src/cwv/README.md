# CWV Audit Flow

This folder contains the Core Web Vitals audit flow for `spacecat-audit-worker`.

The main entry points are:

- `handler.js`
  Orchestrates the two-step CWV audit flow.
- `cwv-audit-result.js`
  Fetches RUM data and selects the entries that should become the CWV opportunity payload.
- `opportunity-sync.js`
  Converts the audit result into the Spacecat opportunity and suggestion records.
- `auto-suggest.js`
  Sends CWV suggestions to Mystique for guidance and autofix workflows.

## Goal

The CWV opportunity should always prefer pages that are actually failing CWV, while still
showing up to 15 pages whenever enough audited pages exist.

That means the selection is intentionally **not** pure traffic ranking and **not** pure
"worst score" ranking.

The product intent is:

- show the most important failing pages first
- keep the CWV opportunity populated for highly optimized sites
- avoid over-favoring ultra-low-traffic pages until they are needed as a last resort

## Selection Rules

`buildPrioritizedCWVAuditResult()` in [cwv-audit-result.js](./cwv-audit-result.js) uses three buckets:

1. Failing entries
   These are entries where at least one CWV metric is above the "good" threshold:
   - `LCP > 2500`
   - `CLS > 0.1`
   - `INP > 200`

   Failing entries are sorted by `pageviews DESC`.

2. Passing entries with meaningful traffic
   If fewer than 15 failing entries exist, the audit pads with passing entries that have
   at least `1000` pageviews in the interval.

   These entries are sorted by:
   - closeness to failure threshold DESC
   - pageviews DESC

   "Closeness" is the maximum normalized pressure of the available metrics:
   - `lcp / 2500`
   - `cls / 0.1`
   - `inp / 200`

   So a page at `LCP=2490` is considered closer to failing than a page at `LCP=1800`.

3. Passing fallback entries
   If we still have fewer than 15 entries after the first two buckets, the audit fills the
   remainder with the rest of the passing entries, using the same closeness-first sort.

The final selected list is:

1. all failing entries, ordered by traffic
2. then passing entries with `>= 1000` pageviews, ordered by threshold pressure then traffic
3. then the remaining passing entries, ordered by the same rule
4. truncated to the target count of 15

## Important Notes

- There is no homepage override.
  The homepage is treated like any other entry and only appears if it ranks into the selected set.

- Group entries and URL entries are both eligible.
  Ranking is based on the same pageview and metric rules for both.

- Passing entries are intentionally allowed into the result.
  They are not bugs by themselves; they are "near-failing" padding so the CWV opportunity
  remains useful for already optimized customers.

- Consumer UIs and downstream processors should not assume that every selected CWV entry has a
  threshold violation.
  That assumption was valid under older logic, but not under the current product rule.

- Downstream consumers should preserve the selected order.
  The worker already returns the opportunity list in its final priority order, so consumers
  should treat `auditResult.cwv` as ranked output rather than re-sorting it with their own rules.

- The UI can legitimately receive suggestions with `totalIssues === 0`.
  Those suggestions represent intentional passing-padding entries and should remain visible.

- This logic is meant to balance:
  - customer-visible actionability
  - product desire to always show a sufficiently populated CWV opportunity
  - avoidance of surfacing ultra-low-traffic pages too early

## End-to-End Flow

1. `collectCWVDataAndImportCode()` in `handler.js`
   calls `buildPrioritizedCWVAuditResult()` and persists the selected CWV entries in the audit result.

2. `syncOpportunityAndSuggestionsStep()` in `handler.js`
   calls `syncOpportunitiesAndSuggestions()` to create/update:
   - one CWV opportunity
   - one suggestion per selected CWV entry

   This stage intentionally carries passing-padding entries forward exactly as selected.

3. `processAutoSuggest()` in `auto-suggest.js`
   only sends URL-type suggestions that still need guidance to Mystique.

This means the selection logic in `cwv-audit-result.js` determines the raw set of CWV entries
that every downstream consumer sees first.

## Example

If a site has:

- 4 failing entries
- 6 passing entries with `>= 1000` pageviews
- 20 additional passing entries under `1000` pageviews

then the selected result will contain:

- the 4 failing entries first
- then the 6 higher-traffic passing entries
- then the top 5 sub-1k passing entries by threshold pressure

for a total of 15 entries.

## Why This Exists

We previously had conflicting expectations:

- one requirement wanted only pages with actual CWV issues
- another wanted at least 15 pages shown, even for highly optimized sites

This ranking resolves that tension by ensuring:

- failing pages are always shown first
- passing pages only appear as padding
- passing padding prefers pages that are both near failing and meaningful in traffic
- very low-traffic passing pages only appear when they are needed to fill the list

## Developer Checklist

When updating this flow in the future, verify these invariants together:

- `cwv-audit-result.js` still ranks failing entries before all padding entries
- passing padding still prefers `>= 1000` pageview entries before sub-1k fallback entries
- downstream consumers do not drop zero-issue padding suggestions
- tests cover both ranking buckets and the fallback bucket
- README and JSDoc still describe the same rule the code implements
