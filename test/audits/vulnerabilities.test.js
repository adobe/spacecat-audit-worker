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
  VULNERABILITY_REPORT_ALL_IGNORED,
} from '../fixtures/vulnerabilities/vulnerability-reports.js';
import VULNERABILITY_REPORT_OLD_SCAN from '../fixtures/vulnerabilities/vulnerability-report-old-scan.json' with { type: 'json' };
import VULNERABILITY_REPORT_NEW_SCAN from '../fixtures/vulnerabilities/vulnerability-report-new-scan.json' with { type: 'json' };
import {
  vulnerabilityAuditRunner, opportunityAndSuggestionsStep, extractCodeInfo, buildKey,
  buildVulnFixEntityPayload, reconcileVulnSuggestions,
} from '../../src/vulnerabilities/handler.js';
import {
  toSuggestionData, mapVulnerabilityToSuggestion,
} from '../../src/vulnerabilities/suggestion-data-mapper.js';

use(sinonChai);
use(chaiAsPromised);

describe('Vulnerabilities Handler Integration Tests', () => {
  let sandbox;
  let context;
  let mockVulnerabilityReport;

  const resetAllStubHistories = () => {
    if (context?.dataAccess) {
      context.dataAccess.Configuration.findLatest.resetHistory();
      context.dataAccess.Opportunity.create.resetHistory();
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resetHistory();
      context.dataAccess.Suggestion.bulkUpdateStatus.resetHistory();
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resetHistory();
    }
    if (context.site?.getOpportunitiesByStatus) {
      context.site.getOpportunitiesByStatus.resetHistory();
    }
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockVulnerabilityReport = VULNERABILITY_REPORT_WITH_VULNERABILITIES;
    const createdOpportunity = {
      getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      getType: () => 'security-vulnerabilities',
      getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      setStatus: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
      setUpdatedBy: sandbox.stub().resolves(),
      save: sandbox.stub().resolves(),
      addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: {
          getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_cs',
          getDeliveryConfig: () => ({
            programId: '123456',
            environmentId: '789012',
          }),
          getOrganizationId: () => 'test-org-id',
          getOpportunitiesByStatus: sandbox.stub().resolves([]),
        },
        finalUrl: 'https://example.com',
        env: {
          IMS_CLIENT_ID: 'test-client-id',
          IMS_HOST: 'https://ims-na1.adobelogin.com',
          IMS_CLIENT_SECRET: 'test-client-secret',
          IMS_CLIENT_CODE: 'test-client-code',
          STARFISH_API_BASE_URL: 'https://starfish.adobe.com/api',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves({
              isHandlerEnabledForSite: sandbox.stub().returns(true),
            }),
          },
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org',
            }),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves(createdOpportunity),
            findById: sandbox.stub().resolves(createdOpportunity),
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
    nock('https://ims-na1.adobelogin.com').post('/ims/token/v4').reply(200, {
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  };

  const setupSuccessfulVulnerabilityApi = () => {
    nock('https://starfish.adobe.com').get('/api/reports/123456/789012/vulnerabilities').reply(200, { data: mockVulnerabilityReport });
  };

  const setupFailedImsAuth = (status = 401) => {
    nock('https://ims-na1.adobelogin.com').post('/ims/token/v4').reply(status, { error: 'Unauthorized' });
  };

  const setupFailedVulnerabilityApi = (status = 500) => {
    nock('https://starfish.adobe.com').get('/api/reports/123456/789012/vulnerabilities').reply(status, { error: 'Internal Server Error' });
  };

  const setupVulnerabilityApi404 = () => {
    nock('https://starfish.adobe.com').get('/api/reports/123456/789012/vulnerabilities').reply(404, { error: 'Not Found' });
  };

  // const createAuditData = (overrides = {}) => ({
  //   auditResult: {
  //     vulnerabilityReport: mockVulnerabilityReport,
  //     success: true,
  //   },
  //   siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  //   auditId: 'test-audit-id',
  //   ...overrides,
  // });

  describe('vulnerabilityAuditRunner', () => {
    it('should skip when site is not aem_cs delivery type', async () => {
      context.site.getDeliveryType = () => DELIVERY_TYPES.AEM_EDGE;

      const result = await vulnerabilityAuditRunner(context);

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

      const result = await mockedRunner(context);

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

      const result = await mockedRunner(context);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.vulnerabilityReport).to.deep.equal(mockVulnerabilityReport);
      expect(result.auditResult.finalUrl).to.equal('https://example.com');

      // Verify that the debug log was called for default IMS org
      expect(context.log.info).to.have.been.calledWithMatch(/site is configured with default IMS org/);
    });

    it('should handle missing programId in delivery config', async () => {
      context.site.getDeliveryConfig = () => ({
        programId: undefined,
        environmentId: '789012',
      });

      const result = await vulnerabilityAuditRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Invalid delivery config for AEM_CS');
    });

    it('should handle missing environmentId in delivery config', async () => {
      context.site.getDeliveryConfig = () => ({
        programId: '123456',
        environmentId: null,
      });

      const result = await vulnerabilityAuditRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Invalid delivery config for AEM_CS');
    });

    it('should handle non-aem_cs delivery type', async () => {
      context.site.getDeliveryType = () => 'aem_on_premise';
      context.site.getDeliveryConfig = () => ({
        programId: null,
        environmentId: null,
      });

      const result = await vulnerabilityAuditRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Unsupported delivery type aem_on_premise');
    });

    it('should handle IMS authentication failure', async () => {
      setupFailedImsAuth(401);

      const result = await vulnerabilityAuditRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Failed to retrieve IMS token');
    });

    it('should handle Starfish Backend API failure', async () => {
      setupSuccessfulImsAuth();
      setupFailedVulnerabilityApi(500);

      const result = await vulnerabilityAuditRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('audit failed with error');
    });

    it('should handle 404 response when vulnerability report not found', async () => {
      setupSuccessfulImsAuth();
      setupVulnerabilityApi404();

      const result = await vulnerabilityAuditRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('fetch successful, but report was empty / null');
      expect(result.auditResult.finalUrl).to.equal('https://example.com');
      expect(context.log.warn).to.have.been.calledWithMatch(/vulnerability report not found/);
      expect(context.log.warn).to.have.been.calledWithMatch(/fetch successful, but report was empty \/ null/);
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

      const result = await mockedRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Failed to fetch vulnerability report');
    });

    it('should format errors with correct structure when any error is thrown', async () => {
      // Mock an error by making the site throw an error
      context.site.getDeliveryConfig = () => {
        throw new Error('Test error');
      };

      const result = await vulnerabilityAuditRunner(context);

      expect(result).to.have.property('fullAuditRef', 'https://example.com');
      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', false);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('error');
      expect(result.auditResult.error).to.include(
        '[security-vulnerabilities] [Site: a1b2c3d4-e5f6-7890-abcd-ef1234567890] audit failed with error: Test error',
      );
    });

    it('should successfully fetch vulnerability report', async () => {
      setupSuccessfulImsAuth();
      setupSuccessfulVulnerabilityApi();

      const result = await vulnerabilityAuditRunner(context);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.vulnerabilityReport).to.deep.equal(mockVulnerabilityReport);
      expect(result.auditResult.finalUrl).to.equal('https://example.com');
    });
  });

  describe('opportunityAndSuggestionsStep', () => {
    it('should skip when audit failed', async () => {
      context.audit = {
        getAuditResult: () => ({ success: false }),
      };
      try {
        await opportunityAndSuggestionsStep(context);
      } catch (error) {
        expect(error.message).to.equal('Audit failed, skipping suggestions generation');
      }
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
    });

    it('should handle no vulnerabilities scenario', async () => {
      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        }),
      };

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should handle opportunity fetching error when no vulnerabilities found', async () => {
      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        }),
      };

      // Mock opportunity fetching to fail
      context.site.getOpportunitiesByStatus.rejects(new Error('Database connection failed'));

      await expect(opportunityAndSuggestionsStep(context)).to.be.rejectedWith(
        'Failed to fetch opportunities for siteId a1b2c3d4-e5f6-7890-abcd-ef1234567890: Database connection failed',
      );
    });

    it('should update existing opportunity to RESOLVED when no vulnerabilities found', async () => {
      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        }),
      };

      // Mock existing opportunity
      const suggestions = [
        {
          getId: () => 'suggestion1',
          getStatus: () => 'NEW',
          getData: () => ({ library: 'libA', current_version: '1.0.0', dependency_tree: [] }),
        },
        {
          getId: () => 'suggestion2',
          getStatus: () => 'NEW',
          getData: () => ({ library: 'libB', current_version: '2.0.0', dependency_tree: [] }),
        },
      ];
      const mockOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        setStatus: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves(suggestions),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        setUpdatedBy: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
      };

      context.site.getOpportunitiesByStatus.resolves([mockOpportunity]);

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(mockOpportunity.setStatus).to.have.been.calledWith('RESOLVED');
      // Read twice now: once by the base sync, once by the FIXED-reconcile pass (§10).
      expect(mockOpportunity.getSuggestions).to.have.been.calledTwice;
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledWith(
        suggestions,
        'OUTDATED',
      );
      expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(mockOpportunity.save).to.have.been.calledOnce;
    });

    it('self-fixes a disappeared NEW finding to FIXED (customer-self-fix) and resolves the opportunity on an all-clear audit', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler) => handler !== 'summit-plg'),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        }),
      };

      // A NEW finding with no fix entity — the customer upgraded the dependency themselves,
      // so it disappears from the all-clear scan. Stateful status so the base sync (which
      // runs after reconcile) sees the reconciled FIXED and does not re-age it.
      let selfStatus = 'NEW';
      const selfFixedSuggestion = {
        getId: () => 'sugg-self',
        getStatus: () => selfStatus,
        getData: () => ({ library: 'libA', current_version: '1.0.0', dependency_tree: [] }),
        setStatus: sandbox.stub().callsFake((v) => { selfStatus = v; }),
        setData: sandbox.stub(),
        setRank: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };

      const mockOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        setStatus: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([selfFixedSuggestion]),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        setUpdatedBy: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
      };
      context.site.getOpportunitiesByStatus.resolves([mockOpportunity]);
      context.dataAccess.Suggestion.saveMany = sandbox.stub().resolves();
      context.dataAccess.FixEntity = {
        getAllFixesWithSuggestionsByOpportunityId: sandbox.stub().resolves([]),
        saveMany: sandbox.stub().resolves(),
      };

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      // Self-fix: NEW → FIXED, backed by a newly-created customer-self-fix DEPLOYED fix.
      expect(selfFixedSuggestion.setStatus).to.have.been.calledWith('FIXED');
      expect(mockOpportunity.addFixEntities).to.have.been.calledOnce;
      const [payloads] = mockOpportunity.addFixEntities.getCall(0).args;
      expect(payloads[0].origin).to.equal('customer-self-fix');
      expect(payloads[0].status).to.equal('DEPLOYED');
      // Not aged to OUTDATED — the base sync sees it already FIXED (protected).
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
      // Opportunity resolved.
      expect(mockOpportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(mockOpportunity.save).to.have.been.calledOnce;
    });

    it('promotes an asserted FIXED+PENDING suggestion to DEPLOYED on an all-clear rescan (§10.2 wiring)', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler) => handler !== 'summit-plg'),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        }),
      };

      // A human asserted this FIXED but the fix is only PENDING; the rescan now shows the
      // vuln gone → confirm it (promote the fix, keep the suggestion FIXED).
      const assertedSuggestion = {
        getId: () => 'sugg-asserted',
        getStatus: () => 'FIXED',
        getData: () => ({ library: 'libA', current_version: '1.0.0', dependency_tree: [] }),
        setStatus: sandbox.stub(),
        setData: sandbox.stub(),
        setRank: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const pendingFixEntity = {
        getId: () => 'fe-asserted',
        getStatus: () => 'PENDING',
        getExecutedAt: () => new Date().toISOString(),
        setStatus: sandbox.stub(),
        setDeployedAt: sandbox.stub(),
      };

      const mockOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        setStatus: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([assertedSuggestion]),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        setUpdatedBy: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
      };
      context.site.getOpportunitiesByStatus.resolves([mockOpportunity]);
      context.dataAccess.Suggestion.saveMany = sandbox.stub().resolves();
      context.dataAccess.FixEntity = {
        getAllFixesWithSuggestionsByOpportunityId: sandbox.stub().resolves([
          { fixEntity: pendingFixEntity, suggestions: [assertedSuggestion] },
        ]),
        saveMany: sandbox.stub().resolves(),
      };

      await opportunityAndSuggestionsStep(context);

      // §10.2: the PENDING fix is promoted to DEPLOYED (+ deployedAt); the suggestion stays FIXED.
      expect(pendingFixEntity.setStatus).to.have.been.calledWith('DEPLOYED');
      expect(pendingFixEntity.setDeployedAt).to.have.been.calledWith(sinon.match.string);
      expect(context.dataAccess.FixEntity.saveMany).to.have.been.calledWith([pendingFixEntity]);
      expect(assertedSuggestion.setStatus).to.not.have.been.called;
    });

    it('should handle no vulnerabilities scenario when no existing opportunity found', async () => {
      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        }),
      };

      // Mock no existing opportunities
      context.site.getOpportunitiesByStatus.resolves([]);

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should not create suggestions for components whose vulnerabilities are all ignored (null/empty)', async () => {
      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_ALL_IGNORED,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      // Components with vulnerabilities=null are non-actionable — no opportunity gets created.
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should resolve a stale opportunity when every reported component has all vulnerabilities ignored', async () => {
      const suggestions = [
        {
          getId: () => 'suggestion1',
          getStatus: () => 'NEW',
          getData: () => ({ library: 'libA', current_version: '1.0.0', dependency_tree: [] }),
        },
      ];
      const staleOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        setStatus: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves(suggestions),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        setUpdatedBy: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
      };
      context.site.getOpportunitiesByStatus.resolves([staleOpportunity]);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_ALL_IGNORED,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(staleOpportunity.setStatus).to.have.been.calledWith('RESOLVED');
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledWith(suggestions, 'OUTDATED');
    });

    it('should process vulnerabilities and create opportunities with suggestions', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      // Enable both opportunity creation and auto-suggest
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities').returns(true);
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities-auto-suggest').returns(true);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_WITH_VULNERABILITIES,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      const result = await opportunityAndSuggestionsStep(context);

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
      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_MULTIPLE_COMPONENTS,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      const result = await opportunityAndSuggestionsStep(context);

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

    it('self-fixes a NEW finding that drops out of a later scan (FIXED + customer-self-fix), refreshing still-present ones', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub().returns(true),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      // One existing NEW suggestion per component in the older scan. Stateful status so the
      // base sync (which runs after reconcile) sees the reconciled FIXED and never re-ages it.
      const existingSuggestions = VULNERABILITY_REPORT_OLD_SCAN.vulnerableComponents.map(
        (component) => {
          let status = 'NEW';
          return {
            getId: () => `suggestion-${component.name}`,
            getData: () => ({
              library: component.name,
              current_version: component.version,
              recommended_version: component.recommendedVersion,
              cves: (component.vulnerabilities || []).map((vuln) => ({
                cve_id: vuln.id,
                score: vuln.score,
              })),
              dependency_tree: component.dependencyTree,
            }),
            getStatus: () => status,
            setStatus: sandbox.stub().callsFake((v) => { status = v; }),
            setData: sandbox.stub(),
            setRank: sandbox.stub(),
            setUpdatedBy: sandbox.stub(),
          };
        },
      );

      const existingOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        getData: () => ({}),
        setData: sandbox.stub(),
        setAuditId: sandbox.stub(),
        // SITES-49175 — self-heal legacy NULL-scope rows on every audit touch
        setScopeType: sandbox.stub(),
        setScopeId: sandbox.stub(),
        getScopeType: () => null,
        getScopeId: () => null,
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves(existingSuggestions),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      context.dataAccess.Suggestion.saveMany = sandbox.stub().resolves();
      context.dataAccess.FixEntity = {
        getAllFixesWithSuggestionsByOpportunityId: sandbox.stub().resolves([]),
        saveMany: sandbox.stub().resolves(),
      };

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NEW_SCAN,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });

      // The dropped-out httpclient NEW finding has no fix entity → customer self-fix:
      // FIXED + a customer-self-fix DEPLOYED fix, NOT aged to OUTDATED.
      const httpclient = existingSuggestions.find(
        (s) => s.getId() === 'suggestion-org.apache.httpcomponents:httpclient',
      );
      expect(httpclient.setStatus).to.have.been.calledWith('FIXED');
      expect(existingOpportunity.addFixEntities).to.have.been.calledOnce;
      const [payloads] = existingOpportunity.addFixEntities.getCall(0).args;
      expect(payloads).to.have.lengthOf(1);
      expect(payloads[0].origin).to.equal('customer-self-fix');
      expect(payloads[0].suggestions).to.deep.equal([
        'suggestion-org.apache.httpcomponents:httpclient',
      ]);
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;

      // Matched suggestions (component present in both scans) must have their
      // dependency_tree refreshed to the new scan's tree, with no leftover/duplicate
      // raw fields from the merge.
      const jettySuggestion = existingSuggestions.find(
        (s) => s.getId() === 'suggestion-org.eclipse.jetty:jetty-util-ajax',
      );
      const newJettyComponent = VULNERABILITY_REPORT_NEW_SCAN.vulnerableComponents.find(
        (c) => c.name === 'org.eclipse.jetty:jetty-util-ajax',
      );
      expect(jettySuggestion.setData).to.have.been.calledOnce;
      const updatedData = jettySuggestion.setData.getCall(0).args[0];
      expect(Object.keys(updatedData)).to.deep.equal([
        'library', 'current_version', 'recommended_version', 'cves', 'dependency_tree',
      ]);
      expect(updatedData.dependency_tree).to.deep.equal(newJettyComponent.dependencyTree);
    });

    it('regression: leaves the FIXED+DEPLOYED pair untouched and opens a fresh NEW finding to restart the lifecycle', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler) => handler !== 'summit-plg'),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      const actionable = VULNERABILITY_REPORT_WITH_VULNERABILITIES.vulnerableComponents
        .filter((c) => (c.vulnerabilities || []).length > 0);
      const regressed = actionable[0];

      // A verified FIXED suggestion for a component that is STILL present in the scan.
      let status = 'FIXED';
      const fixedSuggestion = {
        getId: () => `suggestion-${regressed.name}`,
        getStatus: () => status,
        getData: () => ({
          library: regressed.name,
          current_version: regressed.version,
          recommended_version: regressed.recommendedVersion,
          cves: [],
          dependency_tree: regressed.dependencyTree,
        }),
        setStatus: sandbox.stub().callsFake((v) => { status = v; }),
        setData: sandbox.stub(),
        setRank: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const deployedFixEntity = {
        getId: () => 'fe-regressed',
        getStatus: () => 'DEPLOYED',
        setStatus: sandbox.stub(),
        setDeployedAt: sandbox.stub(),
      };

      const existingOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        getData: () => ({}),
        setData: sandbox.stub(),
        setAuditId: sandbox.stub(),
        setScopeType: sandbox.stub(),
        setScopeId: sandbox.stub(),
        getScopeType: () => null,
        getScopeId: () => null,
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([fixedSuggestion]),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      context.dataAccess.Suggestion.saveMany = sandbox.stub().resolves();
      context.dataAccess.FixEntity = {
        getAllFixesWithSuggestionsByOpportunityId: sandbox.stub().resolves([
          { fixEntity: deployedFixEntity, suggestions: [fixedSuggestion] },
        ]),
        saveMany: sandbox.stub().resolves(),
      };

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_WITH_VULNERABILITIES,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      await opportunityAndSuggestionsStep(context);

      // Regression: the FIXED suggestion and its DEPLOYED fix are left exactly as-is (no
      // OUTDATED, no rollback) — but a fresh NEW finding is opened to restart the lifecycle.
      expect(fixedSuggestion.setStatus).to.not.have.been.called;
      expect(deployedFixEntity.setStatus).to.not.have.been.called;
      expect(context.dataAccess.FixEntity.saveMany).to.not.have.been.called;
      const opened = existingOpportunity.addSuggestions.getCalls()
        .flatMap((c) => c.args[0])
        .find((p) => p?.data?.library === regressed.name);
      expect(opened).to.exist;
      expect(opened.status).to.equal('NEW');
    });

    it('should leave a still-present IN_PROGRESS suggestion unchanged (not FIXED, not OUTDATED)', async () => {
      // §T2.4 — a vuln still detected because the customer has not merged yet must stay
      // IN_PROGRESS across a re-audit (its component is still in the report).
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler) => handler !== 'summit-plg'),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      const actionable = VULNERABILITY_REPORT_WITH_VULNERABILITIES.vulnerableComponents
        .filter((c) => (c.vulnerabilities || []).length > 0);
      const existingSuggestions = actionable.map((component, i) => ({
        getId: () => `suggestion-${component.name}`,
        getData: () => ({
          library: component.name,
          current_version: component.version,
          recommended_version: component.recommendedVersion,
          cves: [],
          dependency_tree: component.dependencyTree,
        }),
        // The first component's suggestion is mid-fix (IN_PROGRESS); it is still present.
        getStatus: () => (i === 0 ? 'IN_PROGRESS' : 'NEW'),
        setStatus: sandbox.stub(),
        setData: sandbox.stub(),
        setRank: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      }));
      const inProgressSuggestion = existingSuggestions[0];

      const existingOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        getData: () => ({}),
        setData: sandbox.stub(),
        setAuditId: sandbox.stub(),
        setScopeType: sandbox.stub(),
        setScopeId: sandbox.stub(),
        getScopeType: () => null,
        getScopeId: () => null,
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves(existingSuggestions),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      context.dataAccess.Suggestion.saveMany = sandbox.stub().resolves();

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_WITH_VULNERABILITIES,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      await opportunityAndSuggestionsStep(context);

      // Still present → not a disappeared candidate; matched-status merge keeps IN_PROGRESS.
      expect(inProgressSuggestion.setStatus).to.not.have.been.called;
    });

    it('should preserve an already-FIXED suggestion through an all-clear audit (§T3.2)', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler) => handler !== 'summit-plg'),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          success: true,
        }),
      };

      const fixedSuggestion = {
        getId: () => 'sugg-fixed',
        getStatus: () => 'FIXED',
        getData: () => ({ library: 'libA', current_version: '1.0.0', dependency_tree: [] }),
        setStatus: sandbox.stub(),
        setData: sandbox.stub(),
        setRank: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };

      const mockOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        setStatus: sandbox.stub().resolves(),
        getSuggestions: sandbox.stub().resolves([fixedSuggestion]),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        addFixEntities: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        setUpdatedBy: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
      };
      context.site.getOpportunitiesByStatus.resolves([mockOpportunity]);
      context.dataAccess.Suggestion.saveMany = sandbox.stub().resolves();

      await opportunityAndSuggestionsStep(context);

      // The FIXED suggestion is protected — never re-touched or aged to OUTDATED.
      expect(fixedSuggestion.setStatus).to.not.have.been.called;
      expect(mockOpportunity.setStatus).to.have.been.calledWith('RESOLVED');
    });

    it('should skip starfish-auto-code when auto suggest is disabled', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities').returns(true);
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities-auto-suggest').returns(false);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_WITH_VULNERABILITIES,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('should handle auto suggest to trigger starfish-auto-code', async () => {
      const mockOpportunity = {
        getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        getType: () => 'security-vulnerabilities',
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub()
          // call 0: base sync (no existing) · call 1: FIXED-reconcile pass (nothing to
          // reconcile) · call 2: dispatch step reads the freshly-created suggestions.
          .onCall(0)
          .resolves([])
          .onCall(1)
          .resolves([])
          .onCall(2)
          .resolves([
            { getId: () => 'suggestion-new', getStatus: () => 'NEW' },
            { getId: () => 'suggestion-pending', getStatus: () => 'PENDING_VALIDATION' },
            { getId: () => 'suggestion-fixed', getStatus: () => 'FIXED' },
          ]),
      };

      context.dataAccess.Opportunity.create.resolves(mockOpportunity);
      context.dataAccess.Opportunity.findById.resolves(null);

      const configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities').returns(true);
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities-auto-suggest').returns(true);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_WITH_VULNERABILITIES,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      const codeData = [
        {
          result: [
            {
              codeBucket: 'spacecat-importer-bucket',
              codePath: 'code/ad3d5bb7-9e85-4195-94e8-833cc5a73253/github/adobe/mystique-project/main/repository.zip',
            },
          ],
        },
      ];

      context.data = { importResults: codeData };
      context.env.QUEUE_SPACECAT_TO_STARFISH_AUTO_CODE = 'test-starfish-queue';

      const result = await opportunityAndSuggestionsStep(context);
      expect(result).to.deep.equal({ status: 'complete' });

      // Verify SQS message to starfish-auto-code was sent
      expect(context.sqs.sendMessage).to.have.been.calledOnce;

      // Verify the queue URL and message structure
      const messageCall = context.sqs.sendMessage.getCall(0);
      expect(messageCall.args[0]).to.equal('test-starfish-queue');
      const message = messageCall.args[1];

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(message).to.have.property('type', 'codefix:security-vulnerabilities');
      expect(message).to.have.property('siteId', context.site.getId());
      expect(message).to.have.property('auditId', 'test-audit-id');
      expect(message).to.have.property('deliveryType', 'aem_cs');
      expect(message.data).to.have.property('opportunityId');
      expect(message.data).to.have.property('suggestionIds');
      expect(message.data.suggestionIds).to.deep.equal([
        'suggestion-new',
        'suggestion-pending',
      ]);
      expect(message.data).to.have.property('codeBucket', 'spacecat-importer-bucket');
      expect(message.data).to.have.property(
        'codePath',
        'code/ad3d5bb7-9e85-4195-94e8-833cc5a73253/github/adobe/mystique-project/main/repository.zip',
      );
      expect(message.data).to.have.property('imsOrg', 'test-ims-org');
    });

    it('should skip starfish-auto-code when queue env var is not configured', async () => {
      const configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities').returns(true);
      configuration.isHandlerEnabledForSite.withArgs('security-vulnerabilities-auto-suggest').returns(true);

      context.audit = {
        getAuditResult: () => ({
          vulnerabilityReport: VULNERABILITY_REPORT_WITH_VULNERABILITIES,
          success: true,
        }),
        getId: () => 'test-audit-id',
      };

      context.data = {
        importResults: [{
          result: [{
            codeBucket: 'spacecat-importer-bucket',
            codePath: 'code/test/repository.zip',
          }],
        }],
      };

      // QUEUE_SPACECAT_TO_STARFISH_AUTO_CODE is not set in context.env

      const result = await opportunityAndSuggestionsStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(context.log.warn).to.have.been.calledWithMatch(/QUEUE_SPACECAT_TO_STARFISH_AUTO_CODE is not configured/);
    });

  });

  describe('extractCodeBucket', () => {
    it('should return code bucket data when audit succeeds', async () => {
      // Setup successful audit
      setupSuccessfulImsAuth();
      setupSuccessfulVulnerabilityApi();

      const { extractCodeBucket } = await import('../../src/vulnerabilities/handler.js');

      const result = await extractCodeBucket(context);

      expect(result).to.have.property('type', 'code');
      expect(result).to.have.property('siteId', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
      expect(result.auditResult).to.have.property('success', true);
    });

    it('should throw error when audit fails', async () => {
      // Setup failed audit
      context.site.getDeliveryType = () => 'other';

      const { extractCodeBucket } = await import('../../src/vulnerabilities/handler.js');

      try {
        await extractCodeBucket(context);
      } catch (error) {
        expect(error.message).to.equal('Audit failed, skipping call to import worker');
      }
    });
  });

  describe('toSuggestionData', () => {
    it('transforms a raw component into the canonical suggestion data shape', () => {
      const component = {
        name: 'com.fasterxml.jackson.core:jackson-databind',
        version: '2.12.3',
        recommendedVersion: '2.12.6.1',
        vulnerabilities: [
          { id: 'CVE-A', score: 5.5, severity: 'Medium', description: 'desc-a', url: 'https://a' },
          { id: 'CVE-B', score: 7.5, severity: 'High', description: 'desc-b' },
        ],
        dependencyTree: ['[root]', 'parent@1.0.0'],
      };

      expect(toSuggestionData(component)).to.deep.equal({
        library: 'com.fasterxml.jackson.core:jackson-databind',
        current_version: '2.12.3',
        recommended_version: '2.12.6.1',
        cves: [
          { cve_id: 'CVE-B', score: 7.5, score_text: '7.5 High', summary: 'desc-b', url: '' },
          { cve_id: 'CVE-A', score: 5.5, score_text: '5.5 Medium', summary: 'desc-a', url: 'https://a' },
        ],
        dependency_tree: ['[root]', 'parent@1.0.0'],
      });
    });

    it('defaults cves and dependency_tree to empty arrays when both are missing', () => {
      const component = { name: 'lib-x', version: '1.0.0' };

      expect(toSuggestionData(component)).to.deep.equal({
        library: 'lib-x',
        current_version: '1.0.0',
        recommended_version: undefined,
        cves: [],
        dependency_tree: [],
      });
    });

    it('defaults dependency_tree to an empty array when dependencyTree is null', () => {
      // Same scanner reports ignoredVulnerabilities: null elsewhere, so a null
      // dependencyTree is a plausible upstream shape, not just a hypothetical.
      const component = { name: 'x', version: '1', dependencyTree: null };

      expect(toSuggestionData(component).dependency_tree).to.deep.equal([]);
      // Must not throw - a bare destructuring default only covers undefined, not null.
      expect(() => buildKey(toSuggestionData(component))).to.not.throw();
    });

    it('formats a zero score as "0" instead of "0.0"', () => {
      const component = {
        name: 'lib-x',
        version: '1.0.0',
        vulnerabilities: [{ id: 'CVE-A', score: 0, severity: 'Low', description: 'desc' }],
      };

      expect(toSuggestionData(component).cves[0]).to.have.property('score_text', '0 Low');
    });
  });

  describe('mapVulnerabilityToSuggestion', () => {
    it('wraps already-transformed suggestion data 1:1, ranked by highest CVE score', () => {
      const opportunity = { getId: () => 'opp-123' };
      const suggestionData = toSuggestionData({
        name: 'lib-x',
        version: '1.0.0',
        vulnerabilities: [{ id: 'CVE-A', score: 3.1, severity: 'Low' }],
      });

      const result = mapVulnerabilityToSuggestion(opportunity, suggestionData);

      expect(result).to.deep.equal({
        opportunityId: 'opp-123',
        type: 'CODE_CHANGE',
        rank: 3.1,
        data: suggestionData,
      });
    });

    it('ranks a suggestion with no CVEs as 0', () => {
      const opportunity = { getId: () => 'opp-456' };
      const suggestionData = toSuggestionData({ name: 'lib-x', version: '1.0.0' });

      const result = mapVulnerabilityToSuggestion(opportunity, suggestionData);

      expect(result.rank).to.equal(0);
    });
  });
});

