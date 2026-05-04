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
  URL_TYPES,
  GUIDELINE_TYPES,
} from '../../../src/utils/store-client.js';
import {
  DrsNoContentAvailableError,
  MYSTIQUE_URLS_LIMIT,
  resolveMystiqueUrlLimit as realResolveMystiqueUrlLimit,
} from '../../../src/utils/offsite-audit-utils.js';
import { OFFSITE_DOMAINS } from '../../../src/offsite-brand-presence/constants.js';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('YouTube Analysis Handler', () => {
  let sandbox;
  let context;
  let mockSite;
  let mockAudit;
  let mockStoreClient;
  let mockComputeTopicsFromBrandPresence;
  let mockFilterUrlsByDrsStatus;
  let mockDrsClient;
  let youtubeAnalysisHandler;
  let StoreEmptyError;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';

  const mockUrls = [
    { url: 'https://www.youtube.com/watch?v=abc', type: 'youtube', metadata: {} },
    { url: 'https://www.youtube.com/watch?v=Qdef', type: 'youtube', metadata: {} },
  ];

  const mockComputedTopics = [
    {
      name: 'Video Content Quality',
      urls: [
        {
          url: 'https://www.youtube.com/watch?v=abc',
          timesCited: 1,
          category: 'general',
          subPrompts: ['engagement', 'production value'],
        },
      ],
    },
  ];

  const mockGuidelines = [
    { guidelineId: 'guide-1', name: 'YouTube Best Practices', instruction: 'Focus on viewer engagement', audits: ['youtube-analysis'] },
  ];

  /** API shape from getGuidelines; handler uses `guidelines` only; topics come from brand presence. */
  const mockGuidelinesApiResponse = {
    topics: [{ topicId: 'topic-legacy', name: 'Ignored from sentiment API' }],
    guidelines: mockGuidelines,
  };

  const expectedSentimentConfigForPostProcessor = { topics: mockComputedTopics, guidelines: mockGuidelines };

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
    mockFilterUrlsByDrsStatus = sandbox.stub().callsFake(async (urls) => urls);

    mockDrsClient = { isConfigured: sandbox.stub().returns(true) };

    mockStoreClient = {
      getUrls: sandbox.stub().resolves(mockUrls),
      getGuidelines: sandbox.stub().resolves(mockGuidelinesApiResponse),
    };

    const mockStoreClientClass = {
      createFrom: sandbox.stub().returns(mockStoreClient),
    };

    const mockDrsClientClass = {
      createFrom: sandbox.stub().returns(mockDrsClient),
    };

    youtubeAnalysisHandler = await esmock('../../../src/youtube-analysis/handler.js', {
      '@adobe/spacecat-shared-drs-client': {
        default: mockDrsClientClass,
      },
      '../../../src/utils/store-client.js': {
        default: mockStoreClientClass,
        StoreEmptyError,
        URL_TYPES,
        GUIDELINE_TYPES,
      },
      '../../../src/utils/offsite-audit-utils.js': {
        DrsNoContentAvailableError,
        MYSTIQUE_URLS_LIMIT,
        filterUrlsByDrsStatus: mockFilterUrlsByDrsStatus,
        resolveMystiqueUrlLimit: realResolveMystiqueUrlLimit,
      },
      '../../../src/offsite-brand-presence/constants.js': {
        OFFSITE_DOMAINS,
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
      expect(youtubeAnalysisHandler.default).to.be.an('object');
      expect(youtubeAnalysisHandler.default).to.have.property('runner');
      expect(youtubeAnalysisHandler.default.runner).to.be.a('function');
    });

    it('should have URL resolver configured', () => {
      expect(youtubeAnalysisHandler.default).to.have.property('urlResolver');
      expect(youtubeAnalysisHandler.default.urlResolver).to.be.a('function');
    });

    it('should have post processors configured', () => {
      expect(youtubeAnalysisHandler.default).to.have.property('postProcessors');
      expect(youtubeAnalysisHandler.default.postProcessors).to.be.an('array');
      expect(youtubeAnalysisHandler.default.postProcessors).to.have.lengthOf(1);
    });
  });

  describe('runYouTubeAnalysisAudit (via runner)', () => {
    it('should return pending_analysis with config and store data when successful', async () => {
      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.status).to.equal('pending_analysis');
      expect(result.auditResult.storeData.urls).to.deep.equal(mockUrls);
      expect(result.auditResult.storeData.sentimentConfig).to.deep.equal(expectedSentimentConfigForPostProcessor);
      expect(result.auditResult.config.urlLimit).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(result.fullAuditRef).to.equal(baseURL);
      expect(mockStoreClient.getUrls).to.have.been.calledWith(siteId, 'youtube-analysis', { sortBy: 'createdAt', sortOrder: 'desc' });
      expect(mockStoreClient.getGuidelines).to.have.been.calledWith(siteId, GUIDELINE_TYPES.YOUTUBE_ANALYSIS);
      expect(mockComputeTopicsFromBrandPresence).to.have.been.calledWith(siteId, context);
    });

    it('should set config.urlLimit on auditResult from messageData.urlLimit', async () => {
      const result = await youtubeAnalysisHandler.default.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { urlLimit: '7' } },
      );

      expect(result.auditResult.config.urlLimit).to.equal(7);
      expect(context.log.info).to.have.been.calledWith('[YouTube] auditContext: {"messageData":{"urlLimit":"7"}}');
    });

    it('should log debug payload for brand-presence topics', async () => {
      await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(context.log.debug).to.have.been.calledWith(
        `[YouTube] Brand-presence topics payload: ${JSON.stringify(mockComputedTopics)}`,
      );
    });

    it('should call StoreClient with correct parameters', async () => {
      await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(mockStoreClient.getUrls).to.have.been.calledWith(siteId, 'youtube-analysis', { sortBy: 'createdAt', sortOrder: 'desc' });
      expect(mockStoreClient.getGuidelines).to.have.been.calledWith(siteId, 'youtube-analysis');
    });

    it('should use empty guidelines when sentiment API omits guidelines', async () => {
      mockStoreClient.getGuidelines.resolves({ topics: [{ topicId: 'legacy-only' }] });

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.info).to.have.been.calledWith('[YouTube] Retrieved 0 guidelines');
    });

    it('should return error when DRS has no available content', async () => {
      mockFilterUrlsByDrsStatus.rejects(new DrsNoContentAvailableError('no content'));

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('no content');
      expect(context.log.error).to.have.been.calledWithMatch(/No DRS content available yet/);
    });

    it('should return error when urlStore returns empty', async () => {
      mockStoreClient.getUrls.rejects(new StoreEmptyError('urlStore', siteId, 'No youtube-analysis URLs found'));

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('urlStore returned empty results');
      expect(result.auditResult.storeName).to.equal('urlStore');
      expect(context.log.error).to.have.been.called;
    });

    it('should proceed with empty guidelines when guidelinesStore returns empty', async () => {
      mockStoreClient.getGuidelines.rejects(new StoreEmptyError('guidelinesStore', 'N/A', 'No guidelines found'));

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(mockComputeTopicsFromBrandPresence).to.have.been.calledWith(siteId, context);
      expect(context.log.info).to.have.been.calledWithMatch(/No guidelines configured for youtube-analysis/);
    });

    it('should succeed when brand presence returns no topics', async () => {
      mockComputeTopicsFromBrandPresence.resolves([]);

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.debug).to.have.been.calledWith('[YouTube] Brand-presence topics payload: []');
    });

    it('should rethrow non-StoreEmptyError from getGuidelines', async () => {
      mockStoreClient.getGuidelines.rejects(new Error('Network timeout'));

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Network timeout');
    });

    it('should filter URLs by DRS availability before returning store data', async () => {
      const availableUrl = mockUrls[0];
      mockFilterUrlsByDrsStatus.callsFake(async () => [availableUrl]);

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.storeData.urls).to.deep.equal([availableUrl]);
      expect(mockFilterUrlsByDrsStatus).to.have.been.calledWith(
        mockUrls,
        OFFSITE_DOMAINS['youtube.com'].datasetIds,
        siteId,
        mockDrsClient,
        sinon.match.object,
        '[YouTube]',
      );
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

      const result = await youtubeAnalysisHandler.default.runner('', context, mockSite);

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

      const result = await youtubeAnalysisHandler.default.runner('https://bmw.com', context, mockSite);

      expect(context.log.info).to.have.been.calledWith(
        '[YouTube] Config: companyName=https://bmw.com, website=https://bmw.com',
      );
      expect(result.auditResult.success).to.be.true;
    });

    it('should handle missing config and use baseURL', async () => {
      mockSite.getConfig.returns(null);
      mockSite.getBaseURL.returns('https://test-company.com');

      const result = await youtubeAnalysisHandler.default.runner('https://test-company.com', context, mockSite);

      expect(context.log.info).to.have.been.calledWith(
        '[YouTube] Config: companyName=https://test-company.com, website=https://test-company.com',
      );
      expect(result.auditResult.success).to.be.true;
    });

    it('should handle general errors during execution', async () => {
      mockSite.getConfig.throws(new Error('Config error'));

      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Config error');
      expect(context.log.error).to.have.been.called;
    });

    it('should include slackContext in auditResult when provided in auditContext', async () => {
      const slackContext = { channelId: 'C-test', threadTs: '1700000000.123456' };
      const result = await youtubeAnalysisHandler.default.runner(
        baseURL,
        context,
        mockSite,
        { slackContext },
      );

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.slackContext).to.deep.equal(slackContext);
    });

    it('should not include slackContext in auditResult when not provided', async () => {
      const result = await youtubeAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.slackContext).to.be.undefined;
    });
  });

  describe('Post Processor - sendMystiqueMessagePostProcessor', () => {
    it('should send message to Mystique queue with config and enriched URLs when audit is successful', async () => {
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
            sentimentConfig: expectedSentimentConfigForPostProcessor,
          },
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique',
        sinon.match({
          type: 'guidance:youtube-analysis',
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
          }),
        }),
      );
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.keys('topics', 'guidelines');
      expect(sentMessage.data.urls).to.have.lengthOf(mockUrls.length);
      expect(sentMessage.data.urls[0].url).to.equal(mockUrls[0].url);
      expect(context.log.info).to.have.been.calledWith(
        `[YouTube] urlLimit=${MYSTIQUE_URLS_LIMIT} (URLs sent to Mystique)`,
      );
      expect(context.log.info).to.have.been.calledWith(
        '[YouTube] Queued YouTube analysis request to Mystique for Example Corp with 2 URLs',
      );
    });

    it('should slice URLs using config.urlLimit', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test', urlLimit: 1 },
          storeData: {
            urls: mockUrls,
            sentimentConfig: expectedSentimentConfigForPostProcessor,
          },
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.log.info).to.have.been.calledWith('[YouTube] urlLimit=1 (URLs sent to Mystique)');
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(1);
    });

    it('should limit URLs to MYSTIQUE_URLS_LIMIT when many URLs exist', async () => {
      const manyUrls = Array.from({ length: MYSTIQUE_URLS_LIMIT + 30 }, (_, i) => ({
        url: `https://youtube.com/watch?v=test-${i}`, type: 'youtube-analysis', metadata: {},
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

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(MYSTIQUE_URLS_LIMIT);
      expect(context.log.info).to.have.been.calledWith(
        `[YouTube] Queued YouTube analysis request to Mystique for Test with ${MYSTIQUE_URLS_LIMIT} URLs`,
      );
    });

    it('should fall back to MYSTIQUE_URLS_LIMIT when urlLimit is absent', async () => {
      const manyUrls = Array.from({ length: MYSTIQUE_URLS_LIMIT + 5 }, (_, i) => ({
        url: `https://youtube.com/watch?v=test-${i}`, type: 'youtube-analysis', metadata: {},
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

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(MYSTIQUE_URLS_LIMIT);
      expect(context.log.info).to.have.been.calledWith(
        `[YouTube] urlLimit=${MYSTIQUE_URLS_LIMIT} (URLs sent to Mystique)`,
      );
    });

    it('should skip sending message when audit failed', async () => {
      const auditData = {
        siteId,
        auditResult: {
          success: false,
          error: 'urlStore returned empty results',
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith('[YouTube] Audit failed, skipping Mystique message');
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

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[YouTube] SQS or Mystique queue not configured, skipping message');
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

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
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

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(result).to.deep.equal(auditData);
      expect(context.log.warn).to.have.been.calledWith('[YouTube] Site not found, skipping Mystique message');
    });

    it('should throw error when SQS send fails', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('SQS Error');
      expect(context.log.error).to.have.been.calledWith('[YouTube] Failed to send Mystique message: SQS Error');
    });

    // Helper: fresh PostgREST chain mock that resolves on the 3rd eq call (org, status, site_id)
    function makeQueryChain(data) {
      const chain = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
      };
      chain.eq.onThirdCall().resolves({ data });
      return chain;
    }

    it('should include scope fields when brand is resolved via brand_sites join', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub()
            .onFirstCall().returns(makeQueryChain([]))
            .onSecondCall().returns(makeQueryChain([{ id: 'brand-2' }])),
        },
      };

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.scopeType).to.equal('brand');
      expect(sentMessage.brandId).to.equal('brand-2');
      expect(sentMessage.siteId).to.equal(siteId);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/brandId=brand-2/).and(sinon.match((v) => !/siteId=/.test(v))),
      );
    });

    it('should include scope fields when brand is resolved via direct baseSiteId match', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub().returns(makeQueryChain([{ id: 'brand-7' }])),
        },
      };

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.scopeType).to.equal('brand');
      expect(sentMessage.brandId).to.equal('brand-7');
      expect(sentMessage.siteId).to.equal(siteId);
    });

    it('should omit scope fields and preserve siteId when no brand is resolved', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub()
            .onFirstCall().returns(makeQueryChain([]))
            .onSecondCall().returns(makeQueryChain([])),
        },
      };

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage).to.not.have.property('scopeType');
      expect(sentMessage).to.not.have.property('brandId');
      expect(sentMessage.siteId).to.equal(siteId);
    });

    it('should still send message without scope if brand resolution throws unexpectedly', async () => {
      const faultySite = {
        getId: sandbox.stub().returns(siteId),
        getBaseURL: sandbox.stub().returns(baseURL),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
        getOrganizationId: sandbox.stub().throws(new Error('getter failed')),
      };
      context.dataAccess.Site.findById.resolves(faultySite);

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
        },
      };

      const postProcessor = youtubeAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage).to.not.have.property('scopeType');
      expect(sentMessage).to.not.have.property('brandId');
      expect(sentMessage.siteId).to.equal(siteId);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Brand resolution failed unexpectedly/),
      );
    });
  });
});
