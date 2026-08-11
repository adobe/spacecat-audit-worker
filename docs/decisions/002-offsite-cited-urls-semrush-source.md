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
8. **Entitlement gate — "flag AND workspace", before any Semrush HTTP call
   (LLMO-6841).** Semrush data only exists for brands actually provisioned in Semrush;
   calling the proxy for a non-entitled brand wastes a request on a paid, rate-limited
   product and reliably yields an error/empty response that just falls back anyway. The
   loader (`src/utils/semrush-entitlement.js`, `resolveSemrushEntitlement`) checks:
   - the org-wide `serenity` feature flag (`feature_flags`, product `LLMO`) is `true` — read
     directly via `postgrestClient`, the same mechanism `brandalf-utils.js`'s
     `isBrandalfEnabled` already uses (no shared-package helper exists for this; api-service's
     own `readFeatureFlag` is private, unpublished application code), **AND**
   - a Semrush workspace resolves for the brand — via the shared
     `@adobe/spacecat-shared-data-access` model layer (`dataAccess.Brand#getSemrushSubWorkspaceId()`,
     falling back to `dataAccess.Organization#getSemrushWorkspaceId()` — the flat org
     workspace), the exact entities/getters spacecat-api-service's own `workspace-resolver.js`
     reads. This is genuine reuse, not a duplicate of column/schema knowledge: the worker
     already depends on this package and its `dataAccess` middleware already wires up the
     `Organization`/`Brand` collections the same way api-service does. What is **not** reused
     is api-service's TTL-bounded in-memory caching around that lookup (`workspace-resolver.js`'s
     `cache`/`brandCache` Maps) — that caching is private application code in api-service, not
     exported from any package, so importing it isn't possible without a cross-repo extraction.
     Re-implementing it here was judged not worth the duplication for a once-per-audit-run
     check (this is not a hot per-request UI path the way api-service's is).
   This mirrors the exact "flag AND workspace" gate spacecat-api-service uses to decide
   whether to serve *any* Serenity route for an org (`serenity-active.js` +
   `workspace-resolver.js`'s `resolveBrandWorkspace`), so "entitled" means the same thing
   in the worker as everywhere else. The check runs immediately after brand resolution
   succeeds and *before* minting the IMS token or building any Semrush request. On a
   non-entitled brand the loader returns `null` with `fallbackReason: 'not-entitled'`
   (confirmed) or `'entitlement-check-failed'` (the check itself errored/timed out — fails
   **closed**, i.e. skip Semrush, same as any other transient PostgREST failure in this
   loader). Both reasons are exempted from the Decision 1 hard-stop: even a canary run
   forced on via `enableSemrush:true` falls back to legacy cleanly for these two reasons —
   entitlement scoping is expected behavior, not a technical failure to surface loudly.
   This check is purely an **extra narrowing** inside the existing
   `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` / `enableSemrush` gate, not a replacement for it.
   Considered and rejected: the api-service `.../serenity/brand-presence/access` endpoint
   (built for a per-user IMS bearer from a browser session; the worker's *service* IMS
   token, per Decision 5, is untested against it — see the LLMO-6709 open risk); reusing
   `isBrandalfEnabled` (a different flag — `brandalf` — from a different cohort than
   Semrush/Serenity entitlement); and a net-new per-site allowlist (the workspace columns
   already are the authoritative provisioning signal, no new construct needed).
8b. **`feature_flags` multi-row safety, and a shared reason-string contract (PR review).**
   `isSerenityEnabledForOrg` mirrors `isBrandalfEnabled`'s wildcard-select +
   `isOrgRow` pattern (`isOrgRow` exported from `brandalf-utils.js` at the time; relocated
   to `feature-flags-utils.js` by Decision 8e) instead of `.eq('flag_name', ...).maybeSingle()`:
   `feature_flags` rows can carry a brand-scoped
   override (`brand_id` set) alongside the organization's own row (`brand_id` NULL) for the
   *same* `organization_id`/`product`/`flag_name`, and `maybeSingle()` throws the moment two
   rows match — which would silently and permanently disable Semrush for any org the moment
   a brand-level `serenity` override exists. Separately, the `'not-entitled'` /
   `'entitlement-check-failed'` reason strings are now exported as
   `SEMRUSH_NOT_ENTITLED_REASON` / `SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON` (plus a bundled
   `SEMRUSH_ENTITLEMENT_SKIP_REASONS` Set) from `semrush-entitlement.js`, imported by both
   the loader (producer) and the handler's hard-stop-exemption check (consumer) — previously
   independently-typed literals with no test tying them together. A granular
   `entitlementReason` (`flag-disabled` | `no-workspace` | `no-client` | `check-failed`) is
   now also threaded onto `diagnostics`/`auditResult` alongside the coarse `fallbackReason`,
   so a systemic wiring bug (`no-client`) stays distinguishable from a one-off transient
   blip (`check-failed`) without changing the coarse-grained hard-stop-exemption contract
   itself.
8c. **Resolved: `entitlement-check-failed` stays exempted from hard-stop; visibility is via
   the existing thread notify() and logs only — no dedicated ops channel (PR review).**
   Decided against making `entitlement-check-failed` hard-stop like `ims-token-failed` —
   `enableSemrush:true` is a per-run canary override, so gating a fleet-wide outage signal
   behind it would mean the signal only fires on whichever single site happens to be
   canary-tested at that moment. A dedicated, unconditional ops-channel Slack alert
   (`postMessageSafe` to a fixed channel, firing regardless of Slack context) was
   considered and implemented, then explicitly rejected in favor of simplicity: the loader's
   existing `notify()` call already posts `:warning: Could not verify Semrush
   entitlement...` into the triggering thread via `onProgress` → `postMessageOptional`
   whenever this happens — unchanged by this decision. Accepted trade-off:
   `channelId`/`threadTs` are only populated when the audit was triggered manually from
   Slack (scheduled/automatic runs have no thread — see `scheduleDrsStatusPoll`'s doc
   comment), so a `entitlement-check-failed` outage during ordinary scheduled operation
   produces **no Slack signal**, only the `log.info`/`log.warn` lines and
   `auditResult.entitlementReason` (Decision 8b) for whoever is watching logs/dashboards.
   If fleet-wide alerting on this specific failure mode becomes a real operational need,
   revisit the dedicated-channel approach then rather than pre-building it now.
8d. **Documented, not enforced: `resolveSemrushWorkspace` trusts caller-supplied org/brand
   membership (PR review).** The shared `Brand` data-access model
   (`@adobe/spacecat-shared-data-access`) has no `organizationId` getter at all — it is
   deliberately minimal, scoped to only the fields the serenity provisioning flow reads/
   writes — so there is no way to verify a resolved brand actually belongs to the given org
   without a raw PostgREST query against `brands.organization_id`, which would reintroduce
   the table-level dependency this module deliberately moved away from (Decision 8) for a
   scenario the sole caller cannot hit today (`resolveBrandResultForSite` is already
   server-side scoped by `organization_id`). Documented as an explicit contract in both
   functions' JSDoc instead of enforced in code: a future caller resolving `orgId`/`brandId`
   from independent sources must guarantee the pairing itself.
8e. **`isOrgRow` relocated to a neutral `feature-flags-utils.js`; reason literals promoted
   to constants; brand-override "revoke" semantics confirmed moot (2nd round PR review).**
   `isOrgRow` moved out of `brandalf-utils.js` (which admitted in its own JSDoc that it was
   already a second consumer) into `src/utils/feature-flags-utils.js`, alongside a new
   shared `readOrgFeatureFlag(postgrestClient, { organizationId, product, flagName, log })`
   that both `isBrandalfEnabled` and `isSerenityEnabledForOrg` now delegate to — the
   previously copy-pasted wildcard-select/error-handling/`isOrgRow`-filter block lives in
   exactly one place. Separately, `resolveSemrushEntitlement`'s internal `reason` values
   (`entitled`/`flag-disabled`/`no-workspace`/`missing-input`/`no-client`/`check-failed`)
   are now a frozen `SEMRUSH_ENTITLEMENT_REASONS` lookup instead of bare literals, matching
   the treatment `SEMRUSH_NOT_ENTITLED_REASON`/`SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON`
   already got (Decision 8b); consuming tests now assert against the constants too, not
   copies of the string.
   On the open question from Decision 8's "ignores brand-scoped override" gap: checked
   directly against `spacecat-api-service` rather than leaving it unconfirmed.
   `feature-flags-storage.js`'s `readFeatureFlag()` — which backs `isSerenityActiveForOrg`
   in `serenity-active.js`, the exact org-wide gate this module mirrors — queries only
   `organization_id`/`product`/`flag_name`, with no `brand_id` awareness at all, and no file
   in that repo ever combines `brand_id` with the `feature_flags` table. Brand-scoped
   feature-flag overrides (grant or revoke direction) are not a feature that exists in
   production today, in either codebase — so `isOrgRow` reading only the org's own row and
   ignoring any override is correct under the current schema by construction, not an
   unverified assumption. Regression tests pinning "org row `false` + brand-override row
   `true` still resolves not-entitled" were added to both `isBrandalfEnabled` and
   `isSerenityEnabledForOrg` to make this explicit rather than only covering the inverse
   (Decision 8b's original multi-row fix tested override-wins-false, not override-cannot-
   grant-true).

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
