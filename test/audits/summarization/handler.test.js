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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import {
  importTopPages,
  submitForScraping,
  sendToMystique,
} from '../../../src/summarization/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Summarization Handler', () => {
  let context;
  let sandbox;
  let site;
  let audit;
  let log;
  let sqs;
  let env;
  let dataAccess;
  const topPages = [
    { getUrl: () => 'https://adobe.com/page1' },
    { getUrl: () => 'https://adobe.com/page2' },
    { getUrl: () => 'https://adobe.com/page3' },
  ];

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    site = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-id-123',
      getDeliveryType: () => 'aem',
    };

    audit = {
      getId: () => 'audit-id-456',
      getAuditType: () => 'summarization',
      getFullAuditRef: () => 'https://adobe.com',
      getAuditResult: sandbox.stub(),
    };

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    sqs = {
      sendMessage: sandbox.stub().resolves({}),
    };

    env = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
    };

    dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
      },
      Site: {
        findById: sandbox.stub(),
      },
    };

    context = {
      log,
      sqs,
      env,
      site,
      audit,
      dataAccess,
      // Default: all 3 URLs have scrape results (100% availability)
      // scrapeResultPaths is a Map<URL, S3Path>
      scrapeResultPaths: new Map([
        ['https://adobe.com/page1', 'scrapes/site-id-123/page1/scrape.json'],
        ['https://adobe.com/page2', 'scrapes/site-id-123/page2/scrape.json'],
        ['https://adobe.com/page3', 'scrapes/site-id-123/page3/scrape.json'],
      ]),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('importTopPages', () => {
    it('should import top pages successfully', async () => {
      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'site-id-123',
        auditResult: {
          success: true,
          topPages: [
            'https://adobe.com/page1',
            'https://adobe.com/page2',
            'https://adobe.com/page3',
          ],
        },
        fullAuditRef: 'https://adobe.com',
      });
      expect(dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        'site-id-123',
        'ahrefs',
        'global',
      );
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Found 3 top pages for site site-id-123');
    });

    it('should handle when no top pages are found', async () => {
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'site-id-123',
        auditResult: {
          success: false,
          topPages: [],
        },
        fullAuditRef: 'https://adobe.com',
      });
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] No top pages found for site');
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(error);

      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'site-id-123',
        auditResult: {
          success: false,
          error: 'Database error',
          topPages: [],
        },
        fullAuditRef: 'https://adobe.com',
      });
      expect(log.error).to.have.been.calledWith(
        '[SUMMARIZATION] Failed to import top pages: Database error',
        error,
      );
    });
  });

  describe('submitForScraping', () => {
    it('should submit top pages for scraping successfully', async () => {
      audit.getAuditResult.returns({ success: true });

      const result = await submitForScraping(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://adobe.com/page1' },
          { url: 'https://adobe.com/page2' },
          { url: 'https://adobe.com/page3' },
        ],
        siteId: 'site-id-123',
        type: 'summarization',
      });
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Submitting 3 pages for scraping');
    });

    it('should limit to 200 pages when submitting for scraping', async () => {
      audit.getAuditResult.returns({ success: true });
      const manyPages = Array.from({ length: 250 }, (_, i) => ({
        getUrl: () => `https://adobe.com/page${i}`,
      }));
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);

      const result = await submitForScraping(context);

      expect(result.urls).to.have.lengthOf(200);
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Submitting 200 pages for scraping');
    });

    it('should throw error when audit failed', async () => {
      audit.getAuditResult.returns({ success: false });

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'Audit failed, skipping scraping',
      );
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] Audit failed, skipping scraping');
    });

    it('should throw error when no top pages to submit', async () => {
      audit.getAuditResult.returns({ success: true });
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'No top pages to submit for scraping',
      );
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] No top pages to submit for scraping');
    });
  });

  describe('sendToMystique', () => {
    beforeEach(() => {
      audit.getAuditResult.returns({ success: true });
    });

    it('should send message to Mystique successfully', async () => {
      const result = await sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.type).to.equal('guidance:summarization');
      expect(sentMessage.siteId).to.equal('site-id-123');
      expect(sentMessage.url).to.equal('https://adobe.com');
      expect(sentMessage.auditId).to.equal('audit-id-456');
      expect(sentMessage.deliveryType).to.equal('aem');
      expect(sentMessage.data.pages).to.have.lengthOf(3);
      
      // Check that all pages are from the scraped URLs
      const pageUrls = sentMessage.data.pages.map((p) => p.page_url);
      expect(pageUrls).to.include.members([
        'https://adobe.com/page1',
        'https://adobe.com/page2',
        'https://adobe.com/page3',
      ]);
      
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Sent 3 pages to Mystique for site site-id-123',
      );
    });

    it('should limit to 100 pages when sending to Mystique', async () => {
      const manyPages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://adobe.com/page${i}`,
      }));
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);
      
      // Provide scrape results for 120 pages (80% availability, exceeds 100 page limit)
      const scrapeMap = new Map();
      for (let i = 0; i < 120; i += 1) {
        scrapeMap.set(`https://adobe.com/page${i}`, `scrapes/site-id-123/page${i}/scrape.json`);
      }
      context.scrapeResultPaths = scrapeMap;

      const result = await sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages).to.have.lengthOf(100);
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Sent 100 pages to Mystique for site site-id-123',
      );
    });

    it('should throw error when audit failed', async () => {
      audit.getAuditResult.returns({ success: false });

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'Audit failed, skipping Mystique message',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] Audit failed, skipping Mystique message',
      );
      expect(sqs.sendMessage).not.to.have.been.called;
    });

    it('should throw error when SQS is not configured', async () => {
      context.sqs = null;

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'SQS or Mystique queue not configured',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] SQS or Mystique queue not configured, skipping message',
      );
    });

    it('should throw error when queue is not configured', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'SQS or Mystique queue not configured',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] SQS or Mystique queue not configured, skipping message',
      );
    });

    it('should throw error when no top pages found', async () => {
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(sendToMystique(context)).to.be.rejectedWith('No top pages found');
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] No top pages found, skipping Mystique message',
      );
      expect(sqs.sendMessage).not.to.have.been.called;
    });

    it('should format page URLs correctly', async () => {
      await sendToMystique(context);

      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      sentMessage.data.pages.forEach((page) => {
        expect(page).to.have.all.keys('page_url', 'keyword', 'questions');
        expect(page.keyword).to.equal('');
        expect(page.questions).to.deep.equal([]);
        expect(page.page_url).to.be.a('string');
      });
    });

    it('should verify scrape availability before sending to Mystique', async () => {
      await sendToMystique(context);

      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Scrape availability: 3/3 (100.0%)',
      );
      expect(sqs.sendMessage).to.have.been.calledOnce;
    });

    it('should throw error when scrape availability is below 50%', async () => {
      // Only 1 out of 3 URLs has scrape data (33%)
      context.scrapeResultPaths = new Map([
        ['https://adobe.com/page1', 'scrapes/site-id-123/page1/scrape.json'],
      ]);

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'Insufficient scrape data: only 1/3 URLs have scrape data available',
      );
      expect(sqs.sendMessage).not.to.have.been.called;
    });

    it('should succeed when scrape availability is exactly 50%', async () => {
      // Add one more page to have 4 total, with exactly 2 available (50%)
      const fourPages = [
        ...topPages,
        { getUrl: () => 'https://adobe.com/page4' },
      ];
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(fourPages);
      
      context.scrapeResultPaths = new Map([
        ['https://adobe.com/page1', 'scrapes/site-id-123/page1/scrape.json'],
        ['https://adobe.com/page2', 'scrapes/site-id-123/page2/scrape.json'],
      ]);

      const result = await sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Scrape availability: 2/4 (50.0%)',
      );
      expect(sqs.sendMessage).to.have.been.calledOnce;
    });

    it('should throw error when no scrape results available', async () => {
      context.scrapeResultPaths = new Map();

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'No scrape results available',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] No scrape results available',
      );
      expect(sqs.sendMessage).not.to.have.been.called;
    });

    it('should throw error when scrapeResultPaths is null', async () => {
      context.scrapeResultPaths = null;

      await expect(sendToMystique(context)).to.be.rejectedWith(
        'No scrape results available',
      );
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] No scrape results available',
      );
      expect(sqs.sendMessage).not.to.have.been.called;
    });

    it('should handle more scrape results than requested pages', async () => {
      // 5 scrape results for 3 pages
      context.scrapeResultPaths = new Map([
        ['https://adobe.com/page1', 'scrapes/site-id-123/page1/scrape.json'],
        ['https://adobe.com/page2', 'scrapes/site-id-123/page2/scrape.json'],
        ['https://adobe.com/page3', 'scrapes/site-id-123/page3/scrape.json'],
        ['https://adobe.com/page4', 'scrapes/site-id-123/page4/scrape.json'],
        ['https://adobe.com/page5', 'scrapes/site-id-123/page5/scrape.json'],
      ]);

      const result = await sendToMystique(context);

      // 5/3 = 166.7% - should pass easily
      expect(result).to.deep.equal({ status: 'complete' });
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Scrape availability: 5/3 (166.7%)',
      );
      expect(sqs.sendMessage).to.have.been.calledOnce;
    });
  });
});