describe('extractCodeInfo', () => {
  describe('returns code info for valid data', () => {
    it('accepts valid nested structure with codeBucket and codePath', () => {
      const data = {
        importResults: [{
          result: [{
            codeBucket: 'spacecat-importer-bucket',
            codePath: 'code/test/repository.zip',
          }],
        }],
      };
      expect(extractCodeInfo(data)).to.deep.equal({
        codeBucket: 'spacecat-importer-bucket',
        codePath: 'code/test/repository.zip',
      });
    });

    it('accepts data with whitespace that trims to valid strings', () => {
      const data = {
        importResults: [{
          result: [{
            codeBucket: '  my-bucket  ',
            codePath: '  path/to/code  ',
          }],
        }],
      };
      expect(extractCodeInfo(data)).to.deep.equal({
        codeBucket: '  my-bucket  ',
        codePath: '  path/to/code  ',
      });
    });

    it('accepts data with multiple importResults or results (uses first)', () => {
      const multipleImportResults = {
        importResults: [
          { result: [{ codeBucket: 'bucket-1', codePath: 'path-1' }] },
          { result: [{ codeBucket: 'bucket-2', codePath: 'path-2' }] },
        ],
      };
      const multipleResults = {
        importResults: [{
          result: [
            { codeBucket: 'bucket-1', codePath: 'path-1' },
            { codeBucket: 'bucket-2', codePath: 'path-2' },
          ],
        }],
      };
      expect(extractCodeInfo(multipleImportResults)).to.deep.equal({
        codeBucket: 'bucket-1',
        codePath: 'path-1',
      });
      expect(extractCodeInfo(multipleResults)).to.deep.equal({
        codeBucket: 'bucket-1',
        codePath: 'path-1',
      });
    });
  });

  describe('returns null for invalid data', () => {
    it('rejects invalid top-level data', () => {
      expect(extractCodeInfo(null)).to.be.null;
      expect(extractCodeInfo(undefined)).to.be.null;
      expect(extractCodeInfo('not an object')).to.be.null;
      expect(extractCodeInfo(123)).to.be.null;
      expect(extractCodeInfo({})).to.be.null;
    });

    it('rejects invalid importResults', () => {
      expect(extractCodeInfo({ otherProperty: 'value' })).to.be.null;
      expect(extractCodeInfo({ importResults: null })).to.be.null;
      expect(extractCodeInfo({ importResults: 'not-an-array' })).to.be.null;
      expect(extractCodeInfo({ importResults: [] })).to.be.null;
      expect(extractCodeInfo({ importResults: [null] })).to.be.null;
      expect(extractCodeInfo({ importResults: ['not-an-object'] })).to.be.null;
    });

    it('rejects invalid result property', () => {
      expect(extractCodeInfo({ importResults: [{ otherProperty: 'value' }] })).to.be.null;
      expect(extractCodeInfo({ importResults: [{ result: null }] })).to.be.null;
      expect(extractCodeInfo({ importResults: [{ result: 'not-an-array' }] })).to.be.null;
      expect(extractCodeInfo({ importResults: [{ result: [] }] })).to.be.null;
      expect(extractCodeInfo({ importResults: [{ result: [null] }] })).to.be.null;
      expect(extractCodeInfo({ importResults: [{ result: ['not-an-object'] }] })).to.be.null;
    });

    it('rejects missing or invalid codeBucket', () => {
      expect(extractCodeInfo({
        importResults: [{ result: [{ codePath: 'path/to/code' }] }],
      })).to.be.null;
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: null, codePath: 'path/to/code' }] }],
      })).to.be.null;
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: 123, codePath: 'path/to/code' }] }],
      })).to.be.null;
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: '', codePath: 'path/to/code' }] }],
      })).to.be.null;
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: '   ', codePath: 'path/to/code' }] }],
      })).to.be.null;
    });

    it('rejects missing or invalid codePath', () => {
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: 'my-bucket' }] }],
      })).to.be.null;
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: 'my-bucket', codePath: 123 }] }],
      })).to.be.null;
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: 'my-bucket', codePath: '' }] }],
      })).to.be.null;
      expect(extractCodeInfo({
        importResults: [{ result: [{ codeBucket: 'my-bucket', codePath: '   ' }] }],
      })).to.be.null;
    });
  });

  describe('buildKey', () => {
    it('builds key from library@version and dependency tree, stripping [root] and parent @version', () => {
      const key = buildKey({
        library: 'com.fasterxml.jackson.core:jackson-databind',
        current_version: '2.12.3',
        dependency_tree: [
          '[root]',
          'biz.netcentric.cq.tools.accesscontroltool/accesscontroltool-bundle@3.5.1',
        ],
      });
      expect(key).to.equal(
        'com.fasterxml.jackson.core:jackson-databind@2.12.3-biz.netcentric.cq.tools.accesscontroltool/accesscontroltool-bundle',
      );
    });

    it('distinguishes the same library at different versions', () => {
      const keyOld = buildKey({
        library: 'lib-x',
        current_version: '1.0.0',
        dependency_tree: ['[root]', 'parent-a@1.0.0'],
      });
      const keyNew = buildKey({
        library: 'lib-x',
        current_version: '1.0.1',
        dependency_tree: ['[root]', 'parent-a@1.0.0'],
      });
      expect(keyOld).to.not.equal(keyNew);
    });

    it('produces identical keys before and after a round-trip through toSuggestionData', () => {
      const rawComponent = {
        name: 'com.fasterxml.jackson.core:jackson-databind',
        version: '2.12.3',
        recommendedVersion: '2.12.6.1',
        vulnerabilities: [{ id: 'CVE-2020-36518', score: 7.5 }],
        dependencyTree: [
          '[root]',
          'biz.netcentric.cq.tools.accesscontroltool/accesscontroltool-bundle@3.5.1',
        ],
      };
      const storedData = {
        library: 'com.fasterxml.jackson.core:jackson-databind',
        current_version: '2.12.3',
        recommended_version: '2.12.6.1',
        cves: [{ cve_id: 'CVE-2020-36518', score: 7.5 }],
        dependency_tree: [
          '[root]',
          'biz.netcentric.cq.tools.accesscontroltool/accesscontroltool-bundle@3.5.1',
        ],
      };
      expect(buildKey(toSuggestionData(rawComponent))).to.equal(buildKey(storedData));
    });

    it('distinguishes same library reached via different dependency paths', () => {
      const keyA = buildKey({
        library: 'lib-x',
        dependency_tree: ['[root]', 'parent-a@1.0.0'],
      });
      const keyB = buildKey({
        library: 'lib-x',
        dependency_tree: ['[root]', 'parent-b@1.0.0'],
      });
      expect(keyA).to.not.equal(keyB);
    });

    it('ignores transitive parent versions in the dependency tree', () => {
      const keyOld = buildKey({
        library: 'lib-x',
        current_version: '1.0.0',
        dependency_tree: ['[root]', 'parent-a@1.0.0'],
      });
      const keyNew = buildKey({
        library: 'lib-x',
        current_version: '1.0.0',
        dependency_tree: ['[root]', 'parent-a@2.5.9'],
      });
      expect(keyOld).to.equal(keyNew);
    });

    it('handles missing dependency_tree by falling back to library@version only', () => {
      expect(buildKey({ library: 'lib-x', current_version: '1.0.0' })).to.equal('lib-x@1.0.0');
    });

    it('handles a null dependency_tree (as persisted by the database) without throwing', () => {
      expect(buildKey({
        library: 'lib-x', current_version: '1.0.0', dependency_tree: null,
      })).to.equal('lib-x@1.0.0');
    });

    it('handles empty dependency_tree array', () => {
      expect(buildKey({ library: 'lib-x', current_version: '1.0.0', dependency_tree: [] })).to.equal('lib-x@1.0.0');
    });

    it('handles tree entries without any @version suffix', () => {
      const key = buildKey({
        library: 'lib-x',
        current_version: '1.0.0',
        dependency_tree: ['[root]', 'parent-with-no-version'],
      });
      expect(key).to.equal('lib-x@1.0.0-parent-with-no-version');
    });

    it('strips only the trailing @version when entry contains multiple "@"', () => {
      const key = buildKey({
        library: 'lib-x',
        current_version: '1.0.0',
        dependency_tree: ['@scope/pkg@1.0.0'],
      });
      expect(key).to.equal('lib-x@1.0.0-@scope/pkg');
    });

    it('preserves dependency tree ordering in the key', () => {
      const keyAB = buildKey({
        library: 'lib-x',
        current_version: '1.0.0',
        dependency_tree: ['parent-a@1', 'parent-b@1'],
      });
      const keyBA = buildKey({
        library: 'lib-x',
        current_version: '1.0.0',
        dependency_tree: ['parent-b@1', 'parent-a@1'],
      });
      expect(keyAB).to.not.equal(keyBA);
    });

    it('matches on a real fixture entry once transformed by toSuggestionData', () => {
      const raw = VULNERABILITY_REPORT_WITH_VULNERABILITIES.vulnerableComponents[0];
      const mapped = {
        library: raw.name,
        current_version: raw.version,
        recommended_version: raw.recommendedVersion,
        cves: [],
        dependency_tree: raw.dependencyTree,
      };
      expect(buildKey(toSuggestionData(raw))).to.equal(buildKey(mapped));
      expect(buildKey(toSuggestionData(raw))).to.include(`@${raw.version}`);
    });
  });
});

