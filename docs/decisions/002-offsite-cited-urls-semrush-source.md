# 002 — Off-Site Cited-URL Source: Semrush URL-Inspector with Legacy Fallback

- **Status:** Proposed
- **Date:** 2026-08-05
- **Related:** spec `docs/specs/2026-08-05-offsite-cited-urls-semrush-source.md` · plan `docs/plans/2026-07-17-offsite-cited-urls-semrush-migration.md` · [LLMO-6488](https://jira.corp.adobe.com/browse/LLMO-6488) / [LLMO-6709](https://jira.corp.adobe.com/browse/LLMO-6709) / [LLMO-6710](https://jira.corp.adobe.com/browse/LLMO-6710) / [LLMO-6844](https://jira.corp.adobe.com/browse/LLMO-6844) / [LLMO-6818](https://jira.corp.adobe.com/browse/LLMO-6818)

## Context

The `offsite-brand-presence` audit selects the cited URLs it feeds to DRS
(YouTube, Reddit, cited web) from internal Brand-Presence data (PostgREST for
brandalf orgs, SharePoint Excel fallback). We are moving that sourcing to the
Semrush-backed Serenity URL-Inspector data, served by the spacecat-api-service
Elements proxy. This swaps the **primary data source of a production audit** and
involves several non-obvious trade-offs, so it warrants an ADR alongside the spec.

## Decision

1. **Source swap behind a flag, Semrush-first — failure handling depends on HOW it
   was enabled.** When Semrush is enabled (env var
   `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED=true`, or the per-run override in Decision 7),
   the runner uses the Semrush loader. On a Semrush **failure** (loader returns `null`):
   - **Env-enabled, or override `false`/absent →** fall back to the legacy
     `loadBrandPresenceData` (PostgREST → SharePoint), so production is never silently
     zeroed out.
   - **Explicitly forced on via `enableSemrush:true` (Slack override) →** **hard stop**:
     return `success:false` with `dataSource:'semrush'` + `fallbackReason`, and do **NOT**
     run legacy. An operator testing Semrush on one run wants the failure **visible**, not
     masked by legacy.
   A genuinely-empty-but-successful result (Map size 0) is **not** a failure — it is used as
   a normal zero-URL Semrush run in both modes. Flag off (no override) = legacy only.
2. **A single `domain-urls` request — no `hostname`, `platform=all` — serves all three
   buckets.** LLMO-6844 made `hostname` optional (returns URLs across every source host)
   and LLMO-6818 added `platform=all` (aggregates citations across every AI engine
   server-side). One request returns a citations-sorted page spanning every host and
   engine; the worker classifies each row client-side into `youtube.com`, `reddit.com`, or
   third-party "cited" (`domain: null`) — see `classifyRow` in the loader.
3. **Failure is whole-request.** With one request, there's no per-engine partial
   tolerance — the loader returns `null` on: no org/brand, transient brand-resolution
   failure, no date window, IMS-token failure, or the `domain-urls` request itself failing
   (network error, timeout, non-2xx, unparseable body). `auditResult.dataSource` =
   `'semrush'` | `'legacy'`, plus `fallbackReason` on failure (`no-organization-id`,
   `no-active-brand`, `brand-resolution-failed`, `no-date-window`, `ims-token-failed`,
   `domain-urls-auth-failed` for a 401/403, or `domain-urls-failed` otherwise) — feeds
   shadow-run parity (LLMO-6711) without grepping logs.
4. **Per-row bucket + hygiene filters (`classifyRow`).** `youtube.com` / `reddit.com` rows
   must additionally pass `YOUTUBE_URL_REGEX` / `REDDIT_URL_REGEX` (drops non-thread Reddit
   and lookalike YouTube hosts, matching the legacy classify). Third-party rows are dropped
   when `contentType: "Owned"`, when the host is in `TOP_CITED_EXCLUDED_DOMAINS` (e.g.
   `wikipedia.org`), or when `isExcludedCitedHost` flags a social/search/brand-lookalike
   host — the legacy top-cited gate, now applied per URL rather than per domain rollup.
   Citations are clamped (`Math.max(0, …)`) and zero-citation URLs are dropped.
5. **Auth = IMS service bearer via v2 `getServiceAccessToken()` (`authorization_code`
   grant), default IMS client.** This is the same S2S path `commerce-product-enrichments`,
   `vulnerabilities` and `permissions` use. v3 `getServiceAccessTokenV3()`
   (`client_credentials`) was tried first but returns IMS **`400 unauthorized_client`** —
   the worker's default IMS client is only provisioned for `authorization_code`; only a
   dedicated integration (content-ai's `CONTENTAI_*`) is registered for `client_credentials`.
   The token is forwarded unchanged to Semrush; no `x-promise-token` for a service caller.
   **Open risk (LLMO-6709):** the proxy is designed around a real *user* IMS token, so whether
   Semrush accepts the worker's *service* token is unverified — the flag stays off until
   confirmed end-to-end (use `enableSemrush:true` on one canary run, per Decision 7, to test).
6. **`PAGE_SIZE` is a fixed constant (1000).** The response is sorted by
   citations globally across every host, so a low-citation bucket can be starved by too
   small a page — a generous page is cheap since it's one request either way. 1000 is the
   `domain-urls` server-side `pageSize` clamp, so it's the max we can actually get currently.
7. **Per-run override via Slack custom arg — how the first live runs get tested.**
   `enableSemrush` (`auditContext.messageData.enableSemrush`, resolved by
   `resolveEnableSemrush`) lets a single Slack-triggered `offsite-brand-presence` /
   `cited-analysis` / `youtube-analysis` / `reddit-analysis` run override the env var —
   `true` forces the Semrush attempt on for that run **and makes a failure a hard stop with
   no legacy fallback** (Decision 1), `false` forces legacy even when the env var is on,
   anything else (absent, empty, invalid) falls through to the env var unchanged. This is the
   intended mechanism for verifying LLMO-6709 against the real Semrush proxy on one site at a
   time, before `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` is flipped fleet-wide. Same tri-state
   mechanism as the existing `enableBrandProfile` override. It is a **per-run** override only
   (one Slack invocation), not the persistent **per-site** cutover tracked under LLMO-6711.

## Consequences

- Enabling the flag can never silently zero out offsite (fallback), but the fallback
  **masks** Semrush failures — read `auditResult.dataSource` / `fallbackReason` (and the
  `Service token rejected` / `domain-urls returned HTTP` logs) to know when Semrush is not
  actually serving.
- **Request volume dropped from ~12–78 requests to exactly 1** per audit run. The
  trade-off is coverage risk at the tails: a bucket whose citation volume is
  systematically lower than the others (e.g. `reddit.com` on a site where third-party
  press coverage dominates) can be starved within one global-citations-sorted page —
  mitigated, not eliminated, by the generous fixed `PAGE_SIZE`.
- The flag is **environment-global** (not per-site); per-site cutover is LLMO-6711. The
  per-run Slack override (Decision 7) exists for ad-hoc testing of one run only.

## Known gaps / non-goals (tracked)

- **Region scoping** is not implemented; the legacy path spans `ACCEPTED_REGIONS` (six
  markets) while this loader sends no region. Follow-up: LLMO-6710 — must close before
  non-US parity can be claimed.
- **Per-domain diversity within the cited bucket** is not enforced: the loader emits every
  qualifying third-party row and relies on `selectTopUrls`'s top-N-by-citations logic
  downstream, so a single very-high-citation domain can dominate the cited bucket.

## Enablement runbook (ordered gates before turning the flag on anywhere)

The flag-off path is safe to merge now. Before `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED=true`
fleet-wide in any environment, close these in order (LLMO-6709 → 6711). The per-run Slack
override (`enableSemrush`, Decision 7) is the intended tool for step 1: run a single live
request against the real Semrush proxy on one site and confirm the auth path works
end-to-end before flipping the env var fleet-wide.

1. **Auth/authz verified (LLMO-6709).** Confirm the worker's **service** IMS token is
   accepted by the Semrush proxy end-to-end. Confirm `tracingFetch` does not emit the
   `Authorization` header into traces/spans (service-bearer leak).
2. **`dataSource` shipped** (this PR) — so parity can be measured.
3. **Shadow-run parity on a canary site (LLMO-6711)** — top-70 overlap per bucket vs legacy.
4. **Fleet enable** per environment — **US markets only** until region scoping (LLMO-6710) closes.

## Configuration / client-convention debt (to resolve before the 3rd caller)

This loader reads `SPACECAT_API_URI` and mints an **IMS service bearer**; `brand-resolver.js`
reads `SPACECAT_API_BASE_URL` and uses **`x-api-key`** — for the *same* spacecat-api-service.
The IMS scheme is justified here (the Elements proxy must forward a bearer to Semrush), but
**two base-URL env vars + two auth schemes** can drift (one caller repointed to stage/prod, the
other not → IMS traffic to an untrusted issuer → 401 → silent legacy fallback). Documented as
debt: pick one base-URL env var and one api-service client convention (a shared helper) **before
the `cited-domains` follow-up adds a third caller** that copies whichever it finds first. A
tracking ticket will be filed before this debt is resolved; not required to close this PR.

## Alternatives Considered

- **No fallback (Semrush-only when on).** Rejected: a Semrush outage would zero out
  offsite for every audited site with no safety net.
- **Per-hostname × per-engine fan-out, summing citations client-side, plus a two-hop
  `cited-domains` → `domain-urls` discovery walk for the third-party bucket.** Superseded
  once LLMO-6844 (optional `hostname`) and LLMO-6818 (`platform=all`) landed: a single
  hostname-less, `platform=all` request now returns every host's URLs, already aggregated,
  in one citations-sorted page — producing the same exact-citation-count contract with 1
  request instead of up to 78, with no separate domain-discovery hop needed.
- **Three requests (`hostname=youtube.com`, `hostname=reddit.com`, and one hostname-less
  request for third-party), all `platform=all`.** Would preserve independent per-bucket
  page sizing — closing the coverage-starvation risk in Consequences — while still cutting
  request volume ~25x. Rejected in favor of the single request for simplicity (one fewer
  moving part, one `fallbackReason` surface instead of three); revisit if shadow-run parity
  (LLMO-6711) shows a bucket is actually being starved in practice.