describe('Summarization Handler - Athena/Ahrefs fallback', () => {
  let sandbox;
  let mockGetTopAgenticUrlsFromAthena;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should use Ahrefs URLs in importTopPages (importTopPages only uses Ahrefs)', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://adobe.com/athena-page1',
      'https://adobe.com/athena-page2',
    ]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const topPages = [
      { getUrl: () => 'https://adobe.com/ahrefs-page1' },
      { getUrl: () => 'https://adobe.com/ahrefs-page2' },
    ];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
    };

    const result = await handler.importTopPages(context);

    // importTopPages only uses Ahrefs, not Athena
    expect(result.auditResult.success).to.be.true;
    expect(result.auditResult.topPages).to.deep.equal([
      'https://adobe.com/ahrefs-page1',
      'https://adobe.com/ahrefs-page2',
    ]);
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
      'site-123',
      'ahrefs',
      'global',
    );
    // Athena is not used in importTopPages
    expect(mockGetTopAgenticUrlsFromAthena).to.not.have.been.called;
  });

  it('should return failure in importTopPages when no Ahrefs pages found (importTopPages only uses Ahrefs)', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await handler.importTopPages(context);

    // importTopPages only uses Ahrefs, not Athena, so when Ahrefs returns empty, it fails
    expect(result.auditResult.success).to.be.false;
    expect(result.auditResult.topPages).to.deep.equal([]);
    expect(context.log.warn).to.have.been.calledWith(
      '[SUMMARIZATION] No top pages found for site',
    );
    // Athena is not used in importTopPages
    expect(mockGetTopAgenticUrlsFromAthena).to.not.have.been.called;
  });

  it('should use Athena URLs in submitForScraping when available', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://adobe.com/athena-page1',
    ]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await handler.submitForScraping(context);

    expect(result.urls).to.deep.equal([{ url: 'https://adobe.com/athena-page1' }]);
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
  });

  it('should fall back to Ahrefs in submitForScraping when Athena returns empty', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const topPages = [{ getUrl: () => 'https://adobe.com/ahrefs-page1' }];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
    };

    const result = await handler.submitForScraping(context);

    expect(result.urls).to.deep.equal([{ url: 'https://adobe.com/ahrefs-page1' }]);
    expect(context.log.info).to.have.been.calledWith(
      '[SUMMARIZATION] No agentic URLs from Athena, falling back to Ahrefs',
    );
  });

  it('should use Athena URLs in sendToMystique when available', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://adobe.com/athena-page1',
      'https://adobe.com/athena-page2',
      'https://adobe.com/athena-page3',
    ]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
        getDeliveryType: () => 'aem',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditResult: () => ({ success: true }),
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
      scrapeResultPaths: new Map([
        ['https://adobe.com/athena-page1', 'path1'],
        ['https://adobe.com/athena-page2', 'path2'],
        ['https://adobe.com/athena-page3', 'path3'],
      ]),
    };

    const result = await handler.sendToMystique(context);

    expect(result).to.deep.equal({ status: 'complete' });
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
  });

  it('should fall back to Ahrefs in sendToMystique when Athena returns empty', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const topPages = [
      { getUrl: () => 'https://adobe.com/ahrefs-page1' },
      { getUrl: () => 'https://adobe.com/ahrefs-page2' },
    ];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
        getDeliveryType: () => 'aem',
      },
      audit: {
        getId: () => 'audit-123',
        getAuditResult: () => ({ success: true }),
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
      scrapeResultPaths: new Map([
        ['https://adobe.com/ahrefs-page1', 'path1'],
        ['https://adobe.com/ahrefs-page2', 'path2'],
      ]),
    };

    const result = await handler.sendToMystique(context);

    expect(result).to.deep.equal({ status: 'complete' });
    expect(context.log.info).to.have.been.calledWith(
      '[SUMMARIZATION] No agentic URLs from Athena, falling back to Ahrefs',
    );
  });
});
