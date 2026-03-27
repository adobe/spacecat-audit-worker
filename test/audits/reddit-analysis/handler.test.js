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
import chaiAsPromised from 'chai-as-promised';
import {
  MYSTIQUE_URLS_LIMIT,
  URL_TYPES,
  resolveMystiqueUrlLimit as realResolveMystiqueUrlLimit,
} from '../../../src/utils/store-client.js';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Reddit Analysis Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockStoreClient;
  let mockComputeTopicsFromBrandPresence;
  let redditAnalysisHandler;
  let StoreEmptyError;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';

  const mockUrls = [
    { url: 'https://reddit.com/r/example/comments/abc', type: 'reddit', metadata: {} },
    { url: 'https://reddit.com/r/example/comments/def', type: 'reddit', metadata: {} },
  ];

  const mockComputedTopics = [
    {
      name: 'Community Sentiment',
      urls: [
        {
          url: 'https://reddit.com/r/example/comments/abc',
          timesCited: 1,
          category: 'general',
          subPrompts: ['brand mentions'],
        },
      ],
    },
  ];

  const expectedSentimentConfig = { topics: mockComputedTopics, guidelines: [] };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    StoreEmptyError = class extends Error {
      constructor(storeName, siteIdParam, details = '') {
        super(`${storeName} returned empty results for siteId: ${siteIdParam}${details ? `. ${details}` : ''}`);
        this.name = 'StoreEmptyError';
        this.storeName = storeName;
        this.siteId = siteIdParam;
      }
    };

    mockComputeTopicsFromBrandPresence = sandbox.stub().resolves(mockComputedTopics);

    mockStoreClient = {
      getUrls: sandbox.stub().resolves(mockUrls),
    };

    const mockStoreClientClass = {
      createFrom: sandbox.stub().returns(mockStoreClient),
    };

    redditAnalysisHandler = await esmock('../../../src/reddit-analysis/handler.js', {
      '../../../src/utils/store-client.js': {
        default: mockStoreClientClass,
        StoreEmptyError,
        URL_TYPES,
        MYSTIQUE_URLS_LIMIT,
        resolveMystiqueUrlLimit: realResolveMystiqueUrlLimit,
      },
      '../../../src/utils/brand-presence-enrichment.js': {
        computeTopicsFromBrandPresence: mockComputeTopicsFromBrandPresence,
      },
    });

    mockSite = {
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().returns(baseURL),
      getOrganizationId: sandbox.stub().returns('org-123'),
      getDeliveryType: sandbox.stub().returns('aem_edge'),
      getConfig: sandbox.stub().returns({
        getCompanyName: sandbox.stub().returns('Example Corp'),
        getCompetitors: sandbox.stub().returns(['Competitor A', 'Competitor B']),
        getCompetitorRegion: sandbox.stub().returns('US'),
        getIndustry: sandbox.stub().returns('Technology'),
        getBrandKeywords: sandbox.stub().returns(['example', 'corp']),
      }),
    };

    mockAudit = {
      getId: sandbox.stub().returns(auditId),
      getFullAuditRef: sandbox.stub().returns(`${baseURL}/audit-ref`),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        audit: mockAudit,
        finalUrl: baseURL,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
          STORE_API_BASE_URL: 'https://store-api.example.com',
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves(mockSite),
          },
          Configuration: {
            findLatest: sandbox.stub().resolves({ isHandlerEnabledForSite: sandbox.stub().returns(true), getHandlers: sandbox.stub().returns({}) }),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Handler Export', () => {
    it('should export a valid audit handler', () => {
      expect(redditAnalysisHandler.default).to.be.an('object');
      expect(redditAnalysisHandler.default).to.have.property('runner');
      expect(redditAnalysisHandler.default.runner).to.be.a('function');
    });

    it('should have URL resolver configured', () => {
      expect(redditAnalysisHandler.default).to.have.property('urlResolver');
      expect(redditAnalysisHandler.default.urlResolver).to.be.a('function');
    });

    it('should have post processors configured', () => {
      expect(redditAnalysisHandler.default).to.have.property('postProcessors');
      expect(redditAnalysisHandler.default.postProcessors).to.be.an('array');
      expect(redditAnalysisHandler.default.postProcessors).to.have.lengthOf(1);
    });
  });

  describe('runRedditAnalysisAudit (via runner)', () => {
    it('temporary test hook: returns Test only after store fetch (pending_analysis path disabled in handler)', async () => {
      const result = await redditAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Test only');
      expect(result.fullAuditRef).to.equal(baseURL);
      expect(mockStoreClient.getUrls).to.have.been.calledWith(siteId, 'reddit-analysis');
      expect(mockComputeTopicsFromBrandPresence).to.have.been.calledWith(siteId, context);
    });

    it('should call StoreClient and compute topics from brand presence', async () => {
      await redditAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(mockStoreClient.getUrls).to.have.been.calledWith(siteId, 'reddit-analysis');
      expect(mockComputeTopicsFromBrandPresence).to.have.been.calledWith(siteId, context);
    });

    it('should log auditContext and mystiqueUrlLimit', async () => {
      await redditAnalysisHandler.default.runner(baseURL, context, mockSite, { messageData: { urlLimit: '3' } });

      expect(context.log.info).to.have.been.calledWith('[Reddit] auditContext: {"messageData":{"urlLimit":"3"}}');
      expect(context.log.info).to.have.been.calledWith('[Reddit] mystiqueUrlLimit=3 (URLs sent to Mystique)');
    });

    it('should log debug payload for brand-presence topics', async () => {
      await redditAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(context.log.debug).to.have.been.calledWith(
        `[Reddit] Brand-presence topics payload: ${JSON.stringify(mockComputedTopics)}`,
      );
    });

    it('should return error when urlStore returns empty', async () => {
      mockStoreClient.getUrls.rejects(new StoreEmptyError('urlStore', siteId, 'No reddit-analysis URLs found'));

      const result = await redditAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('urlStore returned empty results');
      expect(result.auditResult.storeName).to.equal('urlStore');
      expect(context.log.error).to.have.been.called;
    });

    it('temporary test hook: returns Test only when brand presence returns no topics', async () => {
      mockComputeTopicsFromBrandPresence.resolves([]);

      const result = await redditAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Test only');
      expect(context.log.debug).to.have.been.calledWith('[Reddit] Brand-presence topics payload: []');
    });

    it('should return error when company name is not configured', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(''),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
        getIndustry: sandbox.stub().returns(null),
        getBrandKeywords: sandbox.stub().returns([]),
      });
      mockSite.getBaseURL.returns('');

      const result = await redditAnalysisHandler.default.runner('', context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('No company name configured for this site');
      expect(context.log.warn).to.have.been.called;
    });

    it('should use baseURL as companyName before temporary test hook exit', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(null),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
        getIndustry: sandbox.stub().returns(null),
        getBrandKeywords: sandbox.stub().returns([]),
      });
      mockSite.getBaseURL.returns('https://bmw.com');

      const result = await redditAnalysisHandler.default.runner('https://bmw.com', context, mockSite);

      expect(context.log.info).to.have.been.calledWith(
        '[Reddit] Config: companyName=https://bmw.com, website=https://bmw.com',
      );
      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Test only');
    });

    it('should handle missing config and use baseURL before temporary test hook exit', async () => {
      mockSite.getConfig.returns(null);
      mockSite.getBaseURL.returns('https://test-company.com');

      const result = await redditAnalysisHandler.default.runner('https://test-company.com', context, mockSite);

      expect(context.log.info).to.have.been.calledWith(
        '[Reddit] Config: companyName=https://test-company.com, website=https://test-company.com',
      );
      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Test only');
    });

    it('should handle general errors during execution', async () => {
      mockSite.getConfig.throws(new Error('Config error'));

      const result = await redditAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Config error');
      expect(context.log.error).to.have.been.called;
    });
  });

  describe('Post Processor - sendMystiqueMessagePostProcessor', () => {
    it('should send message to Mystique queue with all store data when audit is successful', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: true,
          status: 'pending_analysis',
          mystiqueUrlLimit: MYSTIQUE_URLS_LIMIT,
          config: {
            companyName: 'Example Corp',
            companyWebsite: baseURL,
            competitors: ['Competitor A'],
            competitorRegion: 'US',
            industry: 'Technology',
            brandKeywords: ['example'],
          },
          storeData: {
            urls: mockUrls,
            sentimentConfig: expectedSentimentConfig,
          },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique',
        sinon.match({
          type: 'guidance:reddit-analysis',
          siteId,
          url: baseURL,
          auditId,
          deliveryType: 'aem_edge',
          data: sinon.match({
            companyName: 'Example Corp',
            companyWebsite: baseURL,
            competitors: ['Competitor A'],
            competitorRegion: 'US',
            industry: 'Technology',
            brandKeywords: ['example'],
            topics: mockComputedTopics,
            guidelines: [],
          }),
        }),
      );
      const sent = context.sqs.sendMessage.firstCall.args[1];
      expect(sent.data.urls).to.have.lengthOf(mockUrls.length);
      expect(sent.data.urls[0]).to.include({ url: mockUrls[0].url, type: mockUrls[0].type });
      expect(sent.data.urls[0].timesCited).to.equal(1);
    });

    it('should limit URLs sent to Mystique to MYSTIQUE_URLS_LIMIT', async () => {
      const manyUrls = Array.from({ length: MYSTIQUE_URLS_LIMIT + 30 }, (_, i) => ({
        url: `https://reddit.com/r/test/page-${i}`, type: 'reddit-analysis', metadata: {},
      }));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          mystiqueUrlLimit: MYSTIQUE_URLS_LIMIT,
          config: { companyName: 'Test' },
          storeData: {
            urls: manyUrls,
            sentimentConfig: { topics: [], guidelines: [] },
          },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(MYSTIQUE_URLS_LIMIT);
    });

    it('should limit URLs to mystiqueUrlLimit when set below cap', async () => {
      const manyUrls = Array.from({ length: 20 }, (_, i) => ({
        url: `https://reddit.com/r/test/page-${i}`, type: 'reddit-analysis', metadata: {},
      }));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          mystiqueUrlLimit: 4,
          config: { companyName: 'Test' },
          storeData: {
            urls: manyUrls,
            sentimentConfig: { topics: [], guidelines: [] },
          },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(4);
    });

    it('should fall back to MYSTIQUE_URLS_LIMIT when mystiqueUrlLimit is absent', async () => {
      const manyUrls = Array.from({ length: MYSTIQUE_URLS_LIMIT + 5 }, (_, i) => ({
        url: `https://reddit.com/r/test/page-${i}`, type: 'reddit-analysis', metadata: {},
      }));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: {
            urls: manyUrls,
            sentimentConfig: { topics: [], guidelines: [] },
          },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(MYSTIQUE_URLS_LIMIT);
    });

    it('should skip sending message when audit failed', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: false,
          error: 'urlStore returned empty results',
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith('[Reddit] Audit failed, skipping Mystique message');
    });

    it('should skip sending message when SQS is not configured', async () => {
      context.sqs = null;

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          mystiqueUrlLimit: MYSTIQUE_URLS_LIMIT,
          config: { companyName: 'Test' },
          storeData: { urls: [], sentimentConfig: { topics: [], guidelines: [] } },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[Reddit] SQS or Mystique queue not configured, skipping message');
    });

    it('should skip sending message when queue env is not set', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          mystiqueUrlLimit: MYSTIQUE_URLS_LIMIT,
          config: { companyName: 'Test' },
          storeData: { urls: [], sentimentConfig: { topics: [], guidelines: [] } },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
    });

    it('should skip sending message when site not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const auditData = {
        siteId: 'non-existent-site',
        auditResult: {
          success: true,
          mystiqueUrlLimit: MYSTIQUE_URLS_LIMIT,
          config: { companyName: 'Test' },
          storeData: { urls: [], sentimentConfig: { topics: [], guidelines: [] } },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[Reddit] Site not found, skipping Mystique message');
    });

    it('should throw error when SQS send fails', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          mystiqueUrlLimit: MYSTIQUE_URLS_LIMIT,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfig },
        },
      };

      const postProcessor = redditAnalysisHandler.default.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('SQS Error');
      expect(context.log.error).to.have.been.calledWith('[Reddit] Failed to send Mystique message: SQS Error');
    });
  });
});
