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
 * Behavioural contracts: data integrity in Step 3
 *
 * Covers the status.json merge strategy (prior pages preserved), sticky scrapeForbidden
 * persistence, scrapeJobId written to the status, getScrapeJobStats fallback when
 * ScrapeUrl DB is unavailable, S3 path contract for HTML reads, and PageCitability
 * write behaviour (successful URLs written, errored URLs skipped).
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  processContentAndGenerateOpportunities,
} from '../../../../src/prerender/handler.js';
import { writeToCitabilityRecords } from '../../../../src/prerender/page-citability.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  buildUrlS3Content,
  statusKey,
  buildStatus,
  captureStatusWrite,
  scrapeKeys,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — data integrity (Step 3)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('status.json merges current pages with prior pages not in the current scrape run', async () => {
    const siteId = 'site-merge';
    const scrapeJobId = 'job-merge';
    const currentUrl = 'https://example.com/current';
    const priorUrl = 'https://example.com/prior-only';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        // Existing status.json has a prior page not in the current run
        [statusKey(siteId)]: buildStatus({
          pages: [{ url: priorUrl, needsPrerender: true, scrapingStatus: 'success' }],
        }),
        ...buildUrlS3Content(scrapeJobId, currentUrl),
      }),
      dataAccess: buildDataAccess(sandbox, { scrapeUrls: [currentUrl] }),
      scrapeResultPaths: new Map([[currentUrl, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    const written = captureStatusWrite(ctx.s3Client);
    const writtenUrls = written.pages.map((p) => p.url);
    expect(writtenUrls).to.include(currentUrl);
    expect(writtenUrls).to.include(priorUrl);
  });

  it('scrapeForbidden=true persists in status.json when set by reactive detection (isDomainBlocked)', async () => {
    // isDomainBlocked=true causes scrapeForbidden=true via: let scrapeForbidden = isDomainBlocked
    const siteId = 'site-forbidden-persist';
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      }),
      dataAccess: buildDataAccess(sandbox),
      scrapeResultPaths: new Map(),
      auditContext: { domainBlocked: true },
    });

    await processContentAndGenerateOpportunities(ctx);

    const written = captureStatusWrite(ctx.s3Client);
    expect(written).to.have.property('scrapeForbidden', true);
  });

  it('scrapeJobId from auditContext is written to status.json', async () => {
    const siteId = 'site-jobid';
    const scrapeJobId = 'job-unique-id-123';
    const url = 'https://example.com/page-1';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        ...buildUrlS3Content(scrapeJobId, url),
      }),
      dataAccess: buildDataAccess(sandbox, { scrapeUrls: [url] }),
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    const written = captureStatusWrite(ctx.s3Client);
    expect(written).to.have.property('scrapeJobId', scrapeJobId);
  });

  it('failed URL scrape is recorded with scrapingStatus=error in status.json page entry', async () => {
    // When compareHtmlContent cannot read a URL's HTML from S3 (e.g. NoSuchKey),
    // uploadStatusSummaryToS3 must still include that URL in pages[] with
    // scrapingStatus='error' so the UI and operators can distinguish scrape failures
    // from pages that genuinely have no content gap.
    const siteId = 'site-page-error';
    const scrapeJobId = 'job-page-error';
    const successUrl = 'https://example.com/success-page';
    const errorUrl = 'https://example.com/error-page';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        // successUrl has HTML in S3 → comparison succeeds
        ...buildUrlS3Content(scrapeJobId, successUrl),
        // errorUrl has no entry → NoSuchKey → comparison fails with error result
      }),
      dataAccess: buildDataAccess(sandbox, {
        scrapeUrls: [successUrl, errorUrl],
      }),
      scrapeResultPaths: new Map([[successUrl, {}], [errorUrl, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    const written = captureStatusWrite(ctx.s3Client);
    const errorPage = written?.pages?.find((p) => p.url === errorUrl);
    expect(errorPage, 'error URL must appear in status.json pages').to.not.be.undefined;
    expect(errorPage.scrapingStatus).to.equal('error');

    const successPage = written?.pages?.find((p) => p.url === successUrl);
    expect(successPage?.scrapingStatus).to.equal('success');
  });

  it('getScrapeJobStats falls back to urlsToCheck count when ScrapeUrl is unavailable', async () => {
    // Remove ScrapeUrl from dataAccess → getScrapeJobStats uses fallback path
    // (urlsSubmittedForScraping = urlsToCheck.length)
    const siteId = 'site-scrapeurl-missing';
    const scrapeJobId = 'job-fallback';
    const url = 'https://example.com/page-1';

    const dataAccess = buildDataAccess(sandbox, { scrapeUrls: [url] });
    delete dataAccess.ScrapeUrl; // simulate missing ScrapeUrl entity

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

    // Should complete without error — fallback is silent
    const result = await processContentAndGenerateOpportunities(ctx);
    expect(result).to.have.property('status', 'complete');

    const written = captureStatusWrite(ctx.s3Client);
    expect(written).to.have.property('urlsSubmittedForScraping').that.is.a('number');
  });

  it('S3 path contract: handler reads HTML from canonical scrapeJobId + sanitized-pathname keys', async () => {
    // Verifies the key construction: prerender/scrapes/{scrapeJobId}/{sanitizedPath}/{file}
    // Uses a URL with path segments that exercise the sanitization rules (dots, underscores, slashes)
    // so that any drift in sanitizeImportPath would make the expected keys diverge from actual reads.
    const siteId = 'site-s3-path';
    const scrapeJobId = 'job-s3-path';
    const url = 'https://example.com/some/deep.path/with_underscore';

    const keys = scrapeKeys(scrapeJobId, url);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
        ...buildUrlS3Content(scrapeJobId, url),
      }),
      dataAccess: buildDataAccess(sandbox, { scrapeUrls: [url] }),
      scrapeResultPaths: new Map([[url, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    const readKeys = ctx.s3Client.send.getCalls()
      .filter((c) => c.args[0]?.constructor?.name === 'GetObjectCommand')
      .map((c) => c.args[0].input.Key);

    expect(readKeys).to.include(keys.serverHtml);
    expect(readKeys).to.include(keys.clientHtml);
    expect(readKeys).to.include(keys.scrapeJson);
  });
});

