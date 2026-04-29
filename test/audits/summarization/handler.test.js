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
      getConfig: () => ({ getIncludedURLs: () => [] }),
    };

    audit = {
      getId: () => 'audit-id-456',
      getAuditType: () => 'summarization',
      getFullAuditRef: () => 'https://adobe.com',
      getAuditResult: sandbox.stub(),
      setAuditResult: sandbox.stub(),
      save: sandbox.stub().resolves(),
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
      Opportunity: {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
      },
    };

    context = {
      log,
      sqs,
      env,
      site,
      audit,
      auditContext: {
        summarizationUrls: [
          'https://adobe.com/page1',
          'https://adobe.com/page2',
          'https://adobe.com/page3',
        ],
      },
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
        'seo',
        'global',
      );
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Found 3 top pages for site site-id-123 (using max 200)');
    });

    it('should handle when no top pages are found', async () => {
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'site-id-123',
        auditResult: {
          success: true,
          topPages: [],
        },
        fullAuditRef: 'https://adobe.com',
      });
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] No top pages found for site; continuing with fallback URL sources',
      );
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
        auditContext: {
          summarizationUrls: [
            'https://adobe.com/page1',
            'https://adobe.com/page2',
            'https://adobe.com/page3',
          ],
        },
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
      expect(result.auditContext.summarizationUrls).to.have.lengthOf(200);
      expect(log.info).to.have.been.calledWith('[SUMMARIZATION] Submitting 200 pages for scraping');
    });

    it('should throw error when audit failed', async () => {
      audit.getAuditResult.returns({ success: false });

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'Audit failed, skipping scraping',
      );
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] Audit failed, skipping scraping');
    });

    it('should throw error when no URLs to submit', async () => {
      audit.getAuditResult.returns({ success: true });
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'No URLs to submit for scraping',
      );
      expect(log.warn).to.have.been.calledWith('[SUMMARIZATION] No URLs to submit for scraping');
    });

    it('should include site-config URLs when submitting for scraping', async () => {
      audit.getAuditResult.returns({ success: true });
      site.getConfig = () => ({
        getIncludedURLs: () => ['https://adobe.com/included-page'],
      });

      const result = await submitForScraping(context);

      expect(result.urls).to.deep.equal([
        { url: 'https://adobe.com/included-page' },
        { url: 'https://adobe.com/page1' },
        { url: 'https://adobe.com/page2' },
        { url: 'https://adobe.com/page3' },
      ]);
      expect(result.auditContext.summarizationUrls).to.deep.equal([
        'https://adobe.com/included-page',
        'https://adobe.com/page1',
        'https://adobe.com/page2',
        'https://adobe.com/page3',
      ]);
    });

    it('should handle null SEO top pages when included URLs are present', async () => {
      audit.getAuditResult.returns({ success: true });
      site.getConfig = () => ({
        getIncludedURLs: () => ['https://adobe.com/included-page'],
      });
      dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(null);

      const result = await submitForScraping(context);

      expect(result.urls).to.deep.equal([
        { url: 'https://adobe.com/included-page' },
      ]);
      expect(result.auditContext.summarizationUrls).to.deep.equal([
        'https://adobe.com/included-page',
      ]);
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
      context.auditContext = {
        summarizationUrls: manyPages.map((page) => page.getUrl()),
      };
      
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

    it('should throw error when no submitted URLs are available', async () => {
      context.auditContext = {};

      await expect(sendToMystique(context)).to.be.rejectedWith('No submitted URLs found');
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] No submitted URLs found in audit context, skipping Mystique message',
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
      context.auditContext = {
        summarizationUrls: [
          'https://adobe.com/page1',
          'https://adobe.com/page2',
          'https://adobe.com/page3',
          'https://adobe.com/page4',
        ],
      };
      
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

      expect(result).to.deep.equal({ status: 'complete' });
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Scrape availability: 3/3 (100.0%)',
      );
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages.map((page) => page.page_url)).to.deep.equal([
        'https://adobe.com/page1',
        'https://adobe.com/page2',
        'https://adobe.com/page3',
      ]);
    });

    it('should exclude pages that already have both summary and key points (LLMO-3493)', async () => {
      const mockDetectExistingContent = sandbox.stub().resolves(
        new Map([
          ['https://adobe.com/page1', { hasSummary: true, hasKeyPoints: true }],
          ['https://adobe.com/page2', { hasSummary: false, hasKeyPoints: false }],
          ['https://adobe.com/page3', { hasSummary: true, hasKeyPoints: false }],
        ]),
      );
      context.s3Client = {};
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';

      const handler = await esmock('../../../src/summarization/handler.js', {
        '../../../src/summarization/existing-content-detector.js': { detectExistingContent: mockDetectExistingContent },
      });

      const result = await handler.sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(mockDetectExistingContent).to.have.been.calledOnce;
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages).to.have.lengthOf(2);
      const pageUrls = sentMessage.data.pages.map((p) => p.page_url);
      expect(pageUrls).to.include('https://adobe.com/page2');
      expect(pageUrls).to.include('https://adobe.com/page3');
      expect(pageUrls).not.to.include('https://adobe.com/page1');
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Sent 2 pages to Mystique for site site-id-123',
      );
    });

    it('should skip pre-check when s3Client or bucket not configured', async () => {
      context.s3Client = null;
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';

      const result = await sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages).to.have.lengthOf(3);
    });

    it('should include site-config URLs when sending to Mystique', async () => {
      site.getConfig = () => ({
        getIncludedURLs: () => ['https://adobe.com/included-page'],
      });
      context.scrapeResultPaths = new Map([
        ['https://adobe.com/page1', 'scrapes/site-id-123/page1/scrape.json'],
        ['https://adobe.com/page2', 'scrapes/site-id-123/page2/scrape.json'],
        ['https://adobe.com/page3', 'scrapes/site-id-123/page3/scrape.json'],
        ['https://adobe.com/included-page', 'scrapes/site-id-123/included-page/scrape.json'],
      ]);
      context.auditContext = {
        summarizationUrls: [
          'https://adobe.com/page1',
          'https://adobe.com/page2',
          'https://adobe.com/page3',
          'https://adobe.com/included-page',
        ],
      };

      const result = await sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages.map((page) => page.page_url)).to.include('https://adobe.com/included-page');
    });

    it('should skip pages with unchanged content hash (LLMO-4454)', async () => {
      const hash1 = 'changed-hash';
      const hash2 = 'same-hash';
      const hash3 = 'new-page-hash';

      const mockDetectExistingContent = sandbox.stub().resolves(new Map([
        ['https://adobe.com/page1', { hasSummary: false, hasKeyPoints: false, contentHash: hash1 }],
        ['https://adobe.com/page2', { hasSummary: false, hasKeyPoints: false, contentHash: hash2 }],
        ['https://adobe.com/page3', { hasSummary: false, hasKeyPoints: false, contentHash: hash3 }],
      ]));

      const mockSuggestion = {
        getData: sandbox.stub().returns({ url: 'https://adobe.com/page2', contentHash: hash2 }),
      };
      const mockOpportunity = {
        getType: () => 'summarization',
        getSuggestions: sandbox.stub().resolves([mockSuggestion]),
      };

      context.s3Client = {};
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const handler = await esmock('../../../src/summarization/handler.js', {
        '../../../src/summarization/existing-content-detector.js': { detectExistingContent: mockDetectExistingContent },
      });

      const result = await handler.sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages).to.have.lengthOf(2);
      const pageUrls = sentMessage.data.pages.map((p) => p.page_url);
      expect(pageUrls).to.include('https://adobe.com/page1');
      expect(pageUrls).to.include('https://adobe.com/page3');
      expect(pageUrls).not.to.include('https://adobe.com/page2');
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] Skipped 1 page(s) with unchanged content',
      );
    });

    it('should return early when all pages have unchanged content (LLMO-4454)', async () => {
      const hash = 'same-hash-for-all';

      const mockDetectExistingContent = sandbox.stub().resolves(new Map([
        ['https://adobe.com/page1', { hasSummary: false, hasKeyPoints: false, contentHash: hash }],
        ['https://adobe.com/page2', { hasSummary: false, hasKeyPoints: false, contentHash: hash }],
        ['https://adobe.com/page3', { hasSummary: false, hasKeyPoints: false, contentHash: hash }],
      ]));

      const mockSuggestions = [
        { getData: sandbox.stub().returns({ url: 'https://adobe.com/page1', contentHash: hash }) },
        { getData: sandbox.stub().returns({ url: 'https://adobe.com/page2', contentHash: hash }) },
        { getData: sandbox.stub().returns({ url: 'https://adobe.com/page3', contentHash: hash }) },
      ];
      const mockOpportunity = {
        getType: () => 'summarization',
        getSuggestions: sandbox.stub().resolves(mockSuggestions),
      };

      context.s3Client = {};
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const handler = await esmock('../../../src/summarization/handler.js', {
        '../../../src/summarization/existing-content-detector.js': { detectExistingContent: mockDetectExistingContent },
      });

      const result = await handler.sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(sqs.sendMessage).not.to.have.been.called;
      expect(audit.save).not.to.have.been.called;
      expect(log.info).to.have.been.calledWith(
        '[SUMMARIZATION] No pages to send to Mystique after filtering',
      );
    });

    it('should store scrapedUrlsSent and urlToContentHash in audit result (LLMO-4454)', async () => {
      const hash1 = 'hash-page1';
      const hash2 = 'hash-page2';
      const hash3 = 'hash-page3';

      const mockDetectExistingContent = sandbox.stub().resolves(new Map([
        ['https://adobe.com/page1', { hasSummary: false, hasKeyPoints: false, contentHash: hash1 }],
        ['https://adobe.com/page2', { hasSummary: false, hasKeyPoints: false, contentHash: hash2 }],
        ['https://adobe.com/page3', { hasSummary: false, hasKeyPoints: false, contentHash: hash3 }],
      ]));

      context.s3Client = {};
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';

      const handler = await esmock('../../../src/summarization/handler.js', {
        '../../../src/summarization/existing-content-detector.js': { detectExistingContent: mockDetectExistingContent },
      });

      await handler.sendToMystique(context);

      expect(audit.setAuditResult).to.have.been.calledOnce;
      const auditResultArg = audit.setAuditResult.getCall(0).args[0];
      expect(auditResultArg.scrapedUrlsSent).to.deep.equal([
        'https://adobe.com/page1',
        'https://adobe.com/page2',
        'https://adobe.com/page3',
      ]);
      expect(auditResultArg.urlToContentHash).to.deep.equal({
        'https://adobe.com/page1': hash1,
        'https://adobe.com/page2': hash2,
        'https://adobe.com/page3': hash3,
      });
      expect(audit.save).to.have.been.calledOnce;
    });

    it('should store empty urlToContentHash in audit result when s3Client is not configured (LLMO-4454)', async () => {
      context.s3Client = null;
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';

      await sendToMystique(context);

      expect(audit.setAuditResult).to.have.been.calledOnce;
      const auditResultArg = audit.setAuditResult.getCall(0).args[0];
      expect(auditResultArg.urlToContentHash).to.deep.equal({});
      expect(auditResultArg.scrapedUrlsSent).to.deep.equal([
        'https://adobe.com/page1',
        'https://adobe.com/page2',
        'https://adobe.com/page3',
      ]);
      expect(audit.save).to.have.been.calledOnce;
    });

    it('should send all pages when no matching summarization opportunity exists (LLMO-4454)', async () => {
      const nonMatchingOpportunity = {
        getType: () => 'some-other-type',
        getSuggestions: sandbox.stub().resolves([]),
      };

      const mockDetectExistingContent = sandbox.stub().resolves(new Map([
        ['https://adobe.com/page1', { hasSummary: false, hasKeyPoints: false, contentHash: 'h1' }],
        ['https://adobe.com/page2', { hasSummary: false, hasKeyPoints: false, contentHash: 'h2' }],
        ['https://adobe.com/page3', { hasSummary: false, hasKeyPoints: false, contentHash: 'h3' }],
      ]));

      context.s3Client = {};
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([nonMatchingOpportunity]);

      const handler = await esmock('../../../src/summarization/handler.js', {
        '../../../src/summarization/existing-content-detector.js': { detectExistingContent: mockDetectExistingContent },
      });

      const result = await handler.sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.pages).to.have.lengthOf(3);
    });

    it('should send pages when current content hash is null (LLMO-4454)', async () => {
      const storedHash = 'stored-hash';
      const mockDetectExistingContent = sandbox.stub().resolves(new Map([
        ['https://adobe.com/page1', { hasSummary: false, hasKeyPoints: false, contentHash: null }],
        ['https://adobe.com/page2', { hasSummary: false, hasKeyPoints: false, contentHash: 'different-hash' }],
        ['https://adobe.com/page3', { hasSummary: false, hasKeyPoints: false, contentHash: storedHash }],
      ]));

      const mockSuggestions = [
        { getData: sandbox.stub().returns({ url: 'https://adobe.com/page1', contentHash: storedHash }) },
        { getData: sandbox.stub().returns({ url: 'https://adobe.com/page3', contentHash: storedHash }) },
      ];
      const mockOpportunity = {
        getType: () => 'summarization',
        getSuggestions: sandbox.stub().resolves(mockSuggestions),
      };

      context.s3Client = {};
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const handler = await esmock('../../../src/summarization/handler.js', {
        '../../../src/summarization/existing-content-detector.js': { detectExistingContent: mockDetectExistingContent },
      });

      const result = await handler.sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = sqs.sendMessage.getCall(0).args[1];
      // page1: null hash → sent (can't match), page2: different hash → sent, page3: matching hash → skipped
      expect(sentMessage.data.pages).to.have.lengthOf(2);
      const pageUrls = sentMessage.data.pages.map((p) => p.page_url);
      expect(pageUrls).to.include('https://adobe.com/page1');
      expect(pageUrls).to.include('https://adobe.com/page2');
      expect(pageUrls).not.to.include('https://adobe.com/page3');
    });

    it('should gracefully handle when fetching opportunity hashes fails (LLMO-4454)', async () => {
      const mockDetectExistingContent = sandbox.stub().resolves(new Map([
        ['https://adobe.com/page1', { hasSummary: false, hasKeyPoints: false, contentHash: 'h1' }],
        ['https://adobe.com/page2', { hasSummary: false, hasKeyPoints: false, contentHash: 'h2' }],
        ['https://adobe.com/page3', { hasSummary: false, hasKeyPoints: false, contentHash: 'h3' }],
      ]));

      context.s3Client = {};
      context.env.S3_SCRAPER_BUCKET_NAME = 'test-bucket';
      context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('DB error'));

      const handler = await esmock('../../../src/summarization/handler.js', {
        '../../../src/summarization/existing-content-detector.js': { detectExistingContent: mockDetectExistingContent },
      });

      const result = await handler.sendToMystique(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(sqs.sendMessage).to.have.been.calledOnce;
      expect(log.warn).to.have.been.calledWith(
        '[SUMMARIZATION] Failed to fetch existing suggestion hashes: DB error',
      );
    });
  });
});

