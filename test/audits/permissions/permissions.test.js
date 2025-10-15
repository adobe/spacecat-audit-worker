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
  permissionsAuditRunner,
  tooStrongOpportunityStep,
} from '../../../src/permissions/handler.js';
import {
  redundantAuditRunner,
  redundantPermissionsOpportunityStep,
} from '../../../src/permissions/handler.redundant.js';
import {
  createTooStrongMetrics,
  createTooStrongOpportunityData,
  createAdminMetrics,
  createAdminOpportunityData,
} from '../../../src/permissions/opportunity-data-mapper.js';
import {
  mapTooStrongSuggestion,
  mapAdminSuggestion,
} from '../../../src/permissions/suggestion-data-mapper.js';
import { fetchPermissionsReport } from '../../../src/permissions/common.js';

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
          STARFISH_API_BASE_URL: 'https://aem-trustcenter-dev.adobe.io/api',
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
            bulkUpdateStatus: sandbox.stub().resolves(),
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

  const setup404PermissionsApi = () => {
    nock('https://aem-trustcenter-dev.adobe.io')
      .get('/api/reports/123456/789012/permissions')
      .reply(404, { error: 'Not Found' });
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
      nock('https://aem-trustcenter-dev.adobe.io/api')
        .get('/api/reports/123456/789012/permissions')
        .replyWithError("A network error occurred");


      await expect(fetchPermissionsReport('', context, site))
        .to.be.rejectedWith('Failed to fetch permissions report');
    });

    it('should handle invalid JSON response', async () => {
      setupSuccessfulImsAuth();

      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, 'invalid json');

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('Unexpected token');
    });

    it('should handle missing IMS org', async () => {
      // Mock the dataAccess.Organization.findById to return null
      context.dataAccess.Organization.findById.resolves(null);

      await expect(fetchPermissionsReport('https://example.com', context, site))
        .to.be.rejectedWith('Missing IMS org');
    });

    it('should handle default IMS org', async () => {
      // Mock the dataAccess.Organization.findById to return an org with default IMS org
      context.dataAccess.Organization.findById.resolves({
        getImsOrgId: () => 'default',
      });
      setupSuccessfulImsAuth();
      setupSuccessfulPermissionsApi();

      const result = await fetchPermissionsReport('https://example.com', context, site);

      expect(result).to.deep.equal(mockPermissionsReport);
      expect(context.log.debug).to.have.been.calledWithMatch(/site is configured with default IMS org/);
    });

    it('should handle 404 response from permissions API', async () => {
      setupSuccessfulImsAuth();
      setup404PermissionsApi();

      const result = await fetchPermissionsReport('https://example.com', context, site);

      expect(result).to.be.null;
      expect(context.log.debug).to.have.been.calledWithMatch(/permissions report not found/);
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
      expect(result.auditResult.error).to.include('[security-permissions] [Site: a1b2c3d4-e5f6-7890-abcd-ef1234567890] permissions audit failed with error: Test error');
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
    });

    it('should skip audit for non-AEM CS delivery type', async () => {
      site.getDeliveryType = () => 'aem_on_premise';

      const result = await permissionsAuditRunner('https://example.com', context, site);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', false);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('error', 'Unsupported delivery type aem_on_premise');
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
      expect(context.log.debug).to.have.been.calledWithMatch(/skipping permissions audit as site is of delivery type aem_on_premise/);
    });
  });

  describe('redundantAuditRunner', () => {
    it('should successfully run redundant permissions audit and return audit result', async () => {
      setupSuccessfulImsAuth();
      setupSuccessfulPermissionsApi();

      const result = await redundantAuditRunner('https://example.com', context, site);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', true);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('permissionsReport');
      expect(result.auditResult.permissionsReport).to.deep.equal(mockPermissionsReport);
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
    });

    it('should handle audit failure and return error result', async () => {
      site.getDeliveryConfig = () => {
        throw new Error('Test error');
      };

      const result = await redundantAuditRunner('https://example.com', context, site);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', false);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('error');
      expect(result.auditResult.error).to.include('[security-permissions] [Site: a1b2c3d4-e5f6-7890-abcd-ef1234567890] permissions audit failed with error: Test error');
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
    });

    it('should handle empty permissions report', async () => {
      setupSuccessfulImsAuth();

      const emptyReport = { allPermissions: [], adminChecks: [] };
      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, { data: emptyReport });

      const result = await redundantAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.permissionsReport).to.deep.equal(emptyReport);
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

      const result = await redundantAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.permissionsReport).to.deep.equal(multiplePermissionsReport);
    });

    it('should skip audit for non-AEM CS delivery type', async () => {
      site.getDeliveryType = () => 'aem_on_premise';

      const result = await redundantAuditRunner('https://example.com', context, site);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success', false);
      expect(result.auditResult).to.have.property('finalUrl', 'https://example.com');
      expect(result.auditResult).to.have.property('error', 'Unsupported delivery type aem_on_premise');
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
      expect(context.log.debug).to.have.been.calledWithMatch(/skipping permissions audit as site is of delivery type aem_on_premise/);
    });

    it('should handle null permissions report', async () => {
      setupSuccessfulImsAuth();

      nock('https://aem-trustcenter-dev.adobe.io')
        .get('/api/reports/123456/789012/permissions')
        .reply(200, { data: null });

      const result = await redundantAuditRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.permissionsReport).to.be.null;
    });
  });

  describe('opportunityAndSuggestionsStep', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        auditResult: {
          permissionsReport: mockPermissionsReport,
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

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should return complete status when site is not aem_cs delivery type', async () => {
      site.getDeliveryType = () => 'aem_on_premise';

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should return complete status when audit failed', async () => {
      auditData.auditResult.success = false;

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
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
      auditData.auditResult.permissionsReport = { allPermissions: [], adminChecks: [] };

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

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
      auditData.auditResult.permissionsReport = { allPermissions: [], adminChecks: [] };

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(existingOpportunity.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
      expect(existingOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(existingOpportunity.save).to.have.been.called;
    });

    it('should create new too strong opportunity when allPermissions found', async () => {
      // Mock the data access methods to simulate opportunity creation
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves({
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub().resolves([]),
      });

      // Add allPermissions data to trigger opportunity creation
      auditData.auditResult.permissionsReport.allPermissions = [
        {
          path: '/content/test',
          details: [{ principal: 'everyone', acl: ['jcr:all'], otherPermissions: [] }],
        },
      ];

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.called;
    });

    it('should create new admin opportunity when adminChecks found', async () => {
      // Mock the data access methods to simulate opportunity creation
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves({
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub().resolves([]),
      });

      // Add adminChecks data to trigger opportunity creation
      auditData.auditResult.permissionsReport.adminChecks = [
        {
          principal: 'admin1',
          details: [{ path: '/content/admin1', allow: true, privileges: ['jcr:all'] }],
        },
      ];

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.called;
    });

    it('should handle opportunities with suggestions when resolving', async () => {
      const mockSuggestions = [
        { getId: () => 'suggestion-1', getStatus: () => 'NEW' },
        { getId: () => 'suggestion-2', getStatus: () => 'NEW' },
      ];

      const existingOpportunity = {
        getData: () => ({ securityType: 'CS-ACL-ALL' }),
        getType: () => 'security-permissions',
        setStatus: sandbox.stub(),
        getSuggestions: sandbox.stub().resolves(mockSuggestions),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      auditData.auditResult.permissionsReport = { allPermissions: [], adminChecks: [] };

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataContext.Suggestion.bulkUpdateStatus).to.have.been.calledWith(
        mockSuggestions,
        SuggestionDataAccess.STATUSES.FIXED,
      );
    });

    it('should handle empty opportunities array', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

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
      auditData.auditResult.permissionsReport = { allPermissions: [], adminChecks: [] };

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(tooStrongOpp.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
      expect(adminOpp.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
    });

    it('should early exit in tooStrongOpportunityStep when security-permissions-auto-suggest is not enabled by configuration', async () => {
      context.dataAccess.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler, site) => {
          return handler !== 'security-permissions-auto-suggest';
        }),
      });
      const auditData = {
        auditResult: {
          permissionsReport: {
            allPermissions: [
              {
                path: '/content/test',
                details: [{ principal: 'everyone', acl: ['jcr:all'], otherPermissions: [] }],
              },
            ],
            adminChecks: [],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };
      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);
      expect(result).to.deep.equal({ status: 'complete' });
    });
  });

  describe('redundantPermissionsOpportunityStep', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        auditResult: {
          permissionsReport: mockPermissionsReport,
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

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should return complete status when audit failed', async () => {
      auditData.auditResult.success = false;

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should resolve existing admin opportunities when no adminChecks found', async () => {
      const existingOpportunity = {
        getData: () => ({ securityType: 'CS-ACL-ADMIN' }),
        getType: () => 'security-permissions-redundant',
        setStatus: sandbox.stub(),
        getSuggestions: sandbox.stub().resolves([]),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      auditData.auditResult.permissionsReport = { allPermissions: [], adminChecks: [] };

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(existingOpportunity.setStatus).to.have.been.calledWith(Oppty.STATUSES.RESOLVED);
      expect(existingOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(existingOpportunity.save).to.have.been.called;
    });

    it('should create new admin opportunity when adminChecks found', async () => {
      // Mock the data access methods to simulate opportunity creation
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves({
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub().resolves([]),
      });

      // Add adminChecks data to trigger opportunity creation
      auditData.auditResult.permissionsReport.adminChecks = [
        {
          principal: 'admin1',
          details: [{ path: '/content/admin1', allow: true, privileges: ['jcr:all'] }],
        },
      ];

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.called;
    });

    it('should handle opportunities with suggestions when resolving', async () => {
      const mockSuggestions = [
        { getId: () => 'suggestion-1', getStatus: () => 'NEW' },
        { getId: () => 'suggestion-2', getStatus: () => 'NEW' },
      ];

      const existingOpportunity = {
        getData: () => ({ securityType: 'CS-ACL-ADMIN' }),
        getType: () => 'security-permissions-redundant',
        setStatus: sandbox.stub(),
        getSuggestions: sandbox.stub().resolves(mockSuggestions),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
      auditData.auditResult.permissionsReport = { allPermissions: [], adminChecks: [] };

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataContext.Suggestion.bulkUpdateStatus).to.have.been.calledWith(
        mockSuggestions,
        SuggestionDataAccess.STATUSES.FIXED,
      );
    });

    it('should handle auto-suggest configuration', async () => {
      context.dataAccess.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler, site) => {
          if (handler === 'security-permissions') return true;
          if (handler === 'security-permissions-auto-suggest') return false;
          return false;
        }),
      });

      // Mock the data access methods to simulate opportunity creation
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves({
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub().resolves([]),
      });

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should early exit when security-permissions-auto-suggest is not enabled by configuration', async () => {
      context.dataAccess.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sandbox.stub().callsFake((handler, site) => {
          return handler !== 'security-permissions-auto-suggest';
        }),
      });
      const auditData = {
        auditResult: {
          permissionsReport: {
            allPermissions: [],
            adminChecks: [],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };
      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);
      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should handle opportunity creation failure', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: {
            allPermissions: [],
            adminChecks: [
              {
                principal: 'admin1',
                details: [{ path: '/content/admin1', allow: true, privileges: ['jcr:all'] }],
              },
            ],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.rejects(new Error('Opportunity creation failed'));

      await expect(redundantPermissionsOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Opportunity creation failed');
    });

    it('should handle syncSuggestions failure', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: {
            allPermissions: [],
            adminChecks: [
              {
                principal: 'admin1',
                details: [{ path: '/content/admin1', allow: true, privileges: ['jcr:all'] }],
              },
            ],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves({
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().rejects(new Error('Sync suggestions failed')),
        getSuggestions: sandbox.stub().resolves([]),
      });

      await expect(redundantPermissionsOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Sync suggestions failed');
    });

    it('should handle configuration fetch failure', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Configuration.findLatest.rejects(new Error('Configuration fetch failed'));

      await expect(redundantPermissionsOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Configuration fetch failed');
    });

    it('should handle opportunity fetch failure', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('Opportunity fetch failed'));

      await expect(redundantPermissionsOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Opportunity fetch failed');
    });

    it('should handle empty opportunities array', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: {
            allPermissions: [],
            adminChecks: [],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should handle multiple admin opportunities', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: {
            allPermissions: [],
            adminChecks: [
              {
                principal: 'admin1',
                details: [{ path: '/content/admin1', allow: true, privileges: ['jcr:all'] }],
              },
              {
                principal: 'admin2',
                details: [
                  { path: '/content/admin2', allow: true, privileges: ['jcr:all'] },
                  { path: '/content/admin3', allow: true, privileges: ['jcr:read'] },
                ],
              },
            ],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves({
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
        getSuggestions: sandbox.stub().resolves([]),
      });

      const result = await redundantPermissionsOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.dataAccess.Opportunity.create).to.have.been.called;
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
          permissionsReport: {
            ...mockPermissionsReport,
            allPermissions: [
              {
                path: '/content/test',
                details: [{ principal: 'everyone', acl: ['jcr:all'], otherPermissions: [] }],
              },
            ],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      // Mock the data access methods to simulate opportunity creation failure
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.rejects(new Error('Opportunity creation failed'));

      await expect(tooStrongOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Opportunity creation failed');
    });

    it('should handle syncSuggestions failure', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: {
            ...mockPermissionsReport,
            allPermissions: [
              {
                path: '/content/test',
                details: [{ principal: 'everyone', acl: ['jcr:all'], otherPermissions: [] }],
              },
            ],
          },
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      // Mock the data access methods to simulate syncSuggestions failure
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      context.dataAccess.Opportunity.create.resolves({
        getId: () => 'opp-123',
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub(),
        addSuggestions: sandbox.stub().rejects(new Error('Sync suggestions failed')),
        getSuggestions: sandbox.stub().resolves([]),
      });

      await expect(tooStrongOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Sync suggestions failed');
    });

    it('should handle non-aem_cs delivery type in opportunityAndSuggestionsStep', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      site.getDeliveryType = () => 'aem_on_premise';

      const result = await tooStrongOpportunityStep('https://example.com', auditData, context, site);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('should handle configuration fetch failure', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Configuration.findLatest.rejects(new Error('Configuration fetch failed'));

      await expect(tooStrongOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Configuration fetch failed');
    });

    it('should handle opportunity fetch failure', async () => {
      const auditData = {
        auditResult: {
          permissionsReport: mockPermissionsReport,
          success: true,
        },
        siteId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        auditId: 'audit-123',
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('Opportunity fetch failed'));

      await expect(tooStrongOpportunityStep('https://example.com', auditData, context, site))
        .to.be.rejectedWith('Opportunity fetch failed');
    });
  });

  describe('Opportunity Data Mapper Tests', () => {
    describe('createTooStrongMetrics', () => {
      it('should create metrics for too strong permissions', () => {
        const permissions = [
          { path: '/content/page1', details: [{ principal: 'everyone', acl: ['jcr:all'] }] },
          { path: '/content/page2', details: [{ principal: 'anonymous', acl: ['jcr:all'] }] },
        ];

        const result = createTooStrongMetrics(permissions);

        expect(result).to.deep.equal({
          mainMetric: {
            name: 'Issues',
            value: 2,
          },
          metrics: {
            insecure_permissions: 2,
            redundant_permissions: 0,
          },
        });
      });

      it('should handle empty permissions array', () => {
        const result = createTooStrongMetrics([]);

        expect(result).to.deep.equal({
          mainMetric: {
            name: 'Issues',
            value: 0,
          },
          metrics: {
            insecure_permissions: 0,
            redundant_permissions: 0,
          },
        });
      });
    });

    describe('createTooStrongOpportunityData', () => {
      it('should create opportunity data for too strong permissions', () => {
        const props = { testProp: 'testValue' };

        const result = createTooStrongOpportunityData(props);

        expect(result).to.have.property('runbook', 'https://wiki.corp.adobe.com/display/WEM/Security+Success');
        expect(result).to.have.property('origin', 'AUTOMATION');
        expect(result).to.have.property('title', 'Your website\'s user and group permissions are insecure or incorrect');
        expect(result).to.have.property('tags').that.deep.includes('Security', 'Permissions');
        expect(result).to.have.property('description').that.includes('insecure user permissions');
        expect(result.data).to.have.property('howToFix');
        expect(result.data).to.have.property('dataSources');
        expect(result.data).to.have.property('securityType', 'CS-ACL-ALL');
        expect(result.data).to.have.property('testProp', 'testValue');
      });
    });

    describe('createAdminMetrics', () => {
      it('should create metrics for admin permissions', () => {
        const permissions = [
          { principal: 'admin1', details: [{ path: '/content/admin1', allow: true, privileges: ['jcr:all'] }] },
          { principal: 'admin2', details: [{ path: '/content/admin2', allow: true, privileges: ['jcr:all'] }] },
        ];

        const result = createAdminMetrics(permissions);

        expect(result).to.deep.equal({
          mainMetric: {
            name: 'Issues',
            value: 2,
          },
          metrics: {
            insecure_permissions: 0,
            redundant_permissions: 2,
          },
        });
      });

      it('should handle empty permissions array', () => {
        const result = createAdminMetrics([]);

        expect(result).to.deep.equal({
          mainMetric: {
            name: 'Issues',
            value: 0,
          },
          metrics: {
            insecure_permissions: 0,
            redundant_permissions: 0,
          },
        });
      });
    });

    describe('createAdminOpportunityData', () => {
      it('should create opportunity data for admin permissions', () => {
        const props = { testProp: 'testValue' };

        const result = createAdminOpportunityData(props);

        expect(result).to.have.property('runbook', 'https://wiki.corp.adobe.com/display/WEM/Security+Success');
        expect(result).to.have.property('origin', 'AUTOMATION');
        expect(result).to.have.property('title', 'Your website defines unnecessary permissions for admin / administrators');
        expect(result).to.have.property('tags').that.deep.includes('Security', 'Permissions', 'Administrators');
        expect(result).to.have.property('description').that.includes('unnecessary rules for the admin user');
        expect(result.data).to.have.property('howToFix');
        expect(result.data).to.have.property('dataSources');
        expect(result.data).to.have.property('securityType', 'CS-ACL-ADMIN');
        expect(result.data).to.have.property('testProp', 'testValue');
      });
    });
  });

  describe('Suggestion Data Mapper Tests', () => {
    describe('mapTooStrongSuggestion', () => {
      it('should map too strong permission to suggestion', () => {
        const opportunity = { getId: () => 'opp-123' };
        const tooStrongPermission = {
          principal: 'everyone',
          path: '/content/page',
          acl: ['jcr:all'],
        };

        const result = mapTooStrongSuggestion(opportunity, tooStrongPermission);

        expect(result).to.have.property('opportunityId', 'opp-123');
        expect(result).to.have.property('type', 'CONTENT_UPDATE');
        expect(result.data).to.have.property('issue', 'Insecure');
        expect(result.data).to.have.property('path', '/content/page');
        expect(result.data).to.have.property('principal', 'everyone');
        expect(result.data).to.have.property('permissions').that.deep.equals(['jcr:all']);
        expect(result.data).to.have.property('recommended_permissions').that.deep.equals(['jcr:read', 'jcr:write ']);
        expect(result.data).to.have.property('rationale').that.includes('Granting jcr:all permissions');
      });
    });

    describe('mapAdminSuggestion', () => {
      it('should map admin permission to suggestion', () => {
        const opportunity = { getId: () => 'opp-456' };
        const adminPermission = {
          principal: 'admin-user',
          path: '/content/admin',
          privileges: ['jcr:all'],
        };

        const result = mapAdminSuggestion(opportunity, adminPermission);

        expect(result).to.deep.equal({
          opportunityId: 'opp-456',
          type: 'CONTENT_UPDATE',
          data: {
            issue: 'Redundant',
            path: '/content/admin',
            principal: 'admin-user',
            permissions: ['jcr:all'],
            recommended_permissions: ['Remove'],
            rationale: 'Defining access control policies for the administrators group in AEM is redundant, as members inherently possess full privileges, rendering explicit permissions unnecessary and adding avoidable complexity to the authorization configuration.',
          },
        });
      });
    });
  });
});