describe('Prerender behaviour — PageCitability writes (Step 3)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('successful comparison URLs are written to PageCitability as 7-day dedup records', async () => {
    const siteId = 'site-citability-ok';

    const dataAccess = buildDataAccess(sandbox);
    dataAccess.PageCitability.allBySiteId = sandbox.stub().resolves([]);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      dataAccess,
    });

    const comparisonResults = [
      {
        url: 'https://example.com/ok',
        error: false,
        needsPrerender: false,
        citabilityScore: 0.9,
        contentGainRatio: 1.0,
        wordDifference: 0,
        wordCountBefore: 50,
        wordCountAfter: 50,
        isDeployedAtEdge: false,
      },
      { url: 'https://example.com/err', error: true, needsPrerender: false },
    ];

    await writeToCitabilityRecords(comparisonResults, siteId, ctx);

    // Only the non-error URL must be written — one create call with the correct URL + siteId.
    expect(ctx.dataAccess.PageCitability.create).to.have.been.calledOnce;
    const [createArgs] = ctx.dataAccess.PageCitability.create.firstCall.args;
    expect(createArgs).to.have.property('url', 'https://example.com/ok');
    expect(createArgs).to.have.property('siteId', siteId);
  });

  it('errored URLs are NOT written to PageCitability', async () => {
    const siteId = 'site-citability-all-err';

    const dataAccess = buildDataAccess(sandbox);
    dataAccess.PageCitability.allBySiteId = sandbox.stub().resolves([]);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      dataAccess,
    });

    await writeToCitabilityRecords(
      [
        { url: 'https://example.com/err-1', error: true, needsPrerender: false },
        { url: 'https://example.com/err-2', error: true, needsPrerender: false },
      ],
      siteId,
      ctx,
    );

    expect(ctx.dataAccess.PageCitability.create).to.not.have.been.called;
  });
});
