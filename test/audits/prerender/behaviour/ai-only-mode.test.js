/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Behavioural contracts: AI-only mode
 *
 * AI-only mode is triggered by context.data = { mode: 'ai-only' }.
 * It bypasses scraping entirely — step 1 dispatches directly to Mystique,
 * steps 2 and 3 return immediately with { status: 'skipped' }.
 *
 * Covers:
 *   - Step 2 + Step 3 skip: no S3/DB reads, immediate return
 *   - Step 1 happy path: scrapeJobId + NEW opportunity → complete
 *   - Step 1 no scrapeJobId: status.json has no job → failed
 *   - Step 1 no NEW opportunity: no matching opportunity in DB → failed
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  importTopPages,
  submitForScraping,
  processContentAndGenerateOpportunities,
} from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildOpportunity,
  buildSuggestion,
  statusKey,
  buildStatus,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — AI-only mode', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  // ─── Step 2 + 3 skip ──────────────────────────────────────────────────────────

  it('Step 2: data.mode=ai-only → returns skipped immediately, S3 never read', async () => {
    const s3Client = buildS3Client(sandbox); // no keys — any read would NoSuchKey
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: 'site-ai-step2', baseUrl: 'https://example.com' }),
      s3Client,
      data: { mode: 'ai-only' },
    });

    const result = await submitForScraping(ctx);

    expect(result).to.deep.include({ status: 'skipped', mode: 'ai-only' });
    // S3 must never be touched — the step exits before any I/O
    expect(s3Client.send).to.not.have.been.called;
  });

  it('Step 3: data.mode=ai-only → returns skipped immediately, no opportunity lookup', async () => {
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: 'site-ai-step3', baseUrl: 'https://example.com' }),
      data: { mode: 'ai-only' },
    });

    const result = await processContentAndGenerateOpportunities(ctx);

    expect(result).to.deep.include({ status: 'skipped', mode: 'ai-only' });
    expect(ctx.dataAccess.Opportunity.allBySiteIdAndStatus).to.not.have.been.called;
  });

  // ─── Step 1 happy path ────────────────────────────────────────────────────────

  it('Step 1: scrapeJobId in data + NEW opportunity found → status=complete, mode=ai-only', async () => {
    const siteId = 'site-ai-happy';
    const scrapeJobId = 'job-ai-123';

    // Opportunity with two non-domain-wide suggestions for Mystique to process
    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-ai-1',
      status: 'NEW',
      data: { url: 'https://example.com/page-1', scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-ai-1',
      siteId,
      suggestions: [suggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      data: { mode: 'ai-only', scrapeJobId },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'complete');
    expect(result).to.have.property('mode', 'ai-only');
    expect(result).to.have.property('fullAuditRef').that.includes('ai-only/opp-ai-1');
    // SQS message sent to Mystique queue
    expect(ctx.sqs.sendMessage).to.have.been.called;
  });

  // ─── Step 1 failure paths ─────────────────────────────────────────────────────

  it('Step 1: no scrapeJobId in data or status.json → status=failed', async () => {
    const siteId = 'site-ai-no-job';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      // status.json has no scrapeJobId field → fetchLatestScrapeJobId returns null
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(), // no scrapeJobId in status
      }),
      data: { mode: 'ai-only' }, // no scrapeJobId in data either
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'failed');
    expect(result).to.have.property('fullAuditRef').that.includes(`failed-${siteId}`);
    expect(ctx.log.error).to.have.been.called;
  });

  it('Step 1: scrapeJobId found but no NEW prerender opportunity exists → status=failed', async () => {
    const siteId = 'site-ai-no-opp';
    const scrapeJobId = 'job-ai-456';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      // No NEW opportunities in DB
      dataAccess: buildDataAccess(sandbox, { opportunities: [] }),
      data: { mode: 'ai-only', scrapeJobId },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'failed');
    expect(result).to.have.property('fullAuditRef').that.includes(`failed-${siteId}`);
    expect(ctx.log.error).to.have.been.called;
  });

  // ─── Step 1 opportunity resolution ──────────────────────────────────────────

  it('Step 1: opportunityId in data → resolved via findById (not latest-NEW lookup) → complete', async () => {
    const siteId = 'site-ai-byid';
    const scrapeJobId = 'job-ai-byid';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-byid',
      status: 'NEW',
      data: { url: 'https://example.com/by-id', scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-explicit',
      siteId,
      suggestions: [suggestion],
    });
    const dataAccess = buildDataAccess(sandbox, { opportunities: [opportunity] });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess,
      data: { mode: 'ai-only', opportunityId: 'opp-explicit', scrapeJobId },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'complete');
    expect(result).to.have.property('fullAuditRef').that.includes('opp-explicit');
    expect(dataAccess.Opportunity.findById).to.have.been.calledWith('opp-explicit');
    // The explicit-id path must bypass the latest-NEW lookup entirely
    expect(dataAccess.Opportunity.allBySiteIdAndStatus).to.not.have.been.called;
  });

  it('Step 1: opportunityId in data but not found in DB → status=failed', async () => {
    const siteId = 'site-ai-byid-missing';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [] }), // findById → null
      data: { mode: 'ai-only', opportunityId: 'missing-opp', scrapeJobId: 'job-x' },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'failed');
    expect(result).to.have.property('fullAuditRef').that.includes(`failed-${siteId}`);
    expect(ctx.log.error).to.have.been.calledWithMatch(/Opportunity not found: missing-opp/);
  });

  it('Step 1: resolved opportunity belongs to a different site → status=failed', async () => {
    const siteId = 'site-requester';

    // findById returns an opportunity owned by a DIFFERENT site
    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-other-site',
      siteId: 'site-other',
      suggestions: [],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      data: { mode: 'ai-only', opportunityId: 'opp-other-site', scrapeJobId: 'job-c' },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'failed');
    expect(result).to.have.property('fullAuditRef').that.includes(`failed-${siteId}`);
    expect(ctx.log.error).to.have.been.calledWithMatch(/does not belong to site/);
  });

  // ─── Step 1 scope resolution ────────────────────────────────────────────────

  it('Step 1: no suggestion matches the mode → status=complete, suggestionCount 0, Mystique NOT called', async () => {
    const siteId = 'site-ai-empty-scope';
    const scrapeJobId = 'job-ai-empty';

    // The only suggestion is FIXED → excluded by the ai-only filter → empty scope
    const fixed = buildSuggestion(sandbox, {
      id: 'sug-fixed',
      status: 'FIXED',
      data: { url: 'https://example.com/fixed', scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-ai-empty',
      siteId,
      suggestions: [fixed],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      data: { mode: 'ai-only', scrapeJobId },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'complete');
    expect(result.auditResult).to.have.property('suggestionCount', 0);
    // Early-return before dispatch: no S3 upload, no SQS message
    expect(ctx.sqs.sendMessage).to.not.have.been.called;
  });

  it('Step 1: scrapeJobId absent in data but present in status.json → complete + SQS sent', async () => {
    const siteId = 'site-ai-statusjob';
    const jobFromStatus = 'job-from-status-json';

    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-statusjob',
      status: 'NEW',
      data: { url: 'https://example.com/needs-ai', scrapeJobId: jobFromStatus },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-statusjob',
      siteId,
      suggestions: [suggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus({ scrapeJobId: jobFromStatus }),
      }),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      data: { mode: 'ai-only' }, // no scrapeJobId — must be resolved from status.json
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'complete');
    expect(ctx.sqs.sendMessage).to.have.been.called;
  });

  // ─── New ai-only mode variants ──────────────────────────────────────────────

  it('Step 1: mode=ai-only-current routes through ai-only handling → complete, mode echoed', async () => {
    const siteId = 'site-ai-current';
    const scrapeJobId = 'job-current';

    // NEW, not covered/deployed/pattern-matched → eligible for ai-only-current
    const suggestion = buildSuggestion(sandbox, {
      id: 'sug-current',
      status: 'NEW',
      data: { url: 'https://example.com/current', scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-current',
      siteId,
      suggestions: [suggestion],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      data: { mode: 'ai-only-current', scrapeJobId },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'complete');
    expect(result).to.have.property('mode', 'ai-only-current');
    expect(ctx.sqs.sendMessage).to.have.been.called;
  });

  it('Steps 2 & 3: ai-only-current and ai-only-missing also skip immediately', async () => {
    for (const mode of ['ai-only-current', 'ai-only-missing']) {
      // eslint-disable-next-line no-await-in-loop
      const step2 = await submitForScraping(buildContext(sandbox, {
        site: buildSite({ id: `s2-${mode}`, baseUrl: 'https://example.com' }),
        data: { mode },
      }));
      expect(step2).to.deep.include({ status: 'skipped', mode });

      // eslint-disable-next-line no-await-in-loop
      const step3 = await processContentAndGenerateOpportunities(buildContext(sandbox, {
        site: buildSite({ id: `s3-${mode}`, baseUrl: 'https://example.com' }),
        data: { mode },
      }));
      expect(step3).to.deep.include({ status: 'skipped', mode });
    }
  });

  // ─── Explicit URL scope (CSV batch) ─────────────────────────────────────────

  it('Step 1: explicit auditContext.urls scopes to those URLs and dispatches to Mystique', async () => {
    const siteId = 'site-ai-csv';
    const scrapeJobId = 'job-csv';
    const inCsv = 'https://example.com/listed-in-csv';
    const notInCsv = 'https://example.com/not-listed';

    const listed = buildSuggestion(sandbox, {
      id: 'sug-listed', status: 'NEW', data: { url: inCsv, scrapeJobId },
    });
    const unlisted = buildSuggestion(sandbox, {
      id: 'sug-unlisted', status: 'NEW', data: { url: notInCsv, scrapeJobId },
    });
    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-csv', siteId, suggestions: [listed, unlisted],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      auditContext: { urls: [inCsv] },
      data: { mode: 'ai-only', scrapeJobId },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'complete');
    expect(ctx.sqs.sendMessage).to.have.been.called;
    const putCall = ctx.s3Client.send.getCalls()
      .find((c) => c.args[0]?.input?.Key?.includes('mystique-suggestions'));
    const urls = JSON.parse(putCall.args[0].input.Body).map((s) => s.url);
    expect(urls).to.deep.equal([inCsv]); // only the CSV-listed URL
  });

  it('Step 1: explicit auditContext.urls with no DB suggestions → complete, nothing dispatched', async () => {
    const siteId = 'site-ai-csv-empty';
    const opportunity = buildOpportunity(sandbox, { id: 'opp-csv-empty', siteId, suggestions: [] });
    // getSuggestions resolves null → exercises the (suggestions || []) guard during candidate build
    opportunity.getSuggestions = sandbox.stub().resolves(null);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      auditContext: { urls: ['https://example.com/from-csv'] },
      data: { mode: 'ai-only', scrapeJobId: 'job-csv-empty' },
    });

    const result = await importTopPages(ctx);

    expect(result).to.have.property('status', 'complete');
    expect(ctx.sqs.sendMessage).to.not.have.been.called;
  });
});
