# Preflight Package

Guidance for changes under `src/preflight/`. This file is loaded automatically
when an agent works with files in this directory.

## Logging convention — MUST prefix every log with `[preflight-audit]`

Every log statement in this package (`log.info`, `log.warn`, `log.error`,
`log.debug`) **MUST** begin its message with the literal string
`[preflight-audit]`. This is a hard requirement: the prefix is what lets us
grep/filter these lines in Splunk, so an unprefixed log is effectively
invisible to on-call.

Put the prefix first, before any interpolation, and keep the existing
`site` / `job` / `step` context that surrounding lines use:

```js
// GOOD
log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Preflight audit started.`);
log.error(`[preflight-audit] site: ${site.getId()}, job: ${jobId}. Failed to cancel job.`, error);

// BAD — no prefix, will not surface in Splunk searches
log.info(`Processing preflight audit for ${site.getId()}`);
log.warn(`job ${jobId} skipped`);
```

Rules:
- The prefix is exactly `[preflight-audit]` (lower-case, hyphenated, in square
  brackets) — do not invent per-file variants like `[preflight]` or
  `[preflight-canonical]`.
- Applies to every file in this package, including sub-check handlers
  (`canonical.js`, `metatags.js`, `links.js`, `headings.js`, etc.).
- When editing an existing log line that is missing the prefix, add it as part
  of your change.
- Do not assert on the exact free-form text of a log message in tests unless
  the message is a real contract; when you do assert, match on the
  `[preflight-audit]` prefix plus the stable part so wording tweaks don't break
  tests.

## Response errors — use the `PreflightError` catalog

When the audit ends a job for a reason a consumer needs to act on (the MFE
renders it, an on-call needs to classify it), surface a **stable error code**
from the catalog in `src/preflight/error-constants.js` — do **not** hand a
consumer a freeform `reason` string to parse.

Why: the `reason` text is for humans/logs and can be reworded at any time. The
MFE (and any other consumer) keys off the `code`, maps it to its own localized
copy, and uses the `classification` to decide whether the state is retryable.
A freeform string is an implicit, unversioned contract that breaks silently the
moment someone rewords it.

### The pattern

Each catalog entry is a frozen object with four fields:

| Field | Purpose |
|-------|---------|
| `code` | Stable external identifier, `PREFLIGHT-NNN`. Part of the contract with consumers. |
| `message` | Human-readable default text. Safe to reword; consumers should not parse it. |
| `description` | Internal explanation of the cause (for developers/logs), not shown to end users. |
| `classification` | A `PreflightErrorClassification` value telling consumers how to react (e.g. `CONFIG_ERROR` = not transient, retry won't help). |

Surface it on the job's metadata `payload` when setting a terminal status:

```js
import { PreflightError } from './error-constants.js';

jobEntity.setStatus(AsyncJob.Status.CANCELLED); // or FAILED
jobEntity.setMetadata({
  payload: {
    siteId: site.getId(),
    reason: PreflightError.PREFLIGHT_DISABLED.message,
    errorCode: PreflightError.PREFLIGHT_DISABLED.code,
  },
});
```

### Adding a new response error (checklist)

1. Add a new frozen entry to `PreflightError` in `error-constants.js` with the
   next unused `PREFLIGHT-NNN` code, a `message`, a `description`, and a
   `classification`. Add a new `PreflightErrorClassification` value if none of
   the existing ones fit the consumer-reaction semantics.
2. **Never reword or reuse an existing `code`** — codes are an external
   contract. Superseding one means adding a new entry, not editing the old.
3. Reference the entry via `PreflightError.X.code` / `.message` at the point you
   set the terminal status — never inline a bare string literal for `errorCode`
   or a bespoke `reason`.
4. Coordinate the new `code` with the consuming MFE team so they can add the
   matching localized copy before it ships.
5. Add a test asserting the job's metadata carries the expected `errorCode`
   (assert on the code, which is the contract — not the free-form `message`).

### Enforcement / review expectation

This is convention, not yet a mechanical gate. On review of any change that
ends a preflight job (`setStatus(CANCELLED|FAILED)` + `setMetadata`), confirm
the payload carries an `errorCode` sourced from the catalog and that no new
`PREFLIGHT-NNN` reuses an existing code. If this drifts, the natural mechanical
enforcement is an ESLint `no-restricted-syntax` rule that flags an `errorCode`
property whose value is a string literal rather than a `PreflightError.*.code`
reference — add that rule if manual review proves insufficient.
