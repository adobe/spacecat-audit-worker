# CWV Autofix — `spacecat-audit-worker` Role

This repo owns **Stage 1** of the cross-repo CWV autofix chain. The full E2E flow lives in mystique:

> **[CWV Autofix — End-to-End Flow](https://git.corp.adobe.com/experience-platform/mystique/blob/main/docs/opportunities/cwv/e2e-flow.md)** (the hub doc — read this first if you're new to the flow)

The chain spans four repos:

1. **`spacecat-audit-worker`** (this repo) — runs the CWV audit, persists the opportunity, triggers the chain
2. [`spacecat-import-worker`](https://github.com/adobe/spacecat-import-worker) — mirrors the customer's source code into S3 (parallel branch, fanned out by Step 1 of this audit)
3. [Mystique](https://git.corp.adobe.com/experience-platform/mystique) — generates guidance text + a code patch via two separate tasks
4. [`spacecat-autofix-worker`](https://github.com/adobe/spacecat-autofix-worker) — opens a GitHub Issue + PR carrying the patch

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
- Status is `NEW`
- No guidance has been written yet
- `type: 'url'` (group-type suggestions are skipped)
- The site has `cwv-auto-suggest` enabled in `Configuration`

## Feature flags (per site, in `Configuration`)

| Flag | Effect |
|---|---|
| `cwv-auto-suggest` | gates whether the `guidance:cwv` SQS message is sent at all |
| `cwv-auto-fix` | gates whether `codeBucket` / `codePath` are included (so Mystique can do a code fix, not just guidance) |

Both flags are checked in this repo. The autofix-worker also checks `cwv-auto-fix` independently — both must be enabled for the chain to complete.

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
