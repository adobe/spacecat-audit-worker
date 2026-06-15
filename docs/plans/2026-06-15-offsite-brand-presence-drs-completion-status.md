# DRS Job Completion Status for offsite-brand-presence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `offsite-brand-presence` submits DRS scrape jobs and posts their `job_id`s to Slack, post one follow-up summary in the same thread once all jobs reach a terminal status (or after a ~20-minute wait budget).

**Architecture:** A new lightweight message type, `offsite-brand-presence-drs-status`, is enqueued by the runner after a successful DRS submission (only when a Slack thread context is present). A dedicated poll handler calls `drsClient.getJob()` for each tracked job and either posts the summary (all terminal, or past deadline) or re-enqueues itself with an SQS delay. State (job list, Slack context, absolute deadline) rides inside the SQS message, so each invocation is self-describing.

**Tech Stack:** Node 24 ESM, AWS Lambda + SQS, `@adobe/spacecat-shared-drs-client`, Mocha + Chai + Sinon + esmock, c8 coverage (100% lines/branches/statements).

**Spec:** `docs/specs/2026-06-15-offsite-brand-presence-drs-completion-status.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/offsite-brand-presence/constants.js` | Add poll interval, max-wait budget, terminal-status set |
| Create | `src/offsite-brand-presence/drs-status-handler.js` | Poll DRS job statuses, re-enqueue or post summary |
| Modify | `src/offsite-brand-presence/handler.js` | Enqueue the poll message after a successful submission |
| Modify | `src/index.js` | Register `offsite-brand-presence-drs-status` handler |
| Create | `test/audits/offsite-brand-presence-drs-status.test.js` | Tests for the poll handler |
| Modify | `test/audits/offsite-brand-presence.test.js` | Tests for runner enqueue behavior |

---

## Task 1: Add constants

**Files:**
- Modify: `src/offsite-brand-presence/constants.js` (append after line 62)

- [ ] **Step 1: Add the constants**

Append to the end of `src/offsite-brand-presence/constants.js`:

```js
// DRS job completion polling (offsite-brand-presence-drs-status handler).
export const DRS_POLL_INTERVAL_SECONDS = 120; // 2 minutes between polls
export const DRS_POLL_MAX_WAIT_SECONDS = 1200; // 20 minute total budget
export const DRS_STATUS_AUDIT_TYPE = 'offsite-brand-presence-drs-status';
export const DRS_TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
]);
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint -- src/offsite-brand-presence/constants.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/offsite-brand-presence/constants.js
git commit -m "feat(offsite-brand-presence): add DRS completion polling constants"
```

---

## Task 2: Poll handler — all-terminal summary path

**Files:**
- Create: `src/offsite-brand-presence/drs-status-handler.js`
- Test: `test/audits/offsite-brand-presence-drs-status.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/audits/offsite-brand-presence-drs-status.test.js`:

