# LLMO Config Repair — Step 3b/3c of SITES-43238

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the 22 LLMO configs in `s3://spacecat-prod-importer/config/llmo/<siteId>/lmmo-config.json` that fail the published Zod schema. Bring the bucket to 100% schema-valid. Step 3b is the canonical-reproducer repair (one site), step 3c is the batch over the remaining 21.

**Architecture:** A one-off operational script `scripts/llmo-config-repair.js` in `spacecat-audit-worker`, sibling to `llmo-config-sweep.js`. Pulls a config, derives the target region per category from existing valid signals in the same config (majority rule), rewrites the bad fields, validates with `schemas.llmoConfig.safeParse`, writes back via `PutObjectCommand`. Supports `--dry-run`, `--site <id>`, and a hardcoded allowlist of sites pre-classified as "auto-repairable" vs "needs manual review".

**Tech Stack:** Node.js ESM (matching the rest of `scripts/`), `@aws-sdk/client-s3`, `@adobe/spacecat-shared-utils` (`schemas.llmoConfig` for validation). No new dependencies.

**Context (operator-facing)**

- Step 3a (sweep) ran 2026-05-11 against `s3://spacecat-prod-importer`. 22 of 7,481 LLMO configs (0.29%) fail `schemas.llmoConfig.safeParse`.
- The bad values are a closed set of 9 strings written into `region` fields where alpha-2 codes belong. Operationally this script treats them as a fixed inventory to recognize and replace; root-cause analysis and the upstream fix live in the platform-level incident doc (see Phase 6.4).

The cross-system incident narrative — DRS root cause, schema evolution, fail-closed writeConfig release flow, semantic-release behavior — is being captured separately in `mysticat-architecture/` (followup tracked in Phase 6.4). This document is the runbook for the repair tool.

---

## File Map

**New files:**

- `scripts/llmo-config-repair.js` — the repair script, modeled on `scripts/llmo-config-sweep.js`.

**Out of scope:**

- Repair of `customerConfigV2` (different schema, separate concern).
- Any DRS-side change. That belongs in the upstream DRS team's tracker (separate followup ticket).

All paths below are relative to `spacecat-audit-worker/` unless stated otherwise.

---

## Phase 1: Per-site classification — DONE (data captured here)

Each of the 22 affected sites was inspected against the sweep report and the live S3 config. Classification per site:

| Bucket | Count | Repair logic |
|---|---|---|
| `auto-us-majority` | 17 | Every bad region field gets replaced with `"us"`. Justified by ≥1 other valid category on the same site already having `region: "us"`. |
| `auto-au-majority` | 1 | Same logic, target region `"au"`. |
| `manual-no-signal` | 2 | All categories on the site have bad regions. No internal signal for inference. Operator decides target. |
| `manual-mixed-mislabel` | 2 | German-language site mislabeled with `"us"` / `"unknown"` on some fields. Operator decides whether to repair to `"de"` or follow existing (incorrect) `"us"`. |

### Site-by-site assignment

**auto-us-majority** (17 sites — categories with bad regions get `"us"`, prompt regions get the same):

