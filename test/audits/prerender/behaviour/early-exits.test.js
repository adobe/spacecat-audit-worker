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
 * Behavioural contracts: early exits in Step 3
 *
 * Covers:
 *   - isDomainBlocked=true → skips HTML comparison, writes scrapeForbidden to status.json
 *   - scrapeResultPaths empty + S3 returns no HTML → all comparisons error, audit still completes
 *   - getScrapeJobStats dual-path counting (COMPLETE 403s + FAILED-status 403s)
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
  scrapeKeys,
  statusKey,
  buildStatus,
  captureStatusWrite,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — early exits (Step 3)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('isDomainBlocked=true → S3 HTML never read, scrapeForbidden=true written to status.json', async () => {
    const siteId = 'site-domain-blocked';
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      }),
      dataAccess: buildDataAccess(sandbox),
      scrapeResultPaths: new Map(),
      auditContext: { domainBlocked: true },
    });

    const result = await processContentAndGenerateOpportunities(ctx);

    // Audit completes (does not throw)
    expect(result).to.have.property('status', 'complete');

    // No HTML GetObjectCommands should have been sent
    const htmlReads = ctx.s3Client.send.getCalls().filter(
      (c) => c.args[0]?.constructor?.name === 'GetObjectCommand'
        && c.args[0]?.input?.Key?.endsWith('.html'),
    );
    expect(htmlReads).to.have.length(0);

    const written = captureStatusWrite(ctx.s3Client);
    expect(written).to.have.property('scrapeForbidden', true);
  });

  it('all HTML comparisons error (S3 returns null) → audit completes with zero successful scrapes', async () => {
    const siteId = 'site-all-errors';
    const scrapeJobId = 'job-all-error';
    const url = 'https://example.com/page-missing';
    // S3 keyMap is empty for HTML files → buildS3Client returns NoSuchKey for all reads
    // → getObjectFromKey returns null → compareHtmlContent returns { error: true }
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // Intentionally no HTML or scrape.json for the URL
      }),
      dataAccess: buildDataAccess(sandbox, { scrapeUrls: [url] }),
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    const result = await processContentAndGenerateOpportunities(ctx);

    // Audit completes despite all errors
    expect(result).to.have.property('status', 'complete');
    expect(result.auditResult).to.have.property('urlsScrapedSuccessfully', 0);
  });

  it('getScrapeJobStats counts 403s from FAILED-status URLs via S3 scrape.json', async () => {
    // FAILED-status URLs are absent from scrapeResultPaths (getScrapeResultPaths only returns COMPLETE).
    // getScrapeJobStats finds them by querying ScrapeUrl DB and reading their scrape.json from S3.
    const siteId = 'site-failed-403';
    const scrapeJobId = 'job-failed-403';
    const completedUrl = 'https://example.com/completed';
    const failedUrl = 'https://example.com/failed-403';
    const failedScrapeJsonKey = scrapeKeys(scrapeJobId, failedUrl).scrapeJson;

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        ...buildUrlS3Content(scrapeJobId, completedUrl),
        // scrape.json for the FAILED URL shows 403
        [failedScrapeJsonKey]: { error: { statusCode: 403, message: 'Forbidden' } },
      }),
      dataAccess: buildDataAccess(sandbox, {
        // ScrapeUrl DB includes both URLs (the FAILED one is missing from scrapeResultPaths)
        scrapeUrls: [completedUrl, failedUrl],
      }),
      // Only the COMPLETE URL is in scrapeResultPaths (FAILED URLs absent)
      scrapeResultPaths: new Map([[completedUrl, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    const written = captureStatusWrite(ctx.s3Client);
    // The failed 403 should appear as a missingPage with scrapeError
    const missingWithError = (written.pages ?? []).filter((p) => p.scrapeError?.statusCode === 403);
    expect(missingWithError).to.have.length(1);
  });
});
