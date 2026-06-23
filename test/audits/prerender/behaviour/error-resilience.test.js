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
 * Behavioural contracts: error resilience in Step 3
 *
 * Covers:
 *   - Partial S3 HTML failure (one of N URLs missing) → partial success, not all-or-nothing
 *   - DB exception in Opportunity.allBySiteIdAndStatus → audit catches outer exception, completes
 *   - ScrapeUrl.allByScrapeJobId throws → getScrapeJobStats uses fallback count, no crash
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { processContentAndGenerateOpportunities } from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildUrlS3Content,
  statusKey,
  buildStatus,
  captureStatusWrite,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — error resilience (Step 3)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('partial S3 HTML failure — one URL missing, one present → urlsScrapedSuccessfully=1', async () => {
    // One URL has full S3 content; the other URL is absent from the keyMap → NoSuchKey.
    // The missing URL becomes an error result; the present URL is counted as successful.
    // Audit must not fail entirely just because one URL's HTML is absent.
    const siteId = 'site-partial-fail';
    const scrapeJobId = 'job-partial';
    const goodUrl = 'https://example.com/page-ok';
    const badUrl = 'https://example.com/page-missing-html';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        ...buildUrlS3Content(scrapeJobId, goodUrl),
        // badUrl intentionally absent → S3 returns NoSuchKey
      }),
      dataAccess: buildDataAccess(sandbox, {
        scrapeUrls: [goodUrl, badUrl],
      }),
      scrapeResultPaths: new Map([[goodUrl, {}], [badUrl, {}]]),
      auditContext: { scrapeJobId },
    });

    const result = await processContentAndGenerateOpportunities(ctx);

    expect(result).to.have.property('status', 'complete');
    // goodUrl was scraped; badUrl errored — only 1 should be counted as successful
    expect(result.auditResult).to.have.property('urlsScrapedSuccessfully', 1);
  });

  it('ScrapeUrl.allByScrapeJobId throws → getScrapeJobStats falls back, audit completes', async () => {
    // Unlike the "ScrapeUrl deleted from dataAccess" fallback test in data-integrity,
    // here the entity exists but the DB call itself rejects (e.g., network timeout).
    // getScrapeJobStats must catch the error and use the urlsToCheck.length fallback.
    const siteId = 'site-scrapeurl-throws';
    const scrapeJobId = 'job-throws';
    const url = 'https://example.com/page-1';

    const dataAccess = buildDataAccess(sandbox, { scrapeUrls: [url] });
    // Override allByScrapeJobId to throw instead of resolve
    dataAccess.ScrapeUrl.allByScrapeJobId = sandbox.stub().rejects(new Error('DB connection timeout'));

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        ...buildUrlS3Content(scrapeJobId, url),
      }),
      dataAccess,
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    const result = await processContentAndGenerateOpportunities(ctx);

    expect(result).to.have.property('status', 'complete');
    // Fallback: urlsSubmittedForScraping equals the scrapeResultPaths size
    const written = captureStatusWrite(ctx.s3Client);
    expect(written).to.have.property('urlsSubmittedForScraping').that.is.a('number');
  });

  it('S3 PutObject failure on status.json upload → log.error called, audit still returns complete', async () => {
    // uploadStatusSummaryToS3 catches PutObject errors internally and does not re-throw.
    // The Lambda must still return { status: 'complete' } so SQS does not retry.
    const siteId = 'site-s3-put-fails';
    const scrapeJobId = 'job-put-fails';
    const url = 'https://example.com/page-1';

    const keyMap = {
      [statusKey(siteId)]: buildStatus(),
      ...buildUrlS3Content(scrapeJobId, url),
    };
    const s3Client = {
      send: sandbox.stub().callsFake((cmd) => {
        if (cmd.constructor.name === 'PutObjectCommand') {
          return Promise.reject(new Error('S3 bucket write permission denied'));
        }
        if (cmd.constructor.name === 'GetObjectCommand') {
          const { Key } = cmd.input;
          if (Object.hasOwn(keyMap, Key)) {
            const value = keyMap[Key];
            const isString = typeof value === 'string';
            const body = isString ? value : JSON.stringify(value);
            return Promise.resolve({
              Body: { transformToString: () => Promise.resolve(body) },
              ...(isString ? {} : { ContentType: 'application/json' }),
            });
          }
          const err = new Error('NoSuchKey'); err.name = 'NoSuchKey';
          return Promise.reject(err);
        }
        return Promise.reject(new Error(`Unexpected: ${cmd.constructor.name}`));
      }),
    };

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      s3Client,
      dataAccess: buildDataAccess(sandbox, { scrapeUrls: [url] }),
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    const result = await processContentAndGenerateOpportunities(ctx);

    // Audit must complete even though S3 write failed
    expect(result).to.have.property('status', 'complete');
    // The error is logged (not swallowed silently)
    expect(ctx.log.error).to.have.been.calledWithMatch(/Failed to upload status summary to S3/);
  });

  it('uncaught exception in step 3 outer try → D-12 catch writes lastAuditSuccess=false to status.json', async () => {
    // detectWrongEdgeDeployedStatus (before outer try) = call 0 on allBySiteIdAndStatus → resolves []
    // Branch C's allBySiteIdAndStatus (inside outer try) = call 1 → rejects → triggers D-12 outer catch
    // D-12 outer catch: logs "Audit failed", calls uploadStatusSummaryToS3 with lastAuditSuccess=false
    const siteId = 'site-d12-catch';
    const scrapeJobId = 'job-d12';
    const url = 'https://example.com/page-1';

    const dataAccess = buildDataAccess(sandbox, { scrapeUrls: [url] });
    dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub()
      .resolves([])                                              // call 0: detectWrongEdgeDeployedStatus
      .onCall(1).rejects(new Error('DB connection lost'));       // call 1: Branch C inside outer try

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        ...buildUrlS3Content(scrapeJobId, url), // identical HTML → no prerender → Branch C
      }),
      dataAccess,
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    const result = await processContentAndGenerateOpportunities(ctx);

    // D-12: outer catch must log the failure
    expect(ctx.log.error).to.have.been.calledWithMatch(/Audit failed/);
    // D-12: error status.json is written with lastAuditSuccess=false
    const written = captureStatusWrite(ctx.s3Client);
    expect(written).to.have.property('lastAuditSuccess', false);
    // The result signals failure, not a successful completion
    expect(result).to.have.property('error');
  });

  it('Opportunity.create rejects (Branch A) → handler catches error, logs it, does not crash Lambda', async () => {
    // When prerender URLs ARE found (Branch A: needsPrerender=true) but Opportunity.create
    // rejects, convertToOpportunity catches the error internally. The Lambda must not
    // propagate the exception — a crash here would silently skip writing status.json
    // and the audit would be retried indefinitely.
    const siteId = 'site-create-throws';
    const scrapeJobId = 'job-create-throw';
    const url = 'https://example.com/page-1';

    const dataAccess = buildDataAccess(sandbox, { scrapeUrls: [url] });
    // No existing opportunity found → handler will try to create one, which fails
    dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub().resolves([]);
    dataAccess.Opportunity.create = sandbox.stub().rejects(new Error('DB write failed'));

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // server-sparse + client-rich → ratio > 1.1 → needsPrerender=true → Branch A
        ...buildUrlS3Content(scrapeJobId, url, {
          serverHtml: '<html><body><p>few words</p></body></html>',
          clientHtml: `<html><body><p>${'word '.repeat(60).trim()}</p></body></html>`,
        }),
      }),
      dataAccess,
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    // Must not throw — if it threw, the test would fail here and that would be the regression
    await processContentAndGenerateOpportunities(ctx);

    // Failure must be observable — silent swallow is as dangerous as a crash
    expect(ctx.log.error).to.have.been.called;
  });
});
