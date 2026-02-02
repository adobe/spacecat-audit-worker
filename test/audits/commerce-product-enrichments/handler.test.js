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
      options: {
        waitTimeoutForMetaTags: 5000,
      },
      allowCache: false,
      maxScrapeAge: 0,
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
    expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-1' });
    expect(result.urls[4]).to.deep.equal({ url: 'https://example.com/page-5' });
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
    expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-1' });
    expect(result.urls[49]).to.deep.equal({ url: 'https://example.com/page-50' });
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
    expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-1' });
    expect(result.urls[9]).to.deep.equal({ url: 'https://example.com/page-10' });
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
    expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-1' });
    expect(result.urls[6]).to.deep.equal({ url: 'https://example.com/page-7' });
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
    expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-1' });
    expect(result.urls[2]).to.deep.equal({ url: 'https://example.com/page-3' });
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
      options: {
        waitTimeoutForMetaTags: 5000,
      },
      allowCache: false,
      maxScrapeAge: 0,
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

  it('runAuditAndProcessResults processes scrape results from scrapeResultPaths', async () => {
    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            url: 'https://example.com/page-1',
            finalUrl: 'https://example.com/page-1',
            scrapeResult: {},
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page-1', 'scrapes/site-1/page-1/scrape.json'],
      ['https://example.com/page-2', 'scrapes/site-1/page-2/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-1' },
      finalUrl: 'https://example.com',
      log: {
        ...log,
        debug: sinon.spy(),
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(result.auditResult.totalScraped).to.equal(2);
    expect(result.auditResult.processedPages).to.equal(2);
    expect(result.auditResult.productPages).to.equal(0);
  });

  it('runAuditAndProcessResults handles missing scrape results', async () => {
    const context = {
      site,
      audit: { getId: () => 'audit-2' },
      finalUrl: 'https://example.com',
      log,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths: new Map(),
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(result.auditResult.message).to.equal('No scraped content found');
  });

  it('runAuditAndProcessResults handles missing S3 bucket configuration', async () => {
    const scrapeResultPaths = new Map([
      ['https://example.com/page-1', 'scrapes/site-1/page-1/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-3' },
      finalUrl: 'https://example.com',
      log,
      env: {},
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('PROCESSING_FAILED');
    expect(result.auditResult.error).to.equal('Missing S3 bucket configuration for commerce audit');
  });

  it('runAuditAndProcessResults handles empty scrape data from S3', async () => {
    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(''),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page-1', 'scrapes/site-1/page-1/scrape.json'],
      ['https://example.com/page-2', 'scrapes/site-1/page-2/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-4' },
      finalUrl: 'https://example.com',
      log: {
        ...log,
        debug: sinon.spy(),
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(result.auditResult.totalScraped).to.equal(2);
    expect(result.auditResult.processedPages).to.equal(0);
    expect(result.auditResult.failedPages).to.equal(2);
  });

  it('runAuditAndProcessResults handles S3 read errors', async () => {
    const s3Client = {
      send: sinon.stub().rejects(new Error('S3 access denied')),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page-1', 'scrapes/site-1/page-1/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-5' },
      finalUrl: 'https://example.com',
      log: {
        ...log,
        debug: sinon.spy(),
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(result.auditResult.processedPages).to.equal(0);
    expect(result.auditResult.failedPages).to.equal(1);
    expect(log.warn).to.have.been.calledWith(sinon.match(/No scrape data found/));
  });

  it('runAuditAndProcessResults handles unexpected errors during processing', async () => {
    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            url: 'https://example.com/page-1',
            finalUrl: 'https://example.com/page-1',
            scrapeResult: {},
          })),
        },
      }),
    };

    // Create a log mock where debug throws an error
    const logWithError = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
      debug: sinon.stub().throws(new Error('Unexpected logging error')),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page-1', 'scrapes/site-1/page-1/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-6' },
      finalUrl: 'https://example.com',
      log: logWithError,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(result.auditResult.processedPages).to.equal(0);
    expect(result.auditResult.failedPages).to.equal(1);
    // getObjectFromKey logs S3 errors, so check that log.error was called
    expect(logWithError.error).to.have.been.called;
  });

  it('runAuditAndProcessResults handles missing metadata.url', async () => {
    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            finalUrl: 'https://example.com/page-1',
            scrapeResult: {},
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page-1', 'scrapes/site-1/page-1/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-7' },
      finalUrl: 'https://example.com',
      log: {
        ...log,
        debug: sinon.spy(),
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(result.auditResult.processedPages).to.equal(1);
  });

  it('runAuditAndProcessResults returns OPPORTUNITIES_FOUND when product pages are detected', async () => {
    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            url: 'https://example.com/product-1',
            finalUrl: 'https://example.com/product-1',
            scrapeResult: {
              structuredData: {
                jsonld: {
                  Product: [
                    {
                      name: 'Test Product',
                      sku: 'TEST-SKU-123',
                    },
                  ],
                },
              },
            },
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-8' },
      finalUrl: 'https://example.com',
      log: {
        ...log,
        debug: sinon.spy(),
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('OPPORTUNITIES_FOUND');
    expect(result.auditResult.processedPages).to.equal(1);
    expect(result.auditResult.productPages).to.equal(1);
    expect(result.auditResult.message).to.include('Found 1 product pages');
  });

  it('runAuditAndProcessResults filters out category pages with multiple products', async () => {
    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            url: 'https://example.com/category',
            finalUrl: 'https://example.com/category',
            scrapeResult: {
              structuredData: {
                jsonld: {
                  Product: [
                    {
                      name: 'Product 1',
                      sku: 'SKU-1',
                    },
                    {
                      name: 'Product 2',
                      sku: 'SKU-2',
                    },
                    {
                      name: 'Product 3',
                      sku: 'SKU-3',
                    },
                  ],
                },
              },
            },
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/category', 'scrapes/site-1/category/scrape.json'],
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-9' },
      finalUrl: 'https://example.com',
      log: {
        ...log,
        debug: sinon.spy(),
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(result.auditResult.processedPages).to.equal(1);
    expect(result.auditResult.productPages).to.equal(0);
  });

});

