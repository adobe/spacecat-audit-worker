# Preflight Links — "Unverifiable" Result Category

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Chris Lotton |
| **Created** | 2026-05-19 |
| **Jira** | [SITES-44776](https://jira.corp.adobe.com/browse/SITES-44776) |
| **Related** | [PR #2476](https://github.com/adobe/spacecat-audit-worker/pull/2476) (the proximate cause), [SITES-40919](https://jira.corp.adobe.com/browse/SITES-40919) (the previous unreachable-handling fix), [SITES-35543](https://jira.corp.adobe.com/browse/SITES-35543) (non-HTTP / auth-header work) |
| **Companion PR (MFE)** | TBD — see [Cross-repo coordination](#cross-repo-coordination-mfe-side) |

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. The MFE coordination is a hard gate on rollout — do not flip the SAW behavior in prod without confirming the MFE render path is in place (see Rollout section).

---

## Summary

The preflight `links` audit currently reports any link returning `status: 0` (network error — DNS failure, timeout, connection refused) as broken. After [PR #2476](https://github.com/adobe/spacecat-audit-worker/pull/2476) landed, this began surfacing corp-network-only domains as broken links — e.g., Walmart's intranet timekeeping URL `timesheet.wal-mart.com/...`. Authors on those tenants see false-positive "broken link" warnings on legitimate internal services.

This spec introduces a third audit-result category — **unverifiable** — for links that could not be probed for understandable reasons (DNS failure, timeout, connection refused). The MFE renders these distinctly from "broken" with copy along the lines of *"could not verify (may require authentication or corporate network)"*. The author recognizes the link as their internal service and dismisses without confusion; genuinely broken external links continue to surface as before.

---

## Background

### Lauren's report (SITES-44776)

Page: `author-p149513-e1547919.adobeaemcloud.com/.../content/uswire/en_us.html` (Walmart corporate intranet authoring environment). Preflight flags 14 links as broken; all 14 are corp-network-only Walmart services that don't resolve from public DNS or are firewalled from public networks:

```
baletracker-wrcloud.wal-mart.com
gta-associateinformationlineweb.prod.walmart.net
internal.walmart.com/content/passport/intl-home.html
lossprevention-prod.wal-mart.com
mygnfr.walmart.com
nabpm.cloud.wal-mart.com
outlook.wal-mart.com/owa/wal-mart.com
productremovalwr-prod.wal-mart.com
radapps3.wal-mart.com
stores.tableau.wal-mart.com
timesheet.cloud.wal-mart.com
timesheet.wal-mart.com
workforce-planning-portal.us-walmart.prod.polaris.walmart.com
workvivo.walmart.com
```

All 14 are reaching the `catch (finalErr)` block in `src/preflight/links-checks.js`, which since PR #2476 returns `{ status: 0 }` reported as broken.

### Why this happens

The preflight link checker runs from AWS Lambda. From there:
- Corp-internal DNS records don't resolve → `ENOTFOUND` / `EAI_AGAIN`
- Firewalls drop packets to internal services → `ETIMEDOUT` / `ECONNRESET`
- Or refuse connections at the edge → `ECONNREFUSED`

Pre-#2476, the network-error path silently dropped these. PR #2476 (correctly) classified genuinely unreachable links as broken to fix the legitimate `gta-associateinformationlineweb.prod.walmart.net` case in SITES-40919. The Walmart bug is the trade-off side of that fix: corp-network-only domains now look identical to genuinely-dead links.

### What HEAD/GET *can* distinguish today

Reachable-but-auth-gated patterns are already handled correctly:
- 401 / 403 — in `HEAD_FALLBACK_STATUSES`; not classified as broken
- 302 → SSO login page — followed by `fetch()`; resolves to login page 200; not broken
- 5 `pfedprod.wal-mart.com/idp/startSSO.ping?...` URLs on Lauren's example page are not in the broken count, confirming this

The gap is specifically: **network-level failure**, where the audit has no signal beyond "couldn't reach it."

---

## Goals and Non-Goals

### Goals

- Stop reporting corp-network-only / firewalled external links as broken when they're more accurately *unverifiable*.
- Preserve the existing broken-link signal for genuinely dead external links (404 / 410 / 5xx, and definitive unreachability the team explicitly opts in to flagging).
- Surface enough diagnostic context (DNS failure vs. timeout vs. connection refused) for authors to make a fast judgment call.
- Land a wire-format change that's backward-compatible with the current MFE (existing fields preserved; new fields additive).

### Non-Goals

- Per-tenant allow-lists of "expected unreachable" domains (heavier infra, not needed if the unverifiable category lands).
- Reverting #2476 — it correctly handles genuinely broken externals; this work refines it.
- Authenticated link probing (not feasible from Lambda without per-customer credentials).
- Internal-link unverifiability — AEM author URLs we control should resolve from our infrastructure. Treat internal-link network errors as broken (preserved current behavior).

---

## Proposed Solution

### The three-category model

| Category | Trigger | Current behavior | Proposed behavior |
|---|---|---|---|
| **OK** | 2xx, 3xx, 401, 403, 405, 429, 451 | not reported | unchanged |
| **Broken** | 404, 410, 5xx (after HEAD + GET fallback) | reported via `brokenExternalLinks` / `brokenInternalLinks` | unchanged |
| **Unverifiable** | Network error (`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`, etc.) | reported via `brokenExternalLinks` w/ `status: 0` (post-#2476) | reported via NEW `unverifiableExternalLinks` w/ `code` and `message` |

> **Historical records:** Existing audit records retain the pre-cutover `status: 0` classification in `brokenExternalLinks`; no backfill is planned. Consumers aggregating broken-link counts over time will see a step-down at the cutover date as previously-flagged corp-network links move to `unverifiableExternalLinks`.

### Wire format change

The preflight audit envelope today contains opportunity entries keyed by `check`:

- `check: 'broken-internal-links'` — unchanged
- `check: 'broken-external-links'` — `status: 0` entries move out of here

Add a new opportunity entry. **Matches the shape of the existing `broken-internal-links` / `broken-external-links` opportunities** (see `src/preflight/links.js` for the assembly): `{ check, issue: [...] }` where `issue` is the array of per-link entries. The per-entry field names mirror what links.js emits today for broken links (`url` not `urlTo`; per-link `issue` string; per-link `seoImpact` / `seoRecommendation` / `elements`).

- `check: 'unverifiable-external-links'` — new
- `issue: [...]` — array of per-link entries. Each entry carries:
  - `url` — the unverifiable URL (handler.js performs the `urlTo` → `url` rename for broken links today; same here)
  - `issue` — short per-link summary, e.g. `"Could not verify"` (parallel to the existing `"Status 404"` string for broken)
  - `code` — machine-readable reason (`dns-failure`, `connection-refused`, `timeout`, `tls-error`, `unreachable`)
  - `message` — human-readable explanation suitable for MFE display
  - `seoImpact: "Low"` — not broken, informational
  - `seoRecommendation` — short copy directing the author to review
  - `elements` — per-link CSS selectors (per the existing broken-link wire format — produced by `toElementTargets(selectors)` in `src/preflight/utils/dom-selector.js`)

Example opportunity entry on the audit envelope:

```json
{
  "check": "unverifiable-external-links",
  "issue": [
    {
      "url": "https://timesheet.wal-mart.com/gtaapp/etm/defaultHomePage/welcomePage.jsp",
      "issue": "Could not verify",
      "code": "dns-failure",
      "message": "DNS lookup failed — may require corporate network or authentication",
      "seoImpact": "Low",
      "seoRecommendation": "Review whether this link needs to remain. It may require authentication or be on a private network.",
      "elements": [{ "selector": "div > p > a:nth-of-type(2)" }]
    }
  ]
}
```

### Reason taxonomy

`classifyNetworkError(err)` maps Node error codes to a `(code, message)` pair:

| `err.code` | `code` | `message` |
|---|---|---|
| `ENOTFOUND`, `EAI_AGAIN` | `dns-failure` | "DNS lookup failed — may require corporate network or authentication" |
| `ECONNREFUSED` | `connection-refused` | "Connection refused — may require corporate network or VPN" |
| `ECONNRESET` | `connection-reset` | "Connection was reset — the server or an intermediary forcibly closed the connection" |
| `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT` | `timeout` | "Request timed out — may require authentication or corporate network" |
| `CERT_HAS_EXPIRED`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, etc. | `tls-error` | "TLS verification failed — server certificate may be misconfigured" |
| anything else | `unreachable` | "Could not reach the URL — server may be temporarily unavailable" |

---

## Alternatives Considered

### A. Per-tenant allow-list of "expected unreachable" domains

Walmart configures domains to ignore for unreachability. **Rejected**: shifts judgment to a config that no one will maintain; requires customer-facing toolchain; doesn't help customers who haven't built an allow-list yet.

### B. Revert #2476 for external links only

Restore the pre-fix silent-drop behavior for `status: 0` on externals. **Rejected**: loses the legitimate broken-external signal we just gained (the SITES-40919 case). Trades one bug for another.

### C. Distinguish DNS-failure from other unreachability, treat DNS-failure as informational only

Partial fix only — timeouts and connection-refused from corp firewalls would still surface as broken. The "unverifiable" category handles all three failure modes uniformly.

### D. Three-category model (this spec)

✅ Selected. Preserves broken-link signal, eliminates corp-network false positives, gives authors actionable context per failure mode.

### What would change this decision

- If the MFE team determines the third-category render path is too costly, fall back to Alternative C (DNS-failure-only informational, timeouts/refused stay broken — Walmart partially fixed, other corp networks unchanged).
- If a future audit framework introduces a generic "audit result severity" enum that supersedes the per-check-type categorization, this categorical approach should fold into it.

---

## Cross-Repo Coordination (MFE Side)

> **This is a wire-format change with a hard MFE dependency.** The SAW emission must not be enabled in production until the MFE supports the new `check` type. See [Rollout](#rollout-and-cutover-plan) for the gating mechanism.

### What the MFE must do

- New render path for `check: 'unverifiable-external-links'` in the preflight audit panel.
  - Different visual treatment from "broken" — yellow / info color, not red.
  - Different copy — "Could not verify" not "Broken link."
  - Per-entry rendering: show `url` + `message` (one line); preserve link-to-edit-context affordances same as broken links.
  - Optional dismiss / acknowledge affordance per entry (nice to have, not blocking).
- Graceful fallback for the new wire field on older MFE deploys (see [Backward compatibility](#backward-compatibility) below).

### MFE-side companion PR

- **Repo**: `aem-sites-optimizer-preflight-mfe`
- **Owner**: TBD — needs assignment ([open question 2](#open-questions))
- **Tracker**: TBD — file as companion ticket under SITES-44776 or as a follow-up

This SAW spec will be updated with the MFE PR link once it exists.

### Backward compatibility

Worth confirming with the MFE team:

- **Q**: When the current MFE encounters an unknown `check` type in the opportunities array, does it (a) ignore it, (b) render it via a default fallback, or (c) error?
- If (a) or (b) — the SAW change can ship gradually before the MFE catches up; authors will see partial behavior (still safer than the current state, since fewer "broken" entries will reach their UI).
- If (c) — the SAW change MUST gate behind a feature flag until the MFE PR ships.

Default assumption (verify): the MFE iterates opportunities and renders by recognized check type, ignoring unknown — but **this is a hard dependency to confirm before merging the SAW PR**.

---

## File Inventory

### Modify

- `src/preflight/links-checks.js` — add `classifyNetworkError`, restructure the catch block, return new buckets from `runLinksChecks`
- `src/preflight/links.js` — emit the new `unverifiable-external-links` opportunity entry (this is where `broken-external-links` assembly lives today; the analogous new-bucket assembly goes here)
- `test/preflight/links-checks.test.js` — new test cases for each error code category

### Add

- (none — all changes are localized to existing files)

### Possibly Modify (TBD pending MFE decision)

- `src/preflight/handler.js` — feature flag (env var) to gate the new behavior, if MFE backward compatibility requires it

---

## Implementation Tasks

### Task 1: Add the `classifyNetworkError` helper + tests

- [ ] Add `classifyNetworkError(err)` to `src/preflight/links-checks.js` mapping Node error codes per the [Reason taxonomy](#reason-taxonomy) table.
- [ ] Add unit tests in `test/preflight/links-checks.test.js` covering each `err.code` branch + the "anything else" fallback.
- [ ] Verify: `npm run test:spec -- test/preflight/links-checks.test.js` passes.

### Task 2: Update `checkLinkStatus` to return categorized failure objects

- [ ] In the `catch (finalErr)` block of `checkLinkStatus`, call `classifyNetworkError(finalErr)` and return an object with `status: 0`, `category: 'unverifiable'`, `code`, `message`, `urlTo`, `href`, and the spread of `toElementTargets(selectors)` (i.e. the `elements` array, matching the broken-link wire format). Note: the function returns `urlTo` internally; `links.js` performs the `urlTo` → `url` rename when assembling the opportunity entry, same as for broken links today. **This enriched shape is returned unconditionally** — the feature flag (Task 5) is consulted by `runLinksChecks` when deciding how to bucket the result, not by `checkLinkStatus` when building it.
- [ ] Preserve the existing log line; consider lowering severity from `info` to `debug` for `unverifiable` since these are now expected.
- [ ] Update tests to assert the new return shape on each error code.

### Task 3: Update `runLinksChecks` to bucket results

- [ ] Split the result accumulators into `brokenExternalLinks`, `unverifiableExternalLinks`, and `brokenInternalLinks`. Per [non-goals](#non-goals), internal-link unverifiability stays as broken — no `unverifiableInternalLinks` bucket.
- [ ] Update the return object signature.
- [ ] Update tests to assert each bucket.

### Task 4: Emit the new opportunity entry in the handler

- [ ] In `src/preflight/links.js`, where the `broken-external-links` opportunity entry is assembled today (lines ~183–188), add the analogous assembly for `unverifiable-external-links` populated from `unverifiableExternalLinks`.
- [ ] Match the existing opportunity-object shape: `{ check, issue: [...] }` with per-link entries containing `url`, `seoImpact`, `seoRecommendation`, `elements`.
- [ ] Update tests to assert the new opportunity appears in the envelope when unverifiable links are present, and is absent (or empty) when none are.

### Task 5: Feature flag (conditional on MFE backward compat)

- [ ] Confirm MFE backward-compat behavior — see [Cross-repo coordination](#cross-repo-coordination-mfe-side).
- [ ] If MFE handles unknown check types gracefully: skip flag.
- [ ] If MFE errors on unknown check types: add `PREFLIGHT_LINKS_UNVERIFIABLE_ENABLED` env var, and make `runLinksChecks` consult it BEFORE splitting the buckets:
  - When the flag is **on**: split as Task 3 describes — `unverifiableExternalLinks` becomes its own bucket; `links.js` emits the new `unverifiable-external-links` opportunity entry.
  - When the flag is **off**: `checkLinkStatus` still returns the enriched shape (with `category`, `code`, `message`) as described in Task 2 — it always enriches. `runLinksChecks` skips the bucket split: it routes every result with `category: 'unverifiable'` into `brokenExternalLinks` instead of `unverifiableExternalLinks`, and leaves `unverifiableExternalLinks` empty. `links.js` doesn't emit the new opportunity entry because `unverifiableExternalLinks` is empty. This restores post-#2476 behavior for the MFE exactly — the enriched fields travel internally but don't affect the wire format.
- Rationale: the split happens at `links-checks.js`, before `handler.js` ever sees the buckets. Trying to merge them back in `handler.js` would be more invasive (and would still emit the new check type in the envelope even when flag-off, which the MFE may not handle). Gating at the producer is the cleaner fallback path.

### Task 6: Tests, lint, coverage

- [ ] `npm test` passes with 100% coverage maintained.
- [ ] `npm run lint` passes.
- [ ] Unit tests in `test/preflight/links-checks.test.js` cover the Walmart-domain cases that motivated this spec: every `err.code` value in the [reason taxonomy](#reason-taxonomy) table — `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, plus at least one TLS cert error — produces the expected `(code, message)` and routes the link to `unverifiableExternalLinks`. Use `nock` to simulate each error.

---

## Rollout and Cutover Plan

1. **Spec PR merges** (this doc).
2. **SAW implementation PR opens** — referencing this spec. Code change behind a feature flag if Task 5 determines one is needed.
3. **MFE companion PR opens** in `aem-sites-optimizer-preflight-mfe` — adds render path for `unverifiable-external-links`.
4. **MFE PR merges + deploys** to prod (or stage with verification).
5. **SAW PR merges**. If feature-flagged, flag remains off in prod. **If no feature flag was needed (Task 5)**, the SAW PR must not merge until step 4 (MFE deploy) is confirmed live — otherwise prod will emit a `check` type the MFE doesn't know how to render.
6. **Verification on stage** — Lauren's example page (or equivalent staged repro): confirm the 14 corp-only domains now render as "unverifiable," not broken.
7. **Enable in prod** (flip flag or roll deploy) once MFE is confirmed live.
8. **Customer ack**: notify SITES-44776 reporter (Lauren) with link to test against; close the ticket once confirmed in their environment.

**Hard gate**: do not let the SAW PR's emission reach prod before the MFE renders correctly. If the feature flag is in use, leave it off until step 7.

---

## Verification (Lauren's Case)

The fix is successful when:

- The Walmart example page reproduces with 0 entries in `brokenExternalLinks` (down from 14), and 14 entries in `unverifiableExternalLinks`.
- Each unverifiable entry has a populated `code` and `message` that the author can read.
- The MFE renders the 14 as a clearly-distinct "could not verify" group, visually separable from any genuinely broken links elsewhere on the page.
- Lauren acknowledges the new presentation as acceptable.

---

## Open Questions

1. **MFE backward compatibility on unknown `check` types** — does the current MFE silently ignore, fall back to default render, or error? This determines whether a feature flag is needed (Task 5).
2. **MFE-side owner** — who picks up the companion PR in `aem-sites-optimizer-preflight-mfe`?
3. **Customer-facing copy** — the `message` strings above are first-draft. Worth a content review pass before the MFE renders them.

---

## Future Work

- If multiple audits (headings, accessibility, etc.) adopt the "unverifiable" pattern, lift this from a per-audit spec into a platform-level architectural document in `mysticat-architecture/platform/`.
- When the links audit migrates to the Mysticat blackboard, the data model needs to carry `category`, `code`, and `message` per link from day one. Reference this spec from whatever migration profile gets filed for the `links` audit.
