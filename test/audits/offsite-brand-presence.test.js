/*
 * Copyright 2026 Adobe. All rights reserved.
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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import * as handlerConstants from '../../src/offsite-brand-presence/constants.js';
import { SCRAPE_DATASET_IDS } from '@adobe/spacecat-shared-drs-client';

const {
  DRS_URLS_LIMIT,
  REDDIT_COMMENTS_DAYS_BACK,
} = handlerConstants;

use(sinonChai);

const DEFAULT_WEEK = 7;
const DEFAULT_WEEK_2 = 6;
const DEFAULT_YEAR = 2026;

describe('Offsite Brand Presence Handler', () => {
  let sandbox;
  let mockLoadBrandPresenceData;
  let mockGetPreviousWeeks;
  let mockSubmitScrapeJob;
  let mockDrsIsConfigured;
  let mockPostMessageOptional;
  let offsiteBrandPresenceRunner;
  let handlerDefault;

  let site;
  let context;
  let env;
  let log;
  let dataAccess;
  let sharedMocks;

  const FINAL_URL = 'https://example.com';
  const SITE_ID = 'site-123';
  const BASE_URL = 'https://example.com';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockLoadBrandPresenceData = sandbox.stub();
    mockGetPreviousWeeks = sandbox.stub().returns([
      { week: DEFAULT_WEEK, year: DEFAULT_YEAR },
      { week: DEFAULT_WEEK_2, year: DEFAULT_YEAR },
    ]);
    mockSubmitScrapeJob = sandbox.stub().resolves({ job_id: 'mock-job' });
    mockDrsIsConfigured = sandbox.stub().returns(true);
    mockPostMessageOptional = sandbox.stub().resolves({ success: true, result: {} });

    sharedMocks = {
      '../../src/utils/offsite-brand-presence-enrichment.js': {
        getPreviousWeeks: mockGetPreviousWeeks,
        loadBrandPresenceData: mockLoadBrandPresenceData,
      },
      '@adobe/spacecat-shared-drs-client': {
        default: {
          createFrom: () => ({
            isConfigured: mockDrsIsConfigured,
            submitScrapeJob: mockSubmitScrapeJob,
          }),
        },
        SCRAPE_DATASET_IDS: {
          ...SCRAPE_DATASET_IDS,
        },
      },
      '../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
    };

    const mod = await esmock('../../src/offsite-brand-presence/handler.js', sharedMocks);

    offsiteBrandPresenceRunner = mod.offsiteBrandPresenceRunner;
    handlerDefault = mod.default;

    mockLoadBrandPresenceData.resolves(null);

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    env = {
      DRS_API_URL: 'https://drs.api.example.com',
      DRS_API_KEY: 'test-drs-key',
    };

    dataAccess = {
      AuditUrl: {
        create: sandbox.stub().resolves({}),
        batchGetByKeys: sandbox.stub().resolves({ data: [] }),
      },
      SentimentTopic: {
        allBySiteId: sandbox.stub().resolves({ data: [] }),
        create: sandbox.stub().resolves({}),
      },
    };

    site = {
      getId: sandbox.stub().returns(SITE_ID),
      getBaseURL: sandbox.stub().returns(BASE_URL),
    };

    context = { dataAccess, env, log };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ----- Helpers -----

  function makeBrandPresenceData(sources) {
    return {
      data: sources.map((s) => {
        if (typeof s === 'string') {
          return {
            Sources: s, Region: 'US', Mentions: 'true', Citations: 'true',
          };
        }
        return {
          Sources: s.Sources, Region: s.Region || 'US', Mentions: 'true', Citations: 'true', Topic: s.Topic, Category: s.Category, Prompt: s.Prompt,
        };
      }),
    };
  }

  function stubBrandPresenceData(sources) {
    const data = makeBrandPresenceData(sources);
    mockLoadBrandPresenceData.resolves(data);
    return data;
  }

  // ----- Tests -----

  describe('Default Export', () => {
    it('should export a valid audit handler with runner and urlResolver', () => {
      expect(handlerDefault).to.be.an('object');
      expect(handlerDefault.runner).to.be.a('function');
      expect(handlerDefault.urlResolver).to.be.a('function');
    });
  });

  describe('PostgREST Fallback', () => {
    it('uses PostgREST data before query-index/file fetches', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [{
          Sources: 'https://www.youtube.com/watch?v=abc123',
          Region: 'US',
          Topics: 'Topic A',
          Category: 'Category A',
          Prompt: 'Prompt A',
        }],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(mockLoadBrandPresenceData).to.have.been.calledOnce;
      expect(mockLoadBrandPresenceData.firstCall.args[0].siteId).to.equal(SITE_ID);
      expect(mockLoadBrandPresenceData.firstCall.args[0].site).to.equal(site);
    });

    it('returns empty result when loadBrandPresenceData returns null', async () => {
      mockLoadBrandPresenceData.resolves(null);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
    });
  });

  describe('URL Extraction', () => {
    it('should extract youtube.com and reddit.com URLs including subdomains', async () => {
      const urls = 'https://www.youtube.com/watch?v=x;https://www.reddit.com/r/test/';
      stubBrandPresenceData([urls]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should handle semicolon, newline, and mixed separators in Sources field', async () => {
      const sources = 'https://youtube.com/shorts/a;https://youtube.com/shorts/b\nhttps://reddit.com/r/test/';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should ignore invalid, malformed, and unrecognized URLs without crashing', async () => {
      const sources = 'not-a-url;https://youtube.com/v1;;  ;ftp://weird;https:///path;://nohost;plain-text';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should count URL occurrences across rows and providers', async () => {
      const sharedUrl = 'https://www.youtube.com/watch?v=shared';
      stubBrandPresenceData([sharedUrl, sharedUrl, sharedUrl]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should handle rows without Sources field', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [
          {
            Prompt: 'test prompt', Region: 'US', Mentions: 'true', Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/v1', Region: 'US', Mentions: 'true', Citations: 'true',
          },
        ],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should only extract URLs with Region=US', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [
          {
            Sources: 'https://youtube.com/v1', Region: 'EU',
          },
          {
            Sources: 'https://youtube.com/v2', Region: 'US',
          },
          {
            Sources: 'https://youtube.com/ok', Region: 'US',
          },
          {
            Sources: 'https://reddit.com/r/ok/', Region: 'US',
          },
        ],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should ignore non-offsite and substring-matching domains', async () => {
      const sources = 'https://google.com/search;https://notyoutube.com/watch;https://fakereddit.com/r/test;https://twitter.com/post';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
    });

    it('should discard YouTube URLs with non-standard subdomains', async () => {
      const sources = 'https://music.youtube.com/watch?v=abc;https://studio.youtube.com/channel/123;https://www.youtube.com/watch?v=valid';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
    });

    it('should discard Reddit URLs with non-standard subdomains', async () => {
      const sources = 'https://m.reddit.com/r/test/;https://old.reddit.com/r/test/;https://www.reddit.com/r/valid/';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should discard Reddit URLs without a path after subreddit name', async () => {
      const sources = 'https://reddit.com/r/test;https://reddit.com/r/valid/comments/abc/title';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });

    it('should accept Reddit URLs with /t/ topic and /user/ paths', async () => {
      const sources = 'https://reddit.com/t/gaming/;https://reddit.com/user/someone/comments/abc/post';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(2);
    });

    it('should accept Reddit URLs with percent-encoded characters in path', async () => {
      const sources = 'https://reddit.com/r/sub/some%20path/';
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
    });
  });

  describe('URL Normalization', () => {
    it('should normalize youtube.com/watch URLs to youtu.be short form', async () => {
      stubBrandPresenceData(['https://www.youtube.com/watch?v=abc123']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.deep.equal(['https://youtu.be/abc123']);
    });

    it('should keep youtube.com/shorts URLs as-is (strip query params only)', async () => {
      stubBrandPresenceData(['https://www.youtube.com/shorts/xyz?feature=share']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.deep.equal(['https://www.youtube.com/shorts/xyz']);
    });

    it('should normalize youtu.be short URLs via domain alias', async () => {
      stubBrandPresenceData(['https://youtu.be/shortId']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(1);
      expect(mockSubmitScrapeJob).to.have.been.called;
    });

    it('should preserve trailing slash for domain-root URLs', async () => {
      stubBrandPresenceData(['https://example.com/']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls[0].args[0].url).to.equal('https://example.com/');
    });

    it('should strip trailing slash and query parameters from reddit URLs', async () => {
      stubBrandPresenceData(['https://reddit.com/r/test/post/?utm_source=share']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const postsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'reddit_posts',
      );
      expect(postsCall.args[0].urls[0]).to.equal('https://reddit.com/r/test/post');
    });
  });

  describe('No URLs Found', () => {
    it('should return success with zero counts and skip URL store and DRS', async () => {
      mockLoadBrandPresenceData.resolves(null);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(0);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(0);
      expect(result.auditResult.urlCounts['wikipedia.org']).to.equal(0);
      expect(result.fullAuditRef).to.equal(FINAL_URL);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/No offsite URLs found/),
      );
      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
    });
  });

  describe('URL Store Integration', () => {
    it('should add URLs to URL store via dataAccess', async () => {
      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.have.been.calledOnce;
      const createArg = dataAccess.AuditUrl.create.firstCall.args[0];
      expect(createArg.siteId).to.equal(SITE_ID);
      expect(createArg.url).to.equal('https://youtu.be/test');
      expect(createArg.byCustomer).to.equal(false);
      expect(createArg.audits).to.deep.equal(['youtube-analysis']);
    });

    it('should still send URL to DRS when it already exists in the URL store', async () => {
      dataAccess.AuditUrl.batchGetByKeys.resolves({
        data: [{ getUrl: () => 'https://youtu.be/test' }],
      });

      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
      expect(result.auditResult.success).to.be.true;
      expect(log.info).to.have.been.calledWith(
        sinon.match(/0 created, 1 already existed, 0 failed/),
      );

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.include('https://youtu.be/test');
    });

    it('should return empty storedByDomain when batchGetByKeys fails', async () => {
      dataAccess.AuditUrl.batchGetByKeys.rejects(new Error('DB connection lost'));

      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(dataAccess.AuditUrl.create).to.not.have.been.called;
      expect(mockSubmitScrapeJob).to.not.have.been.called;
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to check existing URLs/),
      );
    });

    it('should handle URL store create failure gracefully and skip DRS for failed URLs', async () => {
      dataAccess.AuditUrl.create.rejects(new Error('DynamoDB error'));

      stubBrandPresenceData(['https://youtube.com/watch?v=test']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(mockSubmitScrapeJob).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to add URL to store/),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match(/0 created, 0 already existed, 1 failed/),
      );
    });

    it('should only send successfully stored URLs to DRS when some fail', async () => {
      const sources = 'https://youtube.com/shorts/a;https://youtube.com/shorts/b;https://reddit.com/r/test/';
      stubBrandPresenceData([sources]);

      dataAccess.AuditUrl.create.onCall(1).rejects(new Error('write failed'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.info).to.have.been.calledWith(
        sinon.match(/2 created, 0 already existed, 1 failed/),
      );

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.have.lengthOf(1);

      const postsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'reddit_posts',
      );
      expect(postsCall.args[0].urls).to.have.lengthOf(1);
    });

    it('should skip DRS for a domain when all its URLs fail to store', async () => {
      const sources = 'https://youtube.com/shorts/a;https://reddit.com/r/test/';
      stubBrandPresenceData([sources]);

      dataAccess.AuditUrl.create.onCall(0).rejects(new Error('youtube store failed'));

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;

      const ytCalls = mockSubmitScrapeJob.getCalls().filter(
        (c) => c.args[0].datasetId.startsWith('youtube_'),
      );
      expect(ytCalls).to.have.lengthOf(0);

      const redditCalls = mockSubmitScrapeJob.getCalls().filter(
        (c) => c.args[0].datasetId.startsWith('reddit_'),
      );
      expect(redditCalls).to.have.lengthOf(2);
    });

    it('should add URLs for multiple domains to URL store', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/a;https://reddit.com/r/test/']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.AuditUrl.create).to.have.been.calledTwice;

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const auditTypes = createCalls.map((c) => c.args[0].audits[0]);
      expect(auditTypes).to.include('youtube-analysis');
      expect(auditTypes).to.include('reddit-analysis');
    });

    it('should add wikipedia URLs to URL store with wikipedia-analysis audit type', async () => {
      stubBrandPresenceData(['https://en.wikipedia.org/wiki/Adobe']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const wikiCalls = createCalls.filter((c) => c.args[0].audits[0] === 'wikipedia-analysis');
      expect(wikiCalls).to.have.lengthOf(1);
      expect(wikiCalls[0].args[0].url).to.include('wikipedia.org');
    });
  });

  describe('Top URLs Per Domain', () => {
    it('should limit both DRS and URL store to top-N URLs per domain', async () => {
      const urls = [];
      const urlCount = DRS_URLS_LIMIT + 10;
      for (let i = 0; i < urlCount; i += 1) {
        urls.push(`https://youtube.com/shorts/vid${i}`);
      }
      const sources = urls.join(';');
      stubBrandPresenceData([sources]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(urlCount);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === 'youtube_videos',
      );
      expect(videosCall.args[0].urls).to.have.lengthOf(DRS_URLS_LIMIT);
      expect(dataAccess.AuditUrl.create.callCount).to.equal(DRS_URLS_LIMIT);
    });

    it('should select most frequent URLs for DRS when counts differ', async () => {
      mockLoadBrandPresenceData.resolves({
        data: [
          {
            Sources: 'https://youtube.com/shorts/popular',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/shorts/popular',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
          {
            Sources: 'https://youtube.com/shorts/rare',
            Region: 'US',
            Mentions: 'true',
            Citations: 'true',
          },
        ],
      });

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
    });
  });

  describe('Top Cited URLs', () => {
    it('should add non-offsite URLs to URL store with cited-analysis audit type', async () => {
      stubBrandPresenceData(['https://example.com/page1;https://other.com/page2']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      expect(createCalls).to.have.lengthOf(2);
      for (const call of createCalls) {
        expect(call.args[0].audits).to.deep.equal(['cited-analysis']);
      }
    });

    it('should exclude offsite domain URLs from top-cited bucket', async () => {
      const sources = 'https://youtube.com/watch?v=abc;https://reddit.com/r/test/;https://en.wikipedia.org/wiki/Adobe;https://example.com/page';
      stubBrandPresenceData([sources]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const topCitedCalls = createCalls.filter((c) => c.args[0].audits[0] === 'cited-analysis');
      expect(topCitedCalls).to.have.lengthOf(1);
      expect(topCitedCalls[0].args[0].url).to.equal('https://example.com/page');
    });

    it('should trigger DRS scraping for top-cited URLs', async () => {
      stubBrandPresenceData(['https://example.com/page1;https://other.com/page2']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const topCitedJob = result.auditResult.drsJobs.find(
        (j) => j.datasetId === SCRAPE_DATASET_IDS.TOP_CITED,
      );
      expect(topCitedJob).to.deep.include({
        domain: 'top-cited',
        datasetId: SCRAPE_DATASET_IDS.TOP_CITED,
        status: 'success',
      });
      expect(mockSubmitScrapeJob).to.have.been.calledWith(sinon.match({
        datasetId: SCRAPE_DATASET_IDS.TOP_CITED,
        siteId: SITE_ID,
        urls: [{ url: 'https://example.com/page1' }, { url: 'https://other.com/page2' }],
      }));
    });

    it('should respect DRS_URLS_LIMIT for top-cited URLs', async () => {
      const urls = [];
      const totalUrls = DRS_URLS_LIMIT + 10;
      for (let i = 0; i < totalUrls; i += 1) {
        urls.push(`https://example${i}.com/page`);
      }
      stubBrandPresenceData([urls.join(';')]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const topCitedCalls = createCalls.filter((c) => c.args[0].audits[0] === 'cited-analysis');
      expect(topCitedCalls).to.have.lengthOf(DRS_URLS_LIMIT);
    });
  });

  describe.skip('Guideline Store Integration', () => {
    function stubWithTopicRows(rows) {
      stubBrandPresenceData(rows);
    }

    it('should create SentimentTopic entities from brand presence data with topics', async () => {
      const rows = [
        {
          Sources: 'https://youtube.com/watch?v=abc;https://example.com/page1',
          Topic: 'BMW XM Latest',
          Category: 'BMW',
          Prompt: 'What is the BMW XM?',
        },
        {
          Sources: 'https://youtube.com/watch?v=abc;https://example.com/page2',
          Topic: 'BMW XM Latest',
          Category: 'BMW',
          Prompt: 'BMW XM review',
        },
      ];
      stubWithTopicRows(rows);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.SentimentTopic.allBySiteId).to.have.been.calledOnceWith(SITE_ID);
      expect(dataAccess.SentimentTopic.create).to.have.been.calledOnce;

      const createArg = dataAccess.SentimentTopic.create.firstCall.args[0];
      expect(createArg.siteId).to.equal(SITE_ID);
      expect(createArg.name).to.equal('BMW XM Latest');
      expect(createArg.description).to.equal('');
      expect(createArg.enabled).to.equal(true);
      expect(createArg.createdBy).to.equal('system');

      const ytUrl = createArg.urls.find((u) => u.url === 'https://youtu.be/abc');
      expect(ytUrl).to.exist;
      expect(ytUrl.timesCited).to.equal(2);
      expect(ytUrl.category).to.equal('BMW');
      expect(ytUrl.subPrompts).to.have.members(['What is the BMW XM?', 'BMW XM review']);

      const page1Url = createArg.urls.find((u) => u.url === 'https://example.com/page1');
      expect(page1Url).to.exist;
      expect(page1Url.timesCited).to.equal(1);
      expect(page1Url.subPrompts).to.deep.equal(['What is the BMW XM?']);
    });

    it('should create multiple topics from different rows', async () => {
      const rows = [
        {
          Sources: 'https://youtube.com/watch?v=abc', Topic: 'Topic A', Category: 'Cat1', Prompt: 'Prompt 1',
        },
        {
          Sources: 'https://reddit.com/r/test/', Topic: 'Topic B', Category: 'Cat2', Prompt: 'Prompt 2',
        },
      ];
      stubWithTopicRows(rows);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.SentimentTopic.create).to.have.been.calledTwice;
      const names = dataAccess.SentimentTopic.create.getCalls().map((c) => c.args[0].name);
      expect(names).to.include('Topic A');
      expect(names).to.include('Topic B');
    });

    it('should update existing topics in place', async () => {
      const mockExistingTopic = {
        getName: () => 'Existing Topic',
        setDescription: sandbox.stub(),
        setUrls: sandbox.stub(),
        setEnabled: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };
      dataAccess.SentimentTopic.allBySiteId.resolves({ data: [mockExistingTopic] });

      stubWithTopicRows([
        {
          Sources: 'https://example.com/page1', Topic: 'Existing Topic', Category: 'Cat1', Prompt: 'Prompt 1',
        },
      ]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(mockExistingTopic.setDescription).to.have.been.calledOnceWith('');
      expect(mockExistingTopic.setUrls).to.have.been.calledOnceWith([
        {
          url: 'https://example.com/page1',
          timesCited: 1,
          category: 'Cat1',
          subPrompts: ['Prompt 1'],
        },
      ]);
      expect(mockExistingTopic.setEnabled).to.have.been.calledOnceWith(true);
      expect(mockExistingTopic.setUpdatedBy).to.have.been.calledOnceWith('system');
      expect(mockExistingTopic.save).to.have.been.calledOnce;
      expect(dataAccess.SentimentTopic.create).to.not.have.been.called;
    });

    it('should load existing topics across all pages when matching by name', async () => {
      const pageOneTopic = {
        getName: () => 'Other Topic',
        setDescription: sandbox.stub(),
        setUrls: sandbox.stub(),
        setEnabled: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };
      const pagedTopic = {
        getName: () => 'Paged Topic',
        setDescription: sandbox.stub(),
        setUrls: sandbox.stub(),
        setEnabled: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };
      dataAccess.SentimentTopic.allBySiteId
        .onFirstCall()
        .resolves({ data: [pageOneTopic], cursor: 'next-page' });
      dataAccess.SentimentTopic.allBySiteId
        .onSecondCall()
        .resolves({ data: [pagedTopic], cursor: null });

      stubWithTopicRows([
        {
          Sources: 'https://example.com/page1', Topic: 'Paged Topic', Category: 'Cat1', Prompt: 'Prompt 1',
        },
      ]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.SentimentTopic.allBySiteId.firstCall).to.have.been.calledWithExactly(SITE_ID, {});
      expect(dataAccess.SentimentTopic.allBySiteId.secondCall).to.have.been.calledWithExactly(SITE_ID, { cursor: 'next-page' });
      expect(pageOneTopic.save).to.not.have.been.called;
      expect(pagedTopic.setDescription).to.have.been.calledOnceWith('');
      expect(pagedTopic.setEnabled).to.have.been.calledOnceWith(true);
      expect(pagedTopic.setUpdatedBy).to.have.been.calledOnceWith('system');
      expect(pagedTopic.save).to.have.been.calledOnce;
      expect(dataAccess.SentimentTopic.create).to.not.have.been.called;
    });

    it('should deduplicate subPrompts across providers', async () => {
      const sharedPrompt = 'What is the BMW XM?';
      const rows = [
        {
          Sources: 'https://example.com/page1', Topic: 'BMW XM', Category: 'BMW', Prompt: sharedPrompt,
        },
        {
          Sources: 'https://example.com/page1', Topic: 'BMW XM', Category: 'BMW', Prompt: sharedPrompt,
        },
      ];
      stubWithTopicRows(rows);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createArg = dataAccess.SentimentTopic.create.firstCall.args[0];
      expect(createArg.urls[0].subPrompts).to.deep.equal([sharedPrompt]);
    });

    it('should use global timesCited count from allUrls', async () => {
      const rows = [
        {
          Sources: 'https://example.com/shared', Topic: 'Topic A', Category: 'Cat1', Prompt: 'Prompt 1',
        },
        {
          Sources: 'https://example.com/shared', Topic: 'Topic B', Category: 'Cat2', Prompt: 'Prompt 2',
        },
        { Sources: 'https://example.com/shared' },
      ];
      stubWithTopicRows(rows);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const createCalls = dataAccess.SentimentTopic.create.getCalls();
      for (const call of createCalls) {
        const urlEntry = call.args[0].urls.find((u) => u.url === 'https://example.com/shared');
        expect(urlEntry.timesCited).to.equal(3);
      }
    });

    it('should skip topic creation when no topics are present in data', async () => {
      stubBrandPresenceData(['https://youtube.com/watch?v=abc']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.SentimentTopic.allBySiteId).to.not.have.been.called;
      expect(dataAccess.SentimentTopic.create).to.not.have.been.called;
    });

    it('should handle topic create failure gracefully', async () => {
      dataAccess.SentimentTopic.create.rejects(new Error('DynamoDB error'));
      stubWithTopicRows([
        {
          Sources: 'https://example.com/page1', Topic: 'Failing Topic', Category: 'Cat1', Prompt: 'Prompt 1',
        },
      ]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to save topic Failing Topic/),
      );
    });

    it('should handle topic save failure gracefully for existing topics', async () => {
      const mockExistingTopic = {
        getName: () => 'Existing Topic',
        setDescription: sandbox.stub(),
        setUrls: sandbox.stub(),
        setEnabled: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().rejects(new Error('DynamoDB error')),
      };
      dataAccess.SentimentTopic.allBySiteId.resolves({ data: [mockExistingTopic] });
      stubWithTopicRows([
        {
          Sources: 'https://example.com/page1', Topic: 'Existing Topic', Category: 'Cat1', Prompt: 'Prompt 1',
        },
      ]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(mockExistingTopic.save).to.have.been.calledOnce;
      expect(dataAccess.SentimentTopic.create).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to save topic Existing Topic/),
      );
    });

    it('should handle allBySiteId returning result with no data property', async () => {
      dataAccess.SentimentTopic.allBySiteId.resolves({});
      stubWithTopicRows([
        {
          Sources: 'https://example.com/page1', Topic: 'New Topic', Category: 'Cat1', Prompt: 'Prompt 1',
        },
      ]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(dataAccess.SentimentTopic.create).to.have.been.calledOnce;
      expect(dataAccess.SentimentTopic.create.firstCall.args[0].name).to.equal('New Topic');
    });

    it('should skip topic when all its URLs are invalid', async () => {
      stubWithTopicRows([
        {
          Sources: 'not-a-valid-url;also-not-valid', Topic: 'Empty Topic', Category: 'Cat', Prompt: 'Prompt',
        },
      ]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(dataAccess.SentimentTopic.allBySiteId).to.not.have.been.called;
      expect(dataAccess.SentimentTopic.create).to.not.have.been.called;
    });

    it('should skip rows without Topic field for topic tracking but still count URLs', async () => {
      stubWithTopicRows([
        {
          Sources: 'https://youtube.com/watch?v=abc', Topic: 'My Topic', Category: 'Cat', Prompt: 'Prompt A',
        },
        { Sources: 'https://youtube.com/watch?v=abc' },
      ]);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(dataAccess.SentimentTopic.create).to.have.been.calledOnce;
      const createArg = dataAccess.SentimentTopic.create.firstCall.args[0];
      expect(createArg.urls[0].timesCited).to.equal(2);
      expect(createArg.urls[0].subPrompts).to.deep.equal(['Prompt A']);
    });
  });

  describe('DRS Scraping', () => {
    it('should trigger DRS jobs for youtube (2 datasets) and reddit (2 datasets)', async () => {
      const urls = 'https://youtube.com/shorts/v1;https://reddit.com/r/test/';
      stubBrandPresenceData([urls]);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.drsJobs).to.have.lengthOf(4);
      expect(result.auditResult.drsJobs[0]).to.deep.include({
        domain: 'youtube.com',
        datasetId: SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS,
        status: 'success',
      });
      expect(result.auditResult.drsJobs[1]).to.deep.include({
        domain: 'youtube.com',
        datasetId: SCRAPE_DATASET_IDS.YOUTUBE_COMMENTS,
        status: 'success',
      });
      expect(result.auditResult.drsJobs[2]).to.deep.include({
        domain: 'reddit.com',
        datasetId: SCRAPE_DATASET_IDS.REDDIT_POSTS,
        status: 'success',
      });
      expect(result.auditResult.drsJobs[3]).to.deep.include({
        domain: 'reddit.com',
        datasetId: SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
        status: 'success',
      });
    });

    it('should call submitScrapeJob with correct params', async () => {
      stubBrandPresenceData(['https://youtube.com/watch?v=x']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const videosCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS,
      );
      expect(videosCall).to.exist;
      expect(videosCall.args[0]).to.deep.include({
        datasetId: SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS,
        siteId: SITE_ID,
      });
      expect(videosCall.args[0].urls).to.deep.equal(['https://youtu.be/x']);
      expect(videosCall.args[0]).to.not.have.property('daysBack');
    });

    it('should include daysBack for reddit_comments', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      const commentsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      );
      expect(commentsCall).to.exist;
      expect(commentsCall.args[0].daysBack).to.equal(REDDIT_COMMENTS_DAYS_BACK);

      const postsCall = mockSubmitScrapeJob.getCalls().find(
        (c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_POSTS,
      );
      expect(postsCall).to.exist;
      expect(postsCall.args[0]).to.not.have.property('daysBack');
    });

    it('should call submitScrapeJob with wikipedia dataset for wikipedia URLs', async () => {
      stubBrandPresenceData(['https://en.wikipedia.org/wiki/Adobe']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(mockSubmitScrapeJob).to.have.been.calledOnce;
      expect(mockSubmitScrapeJob.firstCall.args[0]).to.deep.include({
        datasetId: SCRAPE_DATASET_IDS.WIKIPEDIA,
        siteId: SITE_ID,
      });
      expect(mockSubmitScrapeJob.firstCall.args[0].urls[0]).to.include('wikipedia.org');
    });

    it('should handle DRS API returning error response', async () => {
      mockSubmitScrapeJob.rejects(new Error('DRS POST /jobs failed: 503 - Service Unavailable'));

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].error).to.include('503');
      expect(log.error).to.have.been.calledWith(
        sinon.match(/DRS job failed/),
      );
    });

    it('should handle DRS network error gracefully', async () => {
      mockSubmitScrapeJob.rejects(new Error('DNS resolution failed'));

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.have.lengthOf(2);
      expect(result.auditResult.drsJobs[0].status).to.equal('error');
      expect(result.auditResult.drsJobs[0].error).to.equal('DNS resolution failed');
    });

    it('should skip DRS when not configured', async () => {
      mockDrsIsConfigured.returns(false);

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.drsJobs).to.deep.equal([]);
      expect(mockSubmitScrapeJob).to.not.have.been.called;
      expect(log.error).to.have.been.calledWith(
        sinon.match(/DRS_API_URL or DRS_API_KEY not configured/),
      );
    });

  });

  describe('Slack Notifications', () => {
    const SLACK_CHANNEL_ID = 'C-test-channel';
    const SLACK_THREAD_TS = '1700000000.123456';
    const AUDIT_CONTEXT_WITH_SLACK = {
      slackContext: { channelId: SLACK_CHANNEL_ID, threadTs: SLACK_THREAD_TS },
    };

    it('should send a Slack thread reply with DRS job IDs when slackContext is provided', async () => {
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const [callCtx, callChannelId, callText, callOptions] = mockPostMessageOptional.firstCall.args;
      expect(callCtx).to.equal(context);
      expect(callChannelId).to.equal(SLACK_CHANNEL_ID);
      expect(callOptions).to.deep.equal({ threadTs: SLACK_THREAD_TS });
      expect(callText).to.include('offsite-brand-presence');
      expect(callText).to.include(BASE_URL);
      expect(callText).to.include('youtube.com');
      expect(callText).to.include('mock-job');
      expect(callText).to.not.include(':x:');
    });

    it('should include each triggered domain in the Slack thread message', async () => {
      stubBrandPresenceData(['https://reddit.com/r/adobe/comments/xyz123/a-reddit-post']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include('reddit.com');
      expect(callText).to.include('mock-job');
      expect(callText).to.not.include(':x:');
    });

    it('should include a failed jobs section in the Slack message when some DRS jobs fail', async () => {
      mockSubmitScrapeJob
        .onFirstCall().rejects(new Error('DRS timeout'))
        .onSecondCall().resolves({ job_id: 'mock-job' });

      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const callText = mockPostMessageOptional.firstCall.args[2];
      expect(callText).to.include(':x:');
      expect(callText).to.include('Failed (1)');
      expect(callText).to.include('DRS timeout');
      expect(callText).to.include('youtube.com');
      expect(callText).to.include('mock-job');
    });

    it('should not send a Slack message when no DRS jobs are triggered', async () => {
      mockDrsIsConfigured.returns(false);
      stubBrandPresenceData(['https://youtube.com/shorts/v1']);

      await offsiteBrandPresenceRunner(FINAL_URL, context, site, AUDIT_CONTEXT_WITH_SLACK);

      expect(mockPostMessageOptional).to.not.have.been.called;
    });
  });

  describe('Full Integration Flow', () => {
    it('should complete full audit with URLs from multiple domains', async () => {
      const sources = [
        'https://www.youtube.com/watch?v=abc;https://reddit.com/r/adobe/post1',
        'https://youtube.com/watch?v=def;https://example.com/unrelated;https://en.wikipedia.org/wiki/Adobe',
      ];
      stubBrandPresenceData(sources);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.urlCounts['youtube.com']).to.equal(2);
      expect(result.auditResult.urlCounts['reddit.com']).to.equal(1);
      expect(result.auditResult.urlCounts['wikipedia.org']).to.equal(1);
      expect(result.auditResult.drsJobs).to.have.lengthOf(6);
      expect(result.fullAuditRef).to.equal(FINAL_URL);

      const createCalls = dataAccess.AuditUrl.create.getCalls();
      const topCitedCalls = createCalls.filter((c) => c.args[0].audits[0] === 'cited-analysis');
      expect(topCitedCalls).to.have.lengthOf(1);
      expect(topCitedCalls[0].args[0].url).to.equal('https://example.com/unrelated');

      const topCitedJob = result.auditResult.drsJobs.find((j) => j.datasetId === SCRAPE_DATASET_IDS.TOP_CITED);
      expect(topCitedJob).to.deep.include({
        domain: 'top-cited',
        datasetId: SCRAPE_DATASET_IDS.TOP_CITED,
        status: 'success',
      });
    });

    it('should include both previous weeks in the audit result', async () => {
      mockGetPreviousWeeks.returns([
        { week: 5, year: DEFAULT_YEAR },
        { week: 4, year: DEFAULT_YEAR },
      ]);
      mockLoadBrandPresenceData.resolves(null);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.weeks).to.deep.equal([
        { week: 5, year: DEFAULT_YEAR },
        { week: 4, year: DEFAULT_YEAR },
      ]);
    });

    it('should handle year boundary when previous weeks span two years', async () => {
      mockGetPreviousWeeks.returns([
        { week: 1, year: 2026 },
        { week: 52, year: 2025 },
      ]);
      stubBrandPresenceData(['https://youtube.com/shorts/x']);

      const result = await offsiteBrandPresenceRunner(FINAL_URL, context, site);

      expect(result.auditResult.weeks).to.deep.equal([
        { week: 1, year: 2026 },
        { week: 52, year: 2025 },
      ]);
    });
  });
});
