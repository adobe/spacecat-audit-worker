# Security-Vulnerabilities — FixEntity-Aware Suggestion Lifecycle Reconcile

- **Status:** Implemented
- **Date:** 2026-09-02
- **Branch:** `feat/vulns-rescan-fixed-lifecycle`
- **Related:** [ADR 006 — rescan lifecycle](../decisions/006-security-vulnerabilities-rescan-lifecycle.md)
  (this spec supersedes several of its decisions — see *Doc updates*), `ASO/PHASES.md` §5/§10.
- **Jira:** vuln lifecycle (CWV parity: SITES-49306).

## Problem statement

Each vuln finding is two records with separate lifecycles: a **Suggestion** (customer-facing) and,
once an autofix PR exists, a **FixEntity** (the code change). **New learning that reframes this
work:** opening the autofix PR **is intended to set the Suggestion `FIXED`** while
`addFixEntities` stamps the FixEntity `PENDING`. So `PENDING` vs `DEPLOYED` on the FixEntity now
encodes the **verification level** of a `FIXED` suggestion — `FIXED + PENDING` = *asserted*,
`FIXED + DEPLOYED` = *scan-verified*. That is a legitimate intermediate state, not drift.

The vuln report is a scan of the **deployed AEM CS environment**, so a component **disappearing**
from a later scan is a production-grade "it's gone" signal. What is missing today:

1. Nothing reconciles the `FIXED`/FixEntity pair against later scans — an asserted `FIXED + PENDING`
   is never confirmed, a **regression** (verified-fixed vuln reappears) stays masked, and an
   asserted fix that never actually shipped masks a live vuln forever.
2. A **customer self-fix** — an open finding that disappears with **no** FixEntity because the
   customer bumped the dependency themselves — is currently aged to `OUTDATED`, losing both the
   "resolved" signal and any record of *how* it was fixed.
3. The current branch carries an **`IN_PROGRESS`-confirmation pass** that is dead under the
   PR-open→`FIXED` model (no vuln suggestion is ever `IN_PROGRESS`).

## Goals

1. A single reconcile pass owns **every** vuln Suggestion status transition on each scan, joining
   each Suggestion to its active FixEntity so the decision is **FixEntity-aware**.
2. **Confirm on rescan:** `FIXED + PENDING` whose vuln is **gone** → promote FixEntity
   `PENDING → DEPLOYED` (+ `deployedAt`); Suggestion stays `FIXED` (now verified).
3. **Regression:** `FIXED + DEPLOYED` whose vuln **returns** → archive the old Suggestion to
   `OUTDATED`, **open a fresh** `NEW` Suggestion for the live vuln, roll the FixEntity
   `DEPLOYED → ROLLED_BACK`.
4. **Stale assertion:** `FIXED + PENDING` still present past **30 days** → archive old Suggestion to
   `OUTDATED`, **open a fresh** `NEW` Suggestion, fail the FixEntity `PENDING → FAILED`.
5. **Customer self-fix:** an open finding (`NEW`/`PENDING_VALIDATION`) that disappears with **no**
   FixEntity → Suggestion `FIXED` **and create** a FixEntity capturing the change.
6. The self-fix FixEntity is stamped with a **new dedicated `origin` value** —
   `FixEntity.ORIGINS.CUSTOMER_SELF_FIX` (`'customer-self-fix'`), added to the shared model — so
   downstream (UI/metrics) can distinguish a customer self-fix from the existing producers
   (`spacecat` auto pipeline, `aso` manual UI create, `reporting`).
7. **Remove** the dead `IN_PROGRESS`-confirmation pass and the shared-engine hooks it required;
   `src/utils/data-access.js` returns to its `main` shape.
8. 100% coverage; ADR 006 revised to match.

**In scope beyond this repo:** one **additive** shared change — a new `FixEntity.ORIGINS` value
`customer-self-fix` (see *Shared-package dependency*).