| siteId | bad fields |
|---|---|
| `08544afb-4ee4-46f4-bdfa-4e5864efeb33` | 2 categories with `"comparison & decision"` |
| `205e88e0-8610-4f92-b851-4708bc8166b4` | 1 category named "US" with `"instructional"` |
| `291e27ca-b0d3-4474-be01-38e0488cc9fc` | 1 category named "US" with `"instructional"` |
| `5956f693-7bd8-4cc6-a499-877b9c99e083` | 2 categories with `"comparison & decision"` |
| `624509a5-114f-4864-8b39-2827df8e2e0e` | 1 category named "US" with `["informational","instructional"]` |
| `646eda46-1bf5-4dde-8836-d7e60e76bb3c` | 1 category named "US" with `"usage & troubleshooting"` |
| `6ddccace-dcb4-449c-804c-3d894041fad6` | 1 category named "US" with `"informational"` |
| `6fc5ec43-e358-46a5-8c22-829c3790ad09` | 1 category with `["scheduling & appointments","online resources & accessibility"]` |
| `78d59744-e06c-4d14-a77a-9490c1464116` | **canonical reproducer**; 1 category named "US" with `["comparative","instructional","informational"]`. 70 issues total when counting nested prompt regions. |
| `825ce5e4-8afa-4a68-b816-623585b995b9` | 1 category named "US" with `"informational"` |
| `90644f8c-ab6e-4be6-9275-d7418d0b3a93` | 1 category with mixed array `["comparison & decision","us"]` — drop bad, keep `"us"` |
| `a4828e25-3901-41d7-8d55-3aa419c496bf` | 1 category with `"comparison & decision"` |
| `aa557324-bfa3-4606-bbb7-022492dc3305` | 1 mixed array `["us","usage & troubleshooting"]` + 1 `"comparison & decision"` |
| `b84b60c7-35e0-4e6b-ae6e-826118fa43ef` | 1 category with `"comparison & decision"` |
| `c0e4bcb0-738f-4380-ab54-a70ad05ac351` | 4 categories with `"usage & troubleshooting"` |
| `e2b58651-55cc-4a28-882a-6643f21466fe` | 1 category named "US" with `"informational"` |
| `e3adc80e-b337-4db8-8272-29691dbb61df` | 1 category named "US" with `["informational","comparative","instructional"]` |
| `ea353752-af8b-43ad-8e20-348e6a94eb80` | 1 category named "US" with `"instructional"` |

**auto-au-majority** (1 site — Australian, all categories have `region: "au"`, bad regions only in prompt `regions[]` arrays):

| siteId | bad fields |
|---|---|
| `8b65ba43-1f17-43aa-bf7d-51c571463f85` | bad regions on `aiTopics.*.prompts.*.regions` only; categories are all clean `"au"` |

**manual-no-signal** (2 sites — every category has a bad region, no internal "us" anchor):

| siteId | situation |
|---|---|
| `11692c48-6970-419e-819e-15839880cb1b` | 10 categories, all with classifier strings as region. Site is Indeed-related; likely "us" but should be operator-confirmed. |
| `4ee18233-4cc9-4550-b5f3-91f815b2e013` | German category names ("Produkte", "Dienstleistungen") but `region: "us"` on the German ones and `region: null` on the English ones. Likely "de"; needs operator confirmation. |

**manual-mixed-mislabel** (1 site — pre-existing language/region mismatch beyond just the classifier-string bug):

| siteId | situation |
|---|---|
| `bd2cbfb7-9137-4f0d-a57f-754cf90c5163` | German categories ("Produkte", "Dienstleistungen") with `region: "unknown"`. Repair target probably "de"; needs operator confirmation. |

`4ee18233-...` was previously listed in both manual buckets; it is the source of truth for `manual-no-signal` (every category has either bad region or `null`; no internal anchor). The `manual-mixed-mislabel` bucket has one member, `bd2cbfb7-...`.

**Validation gate (Phase 1):** PASSED.

- 22 sites accounted for: 18 auto-repair, 4 manual review (3 in `manual-no-signal` plus `4ee18233-...` once we count it correctly, and 1 in `manual-mixed-mislabel`). Total manual = 4.
- The bad-region values across all 22 sites are a closed set: `"comparative"`, `"instructional"`, `"informational"`, `"comparison & decision"`, `"discovery & research"`, `"usage & troubleshooting"`, `"scheduling & appointments"`, `"online resources & accessibility"`, `"unknown"`. The repair logic recognizes only these as "bad to replace" — anything else triggers a manual-review halt for safety.

---

## Phase 2: Repair script implementation

**Purpose:** Build the tool that does the per-site repair. Script is the implementation of Phase 1's logic, with dry-run by default for safety.

### Task 2.1: Build `scripts/llmo-config-repair.js`

