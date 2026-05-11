# LLMO Config Repair — Step 3b/3c of SITES-43238

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the 22 LLMO configs in `s3://spacecat-prod-importer/config/llmo/<siteId>/lmmo-config.json` that fail the published Zod schema. Bring the bucket to 100% schema-valid. Step 3b is the canonical-reproducer repair (one site), step 3c is the batch over the remaining 21.

**Architecture:** A one-off operational script `scripts/llmo-config-repair.js` in `spacecat-audit-worker`, sibling to `llmo-config-sweep.js`. Pulls a config, derives the target region per category from existing valid signals in the same config (majority rule), rewrites the bad fields, validates with `schemas.llmoConfig.safeParse`, writes back via `PutObjectCommand`. Supports `--dry-run`, `--site <id>`, and a hardcoded allowlist of sites pre-classified as "auto-repairable" vs "needs manual review".

**Tech Stack:** Node.js ESM (matching the rest of `scripts/`), `@aws-sdk/client-s3`, `@adobe/spacecat-shared-utils` (`schemas.llmoConfig` for validation). No new dependencies.

**Context**

- Step 3a (sweep) ran 2026-05-11 against prod. 7,481 configs scanned, 22 schema-invalid (0.29%).
- All 22 corrupt configs were written between 2025-11-12 and 2026-04-30, i.e. **before** step 1 (writer-side filter, merged 2026-05-04) and step 2 (fail-closed writeConfig, merged 2026-05-04). No new corruption since the fix.
- The bad data is **not** what the original SITES-43238 description assumed. Instead of malformed region codes (`"en-us"`, `"global"`), DRS was emitting **prompt-intent / search-stage classifiers** as `region` values: `"comparative"`, `"instructional"`, `"informational"`, `"comparison & decision"`, `"discovery & research"`, `"usage & troubleshooting"`, `"scheduling & appointments"`, `"online resources & accessibility"`, `"unknown"`.

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

**manual-mixed-mislabel** (2 sites — language/region mismatch suggests pre-existing data-quality issue, not just step-2 fallout):

| siteId | situation |
|---|---|
| `bd2cbfb7-9137-4f0d-a57f-754cf90c5163` | German categories ("Produkte", "Dienstleistungen") with `region: "unknown"`. Repair target probably "de"; needs operator confirmation. |
| `4ee18233-...` | listed in `manual-no-signal`; the mixed labels make it fit either bucket. Treat as manual. |

**Validation gate (Phase 1):** PASSED.

- 22 sites accounted for. 18 in auto-repair buckets, 4 routed to manual review (the table double-counts `4ee18233` deliberately; one of the manual buckets is the source of truth).
- The bad-region values across all 22 sites are a closed set: `"comparative"`, `"instructional"`, `"informational"`, `"comparison & decision"`, `"discovery & research"`, `"usage & troubleshooting"`, `"scheduling & appointments"`, `"online resources & accessibility"`, `"unknown"`. The repair logic recognizes only these as "bad to replace" — anything else triggers a manual-review halt for safety.

---

## Phase 2: Repair script implementation

**Purpose:** Build the tool that does the per-site repair. Script is the implementation of Phase 1's logic, with dry-run by default for safety.

### Task 2.1: Build `scripts/llmo-config-repair.js`

- [ ] CLI flags:
  - `--bucket <name>` (defaults to `S3_BUCKET_NAME`, required if env missing)
  - `--site <siteId>` repair a single site
  - `--all` repair every site listed in the auto-repair allowlist
  - `--region <xx>` override the default `"us"` target (for `8b65ba43` use `--region au`)
  - `--dry-run` (default `true`): print before/after diff to stdout, do not write
  - `--write` (or `--no-dry-run`): actually `PutObject`. Mutually exclusive with `--dry-run`.
  - `--backup-dir <path>` (default `/tmp/llmo-config-repair-backups/`): always save the pre-repair config locally before writing.
  - `--concurrency` and `--limit` reused from sweep style.

- [ ] Hardcoded `AUTO_REPAIR_ALLOWLIST` constant in the script: the 18 siteIds from the `auto-us-majority` + `auto-au-majority` buckets in Phase 1, each with its target region. `--all` only processes sites in the allowlist; sites outside the allowlist require explicit `--site <id>` AND `--region <xx>`.