describe('buildVulnFixEntityPayload', () => {
  it('builds a DEPLOYED CODE_CHANGE self-fix payload stamped with the customer-self-fix origin', () => {
    const suggestion = {
      getId: () => 's1',
      getData: () => ({
        library: 'org.apache.httpcomponents:httpclient',
        current_version: '4.5.13',
        recommended_version: '4.5.14',
        dependency_tree: ['root', 'httpclient'],
      }),
    };
    const opportunity = { getId: () => 'oppty-1' };
    const site = { getDeliveryType: () => 'aem_cs' };

    const payload = buildVulnFixEntityPayload(suggestion, opportunity, site);

    expect(payload.opportunityId).to.equal('oppty-1');
    expect(payload.type).to.equal('CODE_CHANGE');
    expect(payload.status).to.equal('DEPLOYED');
    // Distinguishes a customer self-fix from ASO/automated fixes (origin 'spacecat').
    expect(payload.origin).to.equal('customer-self-fix');
    expect(payload.suggestions).to.deep.equal(['s1']);
    expect(payload.executedAt).to.be.a('string');
    // A self-fix is already live — stamp deployedAt.
    expect(payload.deployedAt).to.be.a('string');
    expect(payload.changeDetails).to.deep.include({
      system: 'aem_cs',
      library: 'org.apache.httpcomponents:httpclient',
      oldValue: '4.5.13',
      updatedValue: '4.5.14',
      dependencyTree: ['root', 'httpclient'],
    });
  });
});

