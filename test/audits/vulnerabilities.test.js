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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import esmock from 'esmock';
import { DELIVERY_TYPES } from '@adobe/spacecat-shared-utils';
import { MockContextBuilder } from '../shared.js';
import {
  VULNERABILITY_REPORT_WITH_VULNERABILITIES,
  VULNERABILITY_REPORT_NO_VULNERABILITIES,
  VULNERABILITY_REPORT_MULTIPLE_COMPONENTS,
} from '../fixtures/vulnerabilities/vulnerability-reports.js';
import { vulnerabilityAuditRunner, opportunityAndSuggestionsStep } from '../../src/vulnerabilities/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Vulnerabilities Handler Integration Tests', () => {
  let sandbox;
  let context;
  let site;
  let mockVulnerabilityReport;

  const resetAllStubHistories = () => {
    if (context?.dataAccess) {
      context.dataAccess.Configuration.findLatest.resetHistory();
      context.dataAccess.Opportunity.create.resetHistory();
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resetHistory();
      context.dataAccess.Suggestion.bulkUpdateStatus.resetHistory();
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resetHistory();
    }
    if (site?.getOpportunitiesByStatus) {
      site.getOpportunitiesByStatus.resetHistory();
    }
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    site = {
      getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      getBaseURL: () => 'https://example.com',
      getDeliveryType: () => 'aem_cs',
      getDeliveryConfig: () => ({
        programId: '123456',
        environmentId: '789012',
      }),
      getOrganizationId: () => 'test-org-id',
      getOpportunitiesByStatus: sandbox.stub().resolves([]),
    };

    mockVulnerabilityReport = VULNERABILITY_REPORT_WITH_VULNERABILITIES;

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site,
        finalUrl: 'https://example.com',
        env: {
          IMS_CLIENT_ID: 'test-client-id',
          IMS_HOST: 'https://ims-na1.adobelogin.com',
          IMS_CLIENT_SECRET: 'test-client-secret',
          IMS_CLIENT_CODE: 'test-client-code',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves({
              isHandlerEnabledForSite: sandbox.stub().returns(true),
            }),
          },
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org'
            })
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves({
              getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              getType: () => 'security-vulnerabilities',
              getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              setStatus: sandbox.stub().resolves(),
              getSuggestions: sandbox.stub().resolves([]),
              setUpdatedBy: sandbox.stub().resolves(),
              save: sandbox.stub().resolves(),
              addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
            }),
          },
          Suggestion: {
            bulkUpdateStatus: sandbox.stub().resolves(),
            allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
          },
        },
      })
      .build();

    // Reset all stub call histories before each test
    resetAllStubHistories();
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  const setupSuccessfulImsAuth = () => {
    nock('https://ims-na1.adobelogin.com')
      .post('/ims/token/v4')
      .reply(200, {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
  };

  const setupSuccessfulVulnerabilityApi = () => {
    nock('https://aem-trustcenter-dev.adobe.io')
      .get('/api/reports/123456/789012/vulnerabilities')
      .reply(200, { data: mockVulnerabilityReport });
  };

  const setupFailedImsAuth = (status = 401) => {
    nock('https://ims-na1.adobelogin.com')
      .post('/ims/token/v4')
      .reply(status, { error: 'Unauthorized' });
  };

  const setupFailedVulnerabilityApi = (status = 500) => {
    nock('https://aem-trustcenter-dev.adobe.io')
      .get('/api/reports/123456/789012/vulnerabilities')
      .reply(status, { error: 'Internal Server Error' });
  };

  const setupVulnerabilityApi404 = () => {
    nock('https://aem-trustcenter-dev.adobe.io')
      .get('/api/reports/123456/789012/vulnerabilities')
      .reply(404, { error: 'Not Found' });
  };

  const createAuditData = (overrides = {}) => ({
    auditResult: {
      vulnerabilityReport: mockVulnerabilityReport,
      success: true,
    },
    siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    auditId: 'test-audit-id',
    ...overrides,
  });

  describe('vulnerabilityAuditRunner', () => {
    it('should skip when site is not aem_cs delivery type', async () => {
      site.getDeliveryType = () => DELIVERY_TYPES.AEM_EDGE;

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Unsupported delivery type');
    });

    it('should handle missing imsOrg', async () => {
      // Mock getImsOrgId to return null (missing IMS org)
      const { vulnerabilityAuditRunner: mockedRunner } = await esmock('../../src/vulnerabilities/handler.js', {
        '../../src/utils/data-access.js': {
          getImsOrgId: sandbox.stub().resolves(null),
          syncSuggestions: sandbox.stub().resolves(),
        },
      });

      const result = await mockedRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Missing IMS org');
      expect(result.auditResult.finalUrl).to.equal('https://example.com');
    });

    it('should handle default imsOrg', async () => {
      // Mock getImsOrgId to return 'default' and set up successful API calls
      const { vulnerabilityAuditRunner: mockedRunner } = await esmock('../../src/vulnerabilities/handler.js', {
        '../../src/utils/data-access.js': {
          getImsOrgId: sandbox.stub().resolves('default'),
          syncSuggestions: sandbox.stub().resolves(),
        },
      });

      setupSuccessfulImsAuth();
      setupSuccessfulVulnerabilityApi();

      const result = await mockedRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.vulnerabilityReport).to.deep.equal(mockVulnerabilityReport);
      expect(result.auditResult.finalUrl).to.equal('https://example.com');

      // Verify that the debug log was called for default IMS org
      expect(context.log.debug).to.have.been.calledWithMatch(/site is configured with default IMS org/);
    });

    it('should handle missing programId in delivery config', async () => {
      site.getDeliveryConfig = () => ({ programId: undefined, environmentId: '789012' });

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Invalid delivery config for AEM_CS');
    });

    it('should handle missing environmentId in delivery config', async () => {
      site.getDeliveryConfig = () => ({ programId: '123456', environmentId: null });

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Invalid delivery config for AEM_CS');
    });

    it('should handle non-aem_cs delivery type', async () => {
      site.getDeliveryType = () => 'aem_on_premise';
      site.getDeliveryConfig = () => ({ programId: null, environmentId: null });

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Unsupported delivery type aem_on_premise');
    });

    it('should handle IMS authentication failure', async () => {
      setupFailedImsAuth(401);

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Failed to retrieve IMS token');
    });

    it('should handle Starfish Backend API failure', async () => {
      setupSuccessfulImsAuth();
      setupFailedVulnerabilityApi(500);

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('audit failed with error');
    });

    it('should handle 404 response when vulnerability report not found', async () => {
      setupSuccessfulImsAuth();
      setupVulnerabilityApi404();

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('fetch successful, but report was empty / null');
      expect(result.auditResult.finalUrl).to.equal('https://example.com');
      expect(context.log.debug).to.have.been.calledWithMatch(/vulnerability report not found/);
      expect(context.log.debug).to.have.been.calledWithMatch(/fetch successful, but report was empty \/ null/);
    });

    it('should handle fetch error and throw generic error message', async () => {
      setupSuccessfulImsAuth();
      // Mock tracingFetch to throw a network error
      const { vulnerabilityAuditRunner: mockedRunner } = await esmock('../../src/vulnerabilities/handler.js', {
        '@adobe/spacecat-shared-utils': {
          isNonEmptyArray: (arr) => Array.isArray(arr) && arr.length > 0,
          DELIVERY_TYPES: { AEM_CS: 'aem_cs' },
          tracingFetch: sandbox.stub().rejects(new Error('Network error')),
          hasText: (text) => typeof text === 'string' && text.trim().length > 0,
        },
        '../../src/utils/data-access.js': {
          getImsOrgId: sandbox.stub().resolves('test-ims-org'),
          syncSuggestions: sandbox.stub().resolves(),
        },
      });

      const result = await mockedRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Failed to fetch vulnerability report');
    });

    it('should format errors with correct structure when any error is thrown', async () => {
      // Mock an error by making the site throw an error
      site.getDeliveryConfig = () => {
        throw new Error('Test error');
      };

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result).to.have.property('fullAuditRef', 'https://example.com');
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', false);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('error');
      expect(result.auditResult.error).to.include('[security-vulnerabilities] [Site: a1b2c3d4-e5f6-7890-abcd-ef1234567890] audit failed with error: Test error');
    });

    it('should successfully fetch vulnerability report', async () => {
      setupSuccessfulImsAuth();
      setupSuccessfulVulnerabilityApi();

      const result = await vulnerabilityAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.vulnerabilityReport).to.deep.equal(mockVulnerabilityReport);
      expect(result.auditResult.finalUrl).to.equal('https://example.com');
    });
  });

  describe('opportunityAndSuggestionsStep', () => {
    it('should skip when audit failed', async () => {
      const auditData = createAuditData({
        auditResult: { success: false },
      });

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
    });

    it('should handle no vulnerabilities scenario', async () => {
      const auditData = createAuditData({
        auditResult: {
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        },
      });

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should handle opportunity fetching error when no vulnerabilities found', async () => {
      const auditData = createAuditData({
        auditResult: {
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        },
      });

      // Mock opportunity fetching to fail
      site.getOpportunitiesByStatus.rejects(new Error('Database connection failed'));

      await expect(opportunityAndSuggestionsStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Failed to fetch opportunities for siteId a1b2c3d4-e5f6-7890-abcd-ef1234567890: Database connection failed');
    });

    it('should update existing opportunity to RESOLVED when no vulnerabilities found', async () => {
      const auditData = createAuditData({
        auditResult: {
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        },
      });

      // Mock existing opportunity
      const mockOpportunity = {
        getType: () => 'security-vulnerabilities',
        setStatus: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([
          { id: 'suggestion1', status: 'NEW' },
          { id: 'suggestion2', status: 'NEW' },
        ]),
        setUpdatedBy: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
      };

      site.getOpportunitiesByStatus.resolves([mockOpportunity]);

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(mockOpportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(mockOpportunity.getSuggestions).to.have.been.calledOnce;
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledWith(
        [{ id: 'suggestion1', status: 'NEW' }, { id: 'suggestion2', status: 'NEW' }],
        'FIXED',
      );
      expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(mockOpportunity.save).to.have.been.calledOnce;
    });

    it('should handle no vulnerabilities scenario when no existing opportunity found', async () => {
      const auditData = createAuditData({
        auditResult: {
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        },
      });

      // Mock no existing opportunities
      site.getOpportunitiesByStatus.resolves([]);

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should process vulnerabilities and create opportunities with suggestions', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      // Enable both opportunity creation and auto-suggest
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities').returns(true);
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities-auto-suggest').returns(true);

      const auditData = createAuditData();

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;

      // Verify opportunity was created with correct data
      const createCall = context.dataAccess.Opportunity.create.getCall(0);
      expect(createCall.args[0]).to.include({
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'test-audit-id',
        type: 'security-vulnerabilities',
        origin: 'AUTOMATION',
      });

      // Verify the opportunity's addSuggestions was called with correct data
      const createdOpportunity = await context.dataAccess.Opportunity.create.getCall(0).returnValue;
      expect(createdOpportunity.addSuggestions).to.have.been.calledOnce;

      // Verify suggestions were created with correct structure
      const suggestionsCall = createdOpportunity.addSuggestions.getCall(0);
      const suggestions = suggestionsCall.args[0];
      expect(suggestions).to.be.an('array');
      expect(suggestions).to.have.lengthOf(1); // One vulnerable component

      // Verify suggestion structure
      const suggestion = suggestions[0];
      expect(suggestion).to.have.property('opportunityId', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(suggestion).to.have.property('type', 'CODE_CHANGE');
      expect(suggestion).to.have.property('rank', 7.5);
      expect(suggestion).to.have.property('data');
      expect(suggestion.data).to.have.property('library', 'com.fasterxml.jackson.core:jackson-databind');
      expect(suggestion.data).to.have.property('current_version', '2.12.3');
      expect(suggestion.data).to.have.property('recommended_version', '2.12.6.1'); // Should have recommended version when auto-suggest is enabled
      expect(suggestion.data).to.have.property('cves');
      expect(suggestion.data.cves).to.be.an('array');
      expect(suggestion.data.cves[0]).to.have.property('cve_id', 'CVE-2020-36518');
      expect(suggestion.data.cves[0]).to.have.property('score', 7.5);
      expect(suggestion.data.cves[0]).to.have.property('score_text', '7.5 High');
    });

    it('should process multiple vulnerable components and create suggestions', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      // Enable both opportunity creation and auto-suggest
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities').returns(true);
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities-auto-suggest').returns(true);

      // Create audit data with multiple vulnerable components
      const auditData = createAuditData({
        auditResult: {
          vulnerabilityReport: VULNERABILITY_REPORT_MULTIPLE_COMPONENTS,
          success: true,
        },
      });

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;

      // Verify suggestions were created for both components
      const createdOpportunity = await context.dataAccess.Opportunity.create.getCall(0).returnValue;
      expect(createdOpportunity.addSuggestions).to.have.been.calledOnce;

      const suggestionsCall = createdOpportunity.addSuggestions.getCall(0);
      const suggestions = suggestionsCall.args[0];
      expect(suggestions).to.be.an('array');
      expect(suggestions).to.have.lengthOf(2); // Two vulnerable components

      // Verify first suggestion (jackson-databind)
      const jacksonSuggestion = suggestions.find((s) => s.data.library === 'com.fasterxml.jackson.core:jackson-databind');
      expect(jacksonSuggestion).to.exist;
      expect(jacksonSuggestion.rank).to.equal(7.5);
      expect(jacksonSuggestion.data.cves).to.have.lengthOf(1);

      // Verify second suggestion (spring-core) - should be sorted by highest score
      const springSuggestion = suggestions.find((s) => s.data.library === 'org.springframework:spring-core');
      expect(springSuggestion).to.exist;
      expect(springSuggestion.rank).to.equal(9.0); // Highest score
      expect(springSuggestion.data.cves).to.have.lengthOf(2);
      expect(springSuggestion.data.cves[0].score).to.equal(9.0); // Sorted by score desc
      expect(springSuggestion.data.cves[1].score).to.equal(5.5);
    });

    it('should handle disabled auto-suggest configuration', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      // Enable main handler but disable auto-suggest
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities').returns(true);
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities-auto-suggest').returns(false);

      const auditData = createAuditData();
      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      expect(context.log.debug).to.have.been.calledWithMatch(/security-vulnerabilities-auto-suggest not configured, skipping version recommendations/);

      // Verify opportunity was created and addSuggestions was called
      const createdOpportunity = await context.dataAccess.Opportunity.create.getCall(0).returnValue;
      expect(createdOpportunity.addSuggestions).to.have.been.calledOnce;

      // Verify suggestions were created with empty recommended_version (generateSuggestions=false)
      const suggestionsCall = createdOpportunity.addSuggestions.getCall(0);
      const suggestions = suggestionsCall.args[0];
      expect(suggestions).to.be.an('array');
      expect(suggestions[0].data.recommended_version).to.equal('');
    });

    it('should handle configuration lookup failure gracefully', async () => {
      context.dataAccess.Configuration.findLatest.rejects(new Error('Database connection failed'));

      const auditData = createAuditData();

      // This should throw an error since the handler doesn't
      // handle config lookup failures gracefully
      await expect(opportunityAndSuggestionsStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Database connection failed');
    });
  });
});
