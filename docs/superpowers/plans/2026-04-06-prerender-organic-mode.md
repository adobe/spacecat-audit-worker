# Prerender Organic Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `run audit {site} prerender organic` Slack command support that limits the prerender audit to organic (SEO top-pages) URLs only, skipping agentic URL sources.

**Architecture:** The api-service `run-audit.js` command normalizes the positional shorthand `prerender organic` into `{"mode":"organic"}` JSON before dispatching the SQS message. The audit-worker prerender handler reads this mode in Step 2 (`submitForScraping`) and skips `getTopAgenticUrls()`, using only organic URLs from `getTopOrganicUrlsFromSeo()`. The existing `getModeFromData()` dispatch pattern (already used for `ai-only` mode) is reused — no structural changes to the pipeline.

**Tech Stack:** Node.js ESM, Mocha + Chai + Sinon + esmock (audit-worker), Mocha + Chai + Sinon + esmock (api-service)

---

## Files Changed

### spacecat-audit-worker

| File | Action | What changes |
|------|--------|--------------|
| `src/prerender/utils/constants.js` | Modify | Add `MODE_ORGANIC = 'organic'` export |
| `src/prerender/handler.js` | Modify | Import `MODE_ORGANIC`; skip agentic fetch in Step 2 when mode is `organic`; skip agentic fetch in Step 3 fallback when mode is `organic` |
| `test/audits/prerender/handler.test.js` | Modify | Add tests for `submitForScraping` in organic mode |

### spacecat-api-service

| File | Action | What changes |
|------|--------|--------------|
| `src/support/slack/commands/run-audit.js` | Modify | Normalize `auditTypeInputArg === 'prerender' && auditDataInputArg === 'organic'` to `JSON.stringify({ mode: 'organic' })` |
| `test/support/slack/commands/run-audit.test.js` | Modify | Add tests for the organic normalization |

---

## Setup: Branch from main (both repos)

- [ ] **Step 1: Pull latest main and create feature branch in audit-worker**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-audit-worker
git checkout main && git pull origin main
git checkout -b feat/prerender-organic-mode
```

- [ ] **Step 2: Pull latest main and create feature branch in api-service**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-api-service
git checkout main && git pull origin main
git checkout -b feat/prerender-organic-slack-command
```

---

## Task 1: audit-worker — `MODE_ORGANIC` constant + `submitForScraping` organic skip

**Files:**
- Modify: `src/prerender/utils/constants.js`
- Modify: `src/prerender/handler.js`
- Test: `test/audits/prerender/handler.test.js`

- [ ] **Step 1: Write the failing test**

Open `test/audits/prerender/handler.test.js`. Find the `describe('submitForScraping', ...)` block (around line 278). Add the following test **at the end of that describe block**, before its closing `});`:

```js
it('should not fetch agentic URLs when mode is organic', async () => {
  const athenaStub = sandbox.stub().resolves(['https://example.com/agentic-1']);
  const mockHandler = await esmock('../../../src/prerender/handler.js', {
    '../../../src/utils/agentic-urls.js': {
      getTopAgenticUrlsFromAthena: athenaStub,
      getPreferredBaseUrl: () => 'https://example.com',
    },
  });

  const context = {
    site: {
      getId: () => 'site-1',
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getIncludedURLs: () => [] }),
    },
    data: '{"mode":"organic"}',
    dataAccess: {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
          { getUrl: () => 'https://example.com/organic-page-1' },
          { getUrl: () => 'https://example.com/organic-page-2' },
        ]),
      },
      PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
    },
    log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
    env: {},
  };

  const result = await mockHandler.submitForScraping(context);

  expect(athenaStub).to.not.have.been.called;
  expect(result.urls).to.deep.equal([
    { url: 'https://example.com/organic-page-1' },
    { url: 'https://example.com/organic-page-2' },
  ]);
});

it('should still fetch agentic URLs when no mode is set', async () => {
  const athenaStub = sandbox.stub().resolves(['https://example.com/agentic-1']);
  const mockHandler = await esmock('../../../src/prerender/handler.js', {
    '../../../src/utils/agentic-urls.js': {
      getTopAgenticUrlsFromAthena: athenaStub,
      getPreferredBaseUrl: () => 'https://example.com',
    },
  });

  const context = {
    site: {
      getId: () => 'site-1',
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getIncludedURLs: () => [] }),
    },
    data: null,
    dataAccess: {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
      },
      PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
    },
    log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
    env: {},
  };

  await mockHandler.submitForScraping(context);

  expect(athenaStub).to.have.been.called;
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-audit-worker
npm run test:spec -- test/audits/prerender/handler.test.js
```

Expected: Two new tests fail. Error will be something like `AssertionError: expected stub to not have been called but was called once` (organic test) because `MODE_ORGANIC` doesn't exist yet.

- [ ] **Step 3: Add `MODE_ORGANIC` to constants**

Open `src/prerender/utils/constants.js`. Add the new export at the end:

```js
export const CONTENT_GAIN_THRESHOLD = 1.1;
export const TOP_AGENTIC_URLS_LIMIT = 2000;
export const DAILY_BATCH_SIZE = 320;
export const TOP_ORGANIC_URLS_LIMIT = 200;
/**
 * URLs processed within this window are treated as recently scraped and skipped.
 */
export const PRERENDER_RECENT_PROCESSING_TIME_DAYS = 7;
export const MODE_AI_ONLY = 'ai-only';
export const MODE_ORGANIC = 'organic';
```

- [ ] **Step 4: Import `MODE_ORGANIC` in handler.js and skip agentic fetch in Step 2**

Open `src/prerender/handler.js`. Find the import from `./utils/constants.js` (around line 25):

```js
import {
  CONTENT_GAIN_THRESHOLD,
  DAILY_BATCH_SIZE,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
  MODE_AI_ONLY,
} from './utils/constants.js';
```

Change it to:

```js
import {
  CONTENT_GAIN_THRESHOLD,
  DAILY_BATCH_SIZE,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
  MODE_AI_ONLY,
  MODE_ORGANIC,
} from './utils/constants.js';
```

Then in `submitForScraping` (around line 795–797), find:

```js
  const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
  // getTopAgenticUrls internally handles errors and returns [] on failure
  const agenticUrls = await getTopAgenticUrls(site, context);
```

Change it to:

```js
  const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
  // getTopAgenticUrls internally handles errors and returns [] on failure
  const agenticUrls = mode === MODE_ORGANIC ? [] : await getTopAgenticUrls(site, context);
```

- [ ] **Step 5: Skip agentic fetch in Step 3 fallback**

In `processContentAndGenerateOpportunities` (around line 1440–1447), find the fallback else block:

```js
      // Fetch agentic URLs only for URL list fallback
      try {
        agenticUrls = await getTopAgenticUrls(site, context);
      } catch (e) {
        log.warn(`${LOG_PREFIX} Failed to fetch agentic URLs for fallback: ${e.message}. baseUrl=${site.getBaseURL()}`);
      }
```

Change it to:

```js
      // Fetch agentic URLs only for URL list fallback (skipped in organic mode)
      if (mode !== MODE_ORGANIC) {
        try {
          agenticUrls = await getTopAgenticUrls(site, context);
        } catch (e) {
          log.warn(`${LOG_PREFIX} Failed to fetch agentic URLs for fallback: ${e.message}. baseUrl=${site.getBaseURL()}`);
        }
      }
```

Note: This entire `else` block is already wrapped in `/* c8 ignore start */` / `/* c8 ignore stop */` comments, so no new test is needed for the fallback path — it is excluded from the 100% coverage requirement.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-audit-worker
npm run test:spec -- test/audits/prerender/handler.test.js
```

Expected: All tests pass including the two new ones.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-audit-worker
npm test
```

Expected: All tests pass, 100% coverage maintained.

- [ ] **Step 8: Commit**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-audit-worker
git add src/prerender/utils/constants.js src/prerender/handler.js test/audits/prerender/handler.test.js
git commit -m "feat(prerender): add organic-only mode to skip agentic URL sources"
```

---

## Task 2: api-service — Normalize `prerender organic` in `run-audit.js`

**Files:**
- Modify: `src/support/slack/commands/run-audit.js`
- Test: `test/support/slack/commands/run-audit.test.js`

- [ ] **Step 1: Write the failing tests**

Open `test/support/slack/commands/run-audit.test.js`. Find the `describe('Handle Execution Method', ...)` block. Add the following two tests after the existing positional-format tests (near line 388, after the `'falls back to positional format when no keywords are provided'` test):

```js
it('normalizes "prerender organic" positional shorthand to organic mode JSON', async () => {
  dataAccessStub.Site.findByBaseURL.resolves({ getId: () => 'site-1' });
  dataAccessStub.Configuration.findLatest.resolves(
    createDefaultConfigurationMock('prerender', ['LLMO']),
  );
  const command = RunAuditCommand(context);

  await command.handleExecution(['validsite.com', 'prerender', 'organic'], slackContext);

  expect(slackContext.say.firstCall.args[0]).to.include(':adobe-run: Triggering prerender audit for https://validsite.com');
  expect(sqsStub.sendMessage).called;
  const auditData = sqsStub.sendMessage.firstCall.args[1].data;
  expect(JSON.parse(auditData)).to.deep.equal({ mode: 'organic' });
});