describe('reconcileVulnSuggestions', () => {
  const sandbox = sinon.createSandbox();

  // data whose buildKey resolves to `key` (empty dependency_tree → key === library@version).
  const dataFor = (key) => ({
    library: key.split('@')[0],
    current_version: key.split('@')[1],
    dependency_tree: [],
  });

  const makeSuggestion = (id, status, key) => ({
    getId: () => id,
    getStatus: () => status,
    getData: () => dataFor(key),
    setStatus: sandbox.stub(),
    setUpdatedBy: sandbox.stub(),
  });

  const makeFixEntity = (id, status, { executedAt } = {}) => ({
    getId: () => id,
    getStatus: () => status,
    getExecutedAt: () => executedAt,
    setStatus: sandbox.stub(),
    setDeployedAt: sandbox.stub(),
  });

  const makeOpportunity = (suggestions) => ({
    getId: () => 'oppty-1',
    getSuggestions: sandbox.stub().resolves(suggestions),
    addSuggestions: sandbox.stub().resolves({ errorItems: [] }),
    addFixEntities: sandbox.stub().resolves({ errorItems: [] }),
  });

  const makeContext = ({ fixes = [], site = { getDeliveryType: () => 'aem_cs' } } = {}) => ({
    site,
    log: { warn: sandbox.stub(), debug: sandbox.stub(), info: sandbox.stub() },
    dataAccess: {
      FixEntity: {
        getAllFixesWithSuggestionsByOpportunityId: sandbox.stub().resolves(fixes),
        saveMany: sandbox.stub().resolves(),
      },
      Suggestion: { saveMany: sandbox.stub().resolves() },
    },
  });

  afterEach(() => sandbox.restore());

  // --- customer self-fix (disappeared open finding with no fix) ---

  it('self-fix: a disappeared NEW finding with no fix becomes FIXED with a customer-self-fix DEPLOYED fix', async () => {
    const s = makeSuggestion('s1', 'NEW', 'lib@1.0.0');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(s.setStatus).to.have.been.calledWith('FIXED');
    expect(s.setUpdatedBy).to.have.been.calledWith('system');
    expect(opportunity.addFixEntities).to.have.been.calledOnce;
    const [payloads] = opportunity.addFixEntities.getCall(0).args;
    expect(payloads).to.have.lengthOf(1);
    expect(payloads[0].status).to.equal('DEPLOYED');
    expect(payloads[0].origin).to.equal('customer-self-fix');
    expect(payloads[0].suggestions).to.deep.equal(['s1']);
    expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([s]);
  });

  it('self-fix: also resolves a disappeared PENDING_VALIDATION finding (paid site)', async () => {
    const s = makeSuggestion('s1', 'PENDING_VALIDATION', 'lib@1.0.0');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(s.setStatus).to.have.been.calledWith('FIXED');
    expect(opportunity.addFixEntities).to.have.been.calledOnce;
  });

  it('self-fix: creates the fix entity before flipping the suggestion FIXED', async () => {
    const s = makeSuggestion('s1', 'NEW', 'lib@1.0.0');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(opportunity.addFixEntities)
      .to.have.been.calledBefore(context.dataAccess.Suggestion.saveMany);
  });

  it('self-fix: leaves the suggestion unchanged when creating its fix entity fails', async () => {
    const s = makeSuggestion('s1', 'NEW', 'lib@1.0.0');
    const opportunity = makeOpportunity([s]);
    opportunity.addFixEntities.rejects(new Error('boom'));
    const context = makeContext({ fixes: [] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(context.log.warn).to.have.been.called;
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('self-fix edge: a disappeared open finding with a PENDING fix is FIXED and its fix promoted (no new fix)', async () => {
    const s = makeSuggestion('s1', 'NEW', 'lib@1.0.0');
    const pending = makeFixEntity('fe1', 'PENDING', { executedAt: new Date().toISOString() });
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [{ fixEntity: pending, suggestions: [s] }] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(s.setStatus).to.have.been.calledWith('FIXED');
    expect(pending.setStatus).to.have.been.calledWith('DEPLOYED');
    expect(pending.setDeployedAt).to.have.been.calledWith(sinon.match.string);
    expect(opportunity.addFixEntities).to.not.have.been.called;
  });

  it('self-fix idempotent: a disappeared finding already backed by a DEPLOYED fix is FIXED without a duplicate', async () => {
    const s = makeSuggestion('s1', 'NEW', 'lib@1.0.0');
    const deployed = makeFixEntity('fe1', 'DEPLOYED');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [{ fixEntity: deployed, suggestions: [s] }] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(s.setStatus).to.have.been.calledWith('FIXED');
    expect(opportunity.addFixEntities).to.not.have.been.called;
    expect(deployed.setStatus).to.not.have.been.called;
  });

  // --- FIXED-side reconciliation ---

  it('confirm: promotes the PENDING fix of a FIXED suggestion whose vuln is gone (keeps FIXED)', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const fix = makeFixEntity('fe1', 'PENDING', { executedAt: new Date().toISOString() });
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [{ fixEntity: fix, suggestions: [s] }] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(fix.setStatus).to.have.been.calledWith('DEPLOYED');
    expect(fix.setDeployedAt).to.have.been.calledWith(sinon.match.string);
    expect(context.dataAccess.FixEntity.saveMany).to.have.been.calledWith([fix]);
    expect(s.setStatus).to.not.have.been.called;
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('regression: leaves the FIXED suggestion and its DEPLOYED fix untouched and opens a fresh NEW finding to restart the lifecycle', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const fix = makeFixEntity('fe1', 'DEPLOYED');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [{ fixEntity: fix, suggestions: [s] }] });

    await reconcileVulnSuggestions(opportunity, [dataFor('lib@1.0.0')], context, context.log);

    // Old records untouched.
    expect(s.setStatus).to.not.have.been.called;
    expect(fix.setStatus).to.not.have.been.called;
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    expect(context.dataAccess.FixEntity.saveMany).to.not.have.been.called;
    // Exactly one fresh finding opened to restart the lifecycle.
    expect(opportunity.addSuggestions).to.have.been.calledOnce;
    const [payloads] = opportunity.addSuggestions.getCall(0).args;
    expect(payloads).to.have.lengthOf(1);
    expect(payloads[0].status).to.equal('NEW');
    expect(payloads[0].data).to.deep.equal(dataFor('lib@1.0.0'));
  });

  it('regression (paid): opens the restarted finding as PENDING_VALIDATION on a validation-required site', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const fix = makeFixEntity('fe1', 'DEPLOYED');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({
      fixes: [{ fixEntity: fix, suggestions: [s] }],
      site: { requiresValidation: true, getDeliveryType: () => 'aem_cs' },
    });

    await reconcileVulnSuggestions(opportunity, [dataFor('lib@1.0.0')], context, context.log);

    expect(s.setStatus).to.not.have.been.called;
    expect(fix.setStatus).to.not.have.been.called;
    const [payloads] = opportunity.addSuggestions.getCall(0).args;
    expect(payloads[0].status).to.equal('PENDING_VALIDATION');
  });

  it('regression: does not open a second finding when an active suggestion for the vuln already exists', async () => {
    const fixed = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const active = makeSuggestion('s2', 'NEW', 'lib@1.0.0');
    const fix = makeFixEntity('fe1', 'DEPLOYED');
    const opportunity = makeOpportunity([fixed, active]);
    const context = makeContext({ fixes: [{ fixEntity: fix, suggestions: [fixed] }] });

    await reconcileVulnSuggestions(opportunity, [dataFor('lib@1.0.0')], context, context.log);

    expect(opportunity.addSuggestions).to.not.have.been.called;
    expect(fixed.setStatus).to.not.have.been.called;
    expect(fix.setStatus).to.not.have.been.called;
  });

  it('wait: leaves a FIXED+PENDING suggestion untouched while the vuln persists but the fix is fresh', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const fix = makeFixEntity('fe1', 'PENDING', { executedAt: new Date().toISOString() });
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [{ fixEntity: fix, suggestions: [s] }] });

    await reconcileVulnSuggestions(opportunity, [dataFor('lib@1.0.0')], context, context.log);

    expect(s.setStatus).to.not.have.been.called;
    expect(fix.setStatus).to.not.have.been.called;
    expect(opportunity.addSuggestions).to.not.have.been.called;
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    expect(context.dataAccess.FixEntity.saveMany).to.not.have.been.called;
  });

  it('leaves a FIXED suggestion untouched when the vuln is present but it has no active fix entity', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    // A non-active (FAILED) fix is ignored, so the suggestion has no PENDING/DEPLOYED fix.
    const fix = makeFixEntity('fe1', 'FAILED');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [{ fixEntity: fix, suggestions: [s] }] });

    await reconcileVulnSuggestions(opportunity, [dataFor('lib@1.0.0')], context, context.log);

    expect(s.setStatus).to.not.have.been.called;
    expect(opportunity.addSuggestions).to.not.have.been.called;
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    expect(context.dataAccess.FixEntity.saveMany).to.not.have.been.called;
  });

  it('leaves a verified FIXED+DEPLOYED suggestion untouched while its vuln stays gone', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const fix = makeFixEntity('fe1', 'DEPLOYED');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [{ fixEntity: fix, suggestions: [s] }] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(s.setStatus).to.not.have.been.called;
    expect(fix.setStatus).to.not.have.been.called;
    expect(context.dataAccess.FixEntity.saveMany).to.not.have.been.called;
  });

  it('leaves a gone FIXED suggestion with no active fix untouched', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({ fixes: [] });

    await reconcileVulnSuggestions(opportunity, [], context, context.log);

    expect(s.setStatus).to.not.have.been.called;
    expect(context.dataAccess.FixEntity.saveMany).to.not.have.been.called;
  });

  // --- guards ---

  it('does nothing (and never fetches fixes) when there is nothing to reconcile', async () => {
    // A present NEW finding is neither FIXED nor disappeared → no candidates.
    const s = makeSuggestion('s1', 'NEW', 'lib@1.0.0');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({});

    await reconcileVulnSuggestions(opportunity, [dataFor('lib@1.0.0')], context, context.log);

    expect(context.dataAccess.FixEntity.getAllFixesWithSuggestionsByOpportunityId)
      .to.not.have.been.called;
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    expect(opportunity.addFixEntities).to.not.have.been.called;
  });

  it('is fail-safe: skips reconciliation and logs when fetching fix entities throws', async () => {
    const s = makeSuggestion('s1', 'FIXED', 'lib@1.0.0');
    const opportunity = makeOpportunity([s]);
    const context = makeContext({});
    context.dataAccess.FixEntity.getAllFixesWithSuggestionsByOpportunityId
      .rejects(new Error('boom'));

    await reconcileVulnSuggestions(opportunity, [dataFor('lib@1.0.0')], context, context.log);

    expect(context.log.warn).to.have.been.called;
    expect(s.setStatus).to.not.have.been.called;
    expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    expect(context.dataAccess.FixEntity.saveMany).to.not.have.been.called;
  });
});
