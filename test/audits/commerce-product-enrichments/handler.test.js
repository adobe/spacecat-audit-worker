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

import esmock from 'esmock';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import {
  importTopPages,
  submitForScraping,
  runAuditAndProcessResults,
} from '../../../src/commerce-product-enrichments/handler.js';

use(sinonChai);
use(chaiAsPromised);

// Valid ACCS format config for mocking
const validACCSConfig = {
  public: {
    default: {
      'commerce-endpoint': 'https://commerce.example.com/graphql',
      headers: {
        cs: {
          'Magento-Environment-Id': 'env-123',
          'Magento-Store-Code': 'store-code',
          'Magento-Store-View-Code': 'view-code',
          'Magento-Website-Code': 'website-code',
          'Magento-Customer-Group': 'customer-group',
          'x-api-key': 'api-key-123',
        },
      },
    },
  },
};

describe('Commerce Product Enrichments Handler', () => {
  let log;
  let site;
  let dataAccess;
  let fetchStub;

  beforeEach(() => {
    sinon.stub(Config, 'toDynamoItem').returns({});
    fetchStub = sinon.stub(global, 'fetch');

    log = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
      debug: sinon.spy(),
    };

    site = {
      getId: sinon.stub().returns('site-1'),
      getBaseURL: sinon.stub().returns('https://example.com'),
      getConfig: sinon.stub().returns({
        getIncludedURLs: sinon.stub().resolves([]),
        getExcludedURLs: sinon.stub().returns([]),
        updateExcludedURLs: sinon.stub(),
        getHandlers: sinon.stub().returns({}),
      }),
      setConfig: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('importTopPages returns top-pages metadata without auditContext when no limit provided', async () => {
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
    expect(result).to.not.have.property('auditContext');
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
    expect(result).to.not.have.property('auditContext');
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
      getExcludedURLs: sinon.stub().returns([]),
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
      jobId: 'site-1',
      processingType: 'default',
      auditContext: {
        scrapeJobId: 'site-1',
      },
      options: {
        waitTimeoutForMetaTags: 5000,
      },
      allowCache: false,
      maxScrapeAge: 0,
    });
  });

  it('submitForScraping filters out excluded URLs from top pages', async () => {
    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
      { getUrl: () => 'https://example.com/page-1' },
      { getUrl: () => 'https://example.com/page-2' },
      { getUrl: () => 'https://example.com/page-3' },
    ]);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns(['https://example.com/page-2']),
    });

    const result = await submitForScraping({ site, dataAccess, log });

    expect(result.urls).to.deep.equal([
      { url: 'https://example.com/page-1' },
      { url: 'https://example.com/page-3' },
    ]);
  });

  it('submitForScraping does not exclude manually included URLs', async () => {
    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
      { getUrl: () => 'https://example.com/page-1' },
    ]);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves(['https://example.com/included-page']),
      getExcludedURLs: sinon.stub().returns([
        'https://example.com/page-1',
        'https://example.com/included-page',
      ]),
    });

    const result = await submitForScraping({ site, dataAccess, log });

    // page-1 is excluded (came from top pages), but included-page passes through
    expect(result.urls).to.deep.equal([
      { url: 'https://example.com/included-page' },
    ]);
  });

  it('submitForScraping handles undefined getExcludedURLs gracefully', async () => {
    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
      { getUrl: () => 'https://example.com/page-1' },
    ]);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      // no getExcludedURLs method
    });

    const result = await submitForScraping({ site, dataAccess, log });

    expect(result.urls).to.deep.equal([
      { url: 'https://example.com/page-1' },
    ]);
  });

  it('submitForScraping uses all top pages when no auditContext limit', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      data: { limit: 5 },
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(50);
    expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-1' });
    expect(result.urls[49]).to.deep.equal({ url: 'https://example.com/page-50' });
  });

  it('submitForScraping returns all top pages when no limit provided', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
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

  it('submitForScraping ignores limit from context.data when provided as JSON string', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      data: '{"limit":10}',
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(50);
    expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-1' });
    expect(result.urls[49]).to.deep.equal({ url: 'https://example.com/page-50' });
  });

  it('submitForScraping ignores invalid JSON in context.data', async () => {
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
    });

    const context = {
      site,
      dataAccess,
      log,
      data: 'invalid-json{',
    };

    const result = await submitForScraping(context);

    expect(result.urls).to.have.lengthOf(50);
  });

  it('submitForScraping respects limit from auditContext (step chaining)', async () => {
    // Create an array of 50 top pages
    const manyTopPages = Array.from({ length: 50 }, (_, i) => ({
      getUrl: () => `https://example.com/page-${i + 1}`,
    }));

    dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyTopPages);

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
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
      getExcludedURLs: sinon.stub().returns([]),
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
      jobId: 'site-1',
      processingType: 'default',
      auditContext: {
        scrapeJobId: 'site-1',
      },
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
    expect(result.auditResult.error).to.equal('S3_SCRAPER_BUCKET_NAME not configured');
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

    // Create a log mock where debug throws only during scrape processing
    const logWithError = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
      debug: sinon.stub().callsFake((msg) => {
        if (typeof msg === 'string' && msg.includes('Reading scrape data')) {
          throw new Error('Unexpected logging error');
        }
      }),
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

  it('runAuditAndProcessResults extracts and logs commerce config successfully', async () => {
    // Mock fetch to return valid ACCS config
    fetchStub.resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    site.getConfig.returns({
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
        },
      }),
    });

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
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-10' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(log.debug).to.have.been.calledWith(
      sinon.match(/Commerce config:/),
      sinon.match.has('url', 'https://commerce.example.com/graphql'),
    );
  });

  it('runAuditAndProcessResults logs warning when commerce config extraction fails', async () => {
    // Mock fetch to return error
    fetchStub.resolves({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
      text: () => Promise.resolve(''),
    });

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
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-11' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(log.warn).to.have.been.calledWith(sinon.match(/Failed to extract commerce config/));
  });

  it('runAuditAndProcessResults logs commerce config at debug for minimal AC config', async () => {
    const minimalACCSConfig = {
      public: {
        default: {
          'commerce-endpoint': 'https://commerce.example.com/graphql',
          headers: {
            cs: {
              'Magento-Environment-Id': 'env-123',
            },
          },
        },
      },
    };

    fetchStub.resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(minimalACCSConfig),
    });

    site.getConfig.returns({
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
        },
      }),
    });

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
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-12' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(log.debug).to.have.been.calledWith(
      sinon.match(/Commerce config:/),
      sinon.match.has('headers', sinon.match.has('Magento-Environment-Id', 'env-123')),
    );
  });

  it('runAuditAndProcessResults does not call enrichment API when no product pages detected', async () => {
    // Mock config fetch
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    site.getConfig.returns({
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
        },
      }),
    });

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
    ]);

    const context = {
      site,
      audit: { getId: () => 'audit-14' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    // Verify enrichment API was NOT called
    const enrichmentCalls = fetchStub.getCalls().filter((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCalls).to.have.lengthOf(0);

    // Verify enrichment response is null
    expect(result.auditResult.enrichmentResponse).to.be.null;
  });

  it('runAuditAndProcessResults skips enrichment when CATALOG_ENRICHMENT_ENDPOINT not configured', async () => {
    // Mock config fetch
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    site.getConfig.returns({
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
        },
      }),
    });

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
                  Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }],
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
      audit: { getId: () => 'audit-16' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        // CATALOG_ENRICHMENT_ENDPOINT not set
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    // Verify warning was logged
    expect(log.warn).to.have.been.calledWith(sinon.match(/CATALOG_ENRICHMENT_ENDPOINT not configured/));

    // Verify enrichment response is null
    expect(result.auditResult.enrichmentResponse).to.be.null;
  });

  it('runAuditAndProcessResults skips enrichment when commerce config extraction fails', async () => {
    // Mock config fetch with error
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
      text: () => Promise.resolve(''),
    });

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
                  Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }],
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
      audit: { getId: () => 'audit-17' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
      },
      scrapeResultPaths,
    };

    const result = await runAuditAndProcessResults(context);

    // Verify no enrichment call attempted
    const enrichmentCalls = fetchStub.getCalls().filter((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCalls).to.have.lengthOf(0);

    // Verify enrichment response is null
    expect(result.auditResult.enrichmentResponse).to.be.null;
  });

  it('runAuditAndProcessResults persists non-product URLs as excluded', async () => {
    const mockConfig = {
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({}),
    };
    site.getConfig.returns(mockConfig);

    const s3Client = { send: sinon.stub() };

    // Product page
    s3Client.send.onCall(0).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {
            structuredData: { jsonld: { Product: [{ sku: 'SKU-1' }] } },
          },
        })),
      },
    });

    // Non-product page
    s3Client.send.onCall(1).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {},
        })),
      },
    });

    // Another non-product page
    s3Client.send.onCall(2).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {},
        })),
      },
    });

    const scrapeResultPaths = new Map([
      ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ['https://example.com/about', 'scrapes/site-1/about/scrape.json'],
      ['https://example.com/blog', 'scrapes/site-1/blog/scrape.json'],
    ]);

    await runAuditAndProcessResults({
      site,
      audit: { getId: () => 'audit-excl-1' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      scrapeResultPaths,
    });

    expect(mockConfig.updateExcludedURLs).to.have.been.calledOnce;
    const [auditType, urls] = mockConfig.updateExcludedURLs.firstCall.args;
    expect(auditType).to.equal('commerce-product-enrichments');
    expect(urls).to.have.members([
      'https://example.com/about',
      'https://example.com/blog',
    ]);
    expect(site.setConfig).to.have.been.calledOnce;
    expect(site.save).to.have.been.calledOnce;
  });

  it('runAuditAndProcessResults does not exclude failed pages', async () => {
    const mockConfig = {
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({}),
    };
    site.getConfig.returns(mockConfig);

    const s3Client = { send: sinon.stub() };

    // Non-product page (success)
    s3Client.send.onCall(0).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {},
        })),
      },
    });

    // Failed page (S3 error)
    s3Client.send.onCall(1).rejects(new Error('S3 read error'));

    const scrapeResultPaths = new Map([
      ['https://example.com/category', 'scrapes/site-1/category/scrape.json'],
      ['https://example.com/broken', 'scrapes/site-1/broken/scrape.json'],
    ]);

    await runAuditAndProcessResults({
      site,
      audit: { getId: () => 'audit-excl-2' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      scrapeResultPaths,
    });

    // Only the successful non-product page should be excluded, not the failed one
    const [, urls] = mockConfig.updateExcludedURLs.firstCall.args;
    expect(urls).to.deep.equal(['https://example.com/category']);
    expect(urls).to.not.include('https://example.com/broken');
  });

  it('runAuditAndProcessResults merges with existing excluded URLs', async () => {
    const mockConfig = {
      getExcludedURLs: sinon.stub().returns([
        'https://example.com/old-excluded-1',
        'https://example.com/old-excluded-2',
      ]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({}),
    };
    site.getConfig.returns(mockConfig);

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {},
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/new-non-product', 'scrapes/site-1/new/scrape.json'],
    ]);

    await runAuditAndProcessResults({
      site,
      audit: { getId: () => 'audit-excl-3' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      scrapeResultPaths,
    });

    const [, urls] = mockConfig.updateExcludedURLs.firstCall.args;
    expect(urls).to.have.lengthOf(3);
    expect(urls).to.include('https://example.com/old-excluded-1');
    expect(urls).to.include('https://example.com/old-excluded-2');
    expect(urls).to.include('https://example.com/new-non-product');
  });

  it('runAuditAndProcessResults deduplicates excluded URLs', async () => {
    const mockConfig = {
      getExcludedURLs: sinon.stub().returns([
        'https://example.com/already-excluded',
      ]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({}),
    };
    site.getConfig.returns(mockConfig);

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {},
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/already-excluded', 'scrapes/site-1/already/scrape.json'],
    ]);

    await runAuditAndProcessResults({
      site,
      audit: { getId: () => 'audit-excl-4' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      scrapeResultPaths,
    });

    const [, urls] = mockConfig.updateExcludedURLs.firstCall.args;
    expect(urls).to.have.lengthOf(1);
    expect(urls).to.deep.equal(['https://example.com/already-excluded']);
  });

  it('runAuditAndProcessResults handles getExcludedURLs returning undefined', async () => {
    const mockConfig = {
      getExcludedURLs: sinon.stub().returns(undefined),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({}),
    };
    site.getConfig.returns(mockConfig);

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {},
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page', 'scrapes/site-1/page/scrape.json'],
    ]);

    await runAuditAndProcessResults({
      site,
      audit: { getId: () => 'audit-excl-undef' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      scrapeResultPaths,
    });

    const [, urls] = mockConfig.updateExcludedURLs.firstCall.args;
    expect(urls).to.deep.equal(['https://example.com/page']);
  });

  it('runAuditAndProcessResults handles config save failure gracefully', async () => {
    const mockConfig = {
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({}),
    };
    site.getConfig.returns(mockConfig);
    site.save.rejects(new Error('DynamoDB write failed'));

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {},
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/page', 'scrapes/site-1/page/scrape.json'],
    ]);

    const result = await runAuditAndProcessResults({
      site,
      audit: { getId: () => 'audit-excl-5' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      scrapeResultPaths,
    });

    // Audit should still complete despite save failure
    expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
    expect(log.error).to.have.been.calledWith(
      sinon.match(/Failed to persist excludedURLs/),
    );
  });

  it('runAuditAndProcessResults skips persistence when all pages are products', async () => {
    const mockConfig = {
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({}),
    };
    site.getConfig.returns(mockConfig);

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: { jsonld: { Product: [{ sku: 'SKU-1' }] } },
            },
          })),
        },
      }),
    };

    const scrapeResultPaths = new Map([
      ['https://example.com/product', 'scrapes/site-1/product/scrape.json'],
    ]);

    await runAuditAndProcessResults({
      site,
      audit: { getId: () => 'audit-excl-6' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      scrapeResultPaths,
    });

    // updateExcludedURLs should not be called when there are no non-product pages
    expect(mockConfig.updateExcludedURLs).to.not.have.been.called;
  });
});

