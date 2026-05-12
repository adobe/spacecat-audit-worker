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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { selectTopTopics } from '../../../src/llm-content-gaps/topics.js';
import { createOpportunityData } from '../../../src/llm-content-gaps/opportunity-data-mapper.js';

use(sinonChai);
use(chaiAsPromised);

const fixtureContent = { id: 1, name: 'Test content', text: 'Sample text' };

// 7 rows, 6 unique topics; Topic A appears twice to exercise deduplication.
// Scores (volume * (1-citation) * (1-owned)): A=1000, B=500, C=400, D=300, E=200, F=100
const fixtureTopics = [
  {
    adobe_topic: 'Topic A', semrush_topic: 'Label A', volume: 1000, citation_share: 0, owned_keywords_share: 0, keywords: 10,
  },
  {
    adobe_topic: 'Topic B', semrush_topic: 'Label B', volume: 500, citation_share: 0, owned_keywords_share: 0, keywords: 5,
  },
  {
    adobe_topic: 'Topic C', semrush_topic: 'Label C', volume: 400, citation_share: 0, owned_keywords_share: 0, keywords: 4,
  },
  {
    adobe_topic: 'Topic D', semrush_topic: 'Label D', volume: 300, citation_share: 0, owned_keywords_share: 0, keywords: 3,
  },
  {
    adobe_topic: 'Topic E', semrush_topic: 'Label E', volume: 200, citation_share: 0, owned_keywords_share: 0, keywords: 2,
  },
  {
    adobe_topic: 'Topic F', semrush_topic: 'Label F', volume: 100, citation_share: 0, owned_keywords_share: 0, keywords: 1,
  },
  // duplicate — should be dropped before scoring
  {
    adobe_topic: 'Topic A', semrush_topic: 'Label A', volume: 1000, citation_share: 0, owned_keywords_share: 0, keywords: 10,
  },
];

