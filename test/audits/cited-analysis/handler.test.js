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
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Cited Analysis Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockStoreClient;
  let citedAnalysisHandler;
  let StoreEmptyError;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';

  const mockUrls = [
    { url: 'https://techblog.example.com/review-of-example', type: 'cited-analysis', metadata: {} },
    { url: 'https://news.example.com/example-corp-article', type: 'cited-analysis', metadata: {} },
  ];

  const mockSentimentConfig = {
    topics: [
      { topicId: 'topic-1', name: 'Brand Perception', subPrompts: ['brand mentions', 'sentiment'] },
    ],
    guidelines: [
      { guidelineId: 'guide-1', name: 'Cited Analysis Best Practices', instruction: 'Focus on LLM citability', audits: ['cited-analysis'] },
    ],
  };

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

    mockStoreClient = {
      getUrls: sandbox.stub().resolves(mockUrls),
      getGuidelines: sandbox.stub().resolves(mockSentimentConfig),
    };

    const mockStoreClientClass = {
      createFrom: sandbox.stub().returns(mockStoreClient),
    };

    citedAnalysisHandler = await esmock('../../../src/cited-analysis/handler.js', {
      '../../../src/utils/store-client.js': {
        default: mockStoreClientClass,
        StoreEmptyError,
        URL_TYPES: {
          WIKIPEDIA: 'wikipedia-analysis',
          REDDIT: 'reddit-analysis',
          YOUTUBE: 'youtube-analysis',
          CITED: 'cited-analysis',
        },
        GUIDELINE_TYPES: {
          WIKIPEDIA_ANALYSIS: 'wikipedia-analysis',
          REDDIT_ANALYSIS: 'reddit-analysis',
          YOUTUBE_ANALYSIS: 'youtube-analysis',
          CITED_ANALYSIS: 'cited-analysis',
        },
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
      expect(citedAnalysisHandler.default).to.be.an('object');
      expect(citedAnalysisHandler.default).to.have.property('runner');
      expect(citedAnalysisHandler.default.runner).to.be.a('function');
    });

    it('should have URL resolver configured', () => {
      expect(citedAnalysisHandler.default).to.have.property('urlResolver');
      expect(citedAnalysisHandler.default.urlResolver).to.be.a('function');
    });

    it('should have post processors configured', () => {
      expect(citedAnalysisHandler.default).to.have.property('postProcessors');
      expect(citedAnalysisHandler.default.postProcessors).to.be.an('array');
      expect(citedAnalysisHandler.default.postProcessors).to.have.lengthOf(1);
    });
  });

  describe('runCitedAnalysisAudit (via runner)', () => {
    it('should return pending_analysis status with config and store data when successful', async () => {
      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.status).to.equal('pending_analysis');
      expect(result.auditResult.config).to.deep.include({
        companyName: 'Example Corp',
        companyWebsite: baseURL,
      });
      expect(result.auditResult.config.competitors).to.deep.equal(['Competitor A', 'Competitor B']);
      expect(result.auditResult.config.competitorRegion).to.equal('US');
      expect(result.auditResult.config.industry).to.equal('Technology');
      expect(result.auditResult.config.brandKeywords).to.deep.equal(['example', 'corp']);

      expect(result.auditResult.storeData).to.exist;
      expect(result.auditResult.storeData.urls).to.deep.equal(mockUrls);
      expect(result.auditResult.storeData.sentimentConfig).to.deep.equal(mockSentimentConfig);

      expect(result.fullAuditRef).to.equal(baseURL);
    });

    it('should call StoreClient with correct parameters', async () => {
      await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(mockStoreClient.getUrls).to.have.been.calledWith(siteId, 'cited-analysis');
      expect(mockStoreClient.getGuidelines).to.have.been.calledWith(siteId, 'cited-analysis');
    });

    it('should succeed with empty guidelines when guidelinesStore is empty', async () => {
      mockStoreClient.getGuidelines.rejects(new StoreEmptyError('guidelinesStore', 'N/A', 'No guidelines found'));

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.storeData.sentimentConfig).to.deep.equal({ topics: [], guidelines: [] });
    });

    it('should re-throw non-StoreEmptyError from getGuidelines', async () => {
      mockStoreClient.getGuidelines.rejects(new Error('Network failure'));

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Network failure');
    });

    it('should return error when urlStore returns empty', async () => {
      mockStoreClient.getUrls.rejects(new StoreEmptyError('urlStore', siteId, 'No top-cited-analysis URLs found'));

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('urlStore returned empty results');
      expect(result.auditResult.storeName).to.equal('urlStore');
      expect(context.log.error).to.have.been.called;
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

      const result = await citedAnalysisHandler.default.runner('', context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('No company name configured for this site');
      expect(context.log.warn).to.have.been.called;
    });

    it('should use baseURL as companyName when company name is not configured', async () => {
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns(null),
        getCompetitors: sandbox.stub().returns([]),
        getCompetitorRegion: sandbox.stub().returns(null),
        getIndustry: sandbox.stub().returns(null),
        getBrandKeywords: sandbox.stub().returns([]),
      });
      mockSite.getBaseURL.returns('https://bmw.com');

      const result = await citedAnalysisHandler.default.runner('https://bmw.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('https://bmw.com');
    });

    it('should handle missing config gracefully and use baseURL', async () => {
      mockSite.getConfig.returns(null);
      mockSite.getBaseURL.returns('https://test-company.com');

      const result = await citedAnalysisHandler.default.runner('https://test-company.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.config.companyName).to.equal('https://test-company.com');
    });

    it('should handle general errors during execution', async () => {
      mockSite.getConfig.throws(new Error('Config error'));

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

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
            sentimentConfig: mockSentimentConfig,
          },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique',
        sinon.match({
          type: 'guidance:cited-analysis',
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
            topics: mockSentimentConfig.topics,
            guidelines: mockSentimentConfig.guidelines,
          }),
        }),
      );
    });

    it('should send raw urls when no topics are available', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: {
            urls: mockUrls,
            sentimentConfig: { topics: [], guidelines: [] },
          },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.deep.equal(mockUrls);
    });

    it('should limit URLs sent to Mystique to MYSTIQUE_URLS_LIMIT', async () => {
      const manyUrls = Array.from({ length: 80 }, (_, i) => ({
        url: `https://example.com/page-${i}`, type: 'cited-analysis', metadata: {},
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

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(50);
    });

    it('should skip sending message when audit failed', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: false,
          error: 'urlStore returned empty results',
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith('[Cited] Audit failed, skipping Mystique message');
    });

    it('should skip sending message when SQS is not configured', async () => {
      context.sqs = null;

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: [], sentimentConfig: { topics: [], guidelines: [] } },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[Cited] SQS or Mystique queue not configured, skipping message');
    });

    it('should skip sending message when queue env is not set', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: [], sentimentConfig: { topics: [], guidelines: [] } },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
    });

    it('should skip sending message when site not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const auditData = {
        siteId: 'non-existent-site',
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: [], sentimentConfig: { topics: [], guidelines: [] } },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[Cited] Site not found, skipping Mystique message');
    });

    it('should throw error when SQS send fails', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: mockSentimentConfig },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('SQS Error');
      expect(context.log.error).to.have.been.calledWith('[Cited] Failed to send Mystique message: SQS Error');
    });
  });
});