describe('Commerce Product Enrichments - CAS IMS Authentication', () => {
  let log;
  let site;
  let fetchStub;
  let mockImsClient;
  let runAuditWithIms;

  beforeEach(async () => {
    fetchStub = sinon.stub(global, 'fetch');

    mockImsClient = {
      getServiceAccessToken: sinon.stub().resolves({
        access_token: 'test-ims-token',
        token_type: 'bearer',
        expires_in: 86400,
      }),
    };

    const mockedHandler = await esmock(
      '../../../src/commerce-product-enrichments/handler.js',
      {
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sinon.stub().returns(mockImsClient),
          },
        },
      },
    );
    runAuditWithIms = mockedHandler.runAuditAndProcessResults;

    log = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
      debug: sinon.spy(),
    };

    site = {
      getId: sinon.stub().returns('site-1'),
      getBaseURL: sinon.stub().returns('https://example.com'),
      getConfig: sinon.stub().returns({
        getIncludedURLs: sinon.stub().resolves([]),
        getExcludedURLs: sinon.stub().returns([]),
        updateExcludedURLs: sinon.stub(),
        getHandlers: sinon.stub().returns({
          'commerce-product-enrichments': { instanceType: 'ACCS' },
        }),
      }),
      setConfig: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    sinon.stub(Config, 'toDynamoItem').returns({});
  });

  afterEach(() => {
    sinon.restore();
  });

  it('enrichment API call includes IMS Authorization header', async () => {
    // Mock config fetch (for getCommerceConfig)
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({
        public: {
          default: {
            'commerce-endpoint': 'https://commerce.example.com/graphql',
            headers: {
              cs: {
                'Magento-Environment-Id': 'env-123',
                'Magento-Store-Code': 'store-code',
                'Magento-Store-View-Code': 'view-code',
                'Magento-Website-Code': 'website-code',
                'x-api-key': 'api-key-123',
              },
            },
          },
        },
      }),
    });

    // Mock enrichment endpoint
    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ status: 'accepted' }),
    });

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: { Product: [{ name: 'Test', sku: 'SKU-1' }] },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-ims-1' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',

      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    await runAuditWithIms(context);

    // Find the enrichment fetch call
    const enrichmentCall = fetchStub.getCalls().find(
      (call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment',
    );
    expect(enrichmentCall).to.exist;

    const { headers } = enrichmentCall.args[1];
    expect(headers).to.have.property('Authorization', 'Bearer test-ims-token');
    expect(headers).to.have.property('Content-Type', 'application/json');
  });

  it('calls enrichment API with correct payload when product pages found', async () => {
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ status: 'accepted', jobId: 'job-123' }),
    });

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: {
                  Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }],
                },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-13' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',

      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    const result = await runAuditWithIms(context);

    const enrichmentCall = fetchStub.getCalls().find((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCall).to.exist;

    const payload = JSON.parse(enrichmentCall.args[1].body);
    expect(payload).to.deep.include({
      siteId: 'site-1',
      environmentId: 'env-123',
      websiteCode: 'website-code',
      storeCode: 'store-code',
      storeViewCode: 'view-code',
    });
    expect(payload.scrapes).to.have.lengthOf(1);
    expect(payload.scrapes[0]).to.deep.equal({
      sku: 'TEST-SKU-123',
      key: 'scrapes/site-1/product-1/scrape.json',
    });

    expect(result.auditResult.enrichmentResponse).to.deep.equal({
      status: 'accepted',
      jobId: 'job-123',
    });
  });

  it('attaches preFetch to scrape entry when SKU matches config', async () => {
    const preFetchRules = [
      { type: 'commerce-catalog-search', params: { filters: [{ attribute: 'categoryPath', eq: 'sactionals' }], pageSize: 10 } },
    ];

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
          preFetch: { 'TEST-SKU-123': preFetchRules },
        },
      }),
    });

    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ status: 'accepted' }),
    });

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: { Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }] },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-prefetch-1' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',
      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    await runAuditWithIms(context);

    const enrichmentCall = fetchStub.getCalls().find((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCall).to.exist;

    const payload = JSON.parse(enrichmentCall.args[1].body);
    expect(payload.scrapes).to.have.lengthOf(1);
    expect(payload.scrapes[0].sku).to.equal('TEST-SKU-123');
    expect(payload.scrapes[0].preFetch).to.deep.equal(preFetchRules);
  });

  it('does not attach preFetch when SKU does not match config', async () => {
    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
          preFetch: { 'DIFFERENT-SKU': [{ type: 'commerce-catalog-search', params: {} }] },
        },
      }),
    });

    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ status: 'accepted' }),
    });

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: { Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }] },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-prefetch-2' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',
      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    await runAuditWithIms(context);

    const enrichmentCall = fetchStub.getCalls().find((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCall).to.exist;

    const payload = JSON.parse(enrichmentCall.args[1].body);
    expect(payload.scrapes[0]).to.deep.equal({
      sku: 'TEST-SKU-123',
      key: 'scrapes/site-1/product-1/scrape.json',
    });
    expect(payload.scrapes[0]).to.not.have.property('preFetch');
  });

  it('attaches preFetch only to matching SKUs in mixed batch', async () => {
    const preFetchRules = [
      { type: 'commerce-catalog-search', params: { filters: [{ attribute: 'categoryPath', eq: 'sactionals' }], pageSize: 10 } },
    ];

    site.getConfig.returns({
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
          preFetch: { 'SKU-001': preFetchRules },
        },
      }),
    });

    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ status: 'accepted', jobId: 'job-789' }),
    });

    const s3Client = { send: sinon.stub() };

    s3Client.send.onCall(0).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {
            structuredData: {
              jsonld: { Product: [{ name: 'Product 1', sku: 'SKU-001' }] },
            },
          },
        })),
      },
    });

    s3Client.send.onCall(1).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {
            structuredData: {
              jsonld: { Product: [{ name: 'Product 2', sku: 'SKU-002' }] },
            },
          },
        })),
      },
    });

    const context = {
      site,
      audit: { getId: () => 'audit-prefetch-3' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',
      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
        ['https://example.com/product-2', 'scrapes/site-1/product-2/scrape.json'],
      ]),
    };

    await runAuditWithIms(context);

    const enrichmentCall = fetchStub.getCalls().find((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCall).to.exist;

    const payload = JSON.parse(enrichmentCall.args[1].body);
    expect(payload.scrapes).to.have.lengthOf(2);

    const scrape1 = payload.scrapes.find((s) => s.sku === 'SKU-001');
    const scrape2 = payload.scrapes.find((s) => s.sku === 'SKU-002');

    expect(scrape1.preFetch).to.deep.equal(preFetchRules);
    expect(scrape2).to.not.have.property('preFetch');
  });

  it('does not attach preFetch when preFetch config is empty object', async () => {
    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([]),
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': {
          instanceType: 'ACCS',
          preFetch: {},
        },
      }),
    });

    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ status: 'accepted' }),
    });

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: { Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }] },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-prefetch-4' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',
      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    await runAuditWithIms(context);

    const enrichmentCall = fetchStub.getCalls().find((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCall).to.exist;

    const payload = JSON.parse(enrichmentCall.args[1].body);
    expect(payload.scrapes[0]).to.deep.equal({
      sku: 'TEST-SKU-123',
      key: 'scrapes/site-1/product-1/scrape.json',
    });
    expect(payload.scrapes[0]).to.not.have.property('preFetch');
  });

  it('handles enrichment API failure gracefully', async () => {
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => null },
      text: () => Promise.resolve('Server error'),
    });

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: {
                  Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }],
                },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-15' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',

      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    const result = await runAuditWithIms(context);

    expect(result.auditResult.status).to.equal('OPPORTUNITIES_FOUND');
    expect(log.error).to.have.been.calledWith(sinon.match(/Enrichment API failed/));
    expect(result.auditResult.enrichmentResponse).to.have.property('error');
  });

  it('handles enrichment API network error gracefully', async () => {
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any)
      .rejects(new Error('Network connection refused'));

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: {
                  Product: [{ name: 'Test Product', sku: 'TEST-SKU-123' }],
                },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-19' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',

      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    const result = await runAuditWithIms(context);

    expect(result.auditResult.status).to.equal('OPPORTUNITIES_FOUND');
    expect(log.error).to.have.been.calledWith(sinon.match(/Enrichment API call failed/));
    expect(result.auditResult.enrichmentResponse).to.deep.equal({
      error: 'Network connection refused',
    });
  });

  it('includes multiple product pages in enrichment payload', async () => {
    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    fetchStub.withArgs('https://test-enrichment-endpoint/catalog-enrichment', sinon.match.any).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ status: 'accepted', jobId: 'job-456' }),
    });

    site.getConfig.returns({
      getExcludedURLs: sinon.stub().returns([]),
      updateExcludedURLs: sinon.stub(),
      getHandlers: sinon.stub().returns({
        'commerce-product-enrichments': { instanceType: 'ACCS' },
      }),
    });

    const s3Client = { send: sinon.stub() };

    s3Client.send.onCall(0).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {
            structuredData: {
              jsonld: { Product: [{ name: 'Product 1', sku: 'SKU-001' }] },
            },
          },
        })),
      },
    });

    s3Client.send.onCall(1).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {},
        })),
      },
    });

    s3Client.send.onCall(2).resolves({
      ContentType: 'application/json',
      Body: {
        transformToString: sinon.stub().resolves(JSON.stringify({
          scrapeResult: {
            structuredData: {
              jsonld: { Product: [{ name: 'Product 2', sku: 'SKU-002' }] },
            },
          },
        })),
      },
    });

    const context = {
      site,
      audit: { getId: () => 'audit-18' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',

      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
        ['https://example.com/about', 'scrapes/site-1/about/scrape.json'],
        ['https://example.com/product-2', 'scrapes/site-1/product-2/scrape.json'],
      ]),
    };

    const result = await runAuditWithIms(context);

    const enrichmentCall = fetchStub.getCalls().find((call) => call.args[0] === 'https://test-enrichment-endpoint/catalog-enrichment');
    expect(enrichmentCall).to.exist;

    const payload = JSON.parse(enrichmentCall.args[1].body);
    expect(payload.scrapes).to.have.lengthOf(2);
    expect(payload.scrapes[0]).to.deep.equal({
      sku: 'SKU-001',
      key: 'scrapes/site-1/product-1/scrape.json',
    });
    expect(payload.scrapes[1]).to.deep.equal({
      sku: 'SKU-002',
      key: 'scrapes/site-1/product-2/scrape.json',
    });

    expect(result.auditResult.productPages).to.equal(2);
  });

  it('logs and rethrows IMS token error', async () => {
    mockImsClient.getServiceAccessToken.rejects(
      new Error('IMS getServiceAccessToken request failed with status: 400'),
    );

    fetchStub.withArgs(sinon.match(/config\.json/)).resolves({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(validACCSConfig),
    });

    const s3Client = {
      send: sinon.stub().resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify({
            scrapeResult: {
              structuredData: {
                jsonld: { Product: [{ name: 'Test Product', sku: 'SKU-1' }] },
              },
            },
          })),
        },
      }),
    };

    const context = {
      site,
      audit: { getId: () => 'audit-ims-error' },
      finalUrl: 'https://example.com',
      log,
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        CATALOG_ENRICHMENT_ENDPOINT: 'https://test-enrichment-endpoint/catalog-enrichment',
        IMS_HOST: 'ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',
      },
      scrapeResultPaths: new Map([
        ['https://example.com/product-1', 'scrapes/site-1/product-1/scrape.json'],
      ]),
    };

    const result = await runAuditWithIms(context);

    expect(result.auditResult.status).to.equal('OPPORTUNITIES_FOUND');
    expect(log.error).to.have.been.calledWith(sinon.match(/IMS token request failed/));
    expect(result.auditResult.enrichmentResponse).to.have.property('error');
  });

});

