# CWV Autofix — `spacecat-audit-worker` Role

This repo owns **Stage 1** of the cross-repo CWV autofix chain. The full E2E flow lives in mystique:

> **[CWV Autofix — End-to-End Flow](https://git.corp.adobe.com/experience-platform/mystique/blob/main/docs/opportunities/cwv/e2e-flow.md)** (the hub doc — read this first if you're new to the flow)

The CWV chain currently spans four repos:

1. **`spacecat-audit-worker`** (this repo) — runs the CWV audit, persists the opportunity, triggers the chain
2. [`spacecat-import-worker`](https://github.com/adobe/spacecat-import-worker) — mirrors the customer's source code into S3 (parallel branch, fanned out by Step 1 of this audit)
3. [Mystique](https://git.corp.adobe.com/experience-platform/mystique) — generates guidance text + a code patch via two separate tasks
4. [`spacecat-autofix-worker`](https://github.com/adobe/spacecat-autofix-worker) — opens a GitHub Issue + PR carrying the patch

**Adjacent (not currently in the CWV path):** [`spacecat-content-scraper`](https://github.com/adobe/spacecat-content-scraper) — see ["Adjacent: `spacecat-content-scraper`"](#adjacent-spacecat-content-scraper) below.

## What this repo does

The CWV audit is a 2-step `StepAudit` registered as audit type `cwv` ([`src/cwv/handler.js`](../src/cwv/handler.js), registered in [`src/index.js`](../src/index.js)):

**Step 1 — `collectCWVDataAndImportCode`** ([`src/cwv/handler.js`](../src/cwv/handler.js)):
- Builds the prioritized CWV audit result from RUM (failing pages first, padded with passing entries) — see [`src/cwv/cwv-audit-result.js`](../src/cwv/cwv-audit-result.js)
- Returns `{ type: 'code', siteId, allowCache: false }` to the `IMPORT_WORKER` step destination, which **fans out to [`spacecat-import-worker`](https://github.com/adobe/spacecat-import-worker)** to mirror the customer repo into S3 in parallel

**Step 2 — `syncOpportunityAndSuggestionsStep`** ([`src/cwv/handler.js`](../src/cwv/handler.js)):
- Creates Opportunity (type `cwv`) + Suggestions (type `CODE_CHANGE`) — see [`src/cwv/opportunity-sync.js`](../src/cwv/opportunity-sync.js)
- [`processAutoSuggest`](../src/cwv/auto-suggest.js) sends one `guidance:cwv` SQS message **per eligible suggestion** to Mystique on `QUEUE_SPACECAT_TO_MYSTIQUE`

## Outbound message (this repo → mystique)

```json
{
  "type": "guidance:cwv",
  "siteId": "...",
  "auditId": "...",
  "deliveryType": "aem_cs",
  "time": "2026-05-07T...",
  "data": {
    "type": "cwv",
    "url": "https://example.com/page",
    "opportunityId": "...",
    "suggestionId": "...",
    "device_type": "mobile",
    "codeBucket": "...",
    "codePath": "code/{siteId}/{source}/{owner}/{repo}/{encodedRef}/repository.zip"
  }
}
```

`codeBucket` and `codePath` are only set when the per-site `cwv-auto-fix` flag is enabled — they tell Mystique where the import-worker mirrored the customer repo.

## Eligibility gate

A suggestion is sent to Mystique only when ALL of:
- Status is `NEW` **or** `PENDING_VALIDATION` (guidance must be generated for
  `PENDING_VALIDATION` so an SME has something to review before approving to `NEW` —
  gating on `NEW` deadlocked paid-tier sites, SITES-47558)
- No code patch has run yet (`isCodeChangeAvailable !== true`)
- For `PENDING_VALIDATION`: guidance is missing or in the legacy aggregated format
  (issues lack `source_index`) — avoids regenerating granular guidance every weekly audit
- `type: 'url'` (group-type suggestions are skipped)
- The site has `cwv-auto-suggest` enabled in `Configuration`

The outbound message carries `data.suggestionStatus` so Mystique gates code-fix
generation on SME approval (`NEW` → code-fix; `PENDING_VALIDATION` → guidance only).

## Feature flags (per site, in `Configuration`)

| Flag | Effect |
|---|---|
| `cwv-auto-fix` | gates whether `codeBucket` / `codePath` are included in the `guidance:cwv` message (so Mystique can do a code fix, not just guidance) |

> **Note (current behavior):** the CWV audit's `processAutoSuggest` **no longer re-checks**
> `cwv-auto-suggest` / `cwv-auto-fix` (see `src/cwv/auto-suggest.js`) — per-site enablement of
> the `cwv` audit is verified upstream via `isHandlerEnabledForSite('cwv', site)`
> (`src/common/audit-utils.js`), consistent with every other audit type. So disabling CWV for a
> site is done by disabling the `cwv` handler in `Configuration` (see the bow-out section below),
> not by flipping `cwv-auto-suggest=false`. The `spacecat-autofix-worker` still checks
> `cwv-auto-fix` independently to gate whether the Issue/PR is actually opened.

## Blackboard engine bow-out (`deliveryConfig.cwvEngine`)

Mystique is migrating CWV per-site off this legacy flow and onto its own blackboard
producer cascade (detection → guidance → autofix → verified projection). Both flows write
the **same** SpaceCat `type: "cwv"` opportunity + suggestion rows, so for a migrated site
exactly one flow must be authoritative or the rows collide/duplicate.

The switch is one field both systems read: `deliveryConfig.cwvEngine ∈ { "legacy"
(default/absent), "blackboard" }` (mirrors `altTextEngine` / `formsA11yEngine`). When
`cwvEngine === "blackboard"`, the CWV audit (`src/cwv/handler.js`) **bows out** at both steps:

- **Step 1 (`collectCWVDataAndImportCode`)** skips the RUM/PSI collection (nothing consumes the
  persisted `cwv` audit result — trend audits read RUM directly) and **resolves any pre-existing
  legacy `type:"cwv"` opportunity**, outdating its still-live (`NEW`/`IN_PROGRESS`) suggestions
  while preserving customer-/system-touched ones (`FIXED`/`SKIPPED`/`ERROR`). This is done in
  Step 1 because it always runs on the initial trigger (not gated on the import-worker
  round-trip). The import-worker hop itself is kept (its payload contract requires a valid
  `type`) — harmless for a migrated site; to skip the audit *entirely* (RUM + import + sync),
  disable the `cwv` handler for the site in `Configuration`.
- **Step 2 (`syncOpportunityAndSuggestionsStep`)** creates no opportunity/suggestion rows and
  sends no `guidance:cwv` message (defense-in-depth if reached).

Mystique's blackboard cascade then owns those rows for the site. The migration action is
flipping `cwvEngine`; flipping it back to `legacy` restores this flow on the next audit. The
full cross-repo contract, the projector-ownership rationale, and a duplicate-row detection
recipe live in Mystique's
`docs/opportunities/cwv/design-cwv-blackboard-migration.md` §9.4 (Spec 009-04 / ADR-0022).

## Key files

- [`src/cwv/handler.js`](../src/cwv/handler.js) — `StepAudit` definition (2 steps)
- [`src/cwv/auto-suggest.js`](../src/cwv/auto-suggest.js) — `processAutoSuggest`, sends `guidance:cwv` to Mystique
- [`src/cwv/opportunity-sync.js`](../src/cwv/opportunity-sync.js) — creates Opportunity + Suggestion records
- [`src/cwv/cwv-audit-result.js`](../src/cwv/cwv-audit-result.js) — builds the prioritized CWV result from RUM
- [`src/index.js`](../src/index.js) — `HANDLERS` map registration

## What happens next

After the message lands on `QUEUE_SPACECAT_TO_MYSTIQUE`, control passes to **[Mystique](https://git.corp.adobe.com/experience-platform/mystique)**, which runs:

- `GenerateCWVGuidanceTask` — produces markdown per metric (LCP / CLS / INP) and writes it back to `data.issues[].value` via the SpaceCat REST API
- `GenerateCWVCodeFixTask` — downloads the ZIP that the import-worker wrote, runs `CodeApplicationAndRegressionCrew` (CrewAI + `aider`), and writes the resulting unified diff back to `data.patchContent` (also via REST)

The patch is later applied by **[`spacecat-autofix-worker`](https://github.com/adobe/spacecat-autofix-worker)** when the user accepts the suggestion in the UI.

For the full picture (message schemas, S3 key shape, Mystique internals, verification recipe), see the [hub doc](https://git.corp.adobe.com/experience-platform/mystique/blob/main/docs/opportunities/cwv/e2e-flow.md).

## Adjacent: `spacecat-content-scraper`

This repo also fans out to [`spacecat-content-scraper`](https://github.com/adobe/spacecat-content-scraper) for **other** audits (accessibility, forms-opportunities, experimentation-opportunities, structured-data, preflight-accessibility, readability) via `AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER` — but **not from the CWV `StepAudit`**. The CWV audit's `StepAudit` only sends to `IMPORT_WORKER` (Step 1).

`content-scraper` registers a `cwv-labs` handler that could capture lab-measured CWV metrics (HAR, perf entries, LCP, CLS, long tasks under PSI throttling profiles), but no production code path here currently invokes it. Mystique's CWV guidance flow runs its own in-process Playwright collector instead. See the [hub's "Adjacent component" section](https://git.corp.adobe.com/experience-platform/mystique/blob/main/docs/opportunities/cwv/e2e-flow.md#adjacent-component-spacecat-content-scraper) and the [content-scraper spoke](https://github.com/adobe/spacecat-content-scraper/blob/main/docs/cwv-autofix-flow.md) for the gap analysis.