- [ ] CLI flags:
  - `--bucket <name>` (defaults to `S3_BUCKET_NAME`, hard error with exit 2 if env missing).
  - `--site <siteId>` repair a single site. Repeatable.
  - `--site-list <file>` JSON file of `[{"siteId": "...", "targetRegion": "us"}, ...]`. Loaded as the effective allowlist if provided; otherwise the script falls back to the hardcoded `AUTO_REPAIR_ALLOWLIST`. Becomes the textual record of what was actually applied (attach to the SITES-43238 closing comment).
  - `--all` repair every site listed in the effective allowlist (file or hardcoded).
  - `--region <xx>` target region for non-allowlisted sites. **Precedence: allowlist wins.** For a site that is in the allowlist with target `"au"`, `--region us` is ignored and the script logs `region override ignored: site is in allowlist with target=au`. `--region` is only consulted for sites NOT in the allowlist (operator extending coverage).
  - `--dry-run` and `--write` are mutually exclusive. **Passing both is a hard error (exit 2).** Default is `--dry-run`; `--write` must be passed explicitly to mutate S3. Implemented in code (not via `parseArgs`) because `node:util parseArgs` has no native mutual-exclusion: after parsing, the script asserts `!(values['dry-run'] && values.write)`.
  - `--backup-dir <path>` (default `/tmp/llmo-config-repair-backups/`): the pre-repair config is written here before `PutObject`. **A failed backup write aborts before any `PutObject`** (exit 2). The local backup is a hard prerequisite, not convenience — S3 versioning is the safety net for a successful write, the local backup is the safety net for the write attempt itself.
  - `--concurrency <n>` default `1`. Repair touches at most 22 objects; parallelism here adds interleaved log output without wall-time benefit, and serial output makes operator review of `--dry-run` and `--write` easier.

- [ ] Hardcoded `AUTO_REPAIR_ALLOWLIST` constant in the script: the 18 siteIds from the `auto-us-majority` + `auto-au-majority` buckets in Phase 1, each with its target region. `--all` only processes sites in the effective allowlist; sites outside it require explicit `--site <id>` AND `--region <xx>`.

- [ ] Bad-region set: hardcoded `BAD_REGION_VALUES` Set of the 9 known classifier strings. Anything not in this set and not matching the alpha-2 pattern triggers a hard error in repair (operator must extend the set deliberately).

