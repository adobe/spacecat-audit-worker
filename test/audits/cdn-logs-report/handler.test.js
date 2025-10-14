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
import { MockContextBuilder } from '../../shared.js';
import handler from '../../../src/cdn-logs-report/handler.js';

use(sinonChai);

// Mock data constants
const MOCK_AGENTIC_DATA = [
  {
    agent_type: 'Bot',
    user_agent_display: 'Googlebot/2.1',
    status: 200,
    number_of_hits: 100,
    avg_ttfb_ms: 250.5,
    country_code: 'US',
    url: '/test',
    product: 'adobe-analytics',
    category: 'Product Page',
  },
  {
    agent_type: 'LLM',
    user_agent_display: 'ChatGPT-User/1.0',
    status: 200,
    number_of_hits: 50,
    avg_ttfb_ms: 180.2,
    country_code: 'GLOBAL',
    url: '/page',
    product: 'experience-manager',
    category: 'Documentation',
  },
  {
    agent_type: 'LLM',
    user_agent_display: 'ChatGPT-User/1.0',
    status: 200,
    number_of_hits: 50,
    avg_ttfb_ms: 180.2,
    country_code: 'AA',
    url: '/page',
    product: 'experience-manager',
    category: 'Documentation',
  },
  {
    agent_type: 'LLM',
    user_agent_display: 'ChatGPT-User/1.0',
    status: 200,
    number_of_hits: 50,
    avg_ttfb_ms: 180.2,
    country_code: 1,
    url: '-',
    product: 'experience-manager',
    category: 'Documentation',
  },
  {
    agent_type: null,
    user_agent_display: null,
    status: null,
    number_of_hits: null,
    avg_ttfb_ms: null,
    country_code: null,
    url: null,
    product: null,
    category: null,
  },
  {
    agent_type: null,
    user_agent_display: null,
    status: null,
    number_of_hits: null,
    avg_ttfb_ms: null,
    country_code: 999, // Invalid country code to trigger catch in validateCountryCode
    url: null,
    product: null,
    category: null,
  },
  {
    agent_type: 'Bot',
    user_agent_display: 'TestBot',
    status: 200,
    number_of_hits: 10,
    avg_ttfb_ms: 150,
    country_code: null, // null country code
    url: '/test',
    product: 'adobe-analytics',
    category: 'Test',
  },
  {
    agent_type: 'Bot',
    user_agent_display: 'TestBot',
    status: 200,
    number_of_hits: 10,
    avg_ttfb_ms: 150,
    country_code: 'INVALID',
    url: '/test',
    product: {},
    category: 'Test',
  },
];

const MOCK_REFERRAL_DATA = [
  {
    path: '/products/analytics',
    referrer: 'https://google.com/search',
    utm_source: 'google',
    utm_medium: 'organic',
    tracking_param: null,
    device: 'desktop',
    date: '2025-01-15',
    region: 'US',
    pageviews: 1250,
  },
  {
    path: 'documentation',
    referrer: 'https://ads.google.com',
    utm_source: 'google',
    utm_medium: 'cpc',
    tracking_param: 'google_ads_456',
    device: 'tablet',
    date: '2025-01-15',
    region: 'GB',
    pageviews: 420,
  },
];