**Non-goals:** changing the autofix worker (PR-open→`FIXED` is intended and lives in another repo);
any *other* shared-package/schema change; a backfill of rows written under the old semantics (the
reconcile handles them forward); CWV (sibling track — align, don't diverge).

## Technical design

### Entry point

`opportunityAndSuggestionsStep` (`src/vulnerabilities/handler.js`) calls
`syncVulnSuggestions(opportunity, newData, context, log)` on both paths: the vulns-present path and
the all-clear path (which passes `newData = []` so every finding "disappears"), after which the
opportunity is set `RESOLVED`.

### Two steps — reconcile first, then a status-neutral base sync

```
await reconcileVulnSuggestions(opportunity, newData, context, log); // owns ALL status changes
await syncSuggestions({                                             // create + data refresh ONLY
  opportunity, newData, context, buildKey,
  mapNewSuggestion: (e) => mapVulnerabilityToSuggestion(opportunity, e),
  mergeStatusFunction: () => null,   // no status changes — reconcile owns them
  log,
});
```

**Why `mergeStatusFunction: () => null` is required.** The default merge
(`data-access.js` `defaultMergeStatusFunction`) flips an existing `OUTDATED` suggestion whose key
**reappears** to `NEW`/`PENDING_VALIDATION` (a generic, non-FixEntity-aware regression heuristic),
and `ERROR → NEW`. In cases 3 & 4 the reconcile deliberately archives the old record to `OUTDATED`
*while its vuln is present* — the default merge would resurrect it and we would also have created
a fresh `NEW`, yielding two live records. Reconcile owns regression (FixEntity-aware), so the base
sync must make **no** status decisions. Its `OUTDATED` sweep is then a no-op, because reconcile has
already transitioned every disappeared open finding.

### The reconcile decision table

For each existing Suggestion, join it to its active FixEntity via
`FixEntity.getAllFixesWithSuggestionsByOpportunityId(opportunityId)` and note whether it has **any**
linked FixEntity. `present` = the Suggestion's key ∈ the current scan (`newData`).

| Suggestion status | FixEntity | Vuln in scan | Action |
|---|---|---|---|
| `NEW` / `PENDING_VALIDATION` | none | **gone** | **self-fix**: Suggestion → `FIXED`; **create** FixEntity (`DEPLOYED`, `origin = customer-self-fix`) |
| `NEW` / `PENDING_VALIDATION` | `PENDING` *(edge)* | **gone** | Suggestion → `FIXED`; promote FixEntity `PENDING → DEPLOYED` |
| `FIXED` | `PENDING` | **gone** | promote FixEntity `PENDING → DEPLOYED` (+ `deployedAt`); stays `FIXED` |
| `FIXED` | `DEPLOYED` | **gone** | no change (already verified-terminal) |
| `FIXED` | `DEPLOYED` | **present** | **regression**: old → `OUTDATED`; **create new** `NEW`/`PENDING_VALIDATION`; FixEntity `DEPLOYED → ROLLED_BACK` |
| `FIXED` | `PENDING`, fresh (<30d) | **present** | wait — no change |
| `FIXED` | `PENDING`, stale (≥30d) | **present** | old → `OUTDATED`; **create new** `NEW`/`PENDING_VALIDATION`; FixEntity `PENDING → FAILED` |
| any other | — | — | no change |

- **Staleness:** 30 days from `FixEntity.executedAt`, with `deployedAt` still empty.
- **Reopen / new-suggestion status:** `PENDING_VALIDATION` on `requiresValidation` sites, else `NEW`.
- **Fresh suggestion (cases 3 & 4):** built from the present vuln's canonical `newData` entry
  (matched by key) via `mapVulnerabilityToSuggestion`, pinned to the reopen status.

### Self-fix FixEntity + origin

`buildVulnFixEntityPayload(suggestion, opportunity, site)` builds a `DEPLOYED` `CODE_CHANGE`
FixEntity from the finding data (`library`, `current_version → recommended_version`,
`dependency_tree`), linked to the Suggestion, stamped with the new dedicated origin:

- `origin: FixEntity.ORIGINS.CUSTOMER_SELF_FIX` (`'customer-self-fix'`) — a **first-class field**,
  not a `changeDetails` convention. It sits alongside the existing producers `spacecat` (auto
  pipeline / autofix worker), `aso` (manual UI create), and `reporting`.
- The existing v1 freeform `changeDetails` (library/version) is unchanged; only the top-level
  `origin` is added, so a self-fix is distinguishable by a single field.
- Automated/ASO fixes keep their current `origin` (`spacecat`) — no change on that side.

### Shared-package dependency (additive, cross-repo)

Using a new origin value requires, in order:

1. **`spacecat-shared-data-access`** — add `CUSTOMER_SELF_FIX: 'customer-self-fix'` to
   `FixEntity.ORIGINS` (`src/models/fix-entity/fix-entity.model.js`). The `origin` schema attribute
   already validates against `Object.values(FixEntity.ORIGINS)`, so getter/setter and validation
   come for free. Publish a new package version.
2. **`mysticat-data-service`** — **only if** the `origin` column is a Postgres `enum`/`CHECK`
   (verify): add the value via a dbmate migration. A plain text column needs no DB change.
3. **this repo** — bump `@adobe/spacecat-shared-data-access` to the published version, then
   reference `FixEntity.ORIGINS.CUSTOMER_SELF_FIX`. Until the bump lands, saving a FixEntity with
   the new origin fails the schema's enum validation — so the shared change must be consumed first
   (or land in lockstep).

### Persistence & safety invariants (carried from the branch)

- **FixEntity before `FIXED`:** create/persist the FixEntity **before** flipping a Suggestion to
  `FIXED` (self-fix), so a `FIXED` is never left without a backing FixEntity; on any write failure,
  leave the Suggestion unchanged for the next audit to retry.
- **Reopen before fix transition (cases 3 & 4):** persist the Suggestion writes (old → `OUTDATED`,
  new `NEW`) **before** the FixEntity `ROLLED_BACK`/`FAILED` transition, so a trailing fix-save
  failure cannot strand a half-done reopen.
- **Fail-safe:** any error fetching the FixEntities skips the whole reconcile for that run rather
  than acting on incomplete data.
- **Idempotent on retry:** once a fix is `ROLLED_BACK`/`FAILED`/`DEPLOYED`, the `FIXED` record no
  longer matches a `PENDING`/`DEPLOYED`-driven case, so it will not re-fire; the base sync will not
  duplicate the fresh `NEW` (its key already exists). Use bulk `saveMany` / `addSuggestions` /
  `addFixEntities` — never per-row saves (CLAUDE.md N+1 rule).

### Removals (part a — strip the in-progress case)

- **`src/vulnerabilities/handler.js`:** drop the `syncSuggestionsWithPublishDetection` wiring and
  `promoteVulnFixEntities`; restore the plain `syncSuggestions` call (with the status-neutral merge
  above). Rename `reconcileFixedVulnSuggestions` → `reconcileVulnSuggestions` and extend it to own
  the open-finding self-fix rows too. Keep `buildVulnFixEntityPayload` (now used for self-fix, plus
  the source flag) and the staleness helpers.
- **`src/utils/data-access.js`:** revert to `main` — remove the `isReconcileCandidate` /
  `resolveFixEntities` parameters (added only to feed the removed pass) and the
  `'security-vulnerabilities'` entry in `AUTHOR_ONLY_OPPORTUNITY_TYPES` (only needed for the publish
  step that is no longer used). `syncSuggestionsWithPublishDetection` stays intact for its other
  consumers (backlinks, etc.).

### Doc updates

Revise **ADR 006** in the same change: D1 → PR-open lands `FIXED` (state the reality); drop the
`IN_PROGRESS` confirmation path; **reverse D2** — a disappeared open finding with no FixEntity →
`FIXED` + synthesized self-fix FixEntity (not `OUTDATED`); regression/stale → archive old to
`OUTDATED` + open fresh (not reopen-in-place); record the new `customer-self-fix` origin value;
refresh Consequences/Alternatives.

## Alternatives

- **Reopen the same record in place (`FIXED → NEW`).** Rejected — a returned vuln is a new finding;
  keep the old as a clean historical `OUTDATED` record and open a fresh one.
- **Leave the old record `FIXED` (two live records).** Rejected — archive to `OUTDATED` so exactly
  one record is live.
- **Let the base sync's default `OUTDATED → NEW` handle regression.** Rejected — not FixEntity-aware
  (cannot tell a regression from a not-yet-deployed assertion) and it races the archive/new split.
- **Keep the `IN_PROGRESS` confirmation pass.** Rejected — dead under PR-open→`FIXED`.
- **Mark a self-fix `OUTDATED` (old D2 / status quo).** Rejected — loses the resolved signal and the
  attribution the new FixEntity captures.

## Success criteria

- `npm test` green at the 100% line/branch/statement gate.
- Every row of the decision table has a test (present/gone × FixEntity state), plus: the all-clear
  (`newData = []`) path, the FixEntity-fetch-failure fail-safe, and the source flag on a self-fix.
- After any run, **no `FIXED` Suggestion lacks a backing FixEntity**.
- An archived `OUTDATED` record is **not** resurrected by the same run's base sync.
- A self-fix FixEntity carries `origin: 'customer-self-fix'`; automated/ASO fixes keep `spacecat`.
- The new `FixEntity.ORIGINS.CUSTOMER_SELF_FIX` value is published in `spacecat-shared-data-access`
  and consumed here (dependency bumped), with the DB migration applied if the `origin` column is
  enum-typed.