```js
/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('offsite-brand-presence DRS status handler', () => {
  let sandbox;
  let handler;
  let mockGetJob;
  let mockPostMessageOptional;
  let context;
  let log;

  const BASE_URL = 'https://example.com';
  const SITE_ID = 'site-123';

  function buildMessage(overrides = {}) {
    return {
      type: 'offsite-brand-presence-drs-status',
      siteId: SITE_ID,
      auditContext: {
        baseURL: BASE_URL,
        slackContext: { channelId: 'C123', threadTs: '111.222' },
        jobs: [
          { domain: 'reddit.com', datasetId: 'reddit_comments', jobId: 'job-1' },
          { domain: 'youtube.com', datasetId: 'youtube_videos', jobId: 'job-2' },
        ],
        deadline: Date.now() + 600000,
        ...overrides,
      },
    };
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockGetJob = sandbox.stub();
    mockPostMessageOptional = sandbox.stub().resolves({ success: true, result: {} });

    handler = await esmock('../../src/offsite-brand-presence/drs-status-handler.js', {
      '@adobe/spacecat-shared-drs-client': {
        default: { createFrom: () => ({ getJob: mockGetJob }) },
      },
      '../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
    });

    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    context = {
      log,
      sqs: { sendMessage: sandbox.stub().resolves() },
      dataAccess: {
        Configuration: {
          findLatest: sandbox.stub().resolves({ getQueues: () => ({ audits: 'audits-queue-url' }) }),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('posts a single summary when all jobs are terminal', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED_WITH_ERRORS' });

    const result = await handler.default(buildMessage(), context);

    expect(result.status).to.equal(200);
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(mockPostMessageOptional).to.have.been.calledOnce;
    const [, channelId, text, opts] = mockPostMessageOptional.firstCall.args;
    expect(channelId).to.equal('C123');
    expect(opts).to.deep.equal({ threadTs: '111.222' });
    expect(text).to.include('example.com');
    expect(text).to.include('reddit_comments');
    expect(text).to.include('COMPLETED');
    expect(text).to.include('COMPLETED_WITH_ERRORS');
  });

  it('includes the error message for a failed job', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'FAILED', error_message: 'boom' });

    await handler.default(buildMessage(), context);

    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.include('FAILED');
    expect(text).to.include('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:spec -- test/audits/offsite-brand-presence-drs-status.test.js`
Expected: FAIL — cannot find module `src/offsite-brand-presence/drs-status-handler.js`.

- [ ] **Step 3: Write the handler**

Create `src/offsite-brand-presence/drs-status-handler.js`:

```js
/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { ok } from '@adobe/spacecat-shared-http-utils';
import DrsClient from '@adobe/spacecat-shared-drs-client';
import { postMessageOptional } from '../utils/slack-utils.js';
import { DRS_POLL_INTERVAL_SECONDS, DRS_TERMINAL_STATUSES } from './constants.js';

const LOG_PREFIX = '[offsite-brand-presence][drs-status]';
const SQS_MAX_DELAY_SECONDS = 900;

/**
 * Builds the Slack completion summary. One line per job: terminal jobs show their
 * status (and error for FAILED/CANCELLED); jobs still non-terminal at the deadline
 * are reported as still running.
 *
 * @param {string} baseURL - The site's base URL
 * @param {Array<{domain: string, datasetId: string, status: string|undefined,
 *   error: string|undefined}>} statuses - Resolved per-job statuses
 * @returns {string} Slack message text
 */
function buildSummary(baseURL, statuses) {
  const lines = [`:checkered_flag: *offsite-brand-presence* DRS jobs *complete* for *${baseURL}*:`];
  for (const s of statuses) {
    const label = `\`${s.domain}\` / \`${s.datasetId}\``;
    if (!DRS_TERMINAL_STATUSES.has(s.status)) {
      lines.push(`• ${label} → still running (timed out waiting)`);
    } else if (s.status === 'FAILED' || s.status === 'CANCELLED') {
      lines.push(`• ${label} → ${s.status}${s.error ? `: ${s.error}` : ''}`);
    } else {
      lines.push(`• ${label} → ${s.status}`);
    }
  }
  return lines.join('\n');
}

/**
 * Polls DRS for the status of the offsite-brand-presence scrape jobs created for a
 * manual Slack run. Re-enqueues itself with an SQS delay until every job is terminal
 * or the deadline passes, then posts a single completion summary to the Slack thread.
 *
 * @param {object} message - SQS message with auditContext { baseURL, slackContext,
 *   jobs: [{domain, datasetId, jobId}], deadline }
 * @param {object} context - Universal context (log, sqs, dataAccess, env)
 * @returns {Promise<Response>}
 */
