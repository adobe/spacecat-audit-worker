# 006 — Offsite url-prompts enrichment (Semrush) + debug hardstop flag

- **Status:** Accepted
- **Date:** 2026-09-14
- **Story:** [LLMO-6712](https://jira.corp.adobe.com/browse/LLMO-6712) (per-URL prompt
  attribution) · builds on ADR [002](002-offsite-cited-urls-semrush-source.md) (Semrush
  domain-urls source + S2S auth) and the structured-logging taxonomy in ADR
  [002-logging](002-offsite-structured-logging-taxonomy.md) / [003](003-offsite-event-taxonomy-phase-boundaries.md).
- **Supersedes:** PR #2872's original design (raw-IMS-token auth on the ASO host), which
  predated the S2S session-token model and no longer loads against `main`.

## Context

The three offsite analysis audits (`cited-analysis`, `youtube-analysis`, `reddit-analysis`)
pull their URLs from the URL store and hand them to Mystique. LLMO-6712 wants each of those
URLs enriched with the **prompts that cited it**, sourced from the Semrush-backed Serenity
`url-inspector/url-prompts` endpoint (one request per URL, `platform=all` for a cross-engine
union). This is decoration layered on URLs the audit already has — not a data *source* like
the `domain-urls` call in ADR 002 — so it must never fail or alter the audit's URL set.

Two things had to be settled to land it on current `main`:

1. **Auth/routing.** ADR 002 replaced the old raw-IMS-token flow with an S2S session-token
   exchange (IMS mint → `/auth/s2s/login {imsOrgId}` → customer-scoped session token) on the
   LLMO edge under the `/api/v1` prefix, with a module-level token cache keyed by `imsOrgId`.
   The url-prompts loader must reuse that exact path — not re-implement it — or it would
   double-mint tokens and re-introduce the host/prefix bugs ADR 002 already fixed.
2. **A way to validate the endpoint cheaply.** Before spending downstream Mystique/DRS/LLM
   resources, we want to trigger a run that only exercises url-prompts and reports the result
   (success / failure counts) from inside audit-worker.

## Decision

### 1. Reuse the ADR-002 S2S auth via shared exports

`offsite-brand-presence-semrush.js` exposes three exports the url-prompts loader consumes, so
both loaders share one auth path, one session-token cache, and one host/prefix resolver:

- `resolveApiBaseUrl(env)` — LLMO host + `/api/v1` prefix.
- `getS2sSessionAuthorization({ context, imsOrgId })` — cached mint+exchange; throws with a
  `.reason` code (`ims_token_failed` / `session_token_auth_failed` / `session_token_failed`).
- `evictS2sSessionToken(imsOrgId)` — drop a stale token on a data-call `401/403`.

The loader resolves the customer `imsOrgId` itself (via `getImsOrgId`) and is **best-effort**:
any failure (no brand / no org / no IMS org / token failure / per-URL error) returns an empty
`Map` and the audit proceeds with un-enriched URLs. There is **no legacy fallback** here —
unlike the `domain-urls` source, there is no alternative prompt source, and enrichment is
optional metadata.

### 2. Enrichment gating: `enableSemrush` OR `enableSemrushWithHardstop`

Enrichment runs for an analysis audit when **either** Slack flag is set on the run:

- `enableSemrush` — runs enrichment, then the audit proceeds to Mystique normally.
- `enableSemrushWithHardstop` — runs enrichment, then **halts the audit before Mystique**
  (see §3).

Both are per-run `auditContext.messageData` overrides resolved by the same tri-state helper
(`resolveEnableSemrush` / `resolveEnableSemrushWithHardstop`). We deliberately did **not** gate
url-prompts on the `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` env var (which controls the
`domain-urls` *source* in the `offsite-brand-presence` audit): coupling a fleet-wide env flag to
a debug hardstop would halt every analysis before Mystique the moment it was flipped. Keeping
both switches as explicit per-run Slack flags keeps the blast radius to the one run you trigger.

### 3. `enableSemrushWithHardstop` is a debug hardstop, reported as a failed audit

After enrichment, the runner returns `buildSemrushDebugHaltResult(...)` — a `success:false`
result carrying `reason: 'semrush_debug_halt'` and the enriched `storeData`. The Mystique
dispatch post-processor already short-circuits on a falsy `success`, so **nothing is sent to
Mystique** and no downstream scrape/LLM work happens. The run intentionally shows up as a
*failed* audit; `reason=semrush_debug_halt` (and a `outcome=skip` log line under
`audit_orchestration_end`) distinguishes it from a genuine failure. This mirrors the
now-removed `domain-urls` hard-stop (ADR 002 decision 8): a deliberately-temporary debug lever,
isolated in one helper so it is trivial to remove once the endpoint is validated.

### 4. Structured, aggregate-only logging

The loader logs through the offsite `olog` taxonomy under one event token,
`data_acquisition_url_prompts_read`:

- a `start` line carrying the resolved `apiBaseUrl`, a full **sample request URL**, the date
  window and `platform` — the routing-debug counterpart to the `domain-urls` start line, so a
  misroute (e.g. a missing `/api/v1`) is visible from the log alone;
- a single **aggregate summary** (`tried` / `urlsWithPrompts` / `totalPrompts` / `ok` /
  `non2xx` / `errors`) — `success` when every call returned 2xx, `degraded` when any failed.

There are **no per-URL log lines** (up to 50 URLs/run would be noise); the aggregate counts are
the fail/success signal.

### 5. Shared request timeout

url-prompts uses the same `resolveSemrushTimeoutMs(env)` as `domain-urls` — default 60s,
overridable by `OFFSITE_SEMRUSH_TIMEOUT_MS` (2-min cap). The per-URL fan-out is bounded by a
client-side concurrency pool (5) so a run of up to 50 URLs cannot burst 50 token-bearing GETs at
the LLMO edge at once.

## Alternatives Considered

- **Duplicate the S2S auth flow inside the url-prompts loader.** Rejected: a second token cache
  would double-mint per org and drift from ADR 002's host/prefix/eviction fixes.
- **Add an `OFFSITE_..._URL_PROMPTS_ENABLED` env var (OR'd with the Slack flag).** Rejected for
  now: with the debug hardstop coupled to "Semrush enabled", a fleet-wide env flag would stop
  every analysis before Mystique. Revisit when url-prompts graduates from debug to a real
  always-on enrichment (at which point the hardstop is removed and an env gate makes sense).
- **Per-URL success/failure logs.** Rejected: too noisy at 50 URLs/run; the aggregate summary
  plus the `start` sample-URL line give enough to debug routing and success rate.
- **A dedicated shorter url-prompts timeout.** Rejected in favor of one shared knob — one env
  var to reason about, and url-prompts calls are lighter than `domain-urls` so 60s is ample
  headroom, not a regression.

## Consequences

- Turning on `enableSemrushWithHardstop` for a run makes that run a **failed audit by design**
  with no Mystique output — dashboards must read `reason=semrush_debug_halt` to tell it apart
  from a real failure. It is a debugging lever, not a steady-state mode.
- The url-prompts loader and the `domain-urls` loader now share auth, cache, base-URL, and
  timeout resolution; a change to any of those affects both (intended).
- The api-service `getUrlPrompts` service layer is flagged POC (unit tests deferred) though the
  endpoint is live-verified — the hardstop debug path exists precisely to validate it before
  broad enablement. Once validated, remove the hardstop (and this ADR's §3) as ADR 002 removed
  its own hard-stop.
