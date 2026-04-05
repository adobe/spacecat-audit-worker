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

/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { SCRAPE_DATASET_IDS } from '@adobe/spacecat-shared-drs-client';
import { MockContextBuilder } from '../../shared.js';
import { OFFSITE_DOMAINS, REDDIT_COMMENTS_DAYS_BACK } from '../../../src/offsite-brand-presence/constants.js';

use(sinonChai);
use(chaiAsPromised);

const WIKI_AUDIT_TYPE = OFFSITE_DOMAINS['wikipedia.org'].auditType;
const YOUTUBE_AUDIT_TYPE = OFFSITE_DOMAINS['youtube.com'].auditType;
const REDDIT_AUDIT_TYPE = OFFSITE_DOMAINS['reddit.com'].auditType;

describe('Offsite Competitor Analysis Guidance Handler', () => {
  let sandbox;
  let context;
  let guidanceHandler;
  let mockDrsClient;
  let mockAuditUrlCreate;

  const siteId = 'test-site-id';

  const mockCompetitors = [
    {
      name: 'Rival Inc',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Rival_Inc',
      youtubeUrls: [
        'https://www.youtube.com/watch?v=abc123',
        'https://www.youtube.com/watch?v=def456',
      ],
      redditUrls: [
        'https://www.reddit.com/r/tech/comments/rival',
      ],
    },
    {
      name: 'Contender LLC',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Contender_LLC',
      youtubeUrls: [],
      redditUrls: [
        'https://www.reddit.com/r/business/comments/contender',
      ],
    },
  ];

  const makeMessage = (competitors) => ({
    siteId,
    data: { competitorProfile: { competitors } },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockDrsClient = {
      isConfigured: sandbox.stub().returns(true),
      submitScrapeJob: sandbox.stub().resolves({ job_id: 'job-123' }),
    };

    mockAuditUrlCreate = sandbox.stub().resolves();

    guidanceHandler = await esmock(
      '../../../src/offsite-competitor-analysis/guidance-handler.js',
      {
        '@adobe/spacecat-shared-drs-client': {
          default: {
            createFrom: sandbox.stub().returns(mockDrsClient),
          },
          SCRAPE_DATASET_IDS,
        },
      },
    );

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          AuditUrl: {
            create: mockAuditUrlCreate,
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Message Validation', () => {
    it('should return noContent when competitors array is empty', async () => {
      const response = await guidanceHandler.default(makeMessage([]), context);

      expect(response.status).to.equal(204);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No competitors found/),
      );
    });

    it('should return noContent when competitors data is missing at any level', async () => {
      const cases = [
        { siteId, data: { competitorProfile: {} } },
        { siteId, data: {} },
        { siteId },
        { siteId, data: null },
      ];

      for (const message of cases) {
        // eslint-disable-next-line no-await-in-loop
        const response = await guidanceHandler.default(message, context);
        expect(response.status).to.equal(204);
      }
    });

    it('should return noContent when no URLs are found in competitor data', async () => {
      const response = await guidanceHandler.default(
        makeMessage([{ name: 'No URLs Competitor' }]),
        context,
      );

      expect(response.status).to.equal(204);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No URLs found in competitor data/),
      );
    });
  });

  describe('URL Extraction', () => {
    it('should extract Wikipedia, YouTube, and Reddit URLs from competitors', async () => {
      await guidanceHandler.default(makeMessage(mockCompetitors), context);

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Extracted 6 URLs: 2 wikipedia, 2 youtube, 2 reddit/),
      );
    });

    it('should skip null or falsy URLs', async () => {
      const message = makeMessage([{
        name: 'Partial',
        wikipediaUrl: null,
        youtubeUrls: [null, '', 'https://youtube.com/valid'],
        redditUrls: [null],
      }]);

      await guidanceHandler.default(message, context);

      expect(mockAuditUrlCreate).to.have.been.calledOnce;
      expect(mockAuditUrlCreate).to.have.been.calledWith(
        sinon.match({ url: 'https://youtube.com/valid' }),
      );
    });

    it('should handle null entries and competitors without URL fields', async () => {
      const message = makeMessage([
        null,
        { name: 'Bare Competitor' },
        { name: 'Wiki Only', wikipediaUrl: 'https://en.wikipedia.org/wiki/Test' },
      ]);

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(200);
      expect(mockAuditUrlCreate).to.have.been.calledOnce;
    });

    it('should not deduplicate same URL across competitors', async () => {
      const sharedUrl = 'https://en.wikipedia.org/wiki/Shared';
      const message = makeMessage([
        { name: 'A', wikipediaUrl: sharedUrl },
        { name: 'B', wikipediaUrl: sharedUrl },
      ]);

      await guidanceHandler.default(message, context);

      expect(mockAuditUrlCreate).to.have.been.calledTwice;
    });
  });

  describe('URL Store', () => {
    it('should create AuditUrl entries with correct audit types and metadata', async () => {
      await guidanceHandler.default(makeMessage(mockCompetitors), context);

      const calls = mockAuditUrlCreate.getCalls();
      const createdUrls = calls.map((c) => c.args[0]);

      expect(createdUrls.filter((u) => u.audits.includes(WIKI_AUDIT_TYPE))).to.have.lengthOf(2);
      expect(createdUrls.filter((u) => u.audits.includes(YOUTUBE_AUDIT_TYPE))).to.have.lengthOf(2);
      expect(createdUrls.filter((u) => u.audits.includes(REDDIT_AUDIT_TYPE))).to.have.lengthOf(2);

      for (const entry of createdUrls) {
        expect(entry).to.include({
          siteId,
          byCustomer: false,
          createdBy: 'system',
          updatedBy: 'system',
        });
      }
    });

    it('should handle AuditUrl.create failures gracefully and log counts', async () => {
      mockAuditUrlCreate
        .onFirstCall().rejects(new Error('Duplicate'))
        .onSecondCall().resolves();

      const message = makeMessage([{
        name: 'Test',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Test1',
        youtubeUrls: ['https://youtube.com/watch?v=test'],
      }]);

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(200);
      expect(context.log.warn).to.have.been.calledWith(sinon.match(/Failed to add URL to store/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/1 created, 1 failed/));

      mockAuditUrlCreate.reset();
      mockAuditUrlCreate.rejects(new Error('DB down'));

      await guidanceHandler.default(message, context);
      expect(context.log.info).to.have.been.calledWith(sinon.match(/0 created, 2 failed/));
    });
  });

  describe('DRS Scraping', () => {
    it('should submit all 5 DRS jobs with correct params for a competitor with all platform URLs', async () => {
      const message = makeMessage([{
        name: 'Full',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Full',
        youtubeUrls: ['https://youtube.com/watch?v=1'],
        redditUrls: ['https://reddit.com/r/full'],
      }]);

      await guidanceHandler.default(message, context);

      expect(mockDrsClient.submitScrapeJob.callCount).to.equal(5);
      const submitCalls = mockDrsClient.submitScrapeJob.getCalls();
      const datasetIds = submitCalls.map((c) => c.args[0].datasetId);
      expect(datasetIds).to.include.members([
        SCRAPE_DATASET_IDS.WIKIPEDIA,
        SCRAPE_DATASET_IDS.YOUTUBE_VIDEOS,
        SCRAPE_DATASET_IDS.YOUTUBE_COMMENTS,
        SCRAPE_DATASET_IDS.REDDIT_POSTS,
        SCRAPE_DATASET_IDS.REDDIT_COMMENTS,
      ]);

      for (const call of submitCalls) {
        expect(call.args[0]).to.have.property('siteId', siteId);
        expect(call.args[0].urls).to.be.an('array').with.lengthOf(1);
      }

      const redditCommentsCall = submitCalls.find((c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS);
      expect(redditCommentsCall.args[0].daysBack).to.equal(REDDIT_COMMENTS_DAYS_BACK);

      const wikiCall = submitCalls.find((c) => c.args[0].datasetId === SCRAPE_DATASET_IDS.WIKIPEDIA);
      expect(wikiCall.args[0]).to.not.have.property('daysBack');
    });

    it('should skip DRS when not configured', async () => {
      mockDrsClient.isConfigured.returns(false);

      const response = await guidanceHandler.default(makeMessage(mockCompetitors), context);

      expect(response.status).to.equal(200);
      expect(mockDrsClient.submitScrapeJob).to.not.have.been.called;
      expect(context.log.error).to.have.been.calledWith(sinon.match(/DRS not configured/));
    });

    it('should handle DRS job submission failures gracefully', async () => {
      mockDrsClient.submitScrapeJob
        .onFirstCall().resolves({ job_id: 'ok-job' })
        .onSecondCall().rejects(new Error('DRS unavailable'));

      const message = makeMessage([{
        name: 'Test',
        youtubeUrls: ['https://youtube.com/watch?v=test'],
      }]);

      const response = await guidanceHandler.default(message, context);

      expect(response.status).to.equal(200);
      expect(context.log.error).to.have.been.calledWith(sinon.match(/DRS job failed/));
    });

    it('should only submit DRS jobs for platforms that have stored URLs', async () => {
      mockAuditUrlCreate
        .onFirstCall().resolves()
        .onSecondCall().rejects(new Error('fail'));

      const message = makeMessage([{
        name: 'Test',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Test',
        redditUrls: ['https://reddit.com/r/test'],
      }]);

      await guidanceHandler.default(message, context);

      const platforms = mockDrsClient.submitScrapeJob.getCalls().map((c) => c.args[0].datasetId);
      expect(platforms).to.include(SCRAPE_DATASET_IDS.WIKIPEDIA);
      expect(platforms).to.not.include(SCRAPE_DATASET_IDS.REDDIT_POSTS);
      expect(platforms).to.not.include(SCRAPE_DATASET_IDS.REDDIT_COMMENTS);

      mockAuditUrlCreate.reset();
      mockAuditUrlCreate.rejects(new Error('All failed'));
      await guidanceHandler.default(
        makeMessage([{ name: 'X', wikipediaUrl: 'https://en.wikipedia.org/wiki/X' }]),
        context,
      );
      expect(mockDrsClient.submitScrapeJob).to.have.callCount(1);
    });
  });
});