it('does not normalize "organic" auditData for non-prerender audit types', async () => {
  dataAccessStub.Site.findByBaseURL.resolves({ getId: () => 'site-1' });
  dataAccessStub.Configuration.findLatest.resolves(
    createDefaultConfigurationMock('lhs-mobile', ['LLMO']),
  );
  const command = RunAuditCommand(context);

  await command.handleExecution(['validsite.com', 'lhs-mobile', 'organic'], slackContext);

  expect(sqsStub.sendMessage).called;
  const auditData = sqsStub.sendMessage.firstCall.args[1].data;
  expect(auditData).to.equal('organic');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-api-service
npx mocha test/support/slack/commands/run-audit.test.js
```

Expected: Two new tests fail. The first will fail because `auditData` will be `'organic'` instead of `'{"mode":"organic"}'`.

- [ ] **Step 3: Add the normalization to `run-audit.js`**

Open `src/support/slack/commands/run-audit.js`. In `handleExecution`, find the `else if (hasValidBaseURL)` block (near the bottom of the function):

```js
      } else if (hasValidBaseURL) {
        const auditType = auditTypeInputArg || LHS_MOBILE;
        say(`:adobe-run: Triggering ${auditType} audit for ${baseURL}`);
        await runAuditForSite(baseURL, auditType, auditDataInputArg, slackContext);
      }
```

Change it to:

```js
      } else if (hasValidBaseURL) {
        const auditType = auditTypeInputArg || LHS_MOBILE;

        // Normalize 'prerender organic' positional shorthand to structured mode flag
        if (auditType === 'prerender' && auditDataInputArg === 'organic') {
          auditDataInputArg = JSON.stringify({ mode: 'organic' });
        }

        say(`:adobe-run: Triggering ${auditType} audit for ${baseURL}`);
        await runAuditForSite(baseURL, auditType, auditDataInputArg, slackContext);
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-api-service
npx mocha test/support/slack/commands/run-audit.test.js
```

Expected: All tests pass including the two new ones.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-api-service
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-api-service
git add src/support/slack/commands/run-audit.js test/support/slack/commands/run-audit.test.js
git commit -m "feat(slack): normalize 'prerender organic' positional args to organic mode"
```

---

## Task 3: Raise Pull Requests

- [ ] **Step 1: Push audit-worker branch and open PR**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-audit-worker
git push -u origin feat/prerender-organic-mode
```

Open a PR against `main` with the following description:

**Title:** `feat(prerender): add organic-only mode to skip agentic URL sources`

**Body:**
```
## Summary

The prerender audit was moved to a schedule-based approach, which removed the ability to run it manually against organic (SEO top-pages) traffic only. This PR adds an `organic` mode to the prerender handler that, when activated, skips fetching agentic (LLM/AI) URLs and limits scraping to organic pages only.

### Changes

- **`src/prerender/utils/constants.js`**: Added `MODE_ORGANIC = 'organic'` export alongside the existing `MODE_AI_ONLY`.
- **`src/prerender/handler.js`**:
  - `submitForScraping` (Step 2): when `getModeFromData(data) === MODE_ORGANIC`, skips `getTopAgenticUrls()` and uses only `getTopOrganicUrlsFromSeo()` (≤200 URLs).
  - `processContentAndGenerateOpportunities` (Step 3 fallback): also skips the agentic fetch when mode is `organic`.

### How to trigger

Via the companion api-service PR, the Slack command becomes:

```
run audit <site-url> prerender organic
```

### Testing

- Added two tests for `submitForScraping`:
  - Verifies `getTopAgenticUrlsFromAthena` is NOT called when `data='{"mode":"organic"}'`
  - Verifies `getTopAgenticUrlsFromAthena` IS still called when no mode is set (regression guard)
- All existing prerender tests continue to pass
- 100% line/branch/statement coverage maintained
```

- [ ] **Step 2: Push api-service branch and open PR**

```bash
cd /Users/ssilare/Developer/projects/ssilare-adobe/spacecat-api-service
git push -u origin feat/prerender-organic-slack-command
```

Open a PR against `main` with the following description:

**Title:** `feat(slack): add 'prerender organic' command support to run-audit`

**Body:**
```
## Summary

Extends the `run audit` Slack command to support a new positional shorthand for triggering the prerender audit in organic-only mode:

```
run audit <site-url> prerender organic
```

### Changes

- **`src/support/slack/commands/run-audit.js`**: In the positional-args branch of `handleExecution`, normalizes `auditType='prerender'` + `auditData='organic'` to `auditData='{"mode":"organic"}'` before dispatching the SQS message. This passes a structured mode flag to the audit-worker handler.

### Behaviour

- Entitlement checks, site lookup, and handler-enabled checks apply unchanged.
- `run audit {site} all` is unaffected — the `ALL_AUDITS` list does not change.
- `organic` is only special-cased when the audit type is `prerender`; other types receive `organic` as raw audit data (unchanged).
- Keyword format `run audit {site} audit:prerender mode:organic` already works and continues to work — this PR adds the simpler positional shorthand on top.

### Depends on

> Companion audit-worker PR: [link to audit-worker PR]

### Testing

- Added two tests:
  - `run audit <site> prerender organic` → `sqsStub.sendMessage` called with `data='{"mode":"organic"}'`
  - `run audit <site> lhs-mobile organic` → `auditData` remains `'organic'` (no cross-audit side effects)
- All existing run-audit tests continue to pass
```
