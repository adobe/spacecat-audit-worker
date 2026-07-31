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
import esmock from 'esmock';
import { submitForScraping } from '../../../src/prerender/submit-for-scraping.js';
import {
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  DAILY_BATCH_SIZE,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
} from '../../../src/prerender/utils/constants.js';

use(sinonChai);

describe('Prerender Audit - submitForScraping (Step 2)', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Step Functions', () => {
    describe('submitForScraping', () => {
      it('should return URLs for scraping', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1' },
            { getUrl: () => 'https://example.com/page2' },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/test-queue',
          },
          auditContext: {
            next: 'process-content-and-generate-opportunities',
            auditId: 'test-audit-id',
            auditType: 'prerender',
          },
        };

        const result = await submitForScraping(context);

        expect(result).to.be.an('object');
        expect(result.urls).to.be.an('array');
        expect(result.siteId).to.equal('test-site-id');
        expect(result.processingType).to.equal('prerender');
        expect(result.maxScrapeAge).to.equal(0);
      });

      it('should use explicit auditContext URLs when provided', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/top-page' },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          auditContext: {
            urls: [
              'https://example.com/page-1',
              'https://example.com/page-1/',
              'https://example.com/file.pdf',
              'https://example.com/page-2',
            ],
          },
        };

        const result = await submitForScraping(context);

        expect(mockSiteTopPage.allBySiteIdAndSourceAndGeo.called).to.be.false;
        expect(result.urls).to.deep.equal([
          { url: 'https://example.com/page-1' },
          { url: 'https://example.com/page-2' },
        ]);
        expect(result.siteId).to.equal('test-site-id');
        expect(result.processingType).to.equal('prerender');
        expect(context.log.info).to.have.been.calledWithMatch('csvUrls=4');
      });

      it('rebases csvUrls (auditContext.urls) to getPreferredBaseUrl domain', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
            getPreferredBaseUrl: () => 'https://example.com',
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
          },
          auditContext: {
            urls: ['https://www.example.com/csv-page-1', 'https://www.example.com/csv-page-2'],
          },
          finalUrl: 'https://example.com',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://example.com/csv-page-1');
        expect(submittedUrls).to.include('https://example.com/csv-page-2');
        submittedUrls.forEach((u) => expect(u).to.not.include('www.'));
      });

      it('uses overrideBaseURL from site config as domain for csvUrls rebasing', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://main--example--adobecom.hlx.page',
            getConfig: () => ({
              getFetchConfig: () => ({ overrideBaseURL: 'https://www.override.com' }),
            }),
          },
          auditContext: {
            urls: ['https://main--example--adobecom.hlx.page/page-1'],
          },
          finalUrl: 'https://main--example--adobecom.hlx.page',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://www.override.com/page-1');
      });

      it('should include includedURLs from site config', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-athena-client': {
            AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
          },
          '../../../src/prerender/utils/shared.js': {
            generateReportingPeriods: () => ({ weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }] }),
            getS3Config: async () => ({ databaseName: 'db', tableName: 'tbl', getAthenaTempLocation: () => 's3://tmp/' }),
            weeklyBreakdownQueries: { createAgenticReportQuery: async () => 'SELECT 1' },
            loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          },
        });
        const mockSiteTopPage = { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) };
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: (auditType) => (auditType === 'prerender' ? ['https://example.com/special'] : []) }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };
        const result = await mockHandler.submitForScraping(context);
        expect(result.urls).to.have.length(1);
        expect(result.urls.map((u) => u.url)).to.include('https://example.com/special');
      });

      it('should fall back to top pages when baseUrl is empty', async () => {
        const topPagesStub = sandbox.stub().resolves([
          { getUrl: () => 'https://example.com/fallback-organic' },
        ]);
        const athenaStub = sandbox.stub().resolves([]);

        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: athenaStub,
          },
        });

        const result = await mockHandler.submitForScraping({
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => '',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: topPagesStub },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        });

        expect(topPagesStub).to.have.been.calledOnce;
        expect(result.urls[0].url).to.equal('https://example.com/fallback-organic');
      });

      it('should warn when top agentic fetch throws and return empty URLs', async () => {
        const warn = sandbox.stub();
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => {
              throw new Error('athena unavailable');
            },
          },
        });

        const result = await mockHandler.submitForScraping({
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), warn, debug: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        });

        expect(result.urls).to.deep.equal([]);
        expect(warn).to.have.been.calledWith(sinon.match(/Failed to fetch agentic URLs: athena unavailable/));
      });

      it('should include non-recent includedURLs even when some organic URLs were recently processed', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
          },
        });

        const recentUrl = 'https://example.com/organic-page';
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => ['https://example.com/special'] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => recentUrl },
              ]),
            },
            // siteStatus returns the organic URL as recently processed → hasRecentOrganic=true
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: async () => ({ Body: { transformToString: async () => JSON.stringify({ pages: [{ url: recentUrl, scrapedAt: new Date().toISOString(), needsPrerender: true, scrapingStatus: 'success' }] }) } }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.submitForScraping(context);
        const urls = result.urls.map((u) => u.url);
        expect(urls).to.include('https://example.com/special');
      });

      it('should submit all fetched organic URLs when they are below the daily batch size', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
          },
        });
        const over = TOP_ORGANIC_URLS_LIMIT + 10;
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(
            Array.from({ length: over }).map((_, i) => ({ getUrl: () => `https://example.com/p${i}` })),
          ),
        };
        const context = {
          site: {
            getId: () => 'site',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };
        const out = await mockHandler.submitForScraping(context);
        expect(out.urls).to.have.length(TOP_ORGANIC_URLS_LIMIT);
        expect(out.urls.map((entry) => entry.url)).to.deep.equal(
          Array.from({ length: TOP_ORGANIC_URLS_LIMIT }).map((_, i) => `https://example.com/p${i}`),
        );
      });

      it('should request agentic URLs using TOP_AGENTIC_URLS_LIMIT', async () => {
        const getTopAgenticLiveUrlsFromAthena = sandbox.stub().resolves(
          Array.from({ length: TOP_AGENTIC_URLS_LIMIT + 10 }, (_, i) => `https://example.com/p${i}`),
        );
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena,
          },
        });
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };
        await mockHandler.submitForScraping(context);
        expect(getTopAgenticLiveUrlsFromAthena).to.have.been.calledOnce;
        expect(getTopAgenticLiveUrlsFromAthena.firstCall.args[2]).to.equal(TOP_AGENTIC_URLS_LIMIT);
        expect(TOP_AGENTIC_URLS_LIMIT).to.equal(2000);
      });

      it('should handle undefined topPages list from SiteTopPage gracefully', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-athena-client': {
            // No agentic URLs for this test
            AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
          },
          '../../../src/prerender/utils/shared.js': {
            generateReportingPeriods: () => ({
              weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            }),
            getS3Config: async () => ({
              databaseName: 'db',
              tableName: 'tbl',
              getAthenaTempLocation: () => 's3://tmp/',
            }),
            weeklyBreakdownQueries: {
              createAgenticReportQuery: async () => 'SELECT 1',
              createTopUrlsQueryWithLimit: async () => 'SELECT 2',
            },
            loadLatestAgenticSheet: async () => ({
              weekId: 'w45-2025',
              baseUrl: 'https://example.com',
              rows: [],
            }),
          },
        });

        const mockSiteTopPage = {
          // Return undefined to exercise `(topPages || [])` fallback in getTopOrganicUrlsFromSeo
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(undefined),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result).to.be.an('object');
        expect(result.urls).to.be.an('array');
      });
      it('rebases organic and included URLs to getPreferredBaseUrl domain', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
            getPreferredBaseUrl: () => 'https://example.com',
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({
              getIncludedURLs: () => ['https://www.example.com/included-page'],
            }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: async () => [
                { getUrl: () => 'https://www.example.com/organic-1' },
                { getUrl: () => 'https://www.example.com/organic-2' },
              ],
            },
          },
          finalUrl: 'https://example.com',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://example.com/organic-1');
        expect(submittedUrls).to.include('https://example.com/organic-2');
        expect(submittedUrls).to.include('https://example.com/included-page');
        submittedUrls.forEach((u) => expect(u).to.not.include('www.'));
      });

      it('uses overrideBaseURL from site config as domain for organic and included URL rebasing', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': {
            detectBotBlocker: sandbox.stub().resolves({ crawlable: true, confidence: 0 }),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://main--example--adobecom.hlx.page',
            getConfig: () => ({
              getFetchConfig: () => ({ overrideBaseURL: 'https://www.override.com' }),
              getIncludedURLs: () => ['https://main--example--adobecom.hlx.page/included'],
            }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: async () => [
                { getUrl: () => 'https://main--example--adobecom.hlx.page/organic-1' },
              ],
            },
          },
          finalUrl: 'https://main--example--adobecom.hlx.page',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://www.override.com/organic-1');
        expect(submittedUrls).to.include('https://www.override.com/included');
      });

      it('returns domainBlocked when status.json has scrapeForbidden within 3d window', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': {
            detectBotBlocker: sandbox.stub().resolves({ crawlable: true, confidence: 0 }),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
          },
        });
        const statusKey = 'prerender/scrapes/sticky-site-id/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  scrapeForbiddenSince: new Date(Date.now() - 86400000).toISOString(),
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const log = { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() };
        const context = {
          site: {
            getId: () => 'sticky-site-id',
            getBaseURL: () => 'https://blocked.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log,
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
        expect(result.auditContext).to.deep.include({ domainBlocked: true });
        expect(log.info).to.have.been.calledWithMatch(/Sticky scrapeForbidden within 3d window/);
      });

      it('still scrapes when status.json scrapeForbidden is outside 3d window', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': {
            detectBotBlocker: sandbox.stub().resolves({ crawlable: true, confidence: 0 }),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });
        const statusKey = 'prerender/scrapes/old-sticky-site/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  scrapeForbiddenSince: new Date(Date.now() - 4 * 86400000).toISOString(),
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const context = {
          site: {
            getId: () => 'old-sticky-site',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.auditContext?.domainBlocked).to.be.undefined;
        expect(result.urls).to.deep.equal([]);
      });

      it('still scrapes when status.json has scrapeForbidden but missing scrapeForbiddenSince', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': {
            detectBotBlocker: sandbox.stub().resolves({ crawlable: true, confidence: 0 }),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });
        const statusKey = 'prerender/scrapes/no-since-site/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  // scrapeForbiddenSince intentionally absent
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const context = {
          site: {
            getId: () => 'no-since-site',
            getBaseURL: () => 'https://prefer.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.auditContext?.domainBlocked).to.be.undefined;
      });

      it('still scrapes when status.json scrapeForbiddenSince is an invalid date', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': {
            detectBotBlocker: sandbox.stub().resolves({ crawlable: true, confidence: 0 }),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });
        const statusKey = 'prerender/scrapes/bad-date-site/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  scrapeForbiddenSince: 'not-a-valid-date',
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const context = {
          site: {
            getId: () => 'bad-date-site',
            getBaseURL: () => 'https://prefer.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.auditContext?.domainBlocked).to.be.undefined;
      });

      it('Slack-triggered runs bypass sticky status.json and still submit URLs', async function () {
        this.timeout(5000);
        const detectBotBlocker = sandbox.stub().resolves({ crawlable: false, confidence: 1, type: 'cloudflare' });
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': { detectBotBlocker },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
          },
        });

        const context = {
          site: {
            getId: () => 'site-slack',
            getBaseURL: () => 'https://slack.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://slack.example/page' },
              ]),
            },
          },
          auditContext: { slackContext: { channelId: 'C01234567' } },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);

        expect(detectBotBlocker).to.not.have.been.called;
        expect(result.urls.map((u) => u.url)).to.include('https://slack.example/page');
      });

      it('proceeds when status.json is missing (NoSuchKey)', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': {
            detectBotBlocker: sandbox.stub().resolves({ crawlable: true, confidence: 0 }),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });

        const context = {
          site: {
            getId: () => 'nosuch-site',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
          },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
      });

      describe('active suggestion cap filter (LLMO-6533/LLMO-6638, automatic runs only)', () => {
        it('drops brand-new URLs once non-outdated suggestion count has reached the limit, but lets existing-suggestion URLs through', async function () {
          this.timeout(5000);
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            },
          });

          const suggestions = [
            { getStatus: () => 'NEW', getData: () => ({ url: 'https://capped.example/existing-page' }) },
            ...Array.from({ length: 3999 }, () => ({ getStatus: () => 'NEW', getData: () => ({}) })),
          ];
          const topPagesStub = sandbox.stub().resolves([
            { getUrl: () => 'https://capped.example/existing-page' },
            { getUrl: () => 'https://capped.example/brand-new-page' },
          ]);
          const log = { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() };
          const context = {
            site: {
              getId: () => 'capped-site-id',
              getBaseURL: () => 'https://capped.example',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: { allBySiteIdAndSourceAndGeo: topPagesStub },
              Opportunity: {
                allBySiteIdAndStatus: sandbox.stub().resolves([
                  {
                    getType: () => 'prerender',
                    getSuggestions: sandbox.stub().resolves(suggestions),
                  },
                ]),
              },
            },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
            log,
          };

          const result = await mockHandler.submitForScraping(context);
          const urls = result.urls.map((u) => u.url);

          expect(urls).to.include('https://capped.example/existing-page');
          expect(urls).to.not.include('https://capped.example/brand-new-page');
          expect(log.info).to.have.been.calledWithMatch(/Active suggestion count \(4000\) has reached the limit of 4000: dropped 1 new URL\(s\)/);
        });

        it('continues submitting all URLs when suggestion count is below the limit, excluding OUTDATED', async function () {
          this.timeout(5000);
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            },
          });

          // 3999 non-outdated + a large batch of OUTDATED ones that must be excluded from the
          // count, so the total remains just under the cap despite having >4000 suggestions.
          const suggestions = [
            ...Array.from({ length: 3999 }, () => ({ getStatus: () => 'NEW', getData: () => ({}) })),
            ...Array.from({ length: 500 }, () => ({ getStatus: () => 'OUTDATED', getData: () => ({}) })),
          ];
          const context = {
            site: {
              getId: () => 'under-cap-site-id',
              getBaseURL: () => 'https://undercap.example',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                  { getUrl: () => 'https://undercap.example/page' },
                ]),
              },
              Opportunity: {
                allBySiteIdAndStatus: sandbox.stub().resolves([
                  {
                    getType: () => 'prerender',
                    getSuggestions: sandbox.stub().resolves(suggestions),
                  },
                ]),
              },
            },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          };

          const result = await mockHandler.submitForScraping(context);

          expect(result.urls.map((u) => u.url)).to.include('https://undercap.example/page');
        });

        it('treats an opportunity without getSuggestions as having zero active suggestions', async function () {
          this.timeout(5000);
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            },
          });

          const context = {
            site: {
              getId: () => 'no-getsuggestions-site-id',
              getBaseURL: () => 'https://nogetsuggestions.example',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                  { getUrl: () => 'https://nogetsuggestions.example/page' },
                ]),
              },
              Opportunity: {
                allBySiteIdAndStatus: sandbox.stub().resolves([
                  { getType: () => 'prerender' },
                ]),
              },
            },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          };

          const result = await mockHandler.submitForScraping(context);

          expect(result.urls.map((u) => u.url)).to.include('https://nogetsuggestions.example/page');
        });

        it('does not apply to Slack-triggered runs', async function () {
          this.timeout(5000);
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            },
          });

          const suggestions = Array.from(
            { length: 4000 },
            () => ({ getStatus: () => 'NEW', getData: () => ({}) }),
          );
          const context = {
            site: {
              getId: () => 'capped-slack-site-id',
              getBaseURL: () => 'https://slack-capped.example',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                  { getUrl: () => 'https://slack-capped.example/brand-new-page' },
                ]),
              },
              Opportunity: {
                allBySiteIdAndStatus: sandbox.stub().resolves([
                  {
                    getType: () => 'prerender',
                    getSuggestions: sandbox.stub().resolves(suggestions),
                  },
                ]),
              },
            },
            auditContext: { slackContext: { channelId: 'C0123' } },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          };

          const result = await mockHandler.submitForScraping(context);

          expect(result.urls.map((u) => u.url)).to.include('https://slack-capped.example/brand-new-page');
        });
      });

      describe('daily batching', () => {
        const makeAgenticUrls = (n, base = 'https://example.com/agentic-') => Array.from({ length: n }, (_, i) => `${base}${i}`);
        const makeRecentPage = (path) => ({
          url: `https://example.com${path}`,
          scrapedAt: new Date().toISOString(),
          needsPrerender: true,
          scrapingStatus: 'success',
        });

        const makeHandlerWithAgentic = async (agenticUrls) => esmock('../../../src/prerender/submit-for-scraping.js', {
          '@adobe/spacecat-shared-utils': {
            detectBotBlocker: sandbox.stub().resolves({ crawlable: true, confidence: 0 }),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves(agenticUrls),
          },
        });

        const makeContext = (recentPages = []) => ({
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
          },
          s3Client: recentPages.length > 0
            ? { send: async () => ({ Body: { transformToString: async () => JSON.stringify({ pages: recentPages }) } }) }
            : { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        });

        it('should cap agentic URLs to DAILY_BATCH_SIZE when no recent citability records exist', async () => {
          const agenticUrls = makeAgenticUrls(500);
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([]);

          const result = await mockHandler.submitForScraping(context);

          expect(result.urls.length).to.equal(DAILY_BATCH_SIZE);
        });

        it('keeps in-scope URLs that sort after a full batch of out-of-scope URLs (scope filter runs before the daily-batch slice)', async () => {
          // A full DAILY_BATCH_SIZE of out-of-scope agentic URLs sorts ahead of the in-scope
          // ones in the merged candidate list. If the site-scope filter ran AFTER the slice,
          // the out-of-scope URLs would consume every batch slot and starve the in-scope ones.
          // Filtering before the slice guarantees the in-scope URLs survive.
          const outOfScope = makeAgenticUrls(DAILY_BATCH_SIZE, 'https://example.com/fr/agentic-');
          const inScope = [
            'https://example.com/uk/agentic-a',
            'https://example.com/uk/agentic-b',
          ];
          const mockHandler = await makeHandlerWithAgentic([...outOfScope, ...inScope]);
          const context = makeContext([]);
          context.site.getBaseURL = () => 'https://example.com/uk';

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          expect(resultUrls).to.include('https://example.com/uk/agentic-a');
          expect(resultUrls).to.include('https://example.com/uk/agentic-b');
          expect(resultUrls).to.not.include('https://example.com/fr/agentic-0');
          expect(result.urls.length).to.equal(2);
        });

        it('should filter out agentic URLs recently processed by prerender (within recent window)', async () => {
          const agenticUrls = [
            'https://example.com/agentic-0',
            'https://example.com/agentic-1',
            'https://example.com/agentic-2',
          ];
          // agentic-0 is in recently-processed set → skip
          const recentRecord = makeRecentPage('/agentic-0');
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([recentRecord]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // agentic-0 was recently processed → should NOT be in this batch
          expect(resultUrls).to.not.include('https://example.com/agentic-0');
          // agentic-1 and agentic-2 were not recently processed → should be included
          expect(resultUrls).to.include('https://example.com/agentic-1');
          expect(resultUrls).to.include('https://example.com/agentic-2');
        });

        it('should exclude recently scraped URL regardless of needsPrerender or scrapingStatus value', async () => {
          const agenticUrls = [
            'https://example.com/agentic-success',
            'https://example.com/agentic-other',
          ];
          // Any URL with a recent scrapedAt is excluded, regardless of needsPrerender/scrapingStatus
          const recentPage = {
            url: 'https://example.com/agentic-success',
            scrapedAt: new Date().toISOString(),
            needsPrerender: false,
            scrapingStatus: 'success',
          };
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([recentPage]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          expect(resultUrls).to.not.include('https://example.com/agentic-success');
          expect(resultUrls).to.include('https://example.com/agentic-other');
        });

        it('should exclude recently scraped URL even when scrapingStatus is error', async () => {
          const agenticUrls = [
            'https://example.com/agentic-failed',
            'https://example.com/agentic-other',
          ];
          // Any URL with a recent scrapedAt is excluded, regardless of scrapingStatus
          const failedPage = {
            url: 'https://example.com/agentic-failed',
            scrapedAt: new Date().toISOString(),
            needsPrerender: false,
            scrapingStatus: 'error',
          };
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([failedPage]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          expect(resultUrls).to.not.include('https://example.com/agentic-failed');
          expect(resultUrls).to.include('https://example.com/agentic-other');
        });

        it('should include agentic URLs when status.json has no recent pages', async () => {
          const agenticUrls = [
            'https://example.com/agentic-0',
            'https://example.com/agentic-1',
          ];
          // S3 returns NoSuchKey — no previously processed pages in the window
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // No recent records → both agentic URLs should be included
          expect(resultUrls).to.include('https://example.com/agentic-0');
          expect(resultUrls).to.include('https://example.com/agentic-1');
        });

        it('should include organic URLs when no citability records exist', async () => {
          const agenticUrls = makeAgenticUrls(5);
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);

          const organicUrl = 'https://example.com/organic-page';
          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => organicUrl }]),
              },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // No recent citability records → include organic URL
          expect(resultUrls).to.include(organicUrl);
        });

        it('should skip organic URLs recently processed by prerender', async () => {
          const agenticUrls = makeAgenticUrls(5);
          const organicUrl = 'https://example.com/organic-page';
          // organic-page is in recently-processed set → skip
          const recentPage = {
            url: organicUrl,
            scrapedAt: new Date().toISOString(),
            needsPrerender: true,
            scrapingStatus: 'success',
          };
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);

          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => organicUrl }]),
              },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: async () => ({ Body: { transformToString: async () => JSON.stringify({ pages: [recentPage] }) } }) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // organic-page was recently processed → should NOT be in batch
          expect(resultUrls).to.not.include(organicUrl);
        });

        it('should pick the next 320 URLs on the next run after filtering recent page citability records', async () => {
          const agenticUrls = makeAgenticUrls(1000);
          const organicUrls = Array.from(
            { length: TOP_ORGANIC_URLS_LIMIT },
            (_, i) => `https://example.com/organic-${i}`,
          );
          const includedUrls = Array.from(
            { length: 10 },
            (_, i) => `https://example.com/included-${i}`,
          );
          const firstBatchUrls = [
            ...organicUrls,
            ...includedUrls,
            ...agenticUrls.slice(0, DAILY_BATCH_SIZE - organicUrls.length - includedUrls.length),
          ];
          const recentRecords = firstBatchUrls.map((url) => ({
            url,
            scrapedAt: new Date().toISOString(),
            needsPrerender: true,
            scrapingStatus: 'success',
          }));
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);

          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => includedUrls }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(
                  organicUrls.map((url) => ({ getUrl: () => url })),
                ),
              },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: async () => ({ Body: { transformToString: async () => JSON.stringify({ pages: recentRecords }) } }) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          expect(resultUrls).to.deep.equal(
            agenticUrls.slice(
              DAILY_BATCH_SIZE - organicUrls.length - includedUrls.length,
              (DAILY_BATCH_SIZE - organicUrls.length - includedUrls.length) + DAILY_BATCH_SIZE,
            ),
          );
        });

        it('should silently ignore citability records with invalid URLs when building recent pathnames', async () => {
          // Page with an empty URL — `p.url` is falsy so it is skipped before normalizePathnameWithQuery is called.
          const invalidPage = { url: '', scrapedAt: new Date().toISOString(), needsPrerender: true };
          const mockHandler = await makeHandlerWithAgentic(['https://example.com/agentic-0']);
          const context = makeContext([invalidPage]);

          // Should not throw; agentic-0 is not blocked by the invalid record
          const result = await mockHandler.submitForScraping(context);
          expect(result.urls.map((u) => u.url)).to.include('https://example.com/agentic-0');
        });

        it('should exclude pages whose scrapedAt is older than the recent window', async () => {
          const agenticUrls = ['https://example.com/stale', 'https://example.com/fresh'];
          const stalePage = {
            url: 'https://example.com/stale',
            scrapedAt: new Date(Date.now() - (PRERENDER_RECENT_PROCESSING_TIME_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
            needsPrerender: true,
          };
          const freshPage = makeRecentPage('/fresh');
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([stalePage, freshPage]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // stale page is outside the recent window → should be included in the batch (not filtered out)
          expect(resultUrls).to.include('https://example.com/stale');
          // fresh page is within the recent window → should be filtered out
          expect(resultUrls).to.not.include('https://example.com/fresh');
        });

        it('should treat an organic URL that cannot be parsed as not recently processed', async () => {
          // 'not-a-valid-url' is not an absolute URL — normalizePathnameWithQuery falls back
          // to the raw string which is not in the recentPathnames Set so the URL is kept.
          const mockHandler = await makeHandlerWithAgentic([]);
          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                  { getUrl: () => 'not-a-valid-url' },
                ]),
              },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          // Should not throw; the invalid organic URL is treated as not-recently-processed
          const result = await mockHandler.submitForScraping(context);
          expect(result).to.be.an('object');
          expect(result.urls).to.be.an('array');
        });

        it('should include agentic URLs that cannot be parsed, not treating them as recently processed', async () => {
          // 'not-a-valid-url' in the agentic list — normalizePathnameWithQuery falls back
          // to the raw string which is not in the recentPathnames Set so the URL is kept.
          const mockHandler = await makeHandlerWithAgentic(['not-a-valid-url', 'https://example.com/valid']);
          const context = makeContext([]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);
          expect(resultUrls).to.include('not-a-valid-url');
          expect(resultUrls).to.include('https://example.com/valid');
        });

        it('should treat query-param URL variants as distinct in the recently-processed set', async () => {
          // Gap 2: /page?filter=iphone in siteStatus should NOT suppress /page?filter=mac.
          const mockHandler = await makeHandlerWithAgentic([]);
          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({
                getIncludedURLs: () => [
                  'https://example.com/page?filter=iphone',
                  'https://example.com/page?filter=mac',
                ],
              }),
            },
            dataAccess: {
              SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: async () => ({ Body: { transformToString: async () => JSON.stringify({ pages: [{ url: 'https://example.com/page?filter=iphone', scrapedAt: new Date().toISOString(), needsPrerender: true, scrapingStatus: 'success' }] }) } }) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // iphone was recently processed → should NOT appear
          expect(resultUrls).to.not.include('https://example.com/page?filter=iphone');
          // mac was NOT recently processed → should appear
          expect(resultUrls).to.include('https://example.com/page?filter=mac');
        });

        describe('edge-deployed URL filtering', () => {
          const makeS3WithStatus = (pages = []) => ({
            send: async (cmd) => {
              if (cmd.constructor?.name === 'GetObjectCommand') {
                return { Body: { transformToString: async () => JSON.stringify({ pages }) } };
              }
              return Promise.reject(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
            },
          });

          it('filters organic URLs where isDeployedAtEdge is true in status.json', async () => {
            const deployedUrl = 'https://example.com/deployed-page';
            const freshUrl = 'https://example.com/fresh-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                    { getUrl: () => deployedUrl },
                    { getUrl: () => freshUrl },
                  ]),
                },
              },
              s3Client: makeS3WithStatus([{ url: deployedUrl, isDeployedAtEdge: true }]),
            };

            const result = await mockHandler.submitForScraping(context);
            const resultUrls = result.urls.map((u) => u.url);
            expect(resultUrls).to.not.include(deployedUrl);
            expect(resultUrls).to.include(freshUrl);
          });

          it('filters agentic URLs where isDeployedAtEdge is true in status.json', async () => {
            const deployedUrl = 'https://example.com/deployed-agentic';
            const freshUrl = 'https://example.com/fresh-agentic';
            const mockHandler = await makeHandlerWithAgentic([deployedUrl, freshUrl]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
              },
              s3Client: makeS3WithStatus([{ url: deployedUrl, isDeployedAtEdge: true }]),
            };

            const result = await mockHandler.submitForScraping(context);
            const resultUrls = result.urls.map((u) => u.url);
            expect(resultUrls).to.not.include(deployedUrl);
            expect(resultUrls).to.include(freshUrl);
          });

          it('does not filter URLs where isDeployedAtEdge is false', async () => {
            const url = 'https://example.com/not-deployed';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => url }]),
                },
              },
              s3Client: makeS3WithStatus([{ url, isDeployedAtEdge: false }]),
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.include(url);
          });

          it('does not filter any URLs when status.json is missing (NoSuchKey)', async () => {
            const url = 'https://example.com/some-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => url }]),
                },
              },
              // makeContext default s3Client already throws NoSuchKey
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.include(url);
          });

          it('logs a warning and does not filter when status.json read fails', async () => {
            const url = 'https://example.com/some-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const log = { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() };
            const context = {
              ...makeContext([]),
              log,
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => url }]),
                },
              },
              s3Client: { send: sandbox.stub().rejects(new Error('S3 read error')) },
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.include(url);
            expect(log.warn).to.have.been.calledWithMatch(/Could not read status\.json/);
          });

          it('skips pages with malformed URLs without throwing', async () => {
            const validUrl = 'https://example.com/valid-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => validUrl }]),
                },
              },
              s3Client: makeS3WithStatus([
                { url: 'not-a-url', isDeployedAtEdge: true },
                { url: validUrl, isDeployedAtEdge: true },
              ]),
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.not.include(validUrl);
          });

          it('handles root-pathname page URLs (pathname === "/")', async () => {
            const rootUrl = 'https://example.com/';
            const freshUrl = 'https://example.com/other-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                    { getUrl: () => rootUrl },
                    { getUrl: () => freshUrl },
                  ]),
                },
              },
              s3Client: makeS3WithStatus([{ url: rootUrl, isDeployedAtEdge: true }]),
            };

            const result = await mockHandler.submitForScraping(context);
            const resultUrls = result.urls.map((u) => u.url);
            expect(resultUrls).to.not.include(rootUrl);
            expect(resultUrls).to.not.include('https://example.com/');
            expect(resultUrls).to.include(freshUrl);
          });
        });


      });

      it('should include organic URLs even when all are in the recency window when triggered from Slack', async () => {
        const athenaStub = sandbox.stub().resolves([]);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: athenaStub,
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          auditContext: { slackContext: { channelId: 'C123', threadTs: '1.0' } },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://example.com/organic-page-1' },
                { getUrl: () => 'https://example.com/organic-page-2' },
              ]),
            },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);

        // Both URLs must be present even though they would be "recent" in a scheduled run
        expect(result.urls).to.deep.equal([
          { url: 'https://example.com/organic-page-1' },
          { url: 'https://example.com/organic-page-2' },
        ]);
      });

      it('should not fetch agentic URLs when triggered from Slack', async () => {
        const athenaStub = sandbox.stub().resolves(['https://example.com/agentic-1']);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: athenaStub,
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          auditContext: { slackContext: { channelId: 'C123', threadTs: '1.0' } },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://example.com/organic-page-1' },
                { getUrl: () => 'https://example.com/organic-page-2' },
              ]),
            },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);

        expect(athenaStub).to.not.have.been.called;
        expect(result.urls).to.deep.equal([
          { url: 'https://example.com/organic-page-1' },
          { url: 'https://example.com/organic-page-2' },
        ]);
      });

      it('should still fetch agentic URLs for scheduled (non-Slack) runs', async () => {
        const athenaStub = sandbox.stub().resolves(['https://example.com/agentic-1']);
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: athenaStub,
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
            },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
          env: {},
        };

        await mockHandler.submitForScraping(context);

        expect(athenaStub).to.have.been.called;
      });

      describe('site-scope filtering', () => {
        it('filters out CSV URLs outside the site subpath', async () => {
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: async () => [],
              getPreferredBaseUrl: () => 'https://bulk.com/uk',
            },
          });

          const context = {
            site: {
              getId: () => 'site-1',
              getBaseURL: () => 'https://bulk.com/uk',
            },
            auditContext: {
              urls: [
                'https://bulk.com/uk/page-1',
                'https://bulk.com/fr/page-2',
                'https://bulk.com/uk/page-3',
              ],
            },
            finalUrl: 'https://bulk.com/uk',
            log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
            env: {},
          };

          const result = await mockHandler.submitForScraping(context);
          const submittedUrls = result.urls.map((u) => u.url);
          expect(submittedUrls).to.include('https://bulk.com/uk/page-1');
          expect(submittedUrls).to.include('https://bulk.com/uk/page-3');
          expect(submittedUrls).to.not.include('https://bulk.com/fr/page-2');
        });

        it('filters out both included URLs and organic top pages outside the site subpath', async () => {
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: async () => [],
              getPreferredBaseUrl: () => 'https://bulk.com/uk',
            },
          });

          const context = {
            site: {
              getId: () => 'site-1',
              getBaseURL: () => 'https://bulk.com/uk',
              getConfig: () => ({
                getIncludedURLs: () => [
                  'https://bulk.com/uk/special',
                  'https://bulk.com/de/special',
                ],
              }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: async () => [
                  { getUrl: () => 'https://bulk.com/uk/organic-1' },
                  { getUrl: () => 'https://bulk.com/fr/organic-2' },
                ],
              },
              Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
              LatestAudit: { updateByKeys: sinon.stub().resolves() },
            },
            finalUrl: 'https://bulk.com/uk',
            log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
            s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const submittedUrls = result.urls.map((u) => u.url);
          // Organic top pages ARE filtered by scope
          expect(submittedUrls).to.include('https://bulk.com/uk/organic-1');
          expect(submittedUrls).to.not.include('https://bulk.com/fr/organic-2');
          // Included URLs ARE filtered by scope
          expect(submittedUrls).to.include('https://bulk.com/uk/special');
          expect(submittedUrls).to.not.include('https://bulk.com/de/special');
        });

        it('filters out agentic URLs outside the site subpath', async () => {
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: async () => [
                'https://bulk.com/uk/agentic-1',
                'https://bulk.com/fr/agentic-2',
                'https://bulk.com/uk/agentic-3',
              ],
            },
          });

          const context = {
            site: {
              getId: () => 'site-1',
              getBaseURL: () => 'https://bulk.com/uk',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: { allBySiteIdAndSourceAndGeo: async () => [] },
              Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
              LatestAudit: { updateByKeys: sinon.stub().resolves() },
            },
            log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
            s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const submittedUrls = result.urls.map((u) => u.url);
          expect(submittedUrls).to.include('https://bulk.com/uk/agentic-1');
          expect(submittedUrls).to.include('https://bulk.com/uk/agentic-3');
          expect(submittedUrls).to.not.include('https://bulk.com/fr/agentic-2');
        });

        it('drops all CSV URLs when site-scope filtering removes them', async () => {
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: async () => [],
              getPreferredBaseUrl: () => 'https://bulk.com/uk',
            },
          });

          const context = {
            site: {
              getId: () => 'site-1',
              getBaseURL: () => 'https://bulk.com/uk',
            },
            auditContext: {
              urls: [
                'https://bulk.com/fr/page-1',
                'https://bulk.com/de/page-2',
              ],
            },
            finalUrl: 'https://bulk.com/uk',
            log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
            env: {},
          };

          const result = await mockHandler.submitForScraping(context);
          expect(result.urls).to.deep.equal([]);
        });

        it('drops all URLs when the rebase-target host diverges from the site scope host', async () => {
          // preferredBase host (other.com) differs from site.getBaseURL() host (bulk.com), so every
          // rebased URL fails the hostname check in isWithinSiteScope - the silent-drop scenario.
          const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: async () => [],
              getPreferredBaseUrl: () => 'https://other.com/uk',
            },
          });

          const context = {
            site: {
              getId: () => 'site-1',
              getBaseURL: () => 'https://bulk.com/uk',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: async () => [
                  { getUrl: () => 'https://bulk.com/uk/organic-1' },
                ],
              },
              Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
              LatestAudit: { updateByKeys: sinon.stub().resolves() },
            },
            finalUrl: 'https://bulk.com/uk',
            log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
            s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          expect(result.urls).to.deep.equal([]);
        });

      });

    });
  });

  describe('Additional branch coverage (submitForScraping)', () => {
    it('should return the raw Athena URL when it is already absolute but invalid', async function () {
      this.timeout(5000);
      const mergeAndGetUniqueHtmlUrlsStub = sinon.stub().callsFake((...args) => ({
        urls: args.filter(Array.isArray).flat(),
        filteredCount: 0,
      }));

      const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticLiveUrlsFromAthena: sinon.stub().resolves(['http://[invalid']),
        },
        '../../../src/prerender/utils/utils.js': {
          isPaidLLMOCustomer: sinon.stub().resolves(false),
          mergeAndGetUniqueHtmlUrls: mergeAndGetUniqueHtmlUrlsStub,
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
        },
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          debug: sinon.stub(),
        },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);

      expect(res.urls).to.deep.equal([{ url: 'http://[invalid' }]);
      // Four calls: one per source (organic, included, agentic) + one cross-source dedup
      expect(mergeAndGetUniqueHtmlUrlsStub).to.have.callCount(4);
    });

    it('should handle missing SiteTopPage without errors (no top organic URLs)', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            periodIdentifier: 'w45-2025',
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
            createAgenticReportQuery: sinon.stub().resolves('SELECT 2'),
          },
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'https://example.com',
            rows: [],
          }),
          buildSheetHitsMap: (rows) => new Map(rows.map((r) => [r.url, r.number_of_hits])),
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        // Intentionally omit SiteTopPage to exercise the "no top pages" branch in getTopOrganicUrlsFromSeo
        dataAccess: {},
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
    });

    it('should warn and continue when SiteTopPage.allBySiteIdAndSourceAndGeo throws', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            periodIdentifier: 'w45-2025',
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
            createAgenticReportQuery: sinon.stub().resolves('SELECT 2'),
          },
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'https://example.com',
            rows: [],
          }),
          buildSheetHitsMap: (rows) => new Map(rows.map((r) => [r.url, r.number_of_hits])),
        },
      });

      const warn = sinon.stub();
      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          // allBySiteIdAndSourceAndGeo is defined but throws — exercises the catch in getTopOrganicUrlsFromSeo
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().rejects(new Error('DB connection lost')),
          },
        },
        log: { info: sinon.stub(), warn, debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
      expect(warn.args.some((call) => typeof call[0] === 'string'
        && call[0].includes('Failed to load top pages for fallback'))).to.be.true;
    });

    it('should handle sheet load failures gracefully and continue scraping', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            periodIdentifier: 'w45-2025',
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            aggregatedLocation: 'agg/',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
          },
          loadLatestAgenticSheet: async () => {
            throw new Error('Sheet load failed');
          },
          buildSheetHitsMap: (rows) => new Map(rows.map((r) => [r.url, r.number_of_hits])),
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
        },
        log: {
          info: sinon.stub(),
          debug: sinon.stub(),
          warn: sinon.stub(),
        },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
    });

    it('should handle missing dataAccess when loading top pages', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: {
            fromContext: () => ({
              // No agentic URLs for this test
              query: async () => [],
            }),
          },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
            createAgenticReportQuery: sinon.stub().resolves('SELECT 2'),
          },
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'https://example.com',
            rows: [],
          }),
          buildSheetHitsMap: (rows) => new Map(rows.map((r) => [r.url, r.number_of_hits])),
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        // Intentionally omit dataAccess to exercise `dataAccess || {}` branch in getTopOrganicUrlsFromSeo
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
    });
  });

  describe('Subpath URL scoping (LLMO-5145)', () => {
    describe('URL filtering in getTopOrganicUrlsFromSeo', () => {
      it('should filter top pages to site subpath scope when baseURL is a subpath', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
            getPreferredBaseUrl: () => 'https://nba.com/kings',
          },
        });

        const allPages = [
          { getUrl: () => 'https://nba.com/kings/roster' },
          { getUrl: () => 'https://nba.com/kings/schedule' },
          { getUrl: () => 'https://nba.com/lakers/page' },
          { getUrl: () => 'https://nba.com/about' },
        ];

        const context = {
          site: {
            getId: () => 'nba-kings-site',
            getBaseURL: () => 'https://nba.com/kings',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sinon.stub().resolves(allPages),
            },
            Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
            LatestAudit: { updateByKeys: sinon.stub().resolves() },
          },
          log: { info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub() },
          s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.submitForScraping(context);
        const urls = result.urls.map((u) => u.url);

        expect(urls).to.include('https://nba.com/kings/roster');
        expect(urls).to.include('https://nba.com/kings/schedule');
        expect(urls).to.not.include('https://nba.com/lakers/page');
        expect(urls).to.not.include('https://nba.com/about');
      });

      it('should include all URLs when baseURL is a root domain', async () => {
        const mockHandler = await esmock('../../../src/prerender/submit-for-scraping.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
            getPreferredBaseUrl: () => 'https://nba.com',
          },
        });

        const allPages = [
          { getUrl: () => 'https://nba.com/lakers/page' },
          { getUrl: () => 'https://nba.com/kings/roster' },
          { getUrl: () => 'https://nba.com/about' },
        ];

        const context = {
          site: {
            getId: () => 'nba-site',
            getBaseURL: () => 'https://nba.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sinon.stub().resolves(allPages),
            },
            Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
            LatestAudit: { updateByKeys: sinon.stub().resolves() },
          },
          log: { info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub() },
          s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.submitForScraping(context);
        const urls = result.urls.map((u) => u.url);

        expect(urls).to.include('https://nba.com/lakers/page');
        expect(urls).to.include('https://nba.com/kings/roster');
        expect(urls).to.include('https://nba.com/about');
      });
    });
  });
  describe('Edge Cases and Error Handling', () => {
    describe('Site Config Edge Cases', () => {
      it('should handle missing site config gracefully', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => null, // No config
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
      });

      it('should handle undefined getIncludedURLs', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({}), // Config without getIncludedURLs
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
      });
    });
  });

});
