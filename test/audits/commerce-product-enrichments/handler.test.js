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

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';

import {
  importTopPages,
  submitForScraping,
  runAuditAndProcessResults,
} from '../../../src/commerce-product-enrichments/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Commerce Product Enrichments Handler', () => {
  let log;
  let site;
  let dataAccess;

  beforeEach(() => {
    log = {
      info: sinon.spy(),
      error: sinon.spy(),
    };

    site = {
      getId: sinon.stub().returns('site-1'),
      getConfig: sinon.stub().returns({
        getIncludedURLs: sinon.stub().resolves([]),
      }),
    };

    dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
      },
    };
  });

  it('importTopPages returns top-pages metadata', async () => {
    const context = {
      site,
      finalUrl: 'https://example.com',
      log,
    };

    const result = await importTopPages(context);

    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: 'site-1',
      auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
      fullAuditRef: 'scrapes/site-1/',
    });
  });

  it('submitForScraping combines top pages and included URLs, filters PDFs', async () => {
    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
      { getUrl: () => 'https://example.com/page-1' },
      { getUrl: () => 'https://example.com/doc.pdf' },
      { getUrl: () => 'ht!tp://bad-url' },
    ]);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([
        'https://example.com/page-1',
        'https://example.com/page-2',
      ]),
    });

    const context = {
      site,
      dataAccess,
      log,
    };

    const result = await submitForScraping(context);

    expect(result).to.deep.equal({
      urls: [
        { url: 'https://example.com/page-1' },
        { url: 'ht!tp://bad-url' },
        { url: 'https://example.com/page-2' },
      ],
      siteId: 'site-1',
      type: 'commerce-product-enrichments',
      allowCache: false,
    });
  });

  it('submitForScraping handles missing site config and defaults to top pages only', async () => {
    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
      { getUrl: () => 'https://example.com/page-1' },
    ]);

    site.getConfig.returns(undefined);

    const context = {
      site,
      dataAccess,
      log,
    };

    const result = await submitForScraping(context);

    expect(result).to.deep.equal({
      urls: [{ url: 'https://example.com/page-1' }],
      siteId: 'site-1',
      type: 'commerce-product-enrichments',
      allowCache: false,
    });
  });

  it('submitForScraping throws when no URLs are available', async () => {
    const context = {
      site,
      dataAccess,
      log,
    };

    await expect(submitForScraping(context)).to.be.rejectedWith(
      'No URLs found for site neither top pages nor included URLs',
    );
  });

  it('runAuditAndProcessResults returns initial-implementation result with scraped pages', async () => {
    const context = {
      site,
      audit: { getId: () => 'audit-1' },
      finalUrl: 'https://example.com',
      log,
      scrapeResultPaths: new Map([
        ['https://example.com/a', 'scrapes/site-1/a/scrape.json'],
        ['https://example.com/b', 'scrapes/site-1/b/scrape.json'],
      ]),
    };

    const result = await runAuditAndProcessResults(context);

    expect(result).to.deep.equal({
      status: 'complete',
      auditResult: {
        status: 'initial-implementation',
        message: 'Commerce page enrichment audit - initial implementation stop point',
        pagesScraped: 2,
      },
    });
  });

  it('runAuditAndProcessResults handles missing scrape results', async () => {
    const context = {
      site,
      audit: { getId: () => 'audit-2' },
      finalUrl: 'https://example.com',
      log,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.pagesScraped).to.equal(0);
  });
});