export default async function offsiteBrandPresenceDrsStatusHandler(message, context) {
  const {
    log, sqs, dataAccess,
  } = context;
  const { siteId, auditContext = {} } = message;
  const {
    baseURL, slackContext = {}, jobs = [], deadline,
  } = auditContext;
  const { channelId, threadTs } = slackContext;

  if (!channelId || !threadTs || jobs.length === 0) {
    log.warn(`${LOG_PREFIX} Missing Slack context or jobs, skipping (site ${siteId})`);
    return ok();
  }

  const drsClient = DrsClient.createFrom(context);

  const statuses = await Promise.all(jobs.map(async (job) => {
    try {
      const result = await drsClient.getJob(job.jobId);
      return { ...job, status: result?.status, error: result?.error_message };
    } catch (err) {
      log.warn(`${LOG_PREFIX} getJob failed for ${job.jobId}: ${err.message}`);
      return { ...job, status: undefined, error: undefined };
    }
  }));

  const terminalCount = statuses.filter((s) => DRS_TERMINAL_STATUSES.has(s.status)).length;
  const allTerminal = terminalCount === statuses.length;

  if (!allTerminal && Date.now() < deadline) {
    const delaySeconds = Math.min(
      DRS_POLL_INTERVAL_SECONDS,
      Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
      SQS_MAX_DELAY_SECONDS,
    );
    const configuration = await dataAccess.Configuration.findLatest();
    await sqs.sendMessage(configuration.getQueues().audits, message, null, delaySeconds);
    log.info(`${LOG_PREFIX} ${terminalCount}/${statuses.length} jobs terminal for ${baseURL}, re-polling in ${delaySeconds}s`);
    return ok();
  }

  await postMessageOptional(context, channelId, buildSummary(baseURL, statuses), { threadTs });
  log.info(`${LOG_PREFIX} Posted completion summary for ${baseURL} (${statuses.length} jobs)`);
  return ok();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:spec -- test/audits/offsite-brand-presence-drs-status.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/offsite-brand-presence/drs-status-handler.js test/audits/offsite-brand-presence-drs-status.test.js
git commit -m "feat(offsite-brand-presence): add DRS status poll handler (summary path)"
```

---

## Task 3: Poll handler — re-enqueue and deadline-timeout paths

**Files:**
- Test: `test/audits/offsite-brand-presence-drs-status.test.js` (add tests)

- [ ] **Step 1: Write the failing tests**

Add inside the `describe` block in `test/audits/offsite-brand-presence-drs-status.test.js`:

```js
  it('re-enqueues with a delay when jobs are still pending and budget remains', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'RUNNING' });

    const result = await handler.default(buildMessage(), context);

    expect(result.status).to.equal(200);
    expect(mockPostMessageOptional).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const [queueUrl, sentMessage, groupId, delaySeconds] = context.sqs.sendMessage.firstCall.args;
    expect(queueUrl).to.equal('audits-queue-url');
    expect(sentMessage.type).to.equal('offsite-brand-presence-drs-status');
    expect(sentMessage.auditContext.jobs).to.have.length(2);
    expect(groupId).to.equal(null);
    expect(delaySeconds).to.equal(120);
  });

  it('caps the re-enqueue delay at the seconds remaining until the deadline', async () => {
    mockGetJob.resolves({ status: 'RUNNING' });

    // 30s left before deadline → delay should be 30, not the 120s interval.
    await handler.default(buildMessage({ deadline: Date.now() + 30000 }), context);

    const delaySeconds = context.sqs.sendMessage.firstCall.args[3];
    expect(delaySeconds).to.be.at.most(30);
    expect(delaySeconds).to.be.greaterThan(0);
  });

  it('posts the summary at the deadline even if jobs are still running', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'RUNNING' });

    await handler.default(buildMessage({ deadline: Date.now() - 1 }), context);

    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(mockPostMessageOptional).to.have.been.calledOnce;
    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.include('still running (timed out waiting)');
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test:spec -- test/audits/offsite-brand-presence-drs-status.test.js`
Expected: PASS (all 5 tests). The handler from Task 2 already implements these paths.

- [ ] **Step 3: Commit**

```bash
git add test/audits/offsite-brand-presence-drs-status.test.js
git commit -m "test(offsite-brand-presence): cover DRS poll re-enqueue and deadline paths"
```

---

## Task 4: Poll handler — getJob failure and missing-context guard

**Files:**
- Test: `test/audits/offsite-brand-presence-drs-status.test.js` (add tests)

- [ ] **Step 1: Write the failing tests**

Add inside the `describe` block:

```js
  it('treats a getJob error as non-terminal and keeps polling', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').rejects(new Error('DRS 503'));

    const result = await handler.default(buildMessage(), context);

    expect(result.status).to.equal(200);
    expect(mockPostMessageOptional).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(log.warn).to.have.been.calledWithMatch(/getJob failed for job-2/);
  });

  it('reports a job as still running when getJob errors past the deadline', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').rejects(new Error('DRS 503'));

    await handler.default(buildMessage({ deadline: Date.now() - 1 }), context);

    expect(mockPostMessageOptional).to.have.been.calledOnce;
    expect(mockPostMessageOptional.firstCall.args[2]).to.include('still running (timed out waiting)');
  });

  it('no-ops when slackContext is missing', async () => {
    const result = await handler.default(buildMessage({ slackContext: {} }), context);

    expect(result.status).to.equal(200);
    expect(mockGetJob).to.not.have.been.called;
    expect(mockPostMessageOptional).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('no-ops when there are no jobs to track', async () => {
    const result = await handler.default(buildMessage({ jobs: [] }), context);

    expect(result.status).to.equal(200);
    expect(mockGetJob).to.not.have.been.called;
    expect(mockPostMessageOptional).to.not.have.been.called;
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test:spec -- test/audits/offsite-brand-presence-drs-status.test.js`
Expected: PASS (all 9 tests).

- [ ] **Step 3: Verify full coverage of the new file**

Run: `npm test -- --grep "DRS status handler"` then check the c8 report shows `src/offsite-brand-presence/drs-status-handler.js` at 100% lines/branches/statements. If any branch is uncovered, add a targeted test before committing.

- [ ] **Step 4: Commit**

```bash
git add test/audits/offsite-brand-presence-drs-status.test.js
git commit -m "test(offsite-brand-presence): cover DRS poll error and guard paths"
```

---

## Task 5: Register the handler in the worker router

**Files:**
- Modify: `src/index.js` (import near line 123-124; HANDLERS entry near line 229-230)

- [ ] **Step 1: Add the import**

In `src/index.js`, immediately after the existing line 124:

```js
import offsiteBrandPresence from './offsite-brand-presence/handler.js';
```

add:

```js
import offsiteBrandPresenceDrsStatus from './offsite-brand-presence/drs-status-handler.js';
```

- [ ] **Step 2: Register in the HANDLERS map**

In `src/index.js`, immediately after the existing line:

```js
  'offsite-brand-presence': offsiteBrandPresence,
```

add:

```js
  'offsite-brand-presence-drs-status': offsiteBrandPresenceDrsStatus,
```

- [ ] **Step 3: Verify the worker still boots and lint passes**

Run: `npm run lint -- src/index.js`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat(offsite-brand-presence): route offsite-brand-presence-drs-status messages"
```

---

## Task 6: Runner enqueues the poll message after a successful submission

**Files:**
- Modify: `src/offsite-brand-presence/handler.js` (imports at lines 21-29; new helper near `notifyDrsResults` ~line 661; call site at ~line 773-775)
- Test: `test/audits/offsite-brand-presence.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/audits/offsite-brand-presence.test.js`, the runner is loaded via esmock and the
test context provides `dataAccess` and `sqs`. Locate the suite that drives a successful
DRS submission (uses `mockSubmitScrapeJob` resolving `{ job_id: 'mock-job' }` and a
`slackContext`). Add a new suite at the end of the top-level `describe` block.

First confirm the test context exposes a `sqs.sendMessage` stub and
`dataAccess.Configuration.findLatest`. If `context.sqs` or `context.dataAccess.Configuration`
is not already stubbed in `beforeEach`, add to the existing context setup:

```js
    context.sqs = { sendMessage: sandbox.stub().resolves() };
    context.dataAccess.Configuration = {
      findLatest: sandbox.stub().resolves({ getQueues: () => ({ audits: 'audits-queue-url' }) }),
    };
```

Then add the suite (adjust the data-seeding helper name to match the file's existing
helper that makes `loadBrandPresenceData` return URLs that produce a submitted job):

```js
  describe('DRS status poll scheduling', () => {
    function withSlack(extra = {}) {
      return {
        slackContext: { channelId: 'C123', threadTs: '111.222' },
        ...extra,
      };
    }

    it('enqueues a poll message when a Slack thread and a successful job exist', async () => {
      // Arrange: loadBrandPresenceData returns offsite URLs so a job is submitted.
      // (Use the same fixture/setup the surrounding "submitScrapeJob" tests use.)
      // mockSubmitScrapeJob already resolves { job_id: 'mock-job' }.

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, withSlack());

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [queueUrl, msg, groupId, delaySeconds] = context.sqs.sendMessage.firstCall.args;
      expect(queueUrl).to.equal('audits-queue-url');
      expect(msg.type).to.equal('offsite-brand-presence-drs-status');
      expect(msg.siteId).to.equal(SITE_ID);
      expect(msg.auditContext.slackContext).to.deep.equal({ channelId: 'C123', threadTs: '111.222' });
      expect(msg.auditContext.jobs[0]).to.include({ jobId: 'mock-job' });
      expect(msg.auditContext.deadline).to.be.a('number');
      expect(groupId).to.equal(null);
      expect(delaySeconds).to.equal(120);
    });

    it('does not enqueue a poll message without a Slack thread context', async () => {
      await offsiteBrandPresenceRunner(FINAL_URL, context, site, {});

      expect(context.sqs.sendMessage).to.not.have.been.called;
    });
  });
```

> Note: this task mirrors the existing "submitScrapeJob" suites for data seeding. Reuse
> whatever setup those tests use so a job is actually submitted. If no job is submitted,
> `sendMessage` will (correctly) not be called and the first test will fail until seeding
> matches.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:spec -- test/audits/offsite-brand-presence.test.js`
Expected: FAIL — the runner does not yet call `sqs.sendMessage` (first test fails;
second already passes).

- [ ] **Step 3: Add the imports**

In `src/offsite-brand-presence/handler.js`, extend the constants import (lines 21-29) to add the three new names:

```js
import {
  DRS_URLS_LIMIT,
  RETRIABLE_STATUSES,
  RETRY_DELAY_MS,
  OFFSITE_DOMAINS,
  CITED_ANALYSIS_DRS_CONFIG,
  YOUTUBE_URL_REGEX,
  REDDIT_URL_REGEX,
  DRS_POLL_INTERVAL_SECONDS,
  DRS_POLL_MAX_WAIT_SECONDS,
  DRS_STATUS_AUDIT_TYPE,
} from './constants.js';
```

- [ ] **Step 4: Add the scheduling helper**

In `src/offsite-brand-presence/handler.js`, immediately after the `notifyDrsResults`
function (ends ~line 677), add:

```js
/**
 * Schedules a delayed DRS status poll for the jobs that were submitted successfully.
 * Only runs for manual Slack runs (channelId + threadTs present) with at least one
 * job_id to track; scheduled runs and submission-only failures are skipped. The poll
 * message carries the job list, Slack context, and an absolute deadline so each poll
 * invocation is self-describing.
 *
 * @param {Array} drsResults - DRS job results from triggerDrsScraping
 * @param {string} baseURL - The site's base URL
 * @param {string} siteId - The site ID
 * @param {object} context - The execution context (sqs, dataAccess, log)
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Slack thread timestamp
 */
async function scheduleDrsStatusPoll(drsResults, baseURL, siteId, context, channelId, threadTs) {
  const { sqs, dataAccess, log } = context;

  if (!channelId || !threadTs) {
    return;
  }

  const jobs = drsResults
    .filter((r) => r.status === 'success' && r.response?.job_id)
    .map((r) => ({ domain: r.domain, datasetId: r.datasetId, jobId: r.response.job_id }));

  if (jobs.length === 0) {
    return;
  }

  const configuration = await dataAccess.Configuration.findLatest();
  await sqs.sendMessage(configuration.getQueues().audits, {
    type: DRS_STATUS_AUDIT_TYPE,
    siteId,
    auditContext: {
      baseURL,
      slackContext: { channelId, threadTs },
      jobs,
      deadline: Date.now() + DRS_POLL_MAX_WAIT_SECONDS * 1000,
    },
  }, null, DRS_POLL_INTERVAL_SECONDS);

  log.info(`${LOG_PREFIX} Scheduled DRS status poll for ${baseURL} (${jobs.length} jobs)`);
}
```

- [ ] **Step 5: Call the helper from the runner**

In `src/offsite-brand-presence/handler.js`, find the existing block (~lines 771-775):

```js
  if (skipped) {
    await notifyDrsSkipped(skipped, baseURL, context, channelId, threadTs);
  } else {
    await notifyDrsResults(drsResults, baseURL, context, channelId, threadTs);
  }
```

Replace the `else` branch so it also schedules the poll:

```js
  if (skipped) {
    await notifyDrsSkipped(skipped, baseURL, context, channelId, threadTs);
  } else {
    await notifyDrsResults(drsResults, baseURL, context, channelId, threadTs);
    await scheduleDrsStatusPoll(drsResults, baseURL, siteId, context, channelId, threadTs);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:spec -- test/audits/offsite-brand-presence.test.js`
Expected: PASS (both new tests + existing suite unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/offsite-brand-presence/handler.js test/audits/offsite-brand-presence.test.js
git commit -m "feat(offsite-brand-presence): schedule DRS completion status poll after submission"
```

---

## Task 7: Full suite + coverage gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite with coverage**

Run: `npm test`
Expected: all tests pass; c8 reports 100% lines/branches/statements across `src/**`,
including `src/offsite-brand-presence/drs-status-handler.js` and the modified
`handler.js`/`constants.js`.

- [ ] **Step 2: Run lint over the whole project**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: If coverage or lint fails, fix and re-run**

Add targeted tests for any uncovered branch (most likely the `result?.status` /
`result?.error_message` optional chaining when `getJob` resolves a partial object, or
the `s.error` ternary in `buildSummary`). Do not lower coverage thresholds.

---

## Self-Review Notes

- **Spec coverage:** single summary when all terminal (Task 2), error surfaced for failures (Task 2/4), 20-min deadline + still-running label (Tasks 1, 3), manual-only via slackContext gate (Tasks 4, 6), no DRS/infra/client changes (none in file list), no-poll when all jobs failed at submission (Task 6). All spec requirements mapped.
- **Type consistency:** `jobs` entries are `{ domain, datasetId, jobId }` in both the runner (Task 6) and the handler (Task 2). `auditContext` keys (`baseURL`, `slackContext`, `jobs`, `deadline`) match across producer and consumer. `DRS_STATUS_AUDIT_TYPE` constant is the single source for the `type` string used in both the runner (Task 6) and the router key (Task 5 uses the literal `'offsite-brand-presence-drs-status'`, which equals the constant value).
- **Placeholders:** none — all code blocks complete. Task 6 intentionally defers the data-seeding detail to the file's existing submitScrapeJob suites (documented), because that fixture setup already exists in the test file and must be reused verbatim rather than duplicated here.
