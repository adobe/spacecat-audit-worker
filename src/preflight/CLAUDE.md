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