describe('Summarization Handler - Athena/SEO fallback', () => {
  let sandbox;
  let mockGetTopAgenticUrlsFromAthena;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should use SEO URLs in importTopPages (importTopPages only uses SEO)', async () => {
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
      { getUrl: () => 'https://adobe.com/seo-page1' },
      { getUrl: () => 'https://adobe.com/seo-page2' },
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

    // importTopPages only uses SEO, not Athena
    expect(result.auditResult.success).to.be.true;
    expect(result.auditResult.topPages).to.deep.equal([
      'https://adobe.com/seo-page1',
      'https://adobe.com/seo-page2',
    ]);
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
      'site-123',
      'seo',
      'global',
    );
    // Athena is not used in importTopPages
    expect(mockGetTopAgenticUrlsFromAthena).to.not.have.been.called;
  });

  it('should keep importTopPages successful when no SEO pages are found', async () => {
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

    expect(result.auditResult.success).to.be.true;
    expect(result.auditResult.topPages).to.deep.equal([]);
    expect(context.log.info).to.have.been.calledWith(
      '[SUMMARIZATION] No top pages found for site; continuing with fallback URL sources',
    );
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
        getConfig: () => ({ getIncludedURLs: () => [] }),
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
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledOnce;
    expect(result.auditContext.summarizationUrls).to.deep.equal(['https://adobe.com/athena-page1']);
  });

  it('should use SEO URLs in submitForScraping when Athena returns empty', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const topPages = [{ getUrl: () => 'https://adobe.com/seo-page1' }];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
    };

    const result = await handler.submitForScraping(context);

    expect(result.urls).to.deep.equal([{ url: 'https://adobe.com/seo-page1' }]);
    expect(result.auditContext.summarizationUrls).to.deep.equal(['https://adobe.com/seo-page1']);
  });

  it('should exclude dynamic page URLs in submitForScraping', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://adobe.com/search',
      'https://adobe.com/about',
      'https://adobe.com/cart',
      'https://adobe.com/contact',
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
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) } },
    };

    const result = await handler.submitForScraping(context);

    expect(result.urls).to.deep.equal([
      { url: 'https://adobe.com/about' },
      { url: 'https://adobe.com/contact' },
    ]);
    expect(result.auditContext.summarizationUrls).to.deep.equal([
      'https://adobe.com/about',
      'https://adobe.com/contact',
    ]);
    expect(context.log.info).to.have.been.calledWith(
      '[SUMMARIZATION] Excluded 2 dynamic page(s) from summarization',
    );
  });

  it('should throw when all URLs are dynamic in submitForScraping', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://adobe.com/search',
      'https://adobe.com/cart',
      'https://adobe.com/login',
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
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) } },
    };

    await expect(handler.submitForScraping(context)).to.be.rejectedWith(
      'No URLs to submit for scraping (all excluded as dynamic)',
    );
    expect(context.log.warn).to.have.been.calledWith(
      '[SUMMARIZATION] No static pages left after filtering dynamic content',
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
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: {
        getId: () => 'audit-123',
        getAuditResult: () => ({ success: true }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        summarizationUrls: [
          'https://adobe.com/athena-page1',
          'https://adobe.com/athena-page2',
          'https://adobe.com/athena-page3',
        ],
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

  it('should use SEO URLs in sendToMystique when Athena returns empty', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const topPages = [
      { getUrl: () => 'https://adobe.com/seo-page1' },
      { getUrl: () => 'https://adobe.com/seo-page2' },
    ];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
        getDeliveryType: () => 'aem',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: {
        getId: () => 'audit-123',
        getAuditResult: () => ({ success: true }),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
      auditContext: {
        summarizationUrls: [
          'https://adobe.com/seo-page1',
          'https://adobe.com/seo-page2',
        ],
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
      scrapeResultPaths: new Map([
        ['https://adobe.com/seo-page1', 'path1'],
        ['https://adobe.com/seo-page2', 'path2'],
      ]),
    };

    const result = await handler.sendToMystique(context);

    expect(result).to.deep.equal({ status: 'complete' });
  });

  it('should throw when sendToMystique is missing submitted URLs in audit context', async () => {
    const handler = await esmock('../../../src/summarization/handler.js', {});
    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
        getDeliveryType: () => 'aem',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      },
      audit: {
        getId: () => 'audit-123',
        getAuditResult: () => ({ success: true }),
      },
      auditContext: {},
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
      scrapeResultPaths: new Map([
        ['https://adobe.com/search', 'path1'],
      ]),
    };

    await expect(handler.sendToMystique(context)).to.be.rejectedWith('No submitted URLs found');
    expect(context.log.warn).to.have.been.calledWith(
      '[SUMMARIZATION] No submitted URLs found in audit context, skipping Mystique message',
    );
  });

  it('should prioritize included URLs, then Athena, then SEO sorted by traffic in submitForScraping', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://adobe.com/agentic-page1',
    ]);

    const handler = await esmock('../../../src/summarization/handler.js', {
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const topPages = [
      { getUrl: () => 'https://adobe.com/seo-page1', getTraffic: () => 100 },
      { getUrl: () => 'https://adobe.com/seo-page2', getTraffic: () => 500 },
    ];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://adobe.com',
        getId: () => 'site-123',
        getConfig: () => ({ getIncludedURLs: () => ['https://adobe.com/included-page1'] }),
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
    };

    const result = await handler.submitForScraping(context);

    expect(result.urls).to.deep.equal([
      { url: 'https://adobe.com/included-page1' },
      { url: 'https://adobe.com/agentic-page1' },
      { url: 'https://adobe.com/seo-page2' },
      { url: 'https://adobe.com/seo-page1' },
    ]);
  });

  it('should keep included URLs first, then Athena, then SEO when cutting off at 200', async () => {
    const includedUrls = Array.from({ length: 3 }, (_, i) => `https://adobe.com/included-${i}`);
    const athenaUrls = Array.from({ length: 3 }, (_, i) => `https://adobe.com/athena-${i}`);
    const seoPages = Array.from({ length: 250 }, (_, i) => ({
      getUrl: () => `https://adobe.com/seo-${i}`,
      getTraffic: () => 1000 - i,
    }));
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves(athenaUrls);

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
        getConfig: () => ({ getIncludedURLs: () => includedUrls }),
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(seoPages),
        },
      },
    };

    const result = await handler.submitForScraping(context);

    expect(result.urls).to.have.lengthOf(200);
    expect(result.auditContext.summarizationUrls.slice(0, 6)).to.deep.equal([
      'https://adobe.com/included-0',
      'https://adobe.com/included-1',
      'https://adobe.com/included-2',
      'https://adobe.com/athena-0',
      'https://adobe.com/athena-1',
      'https://adobe.com/athena-2',
    ]);
    expect(result.auditContext.summarizationUrls[199]).to.equal('https://adobe.com/seo-193');
  });
});
