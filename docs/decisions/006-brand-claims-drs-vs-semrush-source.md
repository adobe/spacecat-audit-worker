# 006 — Brand-Claims Trigger: Per-Site DRS-Sheet vs Semrush-Feed Source Decision

- **Status:** Accepted
- **Date:** 2026-08-28
- **Related:** spec `docs/specs/2026-08-11-brand-claims-scheduled-trigger.md` · ADR
  `docs/decisions/002-offsite-cited-urls-semrush-source.md` (the offsite Semrush source swap
  whose entitlement + override machinery this reuses) · [LLMO-7177](https://jira.corp.adobe.com/browse/LLMO-7177)

## Context

The `brand-claims` audit (spec `2026-08-11-brand-claims-scheduled-trigger.md`) is a per-site
weekly trigger that publishes the DRS `BRAND_PRESENCE_SHEET_WRITTEN` ready-signal so the
mystique Brand Claims consumer runs. It was written entirely around the DRS Brand-Presence
`.xlsx`: it lists S3 for the brand's latest sheet and points the event at that `s3_key`.

For **Semrush-backed** brands there is no BP sheet — the citation data lives in the
Semrush URL-Inspector feed (the same source the `offsite-brand-presence` audit migrated to;
see ADR 002). The mystique consumer already needs to pick an ingest source per brand, and it
was doing so from a **process-wide env var**, which cannot express a per-site decision. The
agreed design is that the **audit-worker trigger** — which already resolves the site, org, and
brand — makes the per-site DRS-vs-Semrush call and **stamps it on the existing event**, so the
consumer sources the right feed without a second source-selection mechanism. Same queue, same
event type, backward-compatible.

## Decision

1. **The trigger decides the source per site and carries it on the event.** The decision is
   made in `src/brand-claims/handler.js`, not in the consumer. The existing
   `BRAND_PRESENCE_SHEET_WRITTEN` event is extended additively (Decision 4) rather than adding
   a new event type or a second queue — Mystique reads one field to route.

2. **Semrush is chosen only when ENABLED **and** ENTITLED; everything else falls back to DRS.**
   - *Enabled:* env `BRAND_CLAIMS_SEMRUSH_ENABLED=true`, or the per-run Slack override
     `enableSemrush` (`auditContext.messageData.enableSemrush`, resolved by the shared
     `resolveEnableSemrush`). Tri-state: an explicit override wins over the env var; absent/
     invalid falls through to the env var. This mirrors ADR 002 Decision 7 exactly — the same
     mechanism, reused, so behavior is identical to the offsite audit an operator already knows.
     (Unlike ADR 002 Decision 1 there is **no hard-stop** variant here: a `brand-claims` run
     that can't use Semrush must still publish *something* for the enabled site, and the DRS
     sheet is a safe, already-written fallback — so every non-Semrush outcome, including an
     explicitly-forced-on run that then fails entitlement, degrades to DRS.)
   - *Entitled:* `resolveSemrushEntitlement` (`src/utils/semrush-entitlement.js`) — the shared
     "serenity feature flag AND resolvable Semrush workspace" gate from ADR 002 Decision 8,
     reused verbatim. Fail-closed: a confirmed non-entitlement (`flag_disabled` / `no_workspace`)
     **and** an inconclusive check (`no_client` / `check_failed`) both fall back to DRS.
   - The gate runs **before** any Semrush-specific work; on the DRS path the entitlement check
     is never called (no wasted PostgREST round trip on the common case).

3. **The Semrush branch skips the S3 sheet lookup entirely.** There is no sheet for a
   Semrush-backed brand, so the branch does not build the `{siteId}/{brandSlug}/analytics/…`
   prefix or list S3. It derives only the `(week, year)` run window (see Decision 5); no other
   per-branch input is needed, because the feed is routed downstream from identity already on
   the event (Decision 4a).

4. **Additive event contract: `ingest_source` on both branches, no `domain`.**
   `ingest_source` is **optional with default `brand_presence_s3`** (an absent value means DRS,
   so a pre-7177 consumer is unaffected), but the trigger now stamps it **explicitly on both
   branches** (`brand_presence_s3` / `semrush_feed`) so the consumer never has to infer it.
   Sheet-scoped fields diverge by branch: the DRS branch sets `sheet_date`/`s3_bucket`/`s3_key`
   from the resolved sheet; the Semrush branch sets all three to `null` (no sheet). All other
   fields (`organization_id`, `brand_id`, `brand`, `site_id`, `platform`, `parent_job_id`,
   `batch_id`) are identical across branches. The DRS branch's pre-existing fields are otherwise
   unchanged — no regression to the sheet-selection path.

4a. **No `domain` on the event (mysticat-architecture#248 correction).** An earlier revision
   stamped a registrable `domain` (the brand primary site's apex host) on the Semrush branch.
   This was dropped: `domain` is a per-**market** concept — each market of a brand has its own
   domain, and the brand itself has none — so a single brand-primary-site domain mis-binds a
   multi-market brand. It is also unnecessary: the downstream Serenity proxy resolves the
   workspace / project / market from `organization_id` + `brand_id`, both already stamped on the
   event. The domain-derivation helper and its "no parseable base URL → fall back to DRS" branch
   were removed with it; an entitled brand now always emits the `semrush_feed` event regardless
   of its base URL.

5. **The Semrush `(week, year)` is a replay-stable run window, not the wall clock.** The DRS
   branch reads immutable sheet metadata (`week`/`year` parsed from the sheet filename); the
   Semrush branch has no such artifact. Deriving it from `isoCalendarWeek(new Date())` at emit
   time would mean a retry / DLQ redrive that crosses the UTC ISO-week boundary re-emits a
   **different** `(week, year)` for the same logical run (a duplicate bucket downstream). So the
   branch accepts an explicit `week`+`year` from `auditContext.messageData` (tri-state, both
   must be present and in range to win — bounded to week 1–53, year 2000–9999), defaulting to
   the current ISO week only when no valid explicit window is supplied. A scheduler/redrive can
   pin the window; an ad-hoc run gets today's week.

6. **The source decision runs before the `brandSlug` guard.** The empty-`brandSlug` guard
   (brand name sanitizes to nothing) is a DRS-only precondition — it can't address an S3 sheet
   prefix. The Semrush feed carries no brand-slug path component (org+brand identity routes it
   downstream), so the guard is now scoped to the DRS branch: a Semrush-entitled brand with an
   empty slug still runs on the feed path (the event's `brand` field is the empty slug, which
   the identity-routed consumer ignores). The DRS path behavior is unchanged.

## Consequences

- One event type, one queue, one consumer-side router (`ingest_source`). Adding a third source
  later is another `ingest_source` value + branch, not new infrastructure.
- `BRAND_CLAIMS_SEMRUSH_ENABLED` is **environment-global** (like `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED`
  in ADR 002); true per-site cutover is a follow-up. The per-run `enableSemrush` override is
  the tool for testing one run against the real entitlement/feed path before flipping the env
  var. The entitlement gate already narrows the env-global flag to only provisioned brands, so
  turning it on fleet-wide degrades gracefully to DRS for every non-entitled site.
- The consumer routes the Semrush feed from `organization_id` + `brand_id` alone; the event
  carries no market/domain, so a multi-market brand is not pinned to a single primary-site
  domain by this trigger.
- The fallback-to-DRS-on-any-doubt policy means a Semrush misconfiguration is **silent** in the
  event stream (it just looks like a DRS run). The granular reason is logged
  (`not Semrush-entitled (reason=…, resolved=…)`) for whoever watches logs; there is no
  dedicated alert (consistent with ADR 002 Decision 8c).

## Alternatives Considered

- **Consumer-side env source selection (status quo).** Rejected: a process-wide env var can't
  make a per-site call, which is the whole requirement — the trigger already has the site/org/
  brand context to decide.
- **A new event type or a second queue for Semrush.** Rejected as disproportionate: the
  consumer already keys off one event; an additive `ingest_source` field routes it with no new
  infrastructure and keeps the DRS path backward-compatible.
- **A hard-stop (no DRS fallback) when `enableSemrush:true`, mirroring ADR 002 Decision 1.**
  Rejected for `brand-claims`: the offsite audit hard-stops so a canary Semrush failure is
  *visible* rather than masked by legacy data, but this trigger's job is to publish a
  ready-signal for an enabled site — failing closed with no event is worse than falling back to
  the (already-written, correct) DRS sheet. Visibility is via logs, not a withheld event.
- **Deriving the Semrush `(week, year)` from the wall clock.** Rejected: not replay-stable
  across the ISO-week boundary (Decision 5).
