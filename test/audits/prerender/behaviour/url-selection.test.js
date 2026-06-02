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
 * Behavioural contracts: URL processing in Step 2 (submitForScraping)
 *
 * Normal mode: PageCitability 7-day dedup, edge-deployed URL exclusion, includedURLs,
 * and DAILY_BATCH_SIZE=320 cap.  No esmock required: getTopAgenticLiveUrlsFromAthena
 * throws when Athena is not configured; getTopAgenticUrls silently catches it and
 * returns [], leaving organic + included URLs as the only sources.
 *
 * CSV mode: non-HTML extension filtering, same-pathname deduplication, overrideBaseURL
 * rebasing.  Tests call submitForScraping directly with auditContext.urls set.
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { submitForScraping } from '../../../../src/prerender/handler.js';
import {
  buildContext,
  buildSite,
  buildS3Client,
  buildDataAccess,
  statusKey,
  buildStatus,
  daysAgo,
} from './helpers.js';

use(sinonChai);

describe('Prerender behaviour — URL selection (Step 2, normal mode)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('URL processed within 7-day window (PageCitability) is excluded from the batch', async () => {
    const siteId = 'site-dedup';
    const recentUrl = 'https://example.com/recent-page';
    const freshUrl = 'https://example.com/fresh-page';

    const citabilityRecords = [
      {
        // recently processed — should be excluded
        getUrl: () => recentUrl,
        getUpdatedAt: () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      }),
      dataAccess: buildDataAccess(sandbox, {
        topPages: [recentUrl, freshUrl],
        citabilityRecords,
      }),
    });

    const result = await submitForScraping(ctx);

    const submittedUrls = result.urls.map((u) => u.url);
    expect(submittedUrls).to.not.include(recentUrl);
    expect(submittedUrls).to.include(freshUrl);
  });

  it('URL absent from PageCitability (outside dedup window) is included in the batch', async () => {
    // The real DB query filters by updatedAt >= 7 days ago, so expired records are not returned.
    // Stub models this by returning no records for that URL — result: URL is included.
    const siteId = 'site-dedup-expired';
    const oldUrl = 'https://example.com/stale-page';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      }),
      dataAccess: buildDataAccess(sandbox, {
        topPages: [oldUrl],
        citabilityRecords: [], // DB returns nothing (record outside 7-day window)
      }),
    });

    const result = await submitForScraping(ctx);

    const submittedUrls = result.urls.map((u) => u.url);
    expect(submittedUrls).to.include(oldUrl);
  });

  it('URL marked isDeployedAtEdge in status.json pages is excluded from the batch', async () => {
    const siteId = 'site-edge-excl';
    const deployedUrl = 'https://example.com/deployed-page';
    const normalUrl = 'https://example.com/normal-page';

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus({
          pages: [
            { url: deployedUrl, isDeployedAtEdge: true },
          ],
        }),
      }),
      dataAccess: buildDataAccess(sandbox, {
        topPages: [deployedUrl, normalUrl],
      }),
    });

    const result = await submitForScraping(ctx);

    const submittedUrls = result.urls.map((u) => u.url);
    expect(submittedUrls).to.not.include(deployedUrl);
    expect(submittedUrls).to.include(normalUrl);
  });

  it('includedURLs from site config are added to the batch alongside organic URLs', async () => {
    const siteId = 'site-included-urls';
    const organicUrl = 'https://example.com/organic';
    const includedUrl = 'https://example.com/included-special';

    const ctx = buildContext(sandbox, {
      site: buildSite({
        id: siteId,
        baseUrl: 'https://example.com',
        includedUrls: [includedUrl],
      }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      }),
      dataAccess: buildDataAccess(sandbox, {
        topPages: [organicUrl],
      }),
    });

    const result = await submitForScraping(ctx);

    const submittedUrls = result.urls.map((u) => u.url);
    expect(submittedUrls).to.include(organicUrl);
    expect(submittedUrls).to.include(includedUrl);
  });

  it('normal mode caps submitted URL count at DAILY_BATCH_SIZE=320', async () => {
    // Organic is capped internally at TOP_ORGANIC_URLS_LIMIT=200.
    // Adding 150 includedURLs (no overlap) makes the combined pool 350 > 320.
    // Normal mode must slice to exactly 320.
    const siteId = 'site-batch-cap';
    const organicUrls = Array.from({ length: 200 }, (_, i) => `https://example.com/organic-${i}`);
    const includedUrls = Array.from({ length: 150 }, (_, i) => `https://example.com/included-${i}`);

    const ctx = buildContext(sandbox, {
      site: buildSite({ id: siteId, baseUrl: 'https://example.com', includedUrls }),
      s3Client: buildS3Client(sandbox, {
        [statusKey(siteId)]: buildStatus(),
      }),
      dataAccess: buildDataAccess(sandbox, { topPages: organicUrls }),
    });

    const result = await submitForScraping(ctx);

    expect(result.urls).to.have.length(320);
  });
});

describe('Prerender behaviour — URL filtering (Step 2, CSV mode)', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  it('non-HTML URLs (jpg, pdf, mp3) are filtered out before submission', async () => {
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: 'site-html-filter', baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      auditContext: {
        urls: [
          'https://example.com/page',          // kept — no non-HTML extension
          'https://example.com/article.html',  // kept — .html is fine
          'https://example.com/image.jpg',     // filtered — image
          'https://example.com/doc.pdf',       // filtered — document
          'https://example.com/sound.mp3',     // filtered — media
        ],
      },
    });

    const result = await submitForScraping(ctx);

    expect(result.urls).to.have.length(2);
    const returnedUrls = result.urls.map(({ url }) => url);
    expect(returnedUrls.some((u) => u.includes('.jpg'))).to.be.false;
    expect(returnedUrls.some((u) => u.includes('.pdf'))).to.be.false;
    expect(returnedUrls.some((u) => u.includes('.mp3'))).to.be.false;
  });

  it('URLs with the same pathname (one with trailing slash) are deduplicated', async () => {
    const ctx = buildContext(sandbox, {
      site: buildSite({ id: 'site-dedup', baseUrl: 'https://example.com' }),
      s3Client: buildS3Client(sandbox),
      auditContext: {
        urls: [
          'https://example.com/page-1',    // first occurrence kept
          'https://example.com/page-1/',   // trailing slash → same path → deduplicated
          'https://example.com/page-2',    // distinct path, kept
        ],
      },
    });

    const result = await submitForScraping(ctx);

    expect(result.urls).to.have.length(2);
    const returnedPaths = result.urls.map(({ url }) => new URL(url).pathname.replace(/\/+$/, ''));
    expect(returnedPaths.filter((p) => p === '/page-1')).to.have.length(1);
    expect(returnedPaths).to.include('/page-2');
  });

  it('CSV mode rebases URLs to overrideBaseURL when set in site fetch config', async () => {
    // When a site configures overrideBaseURL (e.g. preview → prod domain swap),
    // CSV URLs from any origin must be rebased to that override domain.
    const ctx = buildContext(sandbox, {
      site: buildSite({
        id: 'site-override',
        baseUrl: 'https://primary.com',
        overrideBaseURL: 'https://override.example.com',
      }),
      s3Client: buildS3Client(sandbox),
      auditContext: {
        urls: ['https://other-origin.com/some/path'],
      },
    });

    const result = await submitForScraping(ctx);

    expect(result.urls).to.have.length(1);
    const { url } = result.urls[0];
    expect(url).to.equal('https://override.example.com/some/path');
    expect(url).to.not.include('primary.com');
    expect(url).to.not.include('other-origin.com');
  });
});
