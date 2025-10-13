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
import nock from 'nock';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import * as cdnConfigHandler from '../../src/llmo-customer-analysis/cdn-config-handler.js';

use(sinonChai);

describe('CDN Config Handler', () => {
  let sandbox;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Mock environment variable
    process.env.LLMO_HLX_API_KEY = 'test-api-key';

    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {
        Site: {
          findByBaseURL: sandbox.stub(),
          findById: sandbox.stub(),
          allByOrganizationId: sandbox.stub(),
        },
        LatestAudit: {
          findBySiteIdAndAuditType: sandbox.stub(),
        },
        Configuration: {
          findLatest: sandbox.stub(),
        },
        Organization: {
          findById: sandbox.stub(),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      params: {},
    };
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env.LLMO_HLX_API_KEY;
    nock.cleanAll();
  });

  describe('enableCdnAnalysisPerService', () => {
    let mockSite;
    let mockConfig;

    beforeEach(() => {
      mockSite = {
        getId: sandbox.stub().returns('site-123'),
      };

      mockConfig = {
        disableHandlerForSite: sandbox.stub(),
        enableHandlerForSite: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      context.dataAccess.Site.findByBaseURL.resolves(mockSite);
      context.dataAccess.Configuration.findLatest.resolves(mockConfig);
    });

    it('should return null when no domains provided', async () => {
      const result = await cdnConfigHandler.enableCdnAnalysisPerService('test-service', null, context);
      expect(result).to.be.null;

      const result2 = await cdnConfigHandler.enableCdnAnalysisPerService('test-service', [], context);
      expect(result2).to.be.null;
    });

    it('should return message when no valid domains found', async () => {
      context.dataAccess.Site.findByBaseURL.resolves(null);

      const result = await cdnConfigHandler.enableCdnAnalysisPerService(
        'test-service',
        ['invalid-domain.com'],
        context,
      );

      expect(result).to.deep.equal({
        enabled: false,
        serviceName: 'test-service',
        message: 'No valid domains found',
      });
    });

    it('should disable all when more than one domain is enabled', async () => {
      const mockSite2 = { getId: () => 'site-456' };
      context.dataAccess.Site.findByBaseURL
        .onFirstCall().resolves(mockSite)
        .onSecondCall().resolves(mockSite2);

      context.dataAccess.LatestAudit.findBySiteIdAndAuditType
        .onFirstCall().resolves(['audit1'])
        .onSecondCall().resolves(['audit2']);

      const result = await cdnConfigHandler.enableCdnAnalysisPerService(
        'test-service',
        ['domain1.com', 'domain2.com'],
        context,
      );

      expect(mockConfig.disableHandlerForSite).to.have.been.calledTwice;
      expect(mockConfig.disableHandlerForSite).to.have.been.calledWith('cdn-analysis', mockSite);
      expect(mockConfig.disableHandlerForSite).to.have.been.calledWith('cdn-analysis', mockSite2);
      expect(mockConfig.save).to.have.been.called;
      expect(result).to.deep.equal({
        enabled: false,
        serviceName: 'test-service',
        message: 'Disabled 2 domains',
      });
    });

    it('should leave existing when exactly one domain is enabled', async () => {
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves(['existing-audit']);

      const result = await cdnConfigHandler.enableCdnAnalysisPerService(
        'test-service',
        ['domain1.com'],
        context,
      );

      expect(mockConfig.enableHandlerForSite).to.not.have.been.called;
      expect(result).to.deep.equal({
        enabled: false,
        serviceName: 'test-service',
        domain: 'domain1.com',
        message: 'Already enabled: domain1.com',
      });
    });

    it('should enable first available when none are enabled', async () => {
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves([]);

      const result = await cdnConfigHandler.enableCdnAnalysisPerService(
        'test-service',
        ['domain1.com'],
        context,
      );

      expect(mockConfig.enableHandlerForSite).to.have.been.calledWith('cdn-analysis', mockSite);
      expect(mockConfig.save).to.have.been.called;
      expect(result).to.deep.equal({
        enabled: true,
        serviceName: 'test-service',
        domain: 'domain1.com',
        message: 'Enabled: domain1.com',
      });
    });

    it('should handle errors during domain processing', async () => {
      context.dataAccess.Site.findByBaseURL.rejects(new Error('Database error'));

      const result = await cdnConfigHandler.enableCdnAnalysisPerService(
        'test-service',
        ['domain1.com'],
        context,
      );

      expect(context.log.error).to.have.been.calledWith('Error processing domain domain1.com:', 'Database error');
      expect(result).to.deep.equal({
        enabled: false,
        serviceName: 'test-service',
        message: 'No valid domains found',
      });
    });

    it('should filter out falsy domains', async () => {
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves([]);

      const result = await cdnConfigHandler.enableCdnAnalysisPerService(
        'test-service',
        ['domain1.com', null, '', 'domain2.com'],
        context,
      );

      expect(context.dataAccess.Site.findByBaseURL).to.have.been.calledTwice;
      expect(context.dataAccess.Site.findByBaseURL).to.have.been.calledWith('https://domain1.com');
      expect(context.dataAccess.Site.findByBaseURL).to.have.been.calledWith('https://domain2.com');
    });

    it('should throw error when configuration fails', async () => {
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves([]);
      mockConfig.save.rejects(new Error('Save failed'));

      await expect(cdnConfigHandler.enableCdnAnalysisPerService(
        'test-service',
        ['domain1.com'],
        context,
      )).to.be.rejectedWith('Save failed');

      expect(context.log.error).to.have.been.calledWith(
        'CDN analysis enablement failed for service test-service:',
        'Save failed',
      );
    });
  });

  describe('fetchCommerceFastlyService', () => {
    it('should return null when domain is not provided', async () => {
      const result = await cdnConfigHandler.fetchCommerceFastlyService(null, context);
      expect(result).to.be.null;

      const result2 = await cdnConfigHandler.fetchCommerceFastlyService('', context);
      expect(result2).to.be.null;
    });

    it('should return null when API key is not provided', async () => {
      delete process.env.LLMO_HLX_API_KEY;

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);
      expect(result).to.be.null;
    });

    it('should return null when API response is not ok', async () => {
      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(404);

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);
      expect(result).to.be.null;
    });

    it('should return null when response data is not an array', async () => {
      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, { data: 'not-an-array' });

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);
      expect(result).to.be.null;
    });

    it('should find matching service by exact domain match', async () => {
      const mockServices = [
        {
          ServiceName: 'org-123',
          ServiceID: 'service-456',
          domains: 'example.com,other.com',
        },
      ];

      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, { data: mockServices });

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);

      expect(result).to.deep.equal({
        serviceName: 'org-123',
        serviceId: 'service-456',
        matchedDomains: ['example.com', 'other.com'],
      });
    });

    it('should find matching service by domain inclusion', async () => {
      const mockServices = [
        {
          ServiceName: 'org-123',
          ServiceID: 'service-456',
          domains: 'main.example.com,other.com',
        },
      ];

      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, { data: mockServices });

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);

      expect(result).to.deep.equal({
        serviceName: 'org-123',
        serviceId: 'service-456',
        matchedDomains: ['main.example.com', 'other.com'],
      });
    });

    it('should strip www prefix from domain', async () => {
      const mockServices = [
        {
          ServiceName: 'org-123',
          ServiceID: 'service-456',
          domains: 'example.com',
        },
      ];

      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, { data: mockServices });

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://www.example.com', context);

      expect(result).to.deep.equal({
        serviceName: 'org-123',
        serviceId: 'service-456',
        matchedDomains: ['example.com'],
      });
    });

    it('should return null when no matching service found', async () => {
      const mockServices = [
        {
          ServiceName: 'org-123',
          ServiceID: 'service-456',
          domains: 'other.com,another.com',
        },
      ];

      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, { data: mockServices });

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);
      expect(result).to.be.null;
    });

    it('should skip services with missing required fields', async () => {
      const mockServices = [
        {
          ServiceName: 'org-123',
          // Missing ServiceID
          domains: 'example.com',
        },
        {
          // Missing ServiceName
          ServiceID: 'service-456',
          domains: 'example.com',
        },
        {
          ServiceName: 'org-789',
          ServiceID: 'service-999',
          // Missing domains
        },
        {
          ServiceName: 'org-valid',
          ServiceID: 'service-valid',
          domains: 'example.com',
        },
      ];

      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, { data: mockServices });

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);

      expect(result).to.deep.equal({
        serviceName: 'org-valid',
        serviceId: 'service-valid',
        matchedDomains: ['example.com'],
      });
    });

    it('should handle domains with whitespace', async () => {
      const mockServices = [
        {
          ServiceName: 'org-123',
          ServiceID: 'service-456',
          domains: ' example.com , other.com , ',
        },
      ];

      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, { data: mockServices });

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);

      expect(result).to.deep.equal({
        serviceName: 'org-123',
        serviceId: 'service-456',
        matchedDomains: ['example.com', 'other.com'],
      });
    });

    it('should handle fetch errors gracefully', async () => {
      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .replyWithError('Network error');

      const result = await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);

      expect(result).to.be.null;
      expect(context.log.error).to.have.been.calledWith('Error fetching commerce-fastly domains: Network error');
    });

    it('should make request with correct headers', async () => {
      const scope = nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .matchHeader('User-Agent', 'spacecat-audit-worker')
        .matchHeader('Authorization', 'token test-api-key')
        .reply(200, { data: [] });

      await cdnConfigHandler.fetchCommerceFastlyService('https://example.com', context);

      expect(scope.isDone()).to.be.true;
    });
  });

  describe('handleCdnBucketConfigChanges', () => {
    let mockSite;
    let mockConfig;
    let mockSiteConfig;
    let mockConfiguration;

    beforeEach(() => {
      // Mock Config.toDynamoItem static method
      sandbox.stub(Config, 'toDynamoItem').returns({});
      
      mockSiteConfig = {
        updateLlmoCdnBucketConfig: sandbox.stub(),
      };

      mockSite = {
        getId: sandbox.stub().returns('site-123'),
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getOrganizationId: sandbox.stub().returns('org-123'),
        getConfig: sandbox.stub().returns(mockSiteConfig),
        setConfig: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockConfiguration = {
        enableHandlerForSite: sandbox.stub(),
        isHandlerEnabledForSite: sandbox.stub().returns(false),
        save: sandbox.stub().resolves(),
        getQueues: sandbox.stub().returns({
          audits: 'audit-queue-url',
        }),
      };

      context.dataAccess.Site.findById.resolves(mockSite);
      context.dataAccess.Configuration.findLatest.resolves(mockConfiguration);
      context.params = { siteId: 'site-123' };
    });

    it('should throw error when siteId is not provided', async () => {
      context.params = {};

      await expect(cdnConfigHandler.handleCdnBucketConfigChanges(context, {}))
        .to.be.rejectedWith('Site ID is required for CDN configuration');
    });

    it('should throw error when site is not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      await expect(cdnConfigHandler.handleCdnBucketConfigChanges(context, { cdnProvider: 'test-provider' }))
        .to.be.rejectedWith('Site with ID site-123 not found');
    });

    it('should throw error when cdnProvider is not provided', async () => {
      await expect(cdnConfigHandler.handleCdnBucketConfigChanges(context, {}))
        .to.be.rejectedWith('CDN provider is required for CDN configuration');
    });

    it('should handle commerce-fastly provider with service found', async () => {
      nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/adobe-managed-domains/commerce-fastly-domains.json?limit=5000')
        .reply(200, {
          data: [{
            ServiceName: 'commerce-org',
            ServiceID: 'service-123',
            domains: 'example.com,www.example.com',
          }],
        });

      const data = { cdnProvider: 'commerce-fastly' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockSiteConfig.updateLlmoCdnBucketConfig).to.have.been.calledWith({ orgId: 'commerce-org' });
    });

    it('should handle bucket configuration when bucketName provided', async () => {
      const data = { bucketName: 'test-bucket', cdnProvider: 'commerce-fastly' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockSiteConfig.updateLlmoCdnBucketConfig).to.have.been.calledWith({ bucketName: 'test-bucket' });
      expect(mockSite.save).to.have.been.called;
    });

    it('should handle bucket configuration when allowedPaths provided', async () => {
      const data = { allowedPaths: ['test-org/path1', 'test-org/path2'], cdnProvider: 'commerce-fastly' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockSiteConfig.updateLlmoCdnBucketConfig).to.have.been.calledWith({ orgId: 'test-org' });
      expect(mockSite.save).to.have.been.called;
    });

    it('should handle bucket configuration when both bucketName and allowedPaths provided', async () => {
      const data = { bucketName: 'test-bucket', allowedPaths: ['test-org/path1'], cdnProvider: 'commerce-fastly' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockSiteConfig.updateLlmoCdnBucketConfig).to.have.been.calledWith({
        bucketName: 'test-bucket',
        orgId: 'test-org',
      });
      expect(mockSite.save).to.have.been.called;
    });

    it('should handle aem-cs-fastly provider', async () => {
      context.dataAccess.Site.allByOrganizationId.resolves([mockSite]);
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves([]);

      const data = { cdnProvider: 'aem-cs-fastly' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(context.sqs.sendMessage).to.have.been.called;
    });

    it('should skip aem-cs-fastly processing when CDN logs report already exists', async () => {
      context.dataAccess.Site.allByOrganizationId.resolves([mockSite]);
      // Mock existing CDN logs report
      context.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves(['existing-report']);

      const data = { cdnProvider: 'aem-cs-fastly' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      // Should not send any SQS messages since report already exists
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('should handle byocdn provider', async () => {
      const data = { cdnProvider: 'byocdn-custom' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockConfiguration.enableHandlerForSite).to.have.been.calledWith('cdn-analysis', mockSite);
      expect(mockConfiguration.save).to.have.been.called;
    });

    it('should handle byocdn-fastly provider', async () => {
      const data = { cdnProvider: 'byocdn-fastly' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockConfiguration.enableHandlerForSite).to.have.been.calledWith('cdn-analysis', mockSite);
      expect(mockConfiguration.save).to.have.been.called;
    });

    it('should not enable cdn-analysis for non-byocdn providers', async () => {
      const data = { cdnProvider: 'other-provider' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockConfiguration.enableHandlerForSite).to.not.have.been.called;
    });

    it('should not update bucket config when neither bucketName nor orgId provided', async () => {
      const data = { cdnProvider: 'some-provider' };

      await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

      expect(mockSiteConfig.updateLlmoCdnBucketConfig).to.not.have.been.called;
      expect(mockSite.save).to.not.have.been.called;
    });

    describe('AMS provider handling', () => {
      beforeEach(() => {
        context.dataAccess.Site.allByOrganizationId.resolves([mockSite]);
      });

      it('should handle ams-cloudfront provider and remove @ from IMS org ID', async () => {
        // Mock organization with IMS org ID
        const mockOrganization = {
          getImsOrgId: sandbox.stub().returns('TestOrg123@AdobeOrg'),
        };
        context.dataAccess.Organization.findById.resolves(mockOrganization);
        
        const data = { cdnProvider: 'ams-cloudfront' };

        await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

        expect(context.dataAccess.Organization.findById).to.have.been.calledWith(mockSite.getOrganizationId());
        expect(mockSiteConfig.updateLlmoCdnBucketConfig).to.have.been.calledWith({ 
          orgId: 'TestOrg123AdobeOrg' 
        });
        expect(mockConfiguration.enableHandlerForSite).to.have.been.calledWith('cdn-analysis', mockSite);
      });

      it('should handle ams providers without IMS org ID when not cloudfront', async () => {
        const data = { cdnProvider: 'ams-other' };

        await cdnConfigHandler.handleCdnBucketConfigChanges(context, data);

        expect(context.dataAccess.Organization.findById).to.not.have.been.called;
        expect(mockConfiguration.enableHandlerForSite).to.have.been.calledWith('cdn-analysis', mockSite);
      });
    });
  });
});
