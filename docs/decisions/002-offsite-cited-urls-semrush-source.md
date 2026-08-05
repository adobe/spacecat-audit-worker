# 002 — Off-Site Cited-URL Source: Semrush URL-Inspector with Legacy Fallback

- **Status:** Proposed
- **Date:** 2026-08-05
- **Related:** spec `docs/specs/2026-08-05-offsite-cited-urls-semrush-source.md` · plan `docs/plans/2026-07-17-offsite-cited-urls-semrush-migration.md` · [LLMO-6488](https://jira.corp.adobe.com/browse/LLMO-6488) / [LLMO-6709](https://jira.corp.adobe.com/browse/LLMO-6709) / [LLMO-6710](https://jira.corp.adobe.com/browse/LLMO-6710)

## Context

The `offsite-brand-presence` audit selects the cited URLs it feeds to DRS
(YouTube, Reddit, cited web) from internal Brand-Presence data (PostgREST for
brandalf orgs, SharePoint Excel fallback). We are moving that sourcing to the
Semrush-backed Serenity URL-Inspector data, served by the spacecat-api-service
Elements proxy. This swaps the **primary data source of a production audit** and
involves several non-obvious trade-offs, so it warrants an ADR alongside the spec.

## Decision

1. **Source swap behind a flag, Semrush-first with automatic legacy fallback.**
   When `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED=true`, the runner tries the Semrush
   loader first; if it yields **no usable result** it falls back to the legacy
   `loadBrandPresenceData` (PostgREST → SharePoint). Flag off = legacy only.
2. **"No usable result" = fall back, at the SURFACE granularity.** The loader
   returns `null` — and the handler falls back — on: no org/brand, transient
   brand-resolution failure, no date window, IMS-token failure, or when a **whole
   surface (hostname) produced zero successful responses**. Rationale: a dropped
   *surface* (all YouTube or all Reddit engines failed) is indistinguishable from a
   genuine zero and must fall back; a **single failed engine is a partial count**,
   not a dropped surface, and is tolerated (the successful engines still contribute).
   This keeps the strictness aligned with the "don't drop a surface" goal rather than
   over-firing on any one of ~12 requests. **Follow-up:** a bounded retry on
   retriable statuses (`RETRIABLE_STATUSES`) — as the legacy path does — would
   further reduce transient surface-level fallbacks; not in this PR.
2b. **`dataSource` on the audit result.** `auditResult.dataSource` = `'semrush'` |
   `'legacy'` (plus `fallbackReason` when a Semrush attempt fell back), so shadow-run
   parity (LLMO-6711) can join on the source per run instead of grepping a log line.
2c. **Scope + hygiene guards.** Off-host (`domain: null`) rows are dropped so nothing
   leaks into the top-cited bucket / TOP_CITED scrape; citations are clamped
   (`Math.max(0, …)`) and URLs with total count ≤ 0 are dropped so a negative/zero
   value can't corrupt the citations-descending ranking.
3. **Explicit multi-engine query, not an omitted `platform`.** Omitting `platform`
   on `domain-urls`/`cited-domains` does **not** aggregate across engines (the
   proxy resolves it to a single default engine). We query the full offsite provider
   set mapped to serenity models — `SEMRUSH_PLATFORM_BY_PROVIDER` (`google-ai-mode`,
   `search-gpt`, `microsoft-copilot`, `gemini-2.5-flash`, `google-ai-overview`,
   `perplexity`) — and **sum** citations per URL. Validating this map upstream is
   LLMO-6710.
4. **Auth = service IMS bearer, forwarded unchanged to Semrush.** No
   `x-promise-token` for a service caller (that header is the non-IMS/browser path).
   **Open risk:** the proxy forwards the token unchanged and is designed around a
   real *user* IMS token; whether Semrush accepts the worker's *service* token is
   unverified — the flag stays off until confirmed end-to-end (LLMO-6709).
5. **Format parity.** The loader re-applies `YOUTUBE_URL_REGEX` / `REDDIT_URL_REGEX`
   (matching the legacy `handler.js` classify) so non-thread Reddit and lookalike
   YouTube hosts are dropped identically.
6. **Per-run override via Slack custom arg.** `enableSemrush` (`auditContext.messageData.enableSemrush`,
   resolved by `resolveEnableSemrush`) lets a single Slack-triggered `offsite-brand-presence` /
   `cited-analysis` / `youtube-analysis` / `reddit-analysis` run override the env var —
   `true` forces the Semrush attempt on for that run, `false` forces legacy even when the
   env var is on. This is the same tri-state mechanism as the existing `enableBrandProfile`
   override. It is a **per-run** override only (one Slack invocation), not the persistent
   **per-site** cutover tracked under LLMO-6711.

## Consequences

- Enabling the flag can never silently zero out offsite (fallback), but the
  fallback **masks** Semrush failures — read `auditResult.dataSource` /
  `fallbackReason` (and the `Service token rejected` / `No successful Semrush
  response` logs) to know when Semrush is not actually serving.
- `pageSize=100` assumes a server-side citations-descending sort (unconfirmed); the
  loader logs a truncation warning on a full page so an unsorted/capped response is
  visible rather than silently dropping high-citation URLs.
- The flag is **environment-global** (not per-site); per-site cutover is LLMO-6711.
  A per-run Slack override (`enableSemrush`, see Decision 6) exists for ad-hoc testing
  of one run, but does not persist across runs or substitute for the per-site cutover.

## Known gaps / non-goals (tracked)

- **Region scoping** is not implemented; the legacy path spans `ACCEPTED_REGIONS`
  (six markets) while this loader sends no region. Documented as a follow-up
  (LLMO-6710) — must be closed before non-US parity can be claimed.
- Generic "cited" (third-party) bucket — needs a `cited-domains` discovery hop
  (LLMO-6709 follow-up).

## Enablement runbook (ordered gates before turning the flag on anywhere)

The flag-off path is safe to merge now. Before `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED=true`
in **any** environment, close these in order (LLMO-6709 → 6711):

1. **Auth/authz verified (LLMO-6709).** Confirm the worker's **service** IMS token is
   accepted by the Semrush proxy end-to-end (it is forwarded unchanged; the proxy is designed
   around a *user* token). Confirm `tracingFetch` does **not** emit the `Authorization` header
   into traces/spans (service-bearer leak). Confirm the token is org-scoped, or document that
   tenant isolation is fully delegated to the proxy's per-caller org authz — the worker sends
   `spaceCatId = site.getOrganizationId()` with a broad service token and asserts no boundary
   itself (confused-deputy surface).
2. **`dataSource` shipped** (this PR) — so parity can be measured.
3. **Shadow-run parity on a canary site (LLMO-6711)** — top-70 overlap per surface vs legacy.
4. **Fleet enable** per environment (the flag is environment-global).

## Configuration / client-convention debt (to resolve before the 3rd caller)

This loader reads `SPACECAT_API_URI` and mints an **IMS service bearer**; `brand-resolver.js`
reads `SPACECAT_API_BASE_URL` and uses **`x-api-key`** — for the *same* spacecat-api-service.
The IMS scheme is justified here (the Elements proxy must forward a bearer to Semrush), but
**two base-URL env vars + two auth schemes** can drift (one caller repointed to stage/prod, the
other not → IMS traffic to an untrusted issuer → 401 → silent legacy fallback). Documented as
debt: pick one base-URL env var and one api-service client convention (a shared helper) **before
the `cited-domains` follow-up adds a third caller** that copies whichever it finds first.

## Alternatives Considered

- **No fallback (Semrush-only when on).** Rejected: a Semrush outage would zero out
  offsite for every audited site with no safety net.
- **Per-domain fallback** (fall back only for the failed surface). Deferred: more
  complex; the full-run fallback is simpler and strictly safe.
- **Omit `platform` and rely on server-side aggregation.** Rejected: not how these
  two endpoints resolve an absent platform (single-engine narrowing).