- [ ] Bad-region set: hardcoded `BAD_REGION_VALUES` Set of the 9 known classifier strings. Anything not in this set and not matching the alpha-2 pattern triggers a hard error in repair (operator must extend the set deliberately).

- [ ] Repair logic per config:
  - Walk `categories.<uuid>.region`: if string, drop iff in `BAD_REGION_VALUES`, replace with target. If array, filter out `BAD_REGION_VALUES` entries, replace empty with `[target]`, dedupe.
  - Walk `aiTopics.<uuid>.prompts[N].regions`: filter `BAD_REGION_VALUES`, dedupe. If empty, set to `[target]`.
  - Same walk on `topics.<uuid>.prompts[N].regions` for symmetry (sweep showed this path isn't currently affected, but cover it).

- [ ] After in-memory repair: `schemas.llmoConfig.safeParse(repaired)`. If it still fails, log issues, write nothing, exit 2 (operator must investigate).

- [ ] On success in write mode:
  - Write the backup to `<backup-dir>/<siteId>-<timestamp>-before.json`.
  - `PutObjectCommand` the repaired config to S3.
  - Re-read with `readConfig` (which fails closed since step 2) and confirm parse succeeds.
  - Print `repaired siteId=<id> versionBefore=<...> versionAfter=<...>`.

- [ ] Exit 0 only when every requested site repaired and re-validated. Any single failure exits non-zero.

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

### Task 4.1: Repair the 17 `auto-us-majority` sites (minus `78d59744...`, already done)

- [ ] `node scripts/llmo-config-repair.js --bucket spacecat-prod-importer --all --write`
- [ ] Script iterates over `AUTO_REPAIR_ALLOWLIST`, skipping any site already repaired (idempotency: a repair on an already-valid config is a no-op and prints a no-diff message).
- [ ] Inspect each `repaired siteId=...` line for the expected `versionBefore != versionAfter`.

### Task 4.2: Repair the 1 `auto-au-majority` site

- [ ] `node scripts/llmo-config-repair.js --bucket spacecat-prod-importer --site 8b65ba43-1f17-43aa-bf7d-51c571463f85 --region au --write`

### Task 4.3: Re-run the full sweep

- [ ] `node scripts/llmo-config-sweep.js --bucket spacecat-prod-importer --out /tmp/llmo-config-sweep-post-repair-$(date -u +%Y%m%dT%H%M%S).json`
- [ ] Expected: `schemaInvalid` drops from 22 to **4** (the manual-bucket sites only).
- [ ] Diff the affected siteId list against Phase 1's table.

**Validation gate (Phase 4):**

- Post-repair sweep shows exactly 4 schema-invalid configs, and they are precisely the 4 `manual-*` siteIds from Phase 1.
- For each of the 18 auto-repaired sites, the api-service GET endpoint returns HTTP 200.
- Backups present for all 18.

---

## Phase 5: Manual review of the 4 remaining sites

**Purpose:** Make per-site decisions where the data does not auto-resolve.

### Task 5.1: Decide target region for each

- [ ] `11692c48-...` (Indeed): operator confirms target region (almost certainly `"us"`; verify against site config / base URL).
- [ ] `4ee18233-...` (German categories): operator confirms `"de"` vs `"us"`.
- [ ] `bd2cbfb7-...` (German categories, `"unknown"` region): operator confirms `"de"` vs other.
- [ ] (`4ee18233-...` may resolve via `bd2cbfb7-...` decision; record one rationale, apply to both if appropriate.)

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

- [ ] Delete `scripts/llmo-config-sweep.js` and `scripts/llmo-config-repair.js`. These are one-shot tools whose value is consumed; the platform now prevents the class of issue (writer filter + fail-closed writeConfig).
- [ ] Note removal in SITES-43238 closing comment.

### Task 6.3: Followups

- [ ] File DRS sibling ticket (widened scope: DRS emits classifier strings as region values, not just `"global"`).
- [ ] Post-mortem note: semantic-release did not promote `@adobe/spacecat-shared-utils` to a major version despite the BREAKING CHANGE footer on PR 1574. Track separately so the release primitive can be fixed.

**Validation gate (Phase 6):**

- SITES-43238 resolved.
- Scripts removed from the repo.
- Followup tickets filed and linked.

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
