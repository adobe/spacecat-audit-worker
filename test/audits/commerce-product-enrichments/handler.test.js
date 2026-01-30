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
      warn: sinon.spy(),
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

  it('importTopPages returns top-pages metadata without limit when not provided', async () => {
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
    expect(result).to.not.have.property('limit');
  });

  it('importTopPages includes limit in auditContext when provided as object', async () => {
    const context = {
      site,
      finalUrl: 'https://example.com',
      log,
      data: { limit: 25 },
    };

    const result = await importTopPages(context);

    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: 'site-1',
      auditContext: { limit: 25 },
      auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
      fullAuditRef: 'scrapes/site-1/',
    });
  });

  it('importTopPages includes limit in auditContext when provided as JSON string', async () => {
    const context = {
      site,
      finalUrl: 'https://example.com',
      log,
      data: '{"limit":25}',
    };

    const result = await importTopPages(context);

    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: 'site-1',
      auditContext: { limit: 25 },
      auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
      fullAuditRef: 'scrapes/site-1/',
    });
  });

  it('importTopPages handles invalid JSON gracefully', async () => {
    const context = {
      site,
      finalUrl: 'https://example.com',
      log,
      data: 'invalid-json{',
    };

    const result = await importTopPages(context);

    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: 'site-1',
      auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
      fullAuditRef: 'scrapes/site-1/',
    });
    expect(result).to.not.have.property('limit');
    expect(log.warn).to.have.been.calledWith(sinon.match(/Could not parse data as JSON/));
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
      processingType: 'default',
      allowCache: false,
    });
  });

  it('submitForScraping respects limit from context.data', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      data: { limit: 5 },
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(5);
    expect(result.urls[0].url).to.equal('https://example.com/page-1');
    expect(result.urls[4].url).to.equal('https://example.com/page-5');
  });

  it('submitForScraping uses all top pages when limit not provided', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
    });

    const context = {
      site,
      dataAccess,
      log,
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(50);
    expect(result.urls[0].url).to.equal('https://example.com/page-1');
    expect(result.urls[49].url).to.equal('https://example.com/page-50');
  });

  it('submitForScraping respects limit from context.data when provided as JSON string', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      data: '{"limit":10}',
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(10);
    expect(result.urls[0].url).to.equal('https://example.com/page-1');
    expect(result.urls[9].url).to.equal('https://example.com/page-10');
  });

  it('submitForScraping handles invalid JSON gracefully', async () => {
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      data: 'invalid-json{',
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(50);
    expect(log.warn).to.have.been.calledWith(sinon.match(/Could not parse data as JSON/));
  });

  it('submitForScraping respects limit from auditContext (step chaining)', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      auditContext: { limit: 7 },
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(7);
    expect(result.urls[0].url).to.equal('https://example.com/page-1');
    expect(result.urls[6].url).to.equal('https://example.com/page-7');
  });

  it('submitForScraping prefers auditContext limit over data limit', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      data: { limit: 20 },
      auditContext: { limit: 3 },
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(3);
    expect(result.urls[0].url).to.equal('https://example.com/page-1');
    expect(result.urls[2].url).to.equal('https://example.com/page-3');
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
      processingType: 'default',
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
