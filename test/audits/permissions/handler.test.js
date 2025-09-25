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
import { Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { MockContextBuilder } from '../../shared.js';
import {
  fetchPermissionsReport,
  permissionsAuditRunner,
  opportunityAndSuggestionsStep,
} from '../../../src/permissions/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Permissions Handler Tests', () => {
  let sandbox;
  let context;
  let site;

  const mockPermissionsReport = {
    allPermissions: [
      {
        path: '/content/example/page',
        details: [
          {
            principal: 'everyone',
            acl: ['jcr:all'],
            otherPermissions: [],
          },
        ],
      },
    ],
    adminChecks: [
      {
        principal: 'admin-user',
        details: [
          {
            path: '/content/admin',
            allow: true,
            privileges: ['jcr:all'],
          },
        ],
      },
    ],
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
      getOrganizationId: () => 'org-123',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
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
              getImsOrgId: () => 'ims-org-123',
            }),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves({
              getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              getType: () => 'security-permissions',
              getSiteId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              setStatus: sandbox.stub().resolves(),
              getSuggestions: sandbox.stub().resolves([]),
              setUpdatedBy: sandbox.stub().resolves(),
              save: sandbox.stub().resolves(),
              addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
              setAuditId: sandbox.stub().resolves(),
              setData: sandbox.stub().resolves(),
              getData: sandbox.stub().returns({}),
            }),
          },
          Suggestion: {
            bulkUpdateStatus: sandbox.stub().resolves(),
            allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
          },
        },
        dataContext: {
          Suggestion: {
            STATUSES: {
              FIXED: 'FIXED',
              OUTDATED: 'OUTDATED',
              NEW: 'NEW',
            },
          },
        },
      })
      .build();
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

  const setupSuccessfulPermissionsApi = () => {
    nock('https://aem-trustcenter-dev.adobe.io')
      .get('/api/reports/123456/789012/permissions')
      .reply(200, { data: mockPermissionsReport });
  };

  const setupFailedImsAuth = (status = 401) => {
    nock('https://ims-na1.adobelogin.com')
      .post('/ims/token/v4')
      .reply(status, { error: 'Unauthorized' });
  };

  const setupFailedPermissionsApi = (status = 500) => {
    nock('https://aem-trustcenter-dev.adobe.io')
      .get('/api/reports/123456/789012/permissions')
      .reply(status, { error: 'Internal Server Error' });
  };

  describe('fetchPermissionsReport', () => {
    it('should successfully fetch permissions report from trustcenter', async () => {
      setupSuccessfulImsAuth();
      setupSuccessfulPermissionsApi();

      const result = await fetchPermissionsReport('https://example.com', context, site);

      expect(result).to.deep.equal(mockPermissionsReport);
      expect(context.log.debug).to.have.been.calledWithMatch(/successfully fetched permissions report/);
    });

    it('should handle missing programId in delivery config', async () => {
      site.getDeliveryConfig = () => ({ programId: undefined, environmentId: '789012' });

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('Invalid delivery config for AEM_CS');
    });

    it('should handle missing environmentId in delivery config', async () => {
      site.getDeliveryConfig = () => ({ programId: '123456', environmentId: null });

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('Invalid delivery config for AEM_CS');
    });

    it('should handle IMS authentication failure', async () => {
      setupFailedImsAuth(401);

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('IMS getServiceAccessToken request failed with status: 401');
    });

    it('should handle trustcenter API failure', async () => {
      setupSuccessfulImsAuth();
      setupFailedPermissionsApi(500);

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('Failed to fetch permissions report');
    });

    it('should handle network error during fetch', async () => {
      setupSuccessfulImsAuth();

      // Mock a network error by making fetch throw
      const originalFetch = global.fetch;
      global.fetch = sandbox.stub().rejects(new Error('Network error'));

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('Failed to fetch permissions report');

      // Restore original fetch
      global.fetch = originalFetch;
    });

    it('should handle invalid JSON response', async () => {
      setupSuccessfulImsAuth();

      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, 'invalid json');

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('Failed to fetch permissions report');
    });
  });

  describe('permissionsAuditRunner', () => {
    it('should successfully run permissions audit and return audit result', async () => {
      setupSuccessfulImsAuth();
      setupSuccessfulPermissionsApi();

      const result = await permissionsAuditRunner('https://example.com', context, site);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', true);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('permissionsReport');
      expect(result.auditResult.permissionsReport).to.deep.equal(mockPermissionsReport);
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
      expect(context.log.info).to.have.been.calledWithMatch(/identified: 1 jcr:all permissions, 1 admin checks/);
    });

    it('should handle audit failure and return error result', async () => {
      site.getDeliveryConfig = () => {
        throw new Error('Test error');
      };

      const result = await permissionsAuditRunner('https://example.com', context, site);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', false);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('error');
      expect(result.auditResult.error).to.include('[security-permissions] [Site: a1b2c3d4-e5f6-7890-abcd-ef1234567890] audit failed with error: Test error');
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
    });

    it('should handle empty permissions report', async () => {
      setupSuccessfulImsAuth();

      const emptyReport = { allPermissions: [], adminChecks: [] };
      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, { data: emptyReport });

      const result = await permissionsAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.permissionsReport).to.deep.equal(emptyReport);
      expect(context.log.info).to.have.been.calledWithMatch(/identified: 0 jcr:all permissions, 0 admin checks/);
    });

    it('should handle multiple permissions in report', async () => {
      setupSuccessfulImsAuth();

      const multiplePermissionsReport = {
        allPermissions: [
          {
            path: '/content/page1',
            details: [{ principal: 'everyone', acl: ['jcr:all'], otherPermissions: [] }],
          },
          {
            path: '/content/page2',
            details: [
              { principal: 'everyone', acl: ['jcr:all'], otherPermissions: [] },
              { principal: 'anonymous', acl: ['jcr:all'], otherPermissions: [] },
            ],
          },
        ],
        adminChecks: [
          {
            principal: 'admin1',
            details: [{ path: '/content/admin1', allow: true, privileges: ['jcr:all'] }],
          },
          {
            principal: 'admin2',
            details: [{ path: '/content/admin2', allow: true, privileges: ['jcr:all'] }],
          },
        ],
      };

      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, { data: multiplePermissionsReport });

      const result = await permissionsAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.permissionsReport).to.deep.equal(multiplePermissionsReport);
      expect(context.log.info).to.have.been.calledWithMatch(/identified: 2 jcr:all permissions, 2 admin checks/);
    });
  });

  describe('opportunityAndSuggestionsStep', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        auditResult: {
          permissionReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };
    });

    it('should return complete status when audit is disabled for site', async () => {
      context.dataAccess.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sandbox.stub().returns(false),
      });

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.info).to.have.been.calledWithMatch(/audit is disabled for site/);
    });

    it('should return complete status when site is not aem_cs delivery type', async () => {
      site.getDeliveryType = () => 'aem_on_premise';

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.debug).to.have.been.calledWithMatch(/skipping opportunity as it is of delivery type/);
    });

    it('should return complete status when audit failed', async () => {
      auditData.auditResult.success = false;

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.info).to.have.been.calledWithMatch(/Audit failed, skipping opportunity/);
    });

    it('should resolve existing too strong opportunities when no allPermissions found', async () => {
      const existingOpportunity = {
        getData: () => ({ securityType: 'CS-ACL-ALL' }),
        getType: () => 'security-permissions',
        setStatus: sandbox.stub(),
        getSuggestions: sandbox.stub().resolves([]),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      auditData.auditResult.permissionReport = { allPermissions: [], adminChecks: [] };

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(existingOpportunity.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
      expect(existingOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(existingOpportunity.save).to.have.been.called;
    });

    it('should resolve existing admin opportunities when no adminChecks found', async () => {
      const existingOpportunity = {
        getData: () => ({ securityType: 'CS-ACL-ADMIN' }),
        getType: () => 'security-permissions',
        setStatus: sandbox.stub(),
        getSuggestions: sandbox.stub().resolves([]),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      auditData.auditResult.permissionReport = { allPermissions: [], adminChecks: [] };

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(existingOpportunity.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
      expect(existingOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(existingOpportunity.save).to.have.been.called;
    });

    it('should create new too strong opportunity when allPermissions found', async () => {
      const mockOpportunity = {
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub().resolves([]),
      };

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.called;
      expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(mockOpportunity.save).to.have.been.called;
    });

    it('should create new admin opportunity when adminChecks found', async () => {
      const mockOpportunity = {
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub().resolves([]),
      };

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      // Once for too strong, once for admin
      expect(context.dataAccess.Opportunity.create).to.have.been.calledTwice;
      expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(mockOpportunity.save).to.have.been.calledTwice;
    });

    it('should handle opportunities with suggestions when resolving', async () => {
      const mockSuggestions = [
        { getId: () => 'suggestion-1', getStatus: () => 'NEW' },
        { getId: () => 'suggestion-2', getStatus: () => 'NEW' },
      ];

      auditData.auditResult.permissionReport = { allPermissions: [], adminChecks: [] };

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledWith(
        mockSuggestions,
        SuggestionDataAccess.STATUSES.FIXED,
      );
    });

    it('should handle empty opportunities array', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should handle mixed opportunity types correctly', async () => {
      const tooStrongOpp = {
        getData: () => ({ securityType: 'CS-ACL-ALL' }),
        getType: () => 'security-permissions',
        setStatus: sandbox.stub(),
        getSuggestions: sandbox.stub().resolves([]),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
      };

      const adminOpp = {
        getData: () => ({ securityType: 'CS-ACL-ADMIN' }),
        getType: () => 'security-permissions',
        setStatus: sandbox.stub(),
        getSuggestions: sandbox.stub().resolves([]),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([tooStrongOpp, adminOpp]);
      auditData.auditResult.permissionReport = { allPermissions: [], adminChecks: [] };

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(tooStrongOpp.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
      expect(adminOpp.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle null/undefined permissions report gracefully', async () => {
      setupSuccessfulImsAuth();

      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, { data: null });

      const result = await permissionsAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.permissionsReport).to.be.null;
    });

    it('should handle malformed permissions report structure', async () => {
      setupSuccessfulImsAuth();

      const malformedReport = {
        allPermissions: null,
        adminChecks: [null],
      };

      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, { data: malformedReport });

      const result = await permissionsAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.permissionsReport).to.deep.equal(malformedReport);
      expect(result.auditResult.permissionsReport.allPermissions).to.be.null;
      expect(result.auditResult.permissionsReport.adminChecks).to.deep.equal([null]);
    });

    it('should handle IMS client creation failure', async () => {
      // Mock ImsClient.createFrom to throw an error
      const { ImsClient } = await import('@adobe/spacecat-shared-ims-client');
      sandbox.stub(ImsClient, 'createFrom').throws(new Error('IMS client creation failed'));

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('IMS client creation failed');
    });

    it('should handle opportunity creation failure in opportunityAndSuggestionsStep', async () => {
      const auditData = {
        auditResult: {
          permissionReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      // Mock the data access methods to simulate opportunity creation failure
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.rejects(new Error('Opportunity creation failed'));

      await expect(opportunityAndSuggestionsStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Opportunity creation failed');
    });

    it('should handle syncSuggestions failure', async () => {
      const auditData = {
        auditResult: {
          permissionReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      const mockOpportunity = {
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().rejects(new Error('Sync suggestions failed')),
        getSuggestions: sandbox.stub().resolves([]),
      };

      // Mock the data access methods
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves(mockOpportunity);

      await expect(opportunityAndSuggestionsStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Sync suggestions failed');
    });

    it('should handle non-aem_cs delivery type in opportunityAndSuggestionsStep', async () => {
      const auditData = {
        auditResult: {
          permissionReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      site.getDeliveryType = () => 'aem_on_premise';

      const result = await opportunityAndSuggestionsStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.debug).to.have.been.calledWithMatch(/skipping opportunity as it is of delivery type aem_on_premise/);
    });

    it('should handle configuration fetch failure', async () => {
      const auditData = {
        auditResult: {
          permissionReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Configuration.findLatest.rejects(new Error('Configuration fetch failed'));

      await expect(opportunityAndSuggestionsStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Configuration fetch failed');
    });

    it('should handle opportunity fetch failure', async () => {
      const auditData = {
        auditResult: {
          permissionReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('Opportunity fetch failed'));

      await expect(opportunityAndSuggestionsStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Opportunity fetch failed');
    });
  });
});
