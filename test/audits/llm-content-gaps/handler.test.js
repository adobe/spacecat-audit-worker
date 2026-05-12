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
import { createOpportunityData } from '../../../src/llm-content-gaps/opportunity-data-mapper.js';

use(sinonChai);

describe('LLM Content Gaps Handler', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();
  let context;
  let site;

  const auditUrl = 'https://example.com';
  const siteId = 'site-123';

  const expectedFindings = [
    {
      success: false,
      check: 'content-gap',
      checkTitle: 'Content gap: AI-powered analytics',
      description: 'Page has insufficient coverage for topic "AI-powered analytics" (coverage score: 18%).',
      explanation: 'Expand the page to address key subtopics identified in the Semrush content brief.',
      topic: 'AI-powered analytics',
      coverageScore: 18,
      contentBrief: {
        recommendedWordCount: 1200,
        missingSubtopics: ['real-time dashboards', 'predictive insights', 'data connectors'],
        suggestedHeadings: [
          'What is AI-powered analytics?',
          'Key features of AI analytics platforms',
          'How to integrate AI analytics into your workflow',
        ],
        rewriteInstructions: 'Add sections covering real-time dashboards and predictive insights. Include concrete examples and a comparison table of data connectors.',
      },
    },
    {
      success: false,
      check: 'content-gap',
      checkTitle: 'Content gap: enterprise data governance',
      description: 'Page has insufficient coverage for topic "enterprise data governance" (coverage score: 31%).',
      explanation: 'Expand the page to address key subtopics identified in the Semrush content brief.',
      topic: 'enterprise data governance',
      coverageScore: 31,
      contentBrief: {
        recommendedWordCount: 900,
        missingSubtopics: ['compliance frameworks', 'data lineage', 'role-based access'],
        suggestedHeadings: [
          'Data governance in enterprise environments',
          'Compliance and regulatory requirements',
          'Implementing role-based access control',
        ],
        rewriteInstructions: 'Introduce a dedicated section on compliance frameworks (GDPR, CCPA). Add a data lineage diagram and explain role-based access control.',
      },
    },
    {
      success: true,
      check: 'content-gap',
      checkTitle: 'Sufficient coverage: cloud deployment',
      description: 'Page adequately covers topic "cloud deployment" (coverage score: 74%).',
      explanation: 'No action required.',
      topic: 'cloud deployment',
      coverageScore: 74,
    },
  ];

  beforeEach(() => {
    site = { getId: () => siteId };
    context = { log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() } };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('logs hello world and returns a completed result with findings', async () => {
    const { auditRunner } = await import('../../../src/llm-content-gaps/handler.js');
    const result = await auditRunner(auditUrl, context, site);

    expect(context.log.info).to.have.been.calledWith('[llm-content-gaps] hello world');
    expect(context.log.info).to.have.been.calledWith(`[llm-content-gaps] checking ${auditUrl}`);
    expect(result).to.deep.equal({
      auditResult: { siteId, url: auditUrl, status: 'completed', findings: expectedFindings },
      fullAuditRef: auditUrl,
    });
  });

  it('checkLlmContentGaps logs the url and returns dummy findings', async () => {
    const { checkLlmContentGaps } = await import('../../../src/llm-content-gaps/handler.js');
    const findings = checkLlmContentGaps(auditUrl, null, context.log);

    expect(context.log.info).to.have.been.calledWith(`[llm-content-gaps] checking ${auditUrl}`);
    expect(findings).to.deep.equal(expectedFindings);
  });

  describe('opportunityAndSuggestions', () => {
    let convertToOpportunityStub;
    let syncSuggestionsStub;
    let opportunityAndSuggestions;

    beforeEach(async () => {
      convertToOpportunityStub = sinon.stub().resolves({ getId: () => 'opportunity-id' });
      syncSuggestionsStub = sinon.stub().resolves();

      const mockedHandler = await esmock('../../../src/llm-content-gaps/handler.js', {
        '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
      });
      opportunityAndSuggestions = mockedHandler.opportunityAndSuggestions;
    });

    it('skips opportunity creation when there are no failed findings', async () => {
      const auditData = { auditResult: { findings: [expectedFindings[2]] } };

      const result = await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
      expect(syncSuggestionsStub).not.to.have.been.called;
    });

    it('skips opportunity creation when findings are absent', async () => {
      const auditData = { auditResult: {} };

      const result = await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('creates opportunity and syncs one suggestion per failed finding', async () => {
      const auditData = { auditResult: { findings: expectedFindings } };

      const result = await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const { newData, buildKey, mapNewSuggestion } = syncSuggestionsStub.getCall(0).args[0];
      const gaps = expectedFindings.filter((f) => !f.success);
      expect(newData).to.deep.equal(gaps);
      expect(buildKey(gaps[0])).to.equal(`${gaps[0].topic}|${auditUrl}`);

      const mapped = mapNewSuggestion(gaps[0]);
      expect(mapped).to.deep.equal({
        opportunityId: 'opportunity-id',
        type: 'CONTENT_UPDATE',
        rank: gaps[0].coverageScore,
        data: {
          url: auditUrl,
          topic: gaps[0].topic,
          coverageScore: gaps[0].coverageScore,
          contentBrief: gaps[0].contentBrief,
        },
      });
    });

    it('logs completion after syncing', async () => {
      const auditData = { auditResult: { findings: expectedFindings } };

      await opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.log.info).to.have.been.calledWith(
        '[llm-content-gaps] opportunity created and 2 suggestions synced for https://example.com',
      );
    });
  });

  describe('createOpportunityData', () => {
    it('returns the expected opportunity metadata', () => {
      const data = createOpportunityData();
      expect(data.origin).to.equal('AUTOMATION');
      expect(data.tags).to.include('isElmo');
      expect(data.guidance.steps).to.be.an('array').with.length.greaterThan(0);
    });
  });
});