- [ ] Repair logic per config:
  - Walk `categories.<uuid>.region`: if string, drop iff in `BAD_REGION_VALUES`, replace with target. If array, filter out `BAD_REGION_VALUES` entries, replace empty with `[target]`, dedupe.
  - Walk `aiTopics.<uuid>.prompts[N].regions`: filter `BAD_REGION_VALUES`, dedupe. If empty, set to `[target]`.
  - Same walk on `topics.<uuid>.prompts[N].regions` for symmetry (sweep showed this path isn't currently affected, but cover it).

- [ ] **Idempotency contract.** After the walk, deep-equal the repaired object against the original config. If unchanged, skip the write entirely and log `siteId=<id> status=unchanged` — do **not** `PutObject`. This makes re-runs safe and keeps S3 version history clean.

- [ ] After in-memory repair: `schemas.llmoConfig.safeParse(repaired)`. If it still fails, log issues, write nothing, exit 2 (operator must investigate).

- [ ] On success in `--write` mode (when the deep-equal check says the repair is a real change):
  - Write the backup to `<backup-dir>/<siteId>-<timestamp>-before.json`. Abort with exit 2 on backup write failure.
  - `PutObjectCommand` the repaired config to S3.
  - Re-read with `readConfig` from `@adobe/spacecat-shared-utils` and confirm parse succeeds. **Using `readConfig` rather than `GetObject + safeParse` directly is deliberate — it exercises the same code path the api-service uses for the SITES-43238 reproducer, so a green re-read mirrors what callers will see.**
  - Append a structured trailer line: `{"siteId":"...","status":"ok","versionBefore":"...","versionAfter":"...","changedPaths":["categories.<uuid>.region","aiTopics.<uuid>.prompts.0.regions",...]}`.

- [ ] In `--dry-run` mode, output is grouped per site and shows **only the fields that change**, in the form `path: <before> -> <after>`. Full-JSON dumps are excluded — they swamp the operator's terminal. The structured trailer line is still emitted with `status="dry-run"`.

- [ ] Exit codes:
  - 0: every requested site is in one of `ok`, `dry-run`, or `unchanged` end-states.
  - 2: any error during processing (validation failure, backup write failure, S3 error, post-write re-read failure).
  - **Batch policy: continue-on-error.** `--all` does not abort on the first failure; it processes every site, prints the structured trailer per site, and the final exit code is non-zero if any site ended in an error state. Decision rationale: a 17-site batch with one mid-run failure should still produce a complete report so the operator sees the whole picture.

### Task 2.2: Local hand-test on the canonical reproducer in dry-run

- [ ] `node scripts/llmo-config-repair.js --bucket spacecat-prod-importer --site 78d59744-e06c-4d14-a77a-9490c1464116`
- [ ] Inspect the printed diff. Confirm only category-region and prompt-region fields change; nothing else.
- [ ] Confirm the post-repair config validates locally (script's own `safeParse` step prints success).

**Validation gate (Phase 2):**

- `node --check scripts/llmo-config-repair.js` passes.
- Dry-run against `78d59744...` prints a non-empty diff and the in-memory validation succeeds.
- Dry-run against a known-clean site is a no-op (no diff, no validation surprises).
- `npm run lint` unaffected (script is in `scripts/`, excluded by `eslint.config.js`).

---

## Phase 3: Step 3b — repair the canonical reproducer

**Purpose:** Apply the repair to one site under direct operator supervision before batching.

### Task 3.1: Run with `--write` against `78d59744-e06c-4d14-a77a-9490c1464116`

- [ ] `klam credentials -f spacecat-prod -c true` to refresh creds.
- [ ] `node scripts/llmo-config-repair.js --bucket spacecat-prod-importer --site 78d59744-e06c-4d14-a77a-9490c1464116 --write`
- [ ] Confirm script reports success with `versionBefore` and `versionAfter`.
- [ ] Confirm backup file exists in `--backup-dir` and is byte-identical to the original.

### Task 3.2: Verify the original SITES-43238 reproducer is now happy

- [ ] `curl -H "Authorization: Bearer $(mysticat auth token --ims)" 'https://spacecat.experiencecloud.live/api/v1/sites/78d59744-e06c-4d14-a77a-9490c1464116/llmo/config'`
- [ ] Expected: HTTP 200, valid JSON body (was HTTP 400 with Zod errors when SITES-43238 was filed).

### Task 3.3: Re-run the sweep, scoped to this one site

- [ ] `node scripts/llmo-config-sweep.js --bucket spacecat-prod-importer --limit 1` (verify the sweep machinery still works — this is a side-effect-free sanity check, not a replacement for the targeted assertion).
- [ ] Better: `aws s3 cp s3://spacecat-prod-importer/config/llmo/78d59744-e06c-4d14-a77a-9490c1464116/lmmo-config.json - --profile spacecat-prod | node -e "const data=require('fs').readFileSync(0,'utf8'); const { schemas } = require('@adobe/spacecat-shared-utils'); const r = schemas.llmoConfig.safeParse(JSON.parse(data)); console.log(r.success ? 'VALID' : JSON.stringify(r.error.issues, null, 2));"`

**Validation gate (Phase 3):**

- HTTP 200 from the api-service GET for site `78d59744...`.
- One-site safeParse returns `success: true`.
- Backup file present.
- No regressions reported by anyone using that site for the next 24h (passive watch).

---

## Phase 4: Step 3c — batch repair the remaining 18 auto-repair sites

**Purpose:** Apply the same logic across the rest of the allowlist now that one site has validated the approach.

### Task 4.1: Repair the 17 `auto-us-majority` sites (minus `78d59744...`, already done in Phase 3)

- [ ] `node scripts/llmo-config-repair.js --bucket spacecat-prod-importer --all --write`
- [ ] Script iterates over the effective allowlist, **continue-on-error**. The already-repaired canonical site lands as `status=unchanged` per the idempotency contract.
- [ ] Collect the structured trailer lines — these are the artifact for the SITES-43238 closing comment.

**Review gate between Task 4.1 and Task 4.2.**

- [ ] Inspect Task 4.1's trailer output. Every site should be `ok` or `unchanged`. Any `error` rows are investigated before proceeding to 4.2. The point of separating the AU repair from the US batch is to keep this gate explicit — the AU site uses a different target region and a different command line, so it deserves a deliberate decision-point rather than being folded into a single `--all` run.

### Task 4.2: Repair the 1 `auto-au-majority` site

- [ ] `node scripts/llmo-config-repair.js --bucket spacecat-prod-importer --site 8b65ba43-1f17-43aa-bf7d-51c571463f85 --write`
- [ ] No `--region` flag needed: `8b65ba43-...` is in `AUTO_REPAIR_ALLOWLIST` with target `"au"`, and the allowlist wins per the precedence rule in Task 2.1.

### Task 4.3: Re-run the full sweep

- [ ] `node scripts/llmo-config-sweep.js --bucket spacecat-prod-importer --out /tmp/llmo-config-sweep-post-repair-$(date -u +%Y%m%dT%H%M%S).json`
- [ ] Expected: `schemaInvalid` drops from 22 to **4** (the manual-bucket sites only).
- [ ] Diff the affected siteId list against Phase 1's table.

**Validation gate (Phase 4):**

- Post-repair sweep shows exactly 4 schema-invalid configs, and they are precisely the 4 `manual-*` siteIds from Phase 1.
- For each of the 18 auto-repaired sites, the api-service GET endpoint returns HTTP 200.
- Backups present for all 18.
- Structured trailer JSON for every site captured (file or stdout-redirect) for the SITES-43238 audit trail.

---

## Phase 5: Manual review of the 4 remaining sites

**Purpose:** Make per-site decisions where the data does not auto-resolve.

### Task 5.1: Decide target region for each

- [ ] `11692c48-...` (Indeed-related, `manual-no-signal`): operator confirms target region (almost certainly `"us"`; verify against site config / base URL).
- [ ] `4ee18233-...` (German categories, `manual-no-signal`): operator confirms `"de"` vs `"us"`.
- [ ] `bd2cbfb7-...` (German categories with `"unknown"` region, `manual-mixed-mislabel`): operator confirms `"de"` vs other.
- [ ] Record rationale per site. The two German-language sites may resolve to the same target; apply per-site regardless to keep the audit trail clean.

### Task 5.2: Repair each with `--site <id> --region <xx> --write`

- [ ] Once target region is decided, run the script per-site.

**Validation gate (Phase 5):**

- All 4 sites now safeParse-clean.
- Post-repair sweep returns `schemaInvalid: 0`.

---

## Phase 6: Cleanup and ticket close

### Task 6.1: Final sweep + ticket update

- [ ] Run a final full sweep, attach the report (or summary) to SITES-43238.
- [ ] Comment on SITES-43238: step 3 complete, bucket is 100% schema-valid, no new corruption since 2026-05-04.

### Task 6.2: Lifecycle cleanup

- [ ] **Delete `scripts/llmo-config-repair.js`.** Single-use by construction (hardcoded `AUTO_REPAIR_ALLOWLIST`, closed-set `BAD_REGION_VALUES`); the platform fixes prevent recurrence of this specific corruption class.
- [ ] **Keep `scripts/llmo-config-sweep.js`.** Reusable primitive: schema-conformance scanner over an S3 prefix with concurrency and structured output. Any future schema drift on any S3-backed config will want exactly this tool. Carrying cost is near-zero. If `spacecat-audit-worker` is later archived as part of the mystique migration, promote the sweep to a tooling location at that point rather than deleting it.
- [ ] Note both decisions in the SITES-43238 closing comment.

### Task 6.3: DRS coordination — file sibling ticket with explicit steady-state intent

- [ ] **Steady-state intent (decision for this plan):** the writer-side filter in `spacecat-audit-worker/src/drs-prompt-generation/drs-config-writer.js` is a **permanent** defense-in-depth guard, not a temporary measure. Once the upstream DRS bug is fixed, the filter still adds value: it caps the trust placed in any single producer of LLMO config data. The filter cost is negligible (one `Set.has` per region value).
- [ ] File DRS sibling ticket on the upstream team's tracker. Title: "DRS emits prompt-intent classifier strings as `region` values (root cause of SITES-43238)". Include: the closed set of 9 bad values, a pointer to this plan, the affected siteIds, and a request for DRS to validate `region` against ISO-3166 alpha-2 on its end.
- [ ] Sibling ticket has a named DRS-team owner. The audit-worker side has no further code change pending — only data-quality improvement upstream.

### Task 6.4: Followup — incident postmortem in `mysticat-architecture/`

- [ ] Open a separate PR against `mysticat-architecture/` capturing the cross-system narrative for this incident. The home is `mysticat-architecture/platform/decisions/` (ADR-style) or `mysticat-architecture/products/llmo/` (incident-style), whichever the documentation guide steers to once the doc is drafted.
- [ ] Content: DRS emission root cause, the writer-side filter as steady-state guard (rationale), the read/write schema asymmetry that step 2 closed, the semantic-release BREAKING-CHANGE-footer behavior (didn't promote to major), the sweep tool's broader applicability beyond this one bug.
- [ ] Why this is a separate followup, not part of this PR: the cross-system narrative outlives audit-worker (which is on a deprecation path as audits migrate to mystique). Co-locating it with the repair runbook in this repo ties its lifetime to the runbook's, which is wrong.

**Validation gate (Phase 6):**

- SITES-43238 resolved.
- `scripts/llmo-config-repair.js` removed; `scripts/llmo-config-sweep.js` retained with rationale.
- DRS sibling ticket filed, linked from SITES-43238, with a named owner.
- `mysticat-architecture/` postmortem PR open (does not block SITES-43238 closure but is named here so the followup is not lost).

---

## Risks

1. **Inference can be wrong.** Setting `region: "us"` on a topical-named category when the site is actually targeting another market silently mislabels it. Mitigation: the allowlist is hand-curated from sweep data (Phase 1), and 17 of the 18 auto-repair sites have multiple existing `"us"` categories anchoring the inference. The remaining 1 (`8b65ba43-...` AU) has unanimous `"au"`. Sites without a unanimous internal signal are routed to manual review.

2. **Backup loss.** Local `/tmp` backups disappear if the operator host is recycled. Mitigation: the S3 bucket has versioning enabled (`versionId` is returned from `writeConfig`), so the previous version is always recoverable from S3 itself. The local backup is convenience.

3. **In-flight DRS writes during repair.** A DRS prompt-generation completion could re-write the config concurrently with the repair, overwriting it. Mitigation: step 1 (writer-side filter) now drops the bad data before it can reach S3, so a DRS write *would* produce a clean config either way. Worst case: the DRS write loses our regions[] additions on prompts, but the result is still schema-valid.

4. **Script bug corrupts more configs.** Mitigation: dry-run is the default; `--write` is required to mutate; in-memory `safeParse` runs before PutObject; post-write read-back re-validates; S3 versioning preserves the prior version. Multiple independent backstops.

## Deferred

- A repair tool retained as a permanent part of the toolset. Not worth the carrying cost — the platform-level fixes (step 1 + step 2) mean this class of corruption cannot recur. Tracked under "Lifecycle cleanup" in Phase 6.

## Timeline estimate

- Phase 2 (script implementation): 0.5 day
- Phase 3 (canonical repair + verification): 0.25 day
- Phase 4 (batch repair + sweep verification): 0.25 day
- Phase 5 (manual review + repair): 0.5 day (depends on operator availability for the 4 manual cases)
- Phase 6 (cleanup): 0.25 day

Total: ~1.5 days of operator-time, two calendar days if Phase 5 is interactive.
