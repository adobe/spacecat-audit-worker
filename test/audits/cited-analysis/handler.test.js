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

// Mirrors the handler-private constant — update both if the limit changes.
const CITED_ANALYSIS_URLS_LIMIT = 40;
import { CITED_ANALYSIS_DRS_CONFIG } from '../../../src/offsite-brand-presence/constants.js';
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
  let mockComputeTopicsFromBrandPresence;
  let mockFilterUrlsByDrsStatus;
  let mockDrsClient;
  let mockPostMessageOptional;
  let citedAnalysisHandler;
  let StoreEmptyError;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';
  const auditId = 'test-audit-id';

  // Cited URLs represent 3rd-party EARNED citations — pages from blogs,
  // press, etc. that LLMs reference when answering questions about the
  // brand. They must NOT be on the brand's own domain (see the
  // ``runCitedAnalysisAudit owned-domain filter`` describe block below).
  const mockUrls = [
    { url: 'https://techreview.io/review-of-example', type: 'cited-analysis', metadata: {} },
    { url: 'https://industry-news.org/example-corp-article', type: 'cited-analysis', metadata: {} },
  ];

  const mockComputedTopics = [
    {
      name: 'Brand Perception',
      urls: [
        {
          url: 'https://techreview.io/review-of-example',
          timesCited: 1,
          category: 'general',
          subPrompts: ['brand mentions', 'sentiment'],
        },
      ],
    },
  ];

  const mockGuidelines = [
    { guidelineId: 'guide-1', name: 'Cited Analysis Best Practices', instruction: 'Focus on LLM citability', audits: ['cited-analysis'] },
  ];

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
    mockPostMessageOptional = sandbox.stub().resolves({ success: true });

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

    citedAnalysisHandler = await esmock('../../../src/cited-analysis/handler.js', {
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
        CITED_ANALYSIS_DRS_CONFIG,
      },
      '../../../src/utils/offsite-brand-presence-enrichment.js': {
        computeTopicsFromBrandPresence: mockComputeTopicsFromBrandPresence,
      },
      '../../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
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
            findLatest: sandbox.stub().resolves({
              isHandlerEnabledForSite: sandbox.stub().returns(true),
              getHandlers: sandbox.stub().returns({}),
              getQueues: sandbox.stub().returns({ audits: 'audits-queue-url' }),
            }),
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
    it('should return pending_analysis with config and store data when successful', async () => {
      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.status).to.equal('pending_analysis');
      expect(result.auditResult.storeData.urls).to.deep.equal(mockUrls);
      expect(result.auditResult.storeData.sentimentConfig).to.deep.equal(expectedSentimentConfigForPostProcessor);
      expect(result.auditResult.config.urlLimit).to.equal(CITED_ANALYSIS_URLS_LIMIT);
      expect(result.fullAuditRef).to.equal(baseURL);
      expect(mockStoreClient.getUrls).to.have.been.calledWith(siteId, URL_TYPES.CITED, { sortBy: 'createdAt', sortOrder: 'desc' });
      expect(mockStoreClient.getGuidelines).to.have.been.calledWith(siteId, GUIDELINE_TYPES.CITED_ANALYSIS);
      expect(mockComputeTopicsFromBrandPresence).to.have.been.calledWith(siteId, context);
    });

    it('should set config.urlLimit on auditResult from messageData.urlLimit', async () => {
      const result = await citedAnalysisHandler.default.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { urlLimit: '7' } },
      );

      expect(result.auditResult.config.urlLimit).to.equal(7);
      expect(context.log.info).to.have.been.calledWith('[Cited] auditContext: {"messageData":{"urlLimit":"7"}}');
    });

    it('should forward urlLimit to filterUrlsByDrsStatus', async () => {
      await citedAnalysisHandler.default.runner(
        baseURL,
        context,
        mockSite,
        { messageData: { urlLimit: '3' } },
      );

      expect(mockFilterUrlsByDrsStatus).to.have.been.calledWith(
        sinon.match.array,
        CITED_ANALYSIS_DRS_CONFIG.datasetIds,
        siteId,
        mockDrsClient,
        sinon.match.object,
        '[Cited]',
        3,
      );
    });

    it('should log debug payload for brand-presence topics', async () => {
      await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(context.log.debug).to.have.been.calledWith(
        `[Cited] Brand-presence topics payload: ${JSON.stringify(mockComputedTopics)}`,
      );
    });

    it('should call StoreClient with correct parameters', async () => {
      await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(mockStoreClient.getUrls).to.have.been.calledWith(siteId, URL_TYPES.CITED, { sortBy: 'createdAt', sortOrder: 'desc' });
      expect(mockStoreClient.getGuidelines).to.have.been.calledWith(siteId, GUIDELINE_TYPES.CITED_ANALYSIS);
    });

    it('should filter URLs by DRS availability before returning store data', async () => {
      const availableUrl = mockUrls[0];
      mockFilterUrlsByDrsStatus.callsFake(async () => [availableUrl]);

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.storeData.urls).to.deep.equal([availableUrl]);
      expect(mockFilterUrlsByDrsStatus).to.have.been.calledWith(
        mockUrls,
        CITED_ANALYSIS_DRS_CONFIG.datasetIds,
        siteId,
        mockDrsClient,
        sinon.match.object,
        '[Cited]',
        MYSTIQUE_URLS_LIMIT,
      );
    });

    it('should use empty guidelines when sentiment API omits guidelines', async () => {
      mockStoreClient.getGuidelines.resolves({ topics: [{ topicId: 'legacy-only' }] });

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.info).to.have.been.calledWith('[Cited] Retrieved 0 guidelines');
    });

    it('requests a domain-scoped scrape when DRS has no available content yet', async () => {
      mockFilterUrlsByDrsStatus.rejects(new DrsNoContentAvailableError('no content'));

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.status).to.equal('pending_scrape');
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [queueUrl, msg] = context.sqs.sendMessage.firstCall.args;
      expect(queueUrl).to.equal('audits-queue-url');
      expect(msg.type).to.equal('offsite-brand-presence');
      expect(msg.siteId).to.equal(siteId);
      expect(msg.auditContext.messageData).to.deep.equal({ domainScope: 'top-cited' });
    });

    it('returns error without re-scraping when scrape was already requested', async () => {
      mockFilterUrlsByDrsStatus.rejects(new DrsNoContentAvailableError('no content'));

      const result = await citedAnalysisHandler.default.runner(
        baseURL,
        context,
        mockSite,
        { drsScrapeRequested: true },
      );

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('no content');
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(context.log.error).to.have.been.calledWithMatch(/No DRS content available after scraping/);
    });

    it('should proceed with empty guidelines when guidelinesStore returns empty', async () => {
      mockStoreClient.getGuidelines.rejects(new StoreEmptyError('guidelinesStore', 'N/A', 'No guidelines found'));

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(mockComputeTopicsFromBrandPresence).to.have.been.calledWith(siteId, context);
      expect(context.log.info).to.have.been.calledWithMatch(/No guidelines configured for cited-analysis/);
    });

    it('should succeed when brand presence returns no topics', async () => {
      mockComputeTopicsFromBrandPresence.resolves([]);

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.debug).to.have.been.calledWith('[Cited] Brand-presence topics payload: []');
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

      expect(context.log.info).to.have.been.calledWith(
        '[Cited] Config: companyName=https://bmw.com, website=https://bmw.com, competitors=0',
      );
      expect(context.log.warn).to.have.been.calledWithMatch(/No competitors configured for site/);
      expect(result.auditResult.success).to.be.true;
    });

    it('should handle missing config and use baseURL', async () => {
      mockSite.getConfig.returns(null);
      mockSite.getBaseURL.returns('https://test-company.com');

      const result = await citedAnalysisHandler.default.runner('https://test-company.com', context, mockSite);

      expect(context.log.info).to.have.been.calledWith(
        '[Cited] Config: companyName=https://test-company.com, website=https://test-company.com, competitors=0',
      );
      expect(context.log.warn).to.have.been.calledWithMatch(/No competitors configured for site/);
      expect(result.auditResult.success).to.be.true;
    });

    it('should NOT warn when competitors are configured', async () => {
      // mockSite default config has two competitors configured.
      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.not.have.been.calledWithMatch(/No competitors configured/);
      expect(context.log.info).to.have.been.calledWith(
        `[Cited] Config: companyName=Example Corp, website=${baseURL}, competitors=2`,
      );
    });

    it('should handle general errors during execution', async () => {
      mockSite.getConfig.throws(new Error('Config error'));

      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Config error');
      expect(context.log.error).to.have.been.called;
    });

    it('should include slackContext in auditResult when provided in auditContext', async () => {
      const slackContext = { channelId: 'C-test', threadTs: '1700000000.123456' };
      const result = await citedAnalysisHandler.default.runner(
        baseURL,
        context,
        mockSite,
        { slackContext },
      );

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.slackContext).to.deep.equal(slackContext);
    });

    it('should not include slackContext in auditResult when not provided', async () => {
      const result = await citedAnalysisHandler.default.runner(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.slackContext).to.be.undefined;
    });
  });

  // Cited URLs are meant to represent 3rd-party EARNED citations. URLs on
  // the customer's own domain must be filtered out before we waste a DRS
  // lookup on them or ship them to Mystique. The mystique flow has the
  // same filter for defense in depth, but doing it here avoids the
  // round-trip cost.
  describe('runCitedAnalysisAudit owned-domain filter', () => {
    const ownedBaseURL = 'https://bmw.com';

    beforeEach(() => {
      mockSite.getBaseURL.returns(ownedBaseURL);
      mockSite.getConfig.returns({
        getCompanyName: sandbox.stub().returns('BMW'),
        getCompetitors: sandbox.stub().returns(['Audi', 'Mercedes']),
        getCompetitorRegion: sandbox.stub().returns('EU'),
        getIndustry: sandbox.stub().returns('Automotive'),
        getBrandKeywords: sandbox.stub().returns(['bmw']),
      });
    });

    it('handles bare-host brand domain (no scheme)', async () => {
      // ``site.getBaseURL()`` is normalized to include a scheme in
      // production, but some site configs historically stored bare hosts
      // (``bmw.com`` rather than ``https://bmw.com``). The filter must
      // still produce the same apex match.
      mockSite.getBaseURL.returns('bmw.com');
      mockStoreClient.getUrls.resolves([
        { url: 'https://bmw.com/news', type: 'cited-analysis', metadata: {} },
        { url: 'https://caranddriver.com/bmw-review', type: 'cited-analysis', metadata: {} },
      ]);

      const result = await citedAnalysisHandler.default.runner('bmw.com', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      const filtered = mockFilterUrlsByDrsStatus.firstCall.args[0];
      expect(filtered).to.have.lengthOf(1);
      expect(filtered[0].url).to.equal('https://caranddriver.com/bmw-review');
    });

    it('drops apex / www / subdomain URLs on the brand domain before DRS lookup', async () => {
      mockStoreClient.getUrls.resolves([
        { url: 'https://bmw.com/news/owned-article', type: 'cited-analysis', metadata: {} },
        { url: 'https://www.bmw.com/configurator', type: 'cited-analysis', metadata: {} },
        { url: 'https://m.bmw.com/owners', type: 'cited-analysis', metadata: {} },
        { url: 'https://caranddriver.com/bmw-3-series-review', type: 'cited-analysis', metadata: {} },
        { url: 'https://motortrend.com/bmw-x5-test', type: 'cited-analysis', metadata: {} },
      ]);

      const result = await citedAnalysisHandler.default.runner(ownedBaseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      const filtered = mockFilterUrlsByDrsStatus.firstCall.args[0];
      const hosts = filtered.map((u) => new URL(u.url).hostname).sort();
      expect(hosts).to.deep.equal(['caranddriver.com', 'motortrend.com']);
      expect(context.log.info).to.have.been.calledWithMatch(/Excluded 3 owned-domain URLs/);
    });

    it('keeps lookalike domains that are not actually owned', async () => {
      mockStoreClient.getUrls.resolves([
        { url: 'https://not-bmw.com/page', type: 'cited-analysis', metadata: {} },
        { url: 'https://bmw.com.attacker.example/x', type: 'cited-analysis', metadata: {} },
        { url: 'https://caranddriver.com/bmw-review', type: 'cited-analysis', metadata: {} },
      ]);

      const result = await citedAnalysisHandler.default.runner(ownedBaseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      const filtered = mockFilterUrlsByDrsStatus.firstCall.args[0];
      expect(filtered).to.have.lengthOf(3);
    });

    it('is a no-op when baseURL is whitespace-only', async () => {
      mockSite.getBaseURL.returns('   ');
      const urls = [
        { url: 'https://caranddriver.com/bmw-review', type: 'cited-analysis', metadata: {} },
        { url: 'https://bmw.com/news', type: 'cited-analysis', metadata: {} },
      ];
      mockStoreClient.getUrls.resolves(urls);

      const result = await citedAnalysisHandler.default.runner('   ', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      const filtered = mockFilterUrlsByDrsStatus.firstCall.args[0];
      expect(filtered).to.have.lengthOf(2);
    });

    it('keeps URLs whose host string cannot be parsed (defensive)', async () => {
      mockStoreClient.getUrls.resolves([
        { url: 'http://[bad', type: 'cited-analysis', metadata: {} },
        { url: 'https://caranddriver.com/bmw-review', type: 'cited-analysis', metadata: {} },
      ]);

      const result = await citedAnalysisHandler.default.runner(ownedBaseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      const filtered = mockFilterUrlsByDrsStatus.firstCall.args[0];
      expect(filtered).to.have.lengthOf(2);
    });

    it('is a no-op when baseURL is missing (defensive — keeps everything)', async () => {
      mockSite.getBaseURL.returns('');
      const urls = [
        { url: 'https://caranddriver.com/bmw-review', type: 'cited-analysis', metadata: {} },
        { url: 'https://bmw.com/news', type: 'cited-analysis', metadata: {} },
      ];
      mockStoreClient.getUrls.resolves(urls);

      const result = await citedAnalysisHandler.default.runner('', context, mockSite);

      expect(result.auditResult.success).to.be.true;
      const filtered = mockFilterUrlsByDrsStatus.firstCall.args[0];
      expect(filtered).to.have.lengthOf(2);
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

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      const result = await postProcessor(baseURL, auditData, context);

      expect(result).to.deep.equal(auditData);
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
          }),
        }),
      );
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data).to.not.have.keys('topics', 'guidelines');
      expect(sentMessage.data.urls).to.have.lengthOf(mockUrls.length);
      expect(sentMessage.data.urls[0].url).to.equal(mockUrls[0].url);
      expect(context.log.info).to.have.been.calledWith(
        `[Cited] urlLimit=${CITED_ANALYSIS_URLS_LIMIT} (URLs sent to Mystique)`,
      );
      expect(context.log.info).to.have.been.calledWith(
        '[Cited] Queued Cited analysis request to Mystique for Example Corp with 2 URLs',
      );
    });

    it('should pass all URLs through without slicing (limiting is done upstream)', async () => {
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

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.log.info).to.have.been.calledWith('[Cited] urlLimit=1 (URLs sent to Mystique)');
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.lengthOf(mockUrls.length);
    });

    it('should send projected urls when no topics are available', async () => {
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

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      // URL Store metadata (type, metadata, siteId, etc.) is stripped; only
      // url/categories/timesCited/prompts are projected for the SQS payload.
      const expectedUrls = mockUrls.map(({ url }) => ({ url }));
      expect(sentMessage.data.urls).to.deep.equal(expectedUrls);
    });

    it('should strip URL Store metadata and keep only url/categories/timesCited/prompts', async () => {
      const urlsWithMetadata = [
        {
          url: 'https://techreview.io/review-of-example',
          siteId: 'some-site-id',
          byCustomer: false,
          audits: ['cited-analysis'],
          createdAt: '2026-06-16T10:00:00.000Z',
          updatedAt: '2026-06-16T10:00:00.000Z',
          createdBy: 'system',
          updatedBy: 'system',
        },
      ];

      const topicsWithData = [
        {
          name: 'Test Topic',
          urls: [{
            url: 'https://techreview.io/review-of-example',
            timesCited: 5,
            category: 'review',
            subPrompts: ['prompt one'],
          }],
        },
      ];

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: {
            urls: urlsWithMetadata,
            sentimentConfig: { topics: topicsWithData, guidelines: [] },
          },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      const sentUrl = sentMessage.data.urls[0];
      expect(sentUrl).to.have.property('url', 'https://techreview.io/review-of-example');
      expect(sentUrl).to.have.property('categories');
      expect(sentUrl).to.have.property('timesCited', 5);
      expect(sentUrl).to.have.property('prompts');
      expect(sentUrl).to.not.have.any.keys('siteId', 'byCustomer', 'audits', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy');
    });

    it('should reduce URL count when serialised message exceeds size budget', async () => {
      // 40 URLs × 60 prompts × 200 bytes each = ~480 KB, well over the 200 KB budget.
      // Prompts are no longer capped per URL — the size guard is the safety net.
      const largePrompt = 'x'.repeat(200);
      const bigUrls = Array.from({ length: 40 }, (_, i) => ({
        url: `https://example.com/page-${i}`,
        prompts: Array.from({ length: 60 }, () => largePrompt),
      }));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: {
            urls: bigUrls,
            sentimentConfig: { topics: [], guidelines: [] },
          },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls.length).to.be.lessThan(CITED_ANALYSIS_URLS_LIMIT);
      expect(Buffer.byteLength(JSON.stringify(sentMessage), 'utf8')).to.be.at.most(200 * 1024);
      expect(context.log.warn).to.have.been.calledWithMatch(/Message size \d+ bytes exceeds budget/);
    });

    it('should strip prompts from single URL when payload still exceeds budget', async () => {
      // One URL whose prompts alone push it over the 200 KB budget.
      const hugePrompt = 'x'.repeat(300 * 1024); // 300 KB in a single prompt entry
      const singleBigUrl = [{
        url: 'https://example.com/huge',
        categories: ['Tech'],
        timesCited: 7,
        prompts: [hugePrompt],
      }];

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: {
            urls: singleBigUrl,
            sentimentConfig: { topics: [], guidelines: [] },
          },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.urls).to.have.length(1);
      expect(sentMessage.data.urls[0].url).to.equal('https://example.com/huge');
      expect(sentMessage.data.urls[0].prompts).to.be.undefined;
      // Lightweight metadata is preserved even when prompts are stripped.
      expect(sentMessage.data.urls[0].categories).to.deep.equal(['Tech']);
      expect(sentMessage.data.urls[0].timesCited).to.equal(7);
      expect(Buffer.byteLength(JSON.stringify(sentMessage), 'utf8')).to.be.at.most(200 * 1024);
      expect(context.log.warn).to.have.been.calledWithMatch(/Single-URL payload.*still exceeds budget; stripping prompts/);
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
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('SQS Error');
      expect(context.log.error).to.have.been.calledWith('[Cited] Failed to send Mystique message: SQS Error');
    });

    it('should post a Slack failure message when SQS send fails and slackContext is present', async () => {
      context.sqs.sendMessage.rejects(new Error('Message must be shorter than 262144 bytes'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test', companyWebsite: baseURL },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
          slackContext: { channelId: 'C12345', threadTs: '1234567890.000100' },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('Message must be shorter than 262144 bytes');
      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const [, channelId, text, opts] = mockPostMessageOptional.firstCall.args;
      expect(channelId).to.equal('C12345');
      expect(text).to.include(':x:');
      expect(text).to.include(baseURL);
      expect(text).to.include('Message must be shorter than 262144 bytes');
      expect(opts.threadTs).to.equal('1234567890.000100');
    });

    it('should fall back to siteId in the Slack message when companyWebsite is absent', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
          slackContext: { channelId: 'C12345', threadTs: '1234567890.000100' },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('SQS Error');
      expect(mockPostMessageOptional).to.have.been.calledOnce;
      const [, , text] = mockPostMessageOptional.firstCall.args;
      expect(text).to.include(siteId);
    });

    it('should not post to Slack when SQS send fails without slackContext', async () => {
      context.sqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        siteId,
        auditResult: {
          success: true,
          config: { companyName: 'Test' },
          storeData: { urls: mockUrls, sentimentConfig: expectedSentimentConfigForPostProcessor },
        },
      };

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await expect(postProcessor(baseURL, auditData, context)).to.be.rejectedWith('SQS Error');
      expect(mockPostMessageOptional).to.not.have.been.called;
    });

    // Helper: fresh PostgREST chain mock that resolves on limit() (org, status, site_id, order, limit)
    function makeQueryChain(data, postgrestError = null) {
      const chain = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        order: sandbox.stub().returnsThis(),
        limit: sandbox.stub().resolves({ data, error: postgrestError }),
      };
      return chain;
    }

    it('should include scope fields when brand is resolved via brand_sites join', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub()
            .onFirstCall().returns(makeQueryChain([]))             // Q1: no direct match
            .onSecondCall().returns(makeQueryChain([{ id: 'brand-4' }])), // Q2: join match
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

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.scopeType).to.equal('brand');
      expect(sentMessage.brandId).to.equal('brand-4');
      expect(sentMessage.siteId).to.equal(siteId);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/brandId=brand-4/).and(sinon.match((v) => !/siteId=/.test(v))),
      );
    });

    it('should include scope fields when brand is resolved via direct baseSiteId match', async () => {
      context.dataAccess.services = {
        postgrestClient: {
          from: sandbox.stub().returns(makeQueryChain([{ id: 'brand-5' }])), // Q1: direct match
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

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
      await postProcessor(baseURL, auditData, context);

      const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.scopeType).to.equal('brand');
      expect(sentMessage.brandId).to.equal('brand-5');
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

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
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

      const postProcessor = citedAnalysisHandler.default.postProcessors[0];
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