describe('CDN Logs Report Handler', function test() {
  let sandbox;
  let context;
  let site;

  this.timeout(5000);

  const createMockSharepointClient = (stubber) => ({
    getDocument: stubber.stub().returns({
      getDocumentContent: stubber.stub().resolves(Buffer.from('test content')),
      uploadRawDocument: stubber.stub().resolves(),
    }),
    uploadFile: stubber.stub().resolves({ success: true }),
  });

  const createAuditContext = (stubber, overrides = {}) => ({
    sharepointOptions: {
      helixContentSDK: {
        createFrom: stubber.stub().resolves(createMockSharepointClient(stubber)),
      },
    },
    ...overrides,
  });

  const createSiteConfig = (overrides = {}) => {
    const defaultConfig = {
      getLlmoDataFolder: () => 'test-folder',
      getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-adobe-dev' }),
      getLlmoCdnlogsFilter: () => [{
        value: ['www.example.com'],
        key: 'host',
      }],
    };
    return { ...defaultConfig, ...overrides };
  };

  const setupAthenaClientWithData = (
    stubber,
    agenticData = MOCK_AGENTIC_DATA,
    referralData = MOCK_REFERRAL_DATA,
  ) => ({
    execute: stubber.stub().resolves(),
    query: stubber.stub().callsFake((query, database, description) => {
      if (description.includes('agentic')) {
        return Promise.resolve(agenticData);
      } else if (description.includes('referral')) {
        return Promise.resolve(referralData);
      }
      return Promise.resolve([]);
    }),
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    nock.cleanAll();

    site = {
      getSiteId: () => 'test-site',
      getId: () => 'test-site',
      getBaseURL: () => 'https://example.com',
      getConfig: () => createSiteConfig(),
      getOrganizationId: sandbox.stub().returns('test-org-id'),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          SHAREPOINT_CLIENT_ID: 'test-client-id',
          SHAREPOINT_CLIENT_SECRET: 'test-client-secret',
          SHAREPOINT_AUTHORITY: 'https://login.microsoftonline.com/test-tenant-id',
          SHAREPOINT_DOMAIN_ID: 'test-domain-id',
        },
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        s3Client: {
          send: sandbox.stub().resolves({
            Contents: [{ Key: 'raw/fastly/2025/01/15/10/file1.log' }],
          }),
        },
        athenaClient: setupAthenaClientWithData(sandbox),
        dataAccess: {
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org-id',
            }),
          },
        },
      })
      .build();

    // Mock the patterns.json endpoint to avoid pattern generation
    nock('https://main--project-elmo-ui-data--adobe.aem.live')
      .get('/test-folder/agentic-traffic/patterns/patterns.json')
      .reply(200, {
        pagetype: { data: [] },
        products: { data: [] },
      });
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  describe('Cdn logs report audit handler', () => {
    it('successfully processes CDN logs report', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-07'),
        toFake: ['Date']
      });
      const auditContext = createAuditContext(sandbox);
      const result = await handler.runner('https://example.com', context, site, auditContext);

      // Verify audit result structure
      expect(result).to.have.property('auditResult').that.is.an('array');
      expect(result.auditResult).to.have.length.greaterThan(0);
      expect(result).to.have.property('fullAuditRef').that.equals('test-folder');

      // Verify each report config result
      result.auditResult.forEach((reportResult) => {
        expect(reportResult).to.have.property('name').that.is.a('string');
        expect(reportResult).to.have.property('table').that.is.a('string');
        expect(reportResult).to.have.property('database').that.includes('cdn_logs_');
        expect(reportResult).to.have.property('customer').that.is.a('string');
      });

      clock.restore();
      // Verify logging calls
      expect(context.log.debug).to.have.been.calledWith('Starting CDN logs report audit for https://example.com');

      // Verify Athena interactions
      expect(context.athenaClient.execute).to.have.been.callCount(3);
      expect(context.athenaClient.query).to.have.been.callCount(2);

      // Verify data access calls
      expect(context.dataAccess.Organization.findById).to.have.been.calledWith('test-org-id');
    });

    it('returns error when no CDN bucket found', async () => {
      site.getConfig = () => createSiteConfig({
        getLlmoCdnBucketConfig: () => null,
        getCdnLogsConfig: () => null,
      });

      const result = await handler.runner('https://example.com', context, site);

      expect(result.auditResult).to.have.property('success', false);
      expect(result.auditResult).to.have.property('error', 'No CDN bucket found');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('handles null getLlmoCdnBucketConfig with orgId fallback', async () => {
      site.getConfig = () => createSiteConfig({
        getLlmoCdnBucketConfig: () => null,
      });

      // Override context to include AWS_ENV for standard bucket discovery
      const contextWithEnv = {
        ...context,
        env: {
          ...context.env,
          AWS_ENV: 'dev',
        },
      };

      const auditContext = createAuditContext(sandbox);
      const result = await handler.runner('https://example.com', contextWithEnv, site, auditContext);

      expect(result).to.have.property('auditResult').that.is.an('array');
      expect(result.auditResult).to.have.length.greaterThan(0);
      expect(result).to.have.property('fullAuditRef').that.equals('test-folder');

      // Verify data access was called to get IMS org ID as fallback
      expect(contextWithEnv.dataAccess.Organization.findById).to.have.been.calledWith('test-org-id');
    });

    it('handles different weekOffset values', async () => {
      const weekOffset = -2;
      const auditContext = createAuditContext(sandbox, { weekOffset });
      const result = await handler.runner('https://example.com', context, site, auditContext);

      expect(result).to.have.property('auditResult').that.is.an('array');
      expect(result.auditResult).to.have.length.greaterThan(0);
      expect(result).to.have.property('fullAuditRef').that.equals('test-folder');

      expect(context.athenaClient.query).to.have.been.callCount(2);

      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(`week offset: ${weekOffset}`),
      );
    });

    it('runs both week 0 and -1 on Monday when no weekOffset provided', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-06'),
        toFake: ['Date']
      });

      context.athenaClient.query.resetHistory();
      const auditContext = createAuditContext(sandbox);
      await handler.runner('https://example.com', context, site, auditContext);
      
      clock.restore();
      expect(context.athenaClient.query).to.have.been.callCount(4);
    });

    it('runs only week 0 on non-Monday when no weekOffset provided', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-07'),
        toFake: ['Date']
      });

      context.athenaClient.query.resetHistory();
      const auditContext = createAuditContext(sandbox);
      await handler.runner('https://example.com', context, site, auditContext);

      clock.restore();
      expect(context.athenaClient.query).to.have.been.callCount(2);
    });

    it('uses provided weekOffset regardless of day', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-06'),
        toFake: ['Date']
      });

      context.athenaClient.query.resetHistory();
      const auditContext = createAuditContext(sandbox, { weekOffset: -3 });
      await handler.runner('https://example.com', context, site, auditContext);

      clock.restore();
      expect(context.athenaClient.query).to.have.been.callCount(2);
    });

    it('handles table creation errors', async () => {
      context.athenaClient.execute.onSecondCall().rejects(new Error('Table creation failed'));
      const auditContext = createAuditContext(sandbox);

      try {
        await handler.runner('https://example.com', context, site, auditContext);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error.message).to.equal('Table creation failed');
        expect(context.log.error).to.have.been.calledWith('Failed to ensure table exists: Table creation failed');
      }
    });

    describe('LLMO pattern fetch scenarios', () => {
      it('handles successful pattern fetch', async () => {
        const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
          .get('/test-folder/agentic-traffic/patterns/patterns.json')
          .reply(200, {
            pagetype: { data: [{ pattern: 'product-page' }] },
            products: { data: [{ product: 'adobe-analytics' }] },
          });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        // Verify successful execution
        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);

        // Verify pattern fetch was called
        expect(patternNock.isDone()).to.be.true;

        // Verify queries were executed with pattern data
        expect(context.athenaClient.query).to.have.been.called;
      });

      it('handles missing pagetype data', async () => {
        const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
          .get('/test-folder/agentic-traffic/patterns/patterns.json')
          .reply(200, {
            products: { data: [{ product: 'adobe-analytics' }] },
          });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(patternNock.isDone()).to.be.true;
      });

      it('handles fetch errors gracefully', async () => {
        const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
          .get('/test-folder/agentic-traffic/patterns/patterns.json')
          .reply(500, 'Server Error');

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(patternNock.isDone()).to.be.true;

        expect(context.athenaClient.query).to.have.been.called;
      });
    });

    describe('data processing edge cases', () => {
      it('logs skipping message when no S3 data found', async () => {
        context.s3Client = {
          send: sandbox.stub().resolves({ Contents: [] }),
        };

        context.athenaClient = setupAthenaClientWithData(sandbox, null, null);
        const auditContext = createAuditContext(sandbox);

        await handler.runner('https://example.com', context, site, auditContext);

        expect(context.log.info).to.have.been.calledWith('No data found for agentic report - skipping');
        expect(context.log.info).to.have.been.calledWith('No data found for referral report - skipping');
      });

      it('logs warning when Athena query returns empty data', async () => {
        context.athenaClient = setupAthenaClientWithData(sandbox, [], null);
        const auditContext = createAuditContext(sandbox);

        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/No data returned from Athena query for .* report \(.*\)\./)
        );
      });

      it('handles Athena query errors gracefully', async () => {
        const queryError = new Error('Athena query failed: Table not found');
        context.athenaClient = {
          execute: sandbox.stub().resolves(),
          query: sandbox.stub().rejects(queryError),
        };
        const auditContext = createAuditContext(sandbox);

        await handler.runner('https://example.com', context, site, auditContext);

        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/report generation failed: Athena query failed/)
        );
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Failed to generate .* report: Athena query failed/)
        );
      });
    });

    describe('site filter configurations', () => {
      it('handles exclude filters and no dataFolder scenarios', async () => {
        site.getConfig = () => createSiteConfig({
          getLlmoDataFolder: () => null,
          getLlmoCdnlogsFilter: () => [{
            value: ['bot', 'crawler'],
            key: 'user_agent',
            type: 'exclude',
          }, {
            value: ['www.example.com'],
            key: 'host',
          }],
        });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(result).to.have.property('fullAuditRef').that.equals('null');

        expect(context.athenaClient.query).to.have.been.called;
      });

      it('handles empty filters array', async () => {
        site.getConfig = () => createSiteConfig({
          getLlmoCdnlogsFilter: () => [],
        });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(result).to.have.property('fullAuditRef').that.equals('test-folder');

        expect(context.athenaClient.query).to.have.been.called;
      });
    });
  });
});