describe('Commerce Product Enrichments Handler - Yearly (Sitemap)', () => {
  let log;
  let site;
  let getSitemapUrlsStub;
  let discoverSitemapUrlsAndSubmitForScraping;

  beforeEach(async () => {
    getSitemapUrlsStub = sinon.stub();

    const mockedHandler = await esmock(
      '../../../src/commerce-product-enrichments/handler.js',
      {
        '../../../src/sitemap/common.js': {
          getSitemapUrls: getSitemapUrlsStub,
        },
      },
    );
    discoverSitemapUrlsAndSubmitForScraping = mockedHandler.discoverSitemapUrlsAndSubmitForScraping;

    log = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
      debug: sinon.spy(),
    };

    site = {
      getId: sinon.stub().returns('site-1'),
      getBaseURL: sinon.stub().returns('https://example.com'),
      getConfig: sinon.stub().returns({
        getIncludedURLs: sinon.stub().resolves([]),
        getExcludedURLs: sinon.stub().returns([]),
      }),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('discovers sitemap URLs and builds scrape payload', async () => {
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {
        extractedPaths: {
          'https://example.com/sitemap.xml': [
            'https://example.com/product-1',
            'https://example.com/product-2',
            'https://example.com/product-3',
          ],
        },
      },
    });

    const result = await discoverSitemapUrlsAndSubmitForScraping({
      site, log, data: {},
    });

    expect(getSitemapUrlsStub).to.have.been.calledOnceWith(
      'https://example.com',
      log,
    );
    expect(result.urls).to.deep.equal([
      { url: 'https://example.com/product-1' },
      { url: 'https://example.com/product-2' },
      { url: 'https://example.com/product-3' },
    ]);
    expect(result.siteId).to.equal('site-1');
  });

  it('uses all sitemap URLs when no limit specified', async () => {
    const manyUrls = Array.from(
      { length: 50 },
      (_, i) => `https://example.com/page-${i + 1}`,
    );
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {
        extractedPaths: {
          'https://example.com/sitemap.xml': manyUrls,
        },
      },
    });

    const result = await discoverSitemapUrlsAndSubmitForScraping({
      site, log, data: {},
    });

    expect(result.urls).to.have.lengthOf(50);
    expect(result.urls[0]).to.deep.equal({
      url: 'https://example.com/page-1',
    });
    expect(result.urls[49]).to.deep.equal({
      url: 'https://example.com/page-50',
    });
  });

  it('respects custom limit from data', async () => {
    const manyUrls = Array.from(
      { length: 50 },
      (_, i) => `https://example.com/page-${i + 1}`,
    );
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {
        extractedPaths: {
          'https://example.com/sitemap.xml': manyUrls,
        },
      },
    });

    const result = await discoverSitemapUrlsAndSubmitForScraping({
      site, log, data: { limit: 10 },
    });

    expect(result.urls).to.have.lengthOf(10);
    expect(result.urls[0]).to.deep.equal({
      url: 'https://example.com/page-1',
    });
    expect(result.urls[9]).to.deep.equal({
      url: 'https://example.com/page-10',
    });
  });

  it('parses limit from JSON string data', async () => {
    const manyUrls = Array.from(
      { length: 50 },
      (_, i) => `https://example.com/page-${i + 1}`,
    );
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {
        extractedPaths: {
          'https://example.com/sitemap.xml': manyUrls,
        },
      },
    });

    const result = await discoverSitemapUrlsAndSubmitForScraping({
      site, log, data: '{"limit":5}',
    });

    expect(result.urls).to.have.lengthOf(5);
  });

  it('throws on sitemap discovery failure', async () => {
    getSitemapUrlsStub.resolves({
      success: false,
      reasons: [
        {
          value: 'https://example.com/robots.txt',
          error: 'NO_SITEMAP_IN_ROBOTS',
        },
      ],
    });

    await expect(
      discoverSitemapUrlsAndSubmitForScraping({ site, log, data: {} }),
    ).to.be.rejectedWith('Sitemap discovery failed');
  });

  it('throws when extractedPaths is missing', async () => {
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {},
    });

    await expect(
      discoverSitemapUrlsAndSubmitForScraping({ site, log, data: {} }),
    ).to.be.rejectedWith('Sitemap discovery failed');
  });

  it('respects excluded and included URLs', async () => {
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {
        extractedPaths: {
          'https://example.com/sitemap.xml': [
            'https://example.com/page-1',
            'https://example.com/page-2',
            'https://example.com/page-3',
          ],
        },
      },
    });

    site.getConfig.returns({
      getIncludedURLs: sinon.stub().resolves([
        'https://example.com/included-page',
      ]),
      getExcludedURLs: sinon.stub().returns([
        'https://example.com/page-2',
      ]),
    });

    const result = await discoverSitemapUrlsAndSubmitForScraping({
      site, log, data: {},
    });

    expect(result.urls).to.deep.equal([
      { url: 'https://example.com/page-1' },
      { url: 'https://example.com/page-3' },
      { url: 'https://example.com/included-page' },
    ]);
  });

  it('flattens URLs from multiple sitemaps', async () => {
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {
        extractedPaths: {
          'https://example.com/sitemap-1.xml': [
            'https://example.com/page-a',
            'https://example.com/page-b',
          ],
          'https://example.com/sitemap-2.xml': [
            'https://example.com/page-c',
          ],
        },
      },
    });

    const result = await discoverSitemapUrlsAndSubmitForScraping({
      site, log, data: {},
    });

    expect(result.urls).to.have.lengthOf(3);
    expect(result.urls.map((u) => u.url)).to.include.members([
      'https://example.com/page-a',
      'https://example.com/page-b',
      'https://example.com/page-c',
    ]);
  });

  it('handles invalid JSON in data gracefully', async () => {
    getSitemapUrlsStub.resolves({
      success: true,
      reasons: [{ value: 'Urls are extracted from sitemap.' }],
      details: {
        extractedPaths: {
          'https://example.com/sitemap.xml': [
            'https://example.com/page-1',
          ],
        },
      },
    });

    const result = await discoverSitemapUrlsAndSubmitForScraping({
      site, log, data: 'invalid-json{',
    });

    // No limit applied, all URLs returned
    expect(result.urls).to.have.lengthOf(1);
    expect(log.warn).to.have.been.calledWith(
      sinon.match(/Could not parse data as JSON/),
    );
  });
});