describe('LLM Content Gaps Handler', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();
  let context;
  let site;

  const auditUrl = 'https://adobe.com';
  const siteId = 'site-123';

  beforeEach(() => {
    site = { getId: () => siteId, getBaseURL: () => 'https://adobe.com' };
    context = { log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() } };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ─── selectTopTopics ────────────────────────────────────────────────────────

  describe('selectTopTopics', () => {
    it('returns top 5 unique topics sorted by opportunity score', () => {
      const result = selectTopTopics(fixtureTopics);
      expect(result).to.have.length(5);
      expect(result.map((t) => t.adobe_topic)).to.deep.equal(
        ['Topic A', 'Topic B', 'Topic C', 'Topic D', 'Topic E'],
      );
    });

    it('deduplicates by adobe_topic, keeping the first occurrence', () => {
      const result = selectTopTopics(fixtureTopics);
      const names = result.map((t) => t.adobe_topic);
      expect(new Set(names).size).to.equal(names.length);
    });

    it('computes opportunityScore as volume * (1 - citation_share) * (1 - owned_keywords_share)', () => {
      const topics = [{
        adobe_topic: 'X', semrush_topic: 'X', volume: 1000, citation_share: 0.2, owned_keywords_share: 0.5, keywords: 1,
      }];
      const [result] = selectTopTopics(topics, 1);
      expect(result.opportunityScore).to.equal(1000 * 0.8 * 0.5);
    });

    it('respects a custom count', () => {
      const result = selectTopTopics(fixtureTopics, 3);
      expect(result).to.have.length(3);
      expect(result[0].adobe_topic).to.equal('Topic A');
    });
  });

  // ─── loadTopicsForSite ──────────────────────────────────────────────────────

  describe('loadTopicsForSite', () => {
    it('returns parsed JSON when the data file exists', async () => {
      const existsSyncStub = sandbox.stub().returns(true);
      const readFileSyncStub = sandbox.stub().returns(JSON.stringify(fixtureTopics));

      const { loadTopicsForSite } = await esmock('../../../src/llm-content-gaps/topics.js', {
        fs: { existsSync: existsSyncStub, readFileSync: readFileSyncStub },
      });

      const result = loadTopicsForSite('https://adobe.com');
      expect(result).to.deep.equal(fixtureTopics);
      expect(existsSyncStub.firstCall.args[0]).to.include('adobe-com-sample.json');
    });

    it('falls back to adobe-com when no data file exists for the site', async () => {
      const readFileSyncStub = sandbox.stub().returns(JSON.stringify(fixtureTopics));
      const { loadTopicsForSite } = await esmock('../../../src/llm-content-gaps/topics.js', {
        fs: { existsSync: sandbox.stub().returns(false), readFileSync: readFileSyncStub },
      });

      const result = loadTopicsForSite('https://unknown.com');
      expect(result).to.deep.equal(fixtureTopics);
      expect(readFileSyncStub.firstCall.args[0]).to.include('adobe-com-sample.json');
    });
  });

  // ─── loadContentForSite ─────────────────────────────────────────────────────

  describe('loadContentForSite', () => {
    it('returns parsed JSON when the content file exists', async () => {
      const readFileSyncStub = sandbox.stub().returns(JSON.stringify(fixtureContent));
      const { loadContentForSite } = await esmock('../../../src/llm-content-gaps/topics.js', {
        fs: { existsSync: sandbox.stub().returns(true), readFileSync: readFileSyncStub },
      });

      const result = loadContentForSite('https://adobe.com');
      expect(result).to.deep.equal(fixtureContent);
      expect(readFileSyncStub.firstCall.args[0]).to.include('adobe-com-content-example.json');
    });

    it('falls back to adobe-com when no content file exists for the site', async () => {
      const readFileSyncStub = sandbox.stub().returns(JSON.stringify(fixtureContent));
      const { loadContentForSite } = await esmock('../../../src/llm-content-gaps/topics.js', {
        fs: { existsSync: sandbox.stub().returns(false), readFileSync: readFileSyncStub },
      });

      const result = loadContentForSite('https://unknown.com');
      expect(result).to.deep.equal(fixtureContent);
      expect(readFileSyncStub.firstCall.args[0]).to.include('adobe-com-content-example.json');
    });
  });

  // Shared topics mock used by auditRunner and llmContentGapsHandler tests.
  // Provides loadTopicsForSite returning raw fixture data so selectTopTopics
  // runs against a real, controlled dataset.
  const topicsMock = {
    '../../../src/llm-content-gaps/topics.js': {
      loadTopicsForSite: () => fixtureTopics,
      loadContentForSite: () => fixtureContent,
      selectTopTopics,
    },
  };

  // ─── auditRunner ────────────────────────────────────────────────────────────

  describe('auditRunner', () => {
    it('loads topics for the site and returns the top 5 findings', async () => {
      const { auditRunner } = await esmock('../../../src/llm-content-gaps/handler.js', topicsMock);

      const result = await auditRunner(auditUrl, context, site);

      expect(context.log.info).to.have.been.calledWith('[llm-content-gaps] selecting top content-gap topics');
      expect(result.fullAuditRef).to.equal(auditUrl);
      expect(result.auditResult.siteId).to.equal(siteId);
      expect(result.auditResult.status).to.equal('completed');

      const { findings } = result.auditResult;
      expect(findings).to.have.length(5);
      expect(findings[0]).to.deep.equal({
        success: false,
        check: 'content-gap',
        checkTitle: 'Content gap: Topic A',
        description: 'Topic "Topic A" has low AI citation share (0) and low owned keyword share (0) with a search volume of 1000.',
        explanation: 'Expand content coverage for this topic to capture untapped search and AI citation opportunities.',
        url: auditUrl,
        scrapeData: undefined,
        topic: 'Topic A',
        topicLabel: 'Label A',
        volume: 1000,
        citationShare: 0,
        ownedKeywordsShare: 0,
        opportunityScore: 1000,
        contentExample: fixtureContent,
      });
    });

    it('propagates an error when no data file is available for the site', async () => {
      const { auditRunner } = await esmock('../../../src/llm-content-gaps/handler.js', {
        '../../../src/llm-content-gaps/topics.js': {
          loadTopicsForSite: () => { throw new Error('No topic data available for https://adobe.com (expected src/llm-content-gaps/data/adobe-com-sample.json)'); },
          selectTopTopics,
        },
      });

      await expect(auditRunner(auditUrl, context, site)).to.be.rejectedWith(
        'No topic data available for https://adobe.com (expected src/llm-content-gaps/data/adobe-com-sample.json)',
      );
    });
  });

  // ─── llmContentGapsHandler ─────────────────────────────────────────────────

  describe('llmContentGapsHandler', () => {
    it('returns 5 findings per URL and logs each check', async () => {
      const { llmContentGapsHandler: handler } = await esmock('../../../src/llm-content-gaps/handler.js', topicsMock);

      const findings = handler(
        { site, log: context.log },
        { previewUrls: [auditUrl] },
      );

      expect(findings).to.have.length(5);
      expect(context.log.info).to.have.been.calledWith(`[llm-content-gaps] checking ${auditUrl}`);
      expect(findings[0].url).to.equal(auditUrl);
      expect(findings[0].scrapeData).to.be.undefined;
    });

    it('returns findings for every URL in previewUrls', async () => {
      const { llmContentGapsHandler: handler } = await esmock('../../../src/llm-content-gaps/handler.js', topicsMock);

      const urls = [`${auditUrl}/page1`, `${auditUrl}/page2`];
      const findings = handler({ site, log: context.log }, { previewUrls: urls });

      expect(findings).to.have.length(10); // 2 URLs × 5 topics
      expect(findings.slice(0, 5).every((f) => f.url === urls[0])).to.be.true;
      expect(findings.slice(5).every((f) => f.url === urls[1])).to.be.true;
    });

    it('attaches scrapeData from scrapedObjects to each finding', async () => {
      const { llmContentGapsHandler: handler } = await esmock('../../../src/llm-content-gaps/handler.js', topicsMock);

      const scrapeData = { body: '<p>test</p>' };
      const findings = handler(
        { site, log: context.log },
        { previewUrls: [auditUrl], scrapedObjects: { [auditUrl]: scrapeData } },
      );

      expect(findings[0].scrapeData).to.deep.equal(scrapeData);
    });
  });

  // ─── opportunityAndSuggestions ─────────────────────────────────────────────

  describe('opportunityAndSuggestions', () => {
    let convertToOpportunityStub;
    let syncSuggestionsStub;
    let opportunityAndSuggestions;

    const gapFinding = {
      success: false,
      check: 'content-gap',
      checkTitle: 'Content gap: Topic A',
      url: auditUrl,
      scrapeData: undefined,
      topic: 'Topic A',
      topicLabel: 'Label A',
      volume: 1000,
      citationShare: 0,
      ownedKeywordsShare: 0,
      opportunityScore: 1000,
    };
    const successFinding = { success: true, check: 'content-gap', topic: 'Topic X' };

    beforeEach(async () => {
      convertToOpportunityStub = sinon.stub().resolves({ getId: () => 'opportunity-id' });
      syncSuggestionsStub = sinon.stub().resolves();

      ({ opportunityAndSuggestions } = await esmock('../../../src/llm-content-gaps/handler.js', {
        '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
      }));
    });

    it('skips opportunity creation when there are no failed findings', async () => {
      const auditData = { auditResult: { findings: [successFinding] } };
      const result = await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        '[llm-content-gaps] no content gaps found, skipping opportunity creation',
      );
    });

    it('skips opportunity creation when findings are absent', async () => {
      const auditData = { auditResult: {} };
      const result = await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('creates opportunity and syncs one suggestion per gap with the correct shape', async () => {
      const auditData = { auditResult: { findings: [gapFinding, successFinding] } };
      const result = await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const { newData, buildKey, mapNewSuggestion } = syncSuggestionsStub.getCall(0).args[0];
      expect(newData).to.deep.equal([gapFinding]);
      expect(buildKey(gapFinding)).to.equal(`Topic A|${auditUrl}`);
      expect(mapNewSuggestion(gapFinding)).to.deep.equal({
        opportunityId: 'opportunity-id',
        type: 'CONTENT_UPDATE',
        rank: 1000,
        data: {
          url: auditUrl,
          topic: 'Topic A',
          topicLabel: 'Label A',
          volume: 1000,
          citationShare: 0,
          ownedKeywordsShare: 0,
          opportunityScore: 1000,
        },
      });
    });

    it('logs completion after syncing', async () => {
      const auditData = { auditResult: { findings: [gapFinding] } };
      await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.log.info).to.have.been.calledWith(
        '[llm-content-gaps] opportunity created and 1 suggestions synced for https://adobe.com',
      );
    });
  });

  // ─── createOpportunityData ─────────────────────────────────────────────────

  describe('createOpportunityData', () => {
    it('returns expected opportunity metadata', () => {
      const data = createOpportunityData();
      expect(data.origin).to.equal('AUTOMATION');
      expect(data.tags).to.include('isElmo');
      expect(data.guidance.steps).to.be.an('array').with.length.greaterThan(0);
    });
  });
});
