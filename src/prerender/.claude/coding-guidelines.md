# Coding Guidelines & PR Checklist — Prerender Audit

Read this before writing or reviewing any change to `src/prerender/`.

---

## 1 · Respect Invariants First

Before changing any logic, check [decision-log.md](decision-log.md) for a decision entry covering that area.

**Hard rules**:
- The audit worker only writes status `NEW` (on creation) and `OUTDATED` (on update) — never any other status
- `data.coveredByDomainWide` is the only `Suggestion.data` field the main handler mutates on existing suggestions
- `data.aiSummary` + `data.valuable` are only mutated by `guidance-handler.js` (always as a pair — never independently)
- `data.edgeDeployed` is never written by the audit worker — it is owned exclusively by user deploy action via `spacecat-api-service`
- All other `Suggestion.data` fields (`scrapeJobId`, `wordCountBefore`, etc.) are write-once at creation time

If a proposed change would violate any of these, that's a signal to re-examine the approach, not to patch around it.

---

## 2 · Extension Over Modification

Prefer adding new behavior alongside existing logic over replacing it.

- If you're modifying a guard condition (e.g., OUTDATED marking, ACTIVE_STATUSES, bot-block thresholds) — document why the invariant is changing in `decision-log.md` before merging
- If you're changing what data fields get written to `status.json` or `Suggestion.data` — treat it as a locked-contract change (see §6)
- When in doubt: does this change break any of the 10 behavioral contract tests listed in CLAUDE.md? Run them first

---

## 3 · KISS · DRY · YAGNI · SOLID

| Principle | What it means here |
|-----------|-------------------|
| **KISS** | If a function needs a paragraph comment to explain what it does, simplify it. The prerender handler grew to 1,875 lines because of incremental complexity — resist adding more |
| **DRY** | `normalizePathname` is in `src/utils/utils.js` (shared by 10+ audits). `mergeAndGetUniqueHtmlUrls` is in `src/prerender/utils/utils.js`. Check before writing a new URL utility |
| **YAGNI** | Don't add configuration flags, fallback modes, or "future-proof" abstractions unless there's an active requirement. `MODE_AI_ONLY` and `DAILY_BATCH_SIZE` exist because they were needed — not as contingencies |
| **SOLID** | Single responsibility: scraping submission, content comparison, suggestion sync, and Mystique queuing are separate concerns — keep them that way when extracting modules |

---

## 4 · Test-First for Any Refactoring

1. Write (or verify) behavioral contract tests covering the function's observable output before touching the implementation
2. Confirm tests pass on the existing code
3. Extract / refactor
4. Confirm the same tests still pass — no new test logic needed if behavior is unchanged
5. Update all `esmock` stub paths in the **same PR** as the function move — never leave stubs pointing at the old path

The 10 contract tests in CLAUDE.md are the minimum bar. Each covers a non-obvious invariant that has caused production incidents.

---

## 5 · Bulk DB Operations — No N+1

The PostgREST connection pool is **200 connections shared across 10 ECS tasks** (20 per task). A loop of individual saves will exhaust it under load.

| Instead of | Use |
|------------|-----|
| `Promise.all(items.map(i => i.save()))` | `Suggestion.saveMany(items)` |
| `for (id of ids) Suggestion.findById(id)` | `Suggestion.batchGetByKeys(keys)` |
| `Promise.all(items.map(i => i.remove()))` | `Suggestion.removeByIds(ids)` |

This applies to: `syncSuggestions`, `markDeployedUrlSuggestionsAsCovered`, `guidance-handler.js` batch saves, and any new loop over suggestions.

---

## 6 · Locked-Contract Checklist

Stop and coordinate with UI and api-service teams before merging if your change touches any of:

- [ ] `status.json` field names or semantics → impacts `project-elmo-ui` directly
- [ ] `Suggestion.data` field names → impacts `spacecat-api-service` DTOs and `project-elmo-ui` display
- [ ] S3 path format (`sanitizeImportPath` regex) → breaks historical artifact lookups
- [ ] `shouldPreserveDomainWideSuggestion` logic → changes which domain-wide suggestions survive audit runs
- [ ] `processingType: 'prerender'` in `createScrapeJob` call → must match `PrerenderHandler.accepts()` in scraper
- [ ] Mystique SQS payload shape → must include `suggestionId`; Pydantic validates it on the other end

For any of these: open a coordination issue, get sign-off, then merge.

---

## 7 · Log Level Discipline

| Level | Use for |
|-------|---------|
| `log.info` | Key audit milestones (batch submitted, sync complete, bot-block detected), metrics that ops monitors |
| `log.debug` | Verbose per-URL tracing, intermediate values, fallback path taken |
| `log.warn` | Unexpected-but-recoverable (missing scrapeJobId, suggestion skipped, fallback activated) |
| `log.error` | Actual failures that abort processing or require investigation |

Several PRs existed purely to downgrade noise (#2314, #2305). Don't log at `error` for expected edge cases (missing optional field, empty result set).

---

## 8 · 100% c8 Coverage

Coverage is enforced at 100% lines/branches/statements. Every new code path must be tested.

- `/* c8 ignore next N */` is allowed **only** with an explanation comment stating why the branch is untestable (environment-dependent, defensive guard for impossible state, etc.)
- Never use `c8 ignore` to hide testable logic
- **`c8 ignore` means "not tested" — it does NOT mean "unreachable in production"**. Code with `c8 ignore` can and does run in production (e.g. the step 3 fallback path fires when `scrapeResultPaths` is empty — all scrapes failed). Don't infer from `c8 ignore` that code is dead or safe to delete without understanding when it actually executes.
- When extracting a function to a new file, review any existing `c8 ignore` comments — branches that were untestable in the old context may now be testable in isolation

---

## 9 · Update the Brain Map on Every PR

When a PR changes behavior, update the relevant doc:

| Change type | Update |
|-------------|--------|
| New invariant or changed logic | `CLAUDE.md` — relevant section + Key Invariants if applicable |
| Why a non-obvious decision was made | `decision-log.md` — new D-XX entry |
| Scraper output format / S3 schema | `.claude/scraper-internals.md` |
| Shared package API change | `.claude/shared-packages.md` |
| status.json or Suggestion.data field change | `.claude/ui-data-map.md` + `.claude/api-service-deploy-rollback.md` |
| New write to Suggestion.data or status | `CLAUDE.md` — "What the audit worker writes" table |

The brain map is only useful if it stays current. A stale doc is worse than no doc — future Claude (and future engineers) will trust it and get burned.
