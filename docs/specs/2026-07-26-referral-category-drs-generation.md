# Referral Category Generation for DRS sources (GA4 / Adobe Analytics / CJA)

**Status:** Draft · **Author:** Omair Temurian · **Date:** 2026-07-26
**Parent:** LLMO-5440 (Referral Category feature) · **Follows:** LLMO-6257 Phase 1 (optel + cdn, shipped to prod)

## 1. Problem

Referral traffic from the DRS sources — **GA4, Adobe Analytics (AA), and CJA (Customer Journey Analytics)** — shows **no category** on the Referral Traffic dashboard. Two reasons:

1. **No classifier** — nothing goes through those URLs and tags them with a category. DRS imports the traffic, but classification never happens for it.
2. **No rulebook** — sites whose *only* referral data comes from DRS never get category **rules** generated at all. Rule generation runs *only* inside the optel audit (`llmo-referral-traffic-daily/handler.js:299` calls `generateReferralCategoryRules`); a DRS-only site has no optel run, so no rules exist to classify against.

Result: DRS-only sites are stuck showing "All Categories." (A prod scan on 2026-07-26 confirmed this shape: categories appear **only** on sites that have optel; every source combination without optel — including 142 cdn-only sites — is at 0% categories.)

## 2. Plan

Two gaps → two fixes, both reusing the Phase-1 pipeline.

**Fix A — decouple rule generation from the optel audit.**
Today `generateReferralCategoryRules` only runs when the optel handler runs. Change the trigger so it runs for **any site that has referral traffic**, regardless of source. The function is already source-agnostic — it builds its corpus from `rpc_referral_traffic_top_urls`, which unions all 5 source tables, and it is create-if-missing (idempotent). So this is a change to *where it's triggered from*, not a rewrite. **Bonus: this also fixes the cdn-only sites that are broken in prod today.**

> Note: Fix A is new to this spec and concerns **rule generation** (building the rulebook) — which is distinct from *classification* (applying it). It keeps rule-gen exactly where it lives today (the audit-worker) and only broadens which sites trigger it; it does not move anything into the database.

**Fix B — DRS classifies its own URLs write-time, in Python.**
DRS runs in a separate AWS account and cannot read the database directly, so:
- Add a small **read endpoint on the api-service** that returns a site's active category rules (the "rules proxy"). DRS already calls the api-service, so this is the natural bridge.
- In DRS (Python), after it imports GA4/AA/CJA traffic, it fetches the rules via that endpoint, classifies each URL (mirroring the JS `classify.js` logic, including the same `url_path` canonicalization), writes the same category CSV, and drops it into the existing pipeline.

**Reuse (no new work):** the projector (already accepts `referral_url_classifications`), the data-service (the import RPC + tables), the api read RPCs, and the UI are all unchanged — they already handle this data for optel/cdn.

## 3. How it works (trace one GA4 URL end-to-end)

1. DRS imports GA4 referral traffic for a site (as it does today).
2. DRS calls the api-service **rules endpoint** → gets the site's category rulebook. *(rulebook exists because Fix A now generates rules for this site.)*
3. DRS **classifies** each GA4 URL against the rulebook (Python, same canonicalization as JS) → produces `host, url_path, category_name` rows.
4. DRS writes a **category CSV** and hands it to the **projector** (same as optel/cdn do).
5. Projector → **data-service** `wrpc_import_referral_url_classifications` writes it to `referral_url_classifications`.
6. The **api-service** read RPCs surface the category; the **UI** shows it. Done.

## 4. Open questions (to resolve in review)

1. **Ownership / scope.** Which of these pieces is Omair's vs DRS-team's? (Fix A + the api endpoint are JS; the DRS Python classify is DRS-side.)
2. **Where does the decoupled rule-gen run?** A scheduled job that loops sites with referral traffic, or a new audit type, or extend an existing daily run? And **how often** (rules don't need daily regeneration — once per site? weekly? on first referral data?).
3. **LLM cost gating** — rule-gen calls an LLM; running it for many more sites has a cost. What's the budget/guard?
4. **Canonicalization parity** — the exact `url_path` cleanup rules the Python side must match the JS side byte-for-byte (query/fragment stripping, leading slash, collapse `//`, trailing-slash handling). Where do the shared **parity fixtures** live?
5. **Rules endpoint shape + auth** — exact request/response, and how DRS authenticates to the api-service.

## 5. Test plan

- **Parity fixtures**: a shared list of `input url → expected canonical url_path` (and `url → expected category`) cases, run against **both** the JS and Python classifiers, proving identical output.
- **Fix A**: unit test that rule generation now fires for a site with only cdn/DRS referral traffic (no optel).
- **DRS classify**: unit tests on the Python classifier (match / no-match / bad-rule handling), mirroring the existing `classify.test.js` cases.
- **End-to-end in a lower env**: pick a DRS-only site, run the flow, confirm categories appear via the api (`filter-dimensions`) — the same check we did in prod for optel/cdn.

## Non-goals

- No changes to the projector, data-service tables/RPCs, api read RPCs, or UI (all reused from Phase 1).
- No re-classification/backfill of historical DRS traffic beyond what the normal daily flow covers (matches the Phase-1 "self-healing, no backfill" decision).
