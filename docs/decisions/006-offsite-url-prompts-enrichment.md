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

### 1. One shared S2S auth path in its own module

The S2S auth orchestration, the `imsOrgId`-keyed session-token cache, the LLMO host/prefix
resolution, and the small helpers around them live in a dedicated module `offsite-s2s-auth.js`
(it imports only the IMS client + tracing fetch, so it adds no cycle). **Both** the `domain-urls`
loader (`loadCitedUrlsFromSemrush`) and the `url-prompts` loader import from it, so the auth path
lives in one place and cannot drift. Key exports:

- `resolveApiBaseUrl(env)` — LLMO host + `/api/v1` prefix.
- `getS2sSessionAuthorization({ context, imsOrgId })` — cached mint→exchange; returns
  `{ authorization, sessionToken, fromCache }` and throws with a `.reason` code
  (`ims_token_failed` / `session_token_auth_failed` / `session_token_failed`).
- `evictS2sSessionToken(imsOrgId)` — drop a stale token on a data-call `401/403`.

`domain-urls` was refactored onto `getS2sSessionAuthorization` (it previously inlined the
mint/exchange/classify sequence) while keeping its richer telemetry — the Slack fallback notify,
the decoded-consumer-claims success line (logged only on a fresh mint, keyed off `fromCache`),
and the data-call eviction — in the caller rather than pushing it into the shared helper. Because
both entry points hit the same module-level cache, a token minted by one is reused by the other
for the same org: no double-mint (covered by a cross-loader regression test).

The url-prompts loader resolves the customer `imsOrgId` itself (via `getImsOrgId`) and is
**best-effort**: any failure — a *thrown* error from the brand/date/IMS-org resolution or the
token call, or a per-URL fetch error — is caught and returns an empty `Map` so the audit proceeds
with un-enriched URLs and never fails on enrichment. There is **no legacy fallback** here — unlike
the `domain-urls` source, there is no alternative prompt source, and enrichment is optional
metadata. On success it logs a `debug` line with the decoded consumer identity + cache-hit state
(observability parity with `domain-urls`).

The three analysis handlers call a single shared `enrichUrlsWithSemrushPrompts({ urls, site,
context, olog, limit })` (one enrichment code path, not three copies). `limit` is the run's
resolved Mystique URL limit, so enrichment fans out over exactly the set that will be
dispatched — a run scoped to fewer URLs no longer issues token-bearing requests for URLs that
get dropped downstream.

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

**Propagation.** `enableSemrushWithHardstop` is threaded through every hop that already carries
`enableSemrush`, so it works whether the run is triggered directly on an analysis audit or via
`offsite-brand-presence` (which fans out to cited/youtube/reddit), and it survives the
no-URLs-yet self-heal loop (analysis → `requestOffsiteScrape` → `offsite-brand-presence` →
`scheduleDrsStatusPoll` → `drs-status-handler` → `triggerAnalysisAudits` → analysis). The
hardstop itself only ever fires in the three analysis handlers; the orchestrator and DRS-status
handler merely forward the flag.

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

### 4b. Prompt provenance and ingestion validation

Every candidate URL (first `MYSTIQUE_URLS_LIMIT`) is tagged `isUrlFromSemrush` when enrichment
runs, but prompt **provenance** only changes for URLs Semrush actually returned prompts for:
`url-topic-enrichment` fills in the legacy brand-presence-topic prompts for any tagged URL that
Semrush returned nothing for (gated on actual prompt presence, `!urlItem.prompts?.length`, not the
tag), so enabling enrichment never *reduces* prompt coverage — it only swaps the source where
Semrush has data. Prompt strings are third-party content, so each is coerced to a non-empty string
and truncated (`MAX_PROMPT_LENGTH`, 4 KB) at the ingestion boundary in `fetchUrlPrompts`, not left
to an incidental SQS byte-budget backstop.

### 5. Shared request timeout, shorter url-prompts default

Both loaders resolve their timeout through the same `resolveSemrushTimeoutMs(env, defaultMs)` and
honor the same `OFFSITE_SEMRUSH_TIMEOUT_MS` override (2-min cap). The **default** differs by
call shape: `domain-urls` keeps **60s** for its single heavy page; `url-prompts` uses **30s**,
since each call is a light per-URL lookup and up to ~10 batches run sequentially (concurrency 5
over 50 URLs) — a shorter default bounds the enrichment phase's worst-case wall-clock. The env
override, when set, applies to both. The per-URL prompt count is `MAX_URL_PROMPTS` (5), overridable
via `OFFSITE_URL_PROMPTS_MAX` (clamped to `[1, 50]`) — the same knob shape as the timeout; note the
Mystique payload path applies its own independent cap, so this only affects what is stored.

## Alternatives Considered

- **Duplicate the S2S auth flow inside the url-prompts loader.** Rejected: a second token cache
  would double-mint per org and drift from ADR 002's host/prefix/eviction fixes.
- **Add an `OFFSITE_..._URL_PROMPTS_ENABLED` env var (OR'd with the Slack flag).** Rejected for
  now: with the debug hardstop coupled to "Semrush enabled", a fleet-wide env flag would stop
  every analysis before Mystique. Revisit when url-prompts graduates from debug to a real
  always-on enrichment (at which point the hardstop is removed and an env gate makes sense).
- **Per-URL success/failure logs.** Rejected: too noisy at 50 URLs/run; the aggregate summary
  plus the `start` sample-URL line give enough to debug routing and success rate.
- **A separate url-prompts timeout env var.** Rejected in favor of one shared override
  (`OFFSITE_SEMRUSH_TIMEOUT_MS`) with a per-caller *default*: url-prompts defaults to a shorter 30s
  (bounding the sequential-batch wall-clock) while domain-urls keeps 60s, and the single env var
  still tunes both. One knob to reason about, without forcing the same default on two very
  different call shapes.

## Consequences

- Turning on `enableSemrushWithHardstop` for a run makes that run a **failed audit by design**
  with no Mystique output — dashboards must read `reason=semrush_debug_halt` to tell it apart
  from a real failure. It is a debugging lever, not a steady-state mode.
- The url-prompts loader and the `domain-urls` loader now share auth, cache, base-URL, and
  timeout resolution; a change to any of those affects both (intended).
- The api-service `getUrlPrompts` service layer is flagged POC (unit tests deferred) though the
  endpoint is live-verified — the hardstop debug path exists precisely to validate it before
  broad enablement.
- **Planned removal (tracked in this story, LLMO-6712).** Once url-prompts is confirmed working
  across all audits, a **follow-up cleanup PR under LLMO-6712** removes the `enableSemrushWithHardstop`
  debug flag and `buildSemrushDebugHaltResult` (its whole thread through the trigger chain), the
  same way ADR 002's `domain-urls` hard-stop was removed after validation. Until then the
  `success:false` / `reason=semrush_debug_halt` signal is deliberate and short-lived. The audit
  framework has no first-class "skipped" terminal state, which is why the debug halt reuses
  `success:false` rather than a dedicated status.
