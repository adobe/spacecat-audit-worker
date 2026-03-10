/*
 * Copyright 2024 Adobe. All rights reserved.
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
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

describe('CWV Trends Audit Opportunity Sync', () => {
  let sandbox;
  let mockContext;
  let mockSite;
  let mockAudit;
  let mockOpportunity;
  let syncSuggestionsStub;
  let convertToOpportunityStub;
  let syncOpportunitiesAndSuggestions;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Mock site
    mockSite = {
      getId: sandbox.stub().returns('test-site-id'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
    };

    // Mock opportunity
    mockOpportunity = {
      getId: sandbox.stub().returns('opportunity-123'),
      getType: sandbox.stub().returns('cwv-trends-audit'),
      getData: sandbox.stub().returns({ deviceType: 'mobile' }),
    };

    // Mock audit result
    const auditResult = {
      deviceType: 'mobile',
      summary: {
        totalUrls: 100,
        avgGood: 65.5,
        avgNeedsImprovement: 25.0,
        avgPoor: 9.5,
      },
      trendData: [
        { date: '2026-03-10', good: 65, needsImprovement: 25, poor: 10 },
      ],
      urlDetails: [
        {
          url: 'https://example.com/page1',
          pageviews: 5000,
          bounceRate: 25,
          engagement: 75,
          clickRate: 60,
          lcp: 2000,
          cls: 0.08,
          inp: 180,
          ttfb: 300,
        },
        {
          url: 'https://example.com/page2',
          pageviews: 3000,
          bounceRate: 30,
          engagement: 70,
          clickRate: 55,
          lcp: 3000,
          cls: 0.15,
          inp: 300,
          ttfb: 400,
        },
      ],
    };

    // Mock audit
    mockAudit = {
      getId: sandbox.stub().returns('audit-123'),
      getAuditResult: sandbox.stub().returns(auditResult),
    };

    // Create mock context
    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        audit: mockAudit,
        finalUrl: 'https://example.com',
      })
      .build();

    // Mock dependencies
    syncSuggestionsStub = sandbox.stub().resolves();
    convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);

    const opportunitySyncModule = await esmock('../../../src/cwv-trends-audit/opportunity-sync.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
    });

    syncOpportunitiesAndSuggestions = opportunitySyncModule.syncOpportunitiesAndSuggestions;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('syncOpportunitiesAndSuggestions', () => {
    it('should create opportunity with correct parameters', async () => {
      // Act
      await syncOpportunitiesAndSuggestions(mockContext);

      // Assert
      expect(convertToOpportunityStub).to.have.been.calledOnce;

      const [
        finalUrl,
        auditData,
        context,
        createOpportunityData,
        auditType,
        props,
        comparisonFn,
      ] = convertToOpportunityStub.firstCall.args;

      expect(finalUrl).to.equal('https://example.com');
      expect(auditData).to.have.property('siteId', 'test-site-id');
      expect(auditData).to.have.property('id', 'audit-123');
      expect(auditData).to.have.property('auditResult');
      expect(context).to.equal(mockContext);
      expect(createOpportunityData).to.be.a('function');
      expect(auditType).to.equal('cwv-trends-audit');
      expect(props).to.have.property('deviceType', 'mobile');
      expect(comparisonFn).to.be.a('function');
    });

    it('should sync suggestions with correct parameters', async () => {
      // Act
      await syncOpportunitiesAndSuggestions(mockContext);

      // Assert
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const args = syncSuggestionsStub.firstCall.args[0];

      expect(args).to.have.property('opportunity', mockOpportunity);
      expect(args).to.have.property('newData');
      expect(args.newData).to.have.lengthOf(2);
      expect(args).to.have.property('context', mockContext);
      expect(args).to.have.property('buildKey').that.is.a('function');
      expect(args).to.have.property('mapNewSuggestion').that.is.a('function');
    });

    it('should use URL as key for suggestions', async () => {
      // Act
      await syncOpportunitiesAndSuggestions(mockContext);

      // Assert
      const { buildKey } = syncSuggestionsStub.firstCall.args[0];

      const testData = { url: 'https://example.com/test' };
      expect(buildKey(testData)).to.equal('https://example.com/test');
    });

    it('should map suggestions correctly', async () => {
      // Act
      await syncOpportunitiesAndSuggestions(mockContext);

      // Assert
      const { mapNewSuggestion } = syncSuggestionsStub.firstCall.args[0];

      const urlEntry = {
        url: 'https://example.com/page1',
        pageviews: 5000,
        bounceRate: 25,
        engagement: 75,
        clickRate: 60,
        lcp: 2000,
        cls: 0.08,
        inp: 180,
        ttfb: 300,
      };

      const result = mapNewSuggestion(urlEntry);

      expect(result).to.have.property('opportunityId', 'opportunity-123');
      expect(result).to.have.property('type', 'CODE_CHANGE');
      expect(result).to.have.property('rank', 5000); // Ranked by pageviews
      expect(result).to.have.property('data');
      expect(result.data).to.deep.equal(urlEntry);
    });

    it('should rank suggestions by pageviews', async () => {
      // Act
      await syncOpportunitiesAndSuggestions(mockContext);

      // Assert
      const { mapNewSuggestion } = syncSuggestionsStub.firstCall.args[0];

      const highTrafficUrl = {
        url: 'https://example.com/popular',
        pageviews: 10000,
      };

      const lowTrafficUrl = {
        url: 'https://example.com/unpopular',
        pageviews: 1500,
      };

      const highRank = mapNewSuggestion(highTrafficUrl);
      const lowRank = mapNewSuggestion(lowTrafficUrl);

      expect(highRank.rank).to.equal(10000);
      expect(lowRank.rank).to.equal(1500);
      expect(highRank.rank).to.be.greaterThan(lowRank.rank);
    });

    it('should return the created opportunity', async () => {
      // Act
      const result = await syncOpportunitiesAndSuggestions(mockContext);

      // Assert
      expect(result).to.equal(mockOpportunity);
    });
  });
});
