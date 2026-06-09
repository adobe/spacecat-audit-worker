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
import StoreClient, {
  StoreEmptyError,
  URL_TYPES,
  GUIDELINE_TYPES,
} from '../../src/utils/store-client.js';

use(sinonChai);
use(chaiAsPromised);

// Builds an AuditUrl-model-like object exposing the getters StoreClient reads.
const makeAuditUrl = (overrides = {}) => {
  const data = {
    siteId: 'test-site-id',
    url: 'https://example.com',
    byCustomer: false,
    audits: ['wikipedia-analysis'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedBy: 'system',
    ...overrides,
  };
  return {
    getSiteId: () => data.siteId,
    getUrl: () => data.url,
    getByCustomer: () => data.byCustomer,
    getAudits: () => data.audits,
    getCreatedAt: () => data.createdAt,
    getUpdatedAt: () => data.updatedAt,
    getCreatedBy: () => data.createdBy,
    getUpdatedBy: () => data.updatedBy,
  };
};

const makeTopic = (overrides = {}) => {
  const data = {
    siteId: 'test-site-id',
    topicId: 'topic-1',
    name: 'Topic 1',
    description: 'desc',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedBy: 'system',
    ...overrides,
  };
  return {
    getSiteId: () => data.siteId,
    getTopicId: () => data.topicId,
    getName: () => data.name,
    getDescription: () => data.description,
    getEnabled: () => data.enabled,
    getCreatedAt: () => data.createdAt,
    getUpdatedAt: () => data.updatedAt,
    getCreatedBy: () => data.createdBy,
    getUpdatedBy: () => data.updatedBy,
  };
};

const makeGuideline = (overrides = {}) => {
  const data = {
    siteId: 'test-site-id',
    guidelineId: 'guideline-1',
    name: 'Guideline 1',
    instruction: 'do the thing',
    audits: ['wikipedia-analysis'],
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedBy: 'system',
    ...overrides,
  };
  return {
    getSiteId: () => data.siteId,
    getGuidelineId: () => data.guidelineId,
    getName: () => data.name,
    getInstruction: () => data.instruction,
    getAudits: () => data.audits,
    getEnabled: () => data.enabled,
    getCreatedAt: () => data.createdAt,
    getUpdatedAt: () => data.updatedAt,
    getCreatedBy: () => data.createdBy,
    getUpdatedBy: () => data.updatedBy,
  };
};

describe('StoreClient', () => {
  let sandbox;
  let mockLog;
  let dataAccess;
  let storeClient;

  const siteId = 'test-site-id';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockLog = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    dataAccess = {
      AuditUrl: { allBySiteIdAndAuditType: sandbox.stub() },
      SentimentTopic: { allBySiteIdEnabled: sandbox.stub() },
      SentimentGuideline: {
        allBySiteIdAndAuditType: sandbox.stub(),
        allBySiteIdEnabled: sandbox.stub(),
      },
    };

    storeClient = new StoreClient({ dataAccess }, mockLog);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Constants', () => {
    it('should export URL_TYPES', () => {
      expect(URL_TYPES).to.deep.equal({
        WIKIPEDIA: 'wikipedia-analysis',
        REDDIT: 'reddit-analysis',
        YOUTUBE: 'youtube-analysis',
        CITED: 'cited-analysis',
      });
    });

    it('should export GUIDELINE_TYPES', () => {
      expect(GUIDELINE_TYPES).to.deep.equal({
        WIKIPEDIA_ANALYSIS: 'wikipedia-analysis',
        REDDIT_ANALYSIS: 'reddit-analysis',
        YOUTUBE_ANALYSIS: 'youtube-analysis',
        CITED_ANALYSIS: 'cited-analysis',
      });
    });
  });

  describe('StoreEmptyError', () => {
    it('should create error with correct properties', () => {
      const error = new StoreEmptyError('urlStore', 'site-123', 'No URLs found');

      expect(error).to.be.instanceOf(Error);
      expect(error.name).to.equal('StoreEmptyError');
      expect(error.storeName).to.equal('urlStore');
      expect(error.siteId).to.equal('site-123');
      expect(error.message).to.equal('urlStore returned empty results for siteId: site-123. No URLs found');
    });

    it('should create error without details', () => {
      const error = new StoreEmptyError('contentStore', 'site-456');

      expect(error.message).to.equal('contentStore returned empty results for siteId: site-456');
    });
  });

  describe('createFrom', () => {
    it('should create StoreClient from context', () => {
      const context = { dataAccess, log: mockLog };

      const client = StoreClient.createFrom(context);

      expect(client).to.be.instanceOf(StoreClient);
      expect(client.dataAccess).to.equal(dataAccess);
    });

    it('should create StoreClient when context.dataAccess is missing', () => {
      const context = { log: mockLog };

      const client = StoreClient.createFrom(context);

      expect(client).to.be.instanceOf(StoreClient);
      expect(client.dataAccess).to.be.undefined;
    });

    it('should create StoreClient when context is missing', () => {
      const client = StoreClient.createFrom(undefined);

      expect(client).to.be.instanceOf(StoreClient);
      expect(client.dataAccess).to.be.undefined;
    });
  });

  describe('getUrls', () => {
    it('should fetch URLs from the URL store', async () => {
      const rows = [
        makeAuditUrl({ url: 'https://en.wikipedia.org/wiki/Test' }),
        makeAuditUrl({ url: 'https://en.wikipedia.org/wiki/Test2' }),
      ];
      dataAccess.AuditUrl.allBySiteIdAndAuditType.resolves({ data: rows, cursor: null });

      const result = await storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA);

      expect(result).to.have.length(2);
      expect(result[0]).to.include({ url: 'https://en.wikipedia.org/wiki/Test', siteId });
      expect(dataAccess.AuditUrl.allBySiteIdAndAuditType).to.have.been.calledOnce;
      expect(dataAccess.AuditUrl.allBySiteIdAndAuditType.firstCall.args[0]).to.equal(siteId);
      expect(dataAccess.AuditUrl.allBySiteIdAndAuditType.firstCall.args[1]).to.equal('wikipedia-analysis');
    });

    it('should default to createdAt/desc and forward optional sort params', async () => {
      dataAccess.AuditUrl.allBySiteIdAndAuditType.resolves({
        data: [makeAuditUrl()], cursor: null,
      });

      await storeClient.getUrls(siteId, URL_TYPES.REDDIT);
      expect(dataAccess.AuditUrl.allBySiteIdAndAuditType.firstCall.args[2]).to.include({
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      dataAccess.AuditUrl.allBySiteIdAndAuditType.resetHistory();
      await storeClient.getUrls(siteId, URL_TYPES.REDDIT, { sortBy: 'url', sortOrder: 'asc' });
      expect(dataAccess.AuditUrl.allBySiteIdAndAuditType.firstCall.args[2]).to.include({
        sortBy: 'url',
        sortOrder: 'asc',
      });
    });

    it('should fetch all pages when paginated', async () => {
      const page1 = [makeAuditUrl({ url: 'https://example.com/1' })];
      const page2 = [makeAuditUrl({ url: 'https://example.com/2' })];

      dataAccess.AuditUrl.allBySiteIdAndAuditType
        .onFirstCall().resolves({ data: page1, cursor: 'next-cursor' })
        .onSecondCall().resolves({ data: page2, cursor: null });

      const result = await storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA);

      expect(result.map((u) => u.url)).to.deep.equal([
        'https://example.com/1',
        'https://example.com/2',
      ]);
      expect(dataAccess.AuditUrl.allBySiteIdAndAuditType).to.have.been.calledTwice;
      expect(dataAccess.AuditUrl.allBySiteIdAndAuditType.secondCall.args[2])
        .to.include({ cursor: 'next-cursor' });
    });

    it('should throw when dataAccess collections are not configured', async () => {
      const clientNoData = new StoreClient({ dataAccess: {} }, mockLog);

      await expect(clientNoData.getUrls(siteId, URL_TYPES.WIKIPEDIA))
        .to.be.rejectedWith('StoreClient is not configured: missing dataAccess collections AuditUrl, SentimentTopic, SentimentGuideline');
    });

    it('should throw when constructed without config (no dataAccess)', async () => {
      const clientNoConfig = new StoreClient();

      await expect(clientNoConfig.getUrls(siteId, URL_TYPES.WIKIPEDIA))
        .to.be.rejectedWith('StoreClient is not configured: missing dataAccess collections AuditUrl, SentimentTopic, SentimentGuideline');
    });

    it('should throw StoreEmptyError when no URLs returned', async () => {
      dataAccess.AuditUrl.allBySiteIdAndAuditType.resolves({ data: [], cursor: null });

      await expect(storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA))
        .to.be.rejectedWith(StoreEmptyError);
    });

    it('should throw StoreEmptyError when data is undefined', async () => {
      dataAccess.AuditUrl.allBySiteIdAndAuditType.resolves({ cursor: null });

      await expect(storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA))
        .to.be.rejectedWith(StoreEmptyError);
    });
  });

  describe('getGuidelines', () => {
    it('should fetch sentiment config (topics + guidelines) for an audit type', async () => {
      dataAccess.SentimentTopic.allBySiteIdEnabled.resolves({ data: [makeTopic()] });
      dataAccess.SentimentGuideline.allBySiteIdAndAuditType.resolves({
        data: [makeGuideline()],
      });

      const result = await storeClient.getGuidelines(siteId, GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS);

      expect(result.topics).to.have.length(1);
      expect(result.topics[0]).to.include({ topicId: 'topic-1', name: 'Topic 1' });
      expect(result.guidelines).to.have.length(1);
      expect(result.guidelines[0]).to.include({ guidelineId: 'guideline-1', name: 'Guideline 1' });
      expect(dataAccess.SentimentGuideline.allBySiteIdAndAuditType)
        .to.have.been.calledWith(siteId, 'wikipedia-analysis');
      expect(dataAccess.SentimentGuideline.allBySiteIdEnabled).to.not.have.been.called;
    });

    it('should default audits to [] when a guideline has no audits', async () => {
      dataAccess.SentimentTopic.allBySiteIdEnabled.resolves({ data: [] });
      dataAccess.SentimentGuideline.allBySiteIdAndAuditType.resolves({
        data: [makeGuideline({ audits: null })],
      });

      const result = await storeClient.getGuidelines(siteId, GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS);

      expect(result.guidelines[0].audits).to.deep.equal([]);
    });

    it('should use allBySiteIdEnabled when audit type is undefined', async () => {
      dataAccess.SentimentTopic.allBySiteIdEnabled.resolves({ data: [] });
      dataAccess.SentimentGuideline.allBySiteIdEnabled.resolves({ data: [makeGuideline()] });

      const result = await storeClient.getGuidelines(siteId, undefined);

      expect(result.guidelines).to.have.length(1);
      expect(dataAccess.SentimentGuideline.allBySiteIdEnabled).to.have.been.calledOnce;
      expect(dataAccess.SentimentGuideline.allBySiteIdAndAuditType).to.not.have.been.called;
    });

    it('should throw StoreEmptyError when no guidelines returned', async () => {
      dataAccess.SentimentTopic.allBySiteIdEnabled.resolves({ data: [makeTopic()] });
      dataAccess.SentimentGuideline.allBySiteIdAndAuditType.resolves({ data: [] });

      await expect(storeClient.getGuidelines(siteId, GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS))
        .to.be.rejectedWith(StoreEmptyError);
    });

    it('should tolerate missing data fields and still throw when empty', async () => {
      dataAccess.SentimentTopic.allBySiteIdEnabled.resolves({});
      dataAccess.SentimentGuideline.allBySiteIdAndAuditType.resolves({});

      await expect(storeClient.getGuidelines(siteId, GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS))
        .to.be.rejectedWith(StoreEmptyError);
    });

    it('should log topics and guidelines count', async () => {
      dataAccess.SentimentTopic.allBySiteIdEnabled.resolves({
        data: [makeTopic({ topicId: '1' }), makeTopic({ topicId: '2' })],
      });
      dataAccess.SentimentGuideline.allBySiteIdAndAuditType.resolves({
        data: [makeGuideline({ guidelineId: '1' })],
      });

      await storeClient.getGuidelines(siteId, 'test');

      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/2 topics and 1 guidelines/),
      );
    });
  });
});
