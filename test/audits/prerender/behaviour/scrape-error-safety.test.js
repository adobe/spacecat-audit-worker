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
 * Behavioural contracts: scrape error safety
 *
 * Verifies that errored URLs (S3 NoSuchKey / missing HTML) never cause their
 * suggestions to be marked OUTDATED, while successfully scraped URLs are still
 * eligible for OUTDATED marking.
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
  buildOpportunity,
  buildSuggestion,
  buildUrlS3Content,
  buildStatus,
  statusKey,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — scrape error safety', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('100% scraping error → no suggestions marked OUTDATED', async () => {
    const siteId = 'site-all-error';
    const scrapeJobId = 'job-all-error';
    const url1 = 'https://example.com/error-page-1';
    const url2 = 'https://example.com/error-page-2';

    // Both URLs have NO S3 content — every GetObjectCommand for these keys
    // will reject with NoSuchKey (buildS3Client default for absent keys).
    // Only the status.json key is present so the handler can read/write it.
    const s3Client = buildS3Client(sandbox, {
      [statusKey(siteId)]: buildStatus(),
    });

    const url1Suggestion = buildSuggestion(sandbox, {
      id: 'sug-err-1',
      siteId,
      status: 'NEW',
      data: { url: url1 },
    });
    const url2Suggestion = buildSuggestion(sandbox, {
      id: 'sug-err-2',
      siteId,
      status: 'NEW',
      data: { url: url2 },
    });

    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-all-error',
      siteId,
      type: 'prerender',
      status: 'NEW',
      suggestions: [url1Suggestion, url2Suggestion],
    });

    const dataAccess = buildDataAccess(sandbox, {
      opportunities: [opportunity],
      scrapeUrls: [url1, url2],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client,
      dataAccess,
      scrapeResultPaths: new Map([[url1, {}], [url2, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // scrapedUrlsSet is empty because all comparisons errored → no URLs are
    // eligible for OUTDATED, so bulkUpdateStatus must never be called.
    expect(ctx.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
  });

  it('Partial error — errored URL suggestion NOT OUTDATED, successfully scraped URL IS OUTDATED', async () => {
    const siteId = 'site-partial-error';
    const scrapeJobId = 'job-partial-error';
    const url1 = 'https://example.com/ok-page';
    const url2 = 'https://example.com/error-page';

    // url1 has full S3 content (HTML_SAME → needsPrerender=false, successful comparison).
    // url2 has NO S3 content → compareHtmlContent returns { error: true, ... }.
    const s3Client = buildS3Client(sandbox, {
      [statusKey(siteId)]: buildStatus(),
      ...buildUrlS3Content(scrapeJobId, url1), // HTML_SAME default → no prerender needed
    });

    const url1Suggestion = buildSuggestion(sandbox, {
      id: 'sug-ok-1',
      siteId,
      status: 'NEW',
      data: { url: url1 },
    });
    const url2Suggestion = buildSuggestion(sandbox, {
      id: 'sug-err-2',
      siteId,
      status: 'NEW',
      data: { url: url2 },
    });

    const opportunity = buildOpportunity(sandbox, {
      id: 'opp-partial-error',
      siteId,
      type: 'prerender',
      status: 'NEW',
      suggestions: [url1Suggestion, url2Suggestion],
    });

    const dataAccess = buildDataAccess(sandbox, {
      opportunities: [opportunity],
      scrapeUrls: [url1, url2],
    });

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client,
      dataAccess,
      scrapeResultPaths: new Map([[url1, {}], [url2, {}]]),
      auditContext: { scrapeJobId },
    });

    await processContentAndGenerateOpportunities(ctx);

    // bulkUpdateStatus should have been called because url1 was successfully scraped
    // (needsPrerender=false → it belongs to scrapedUrlsSet → its suggestion is OUTDATED).
    expect(ctx.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.called;

    // Collect all suggestions passed to bulkUpdateStatus across all calls.
    const allUpdatedSuggestions = ctx.dataAccess.Suggestion.bulkUpdateStatus.args
      .flatMap(([suggestions]) => suggestions);

    const updatedIds = allUpdatedSuggestions.map((s) => s.getId());

    // url1's suggestion IS in the outdated set (successfully scraped, no longer needs prerender).
    expect(updatedIds).to.include(url1Suggestion.getId());

    // url2's suggestion is NOT in the outdated set (errored → excluded from scrapedUrlsSet).
    expect(updatedIds).to.not.include(url2Suggestion.getId());
  });
});
