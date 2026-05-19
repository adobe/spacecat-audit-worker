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
});
