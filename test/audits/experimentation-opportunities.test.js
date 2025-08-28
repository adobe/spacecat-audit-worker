/*
 * Copyright 2023 Adobe. All rights reserved.
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
import { MockContextBuilder } from '../shared.js';
import opportunitiesData from '../fixtures/experimentation-opportunities/opportunitiesdata.json' with { type: 'json' };
import auditDataMock from '../fixtures/experimentation-opportunities/experimentation-opportunity-audit.json' with { type: 'json' };
import {
  runAuditAndScrapeStep,
  organicKeywordsStep,
  importAllTrafficStep,
  generateOpportunityAndSuggestions,
  experimentOpportunitiesAuditRunner,
  getHighOrganicLowCtrOpportunity,
  processCustomUrls,
} from '../../src/experimentation-opportunities/handler.js';

use(sinonChai);

describe('Experimentation Opportunities Tests', () => {
  const url = 'https://abc.com';

  let context;
  let processEnvCopy;
  let messageBodyJson;
  let sandbox;
  let site;
  let audit;
  let s3Client;
  let siteConfig;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(async () => {
    messageBodyJson = {
      type: '404',
      url: 'https://abc.com',
      auditContext: {
        finalUrl: 'abc.com',
      },
    };
    siteConfig = {
      getImports: () => [],
      enableImport: sinon.stub(),
      disableImport: sinon.stub(),
      getSlackConfig: sinon.stub(),
      getHandlers: sinon.stub(),
      getContentAiConfig: sinon.stub(),
      getFetchConfig: sinon.stub(),
      getBrandConfig: sinon.stub(),
      getCdnLogsConfig: sinon.stub(),
      getLlmoConfig: sinon.stub(),
    };
    site = {
      getBaseURL: () => 'https://abc.com',
      getId: () => '056f9dbe-e9e1-4d80-8bfb-c9785a873b6a',
      getDeliveryType: () => 'aem_edge',
      setConfig: sinon.stub(),
      save: sinon.stub(),
      getConfig: () => siteConfig,
    };
    audit = {
      getId: () => auditDataMock.id,
      getAuditType: () => 'experimentation-opportunities',
      getFullAuditRef: () => url,
      getAuditResult: sinon.stub(),
    };
    s3Client = {
      send: sinon.stub().resolves({
        Body: {
          transformToString: sinon.stub().resolves('{"scrapeResult":{"tags":{"lang":"en-US"}}}'),
        },
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
          AWS_REGION: 'us-east-1',
          AWS_ACCESS_KEY_ID: 'some-key-id',
          AWS_SECRET_ACCESS_KEY: 'some-secret-key',
          AWS_SESSION_TOKEN: 'some-secret-token',
          QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
          S3_SCRAPER_BUCKET_NAME: 'bucket',
        },
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        audit,
        site,
        finalUrl: url,
        s3Client,
      })
      .build(messageBodyJson);

    context.rumApiClient = {
      queryMulti: sinon.stub().resolves(opportunitiesData),
      query: sinon.stub().resolves([]), // Add query method for custom URL processing
    };
    context.sqs = {
      sendMessage: sinon.stub().resolves({}),
    };

    processEnvCopy = { ...process.env };
    process.env = {
      ...process.env,
      ...context.env,
    };

    nock('https://abc.com')
      .get('/')
      .reply(200);
  });

  afterEach(() => {
    process.env = processEnvCopy;
    nock.cleanAll();
    sandbox.restore();
    sinon.restore();
  });

  describe('Basic Audit Functionality', () => {
    it('should run the audit and scrape step', async () => {
      const auditData = await runAuditAndScrapeStep(context);
      expect(context.rumApiClient.queryMulti).calledWith(
        [
          'rageclick',
          'high-inorganic-high-bounce-rate',
          'high-organic-low-ctr',
        ],
        {
          domain: 'https://abc.com',
          interval: 7,
          granularity: 'hourly',
        },
      );

      expect(
        auditData.auditResult.experimentationOpportunities,
      ).to.deep.equal(auditDataMock.auditResult.experimentationOpportunities);
    });
  });

  describe('Organic Keywords Step', () => {
    it('should enable the imports if organic-keywords import is not enabled', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'https://abc.com/page1' },
        ],
      });
      const result = await organicKeywordsStep(context);

      expect(context.site.getConfig().enableImport).to.have.been.calledWith('organic-keywords');
      expect(context.site.getConfig().disableImport).to.have.been.calledWith('organic-keywords');
      expect(context.site.save).to.have.been.called;
      expect(result).to.have.property('urlConfigs');
      expect(result.urlConfigs[0]).to.deep.include({ url: 'https://abc.com/page1', geo: 'us' });
    });

    it('should NOT enable the imports if organic-keywords import is already enabled', async () => {
      context.site.getConfig().getImports = () => [{ type: 'organic-keywords', enabled: true }];
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'https://abc.com/page2' },
        ],
      });
      const result = await organicKeywordsStep(context);
      expect(context.site.getConfig().enableImport).not.to.have.been.called;
      expect(context.site.getConfig().disableImport).not.to.have.been.called;
      expect(context.site.save).not.to.have.been.called;
      expect(result).to.have.property('urlConfigs');
      expect(result.urlConfigs[0]).to.deep.include({ url: 'https://abc.com/page2', geo: 'us' });
    });

    it('should log site config and imports information', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'https://abc.com/page1' },
        ],
      });

      await organicKeywordsStep(context);

      expect(context.log.info).to.have.been.calledWith('Site config exists: true, imports count: 0');
    });

    it('should handle null site config gracefully', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'https://abc.com/page1' },
        ],
      });

      // Mock site.getConfig to return null
      context.site.getConfig = sinon.stub().returns(null);

      const result = await organicKeywordsStep(context);

      expect(context.log.info).to.have.been.calledWith('Site config exists: false, imports count: 0');
      expect(context.log.error).to.have.been.calledWith('Cannot toggle import organic-keywords for site 056f9dbe-e9e1-4d80-8bfb-c9785a873b6a: site config is null');
      expect(result).to.have.property('urlConfigs');
      expect(result.urlConfigs[0]).to.deep.include({ url: 'https://abc.com/page1', geo: 'us' });
    });

    it('should not call toggleImport if site config is null', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'https://abc.com/page1' },
        ],
      });

      // Mock site.getConfig to return null
      context.site.getConfig = sinon.stub().returns(null);

      await organicKeywordsStep(context);

      // Verify that site.save is not called when config is null
      expect(context.site.save).not.to.have.been.called;
      expect(context.site.setConfig).not.to.have.been.called;
    });

    it('organic keywords step should handle failures in saving the site config', async () => {
      context.audit.getAuditResult.returns(auditDataMock.auditResult);
      context.site.save.rejects(new Error('Failed to save site config'));
      const stepResult = await organicKeywordsStep(context);
      expect(
        stepResult,
      ).to.deep.equal({
        type: 'organic-keywords',
        siteId: site.getId(),
        urlConfigs: [{ url: 'https://abc.com/abc-adoption/account', geo: 'us' }],
      });
    });

    it('organic keywords step should handle invalid urls in the audit result', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'invalid-url' },
        ],
      });
      const stepResult = await organicKeywordsStep(context);
      expect(
        stepResult,
      ).to.deep.equal({
        type: 'organic-keywords',
        siteId: site.getId(),
        urlConfigs: [],
      });
    });

    it('organic keywords step should use default geo if scrape not found', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'https://abc.com/page3' },
        ],
      });
      context.s3Client.send.resolves({
        Body: {
          transformToString: sinon.stub().resolves(null),
        },
      });
      const stepResult = await organicKeywordsStep(context);
      expect(
        stepResult,
      ).to.deep.equal({
        type: 'organic-keywords',
        siteId: site.getId(),
        urlConfigs: [{ url: 'https://abc.com/page3', geo: 'us' }],
      });
    });

    it('organic keywords step should use default geo if lang tag not found in scrape', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'high-organic-low-ctr', page: 'https://abc.com/page3' },
        ],
      });
      context.s3Client.send.resolves({
        Body: {
          transformToString: sinon.stub().resolves({ scrapeResult: { tags: {} } }),
        },
      });
      let stepResult = await organicKeywordsStep(context);
      expect(
        stepResult,
      ).to.deep.equal({
        type: 'organic-keywords',
        siteId: site.getId(),
        urlConfigs: [{ url: 'https://abc.com/page3', geo: 'us' }],
      });
      context.s3Client.send.resolves({
        Body: {
          transformToString: sinon.stub().resolves({ scrapeResult: {} }),
        },
      });
      stepResult = await organicKeywordsStep(context);
      expect(
        stepResult,
      ).to.deep.equal({
        type: 'organic-keywords',
        siteId: site.getId(),
        urlConfigs: [{ url: 'https://abc.com/page3', geo: 'us' }],
      });
    });
  });

  describe('Import All Traffic Step', () => {
    it('should run the import all traffic step', async () => {
      const stepResult = importAllTrafficStep(context);
      expect(stepResult).to.deep.equal({
        type: 'all-traffic',
        siteId: site.getId(),
      });
    });
  });

  describe('Message Generation', () => {
    it('sends messages for each high-organic-low-ctr opportunity to mystique', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          {
            type: 'high-organic-low-ctr',
            page: 'https://abc.com/oppty-one',
            trackedPageKPIValue: '0.12',
            trackedKPISiteAverage: '0.25',
          },
          {
            type: 'rageclick',
            page: 'https://abc.com/rageclick-page',
          },
          {
            type: 'high-organic-low-ctr',
            page: 'https://abc.com/oppty-two',
            trackedPageKPIValue: '0.08',
            trackedKPISiteAverage: '0.22',
          },
        ],
      });
      await generateOpportunityAndSuggestions(context);

      expect(context.sqs.sendMessage).to.have.been.calledTwice;

      const [queueArg1, messageArg1] = context.sqs.sendMessage.firstCall.args;
      expect(queueArg1).to.equal('spacecat-to-mystique');
      expect(messageArg1).to.include({
        type: 'guidance:high-organic-low-ctr',
        siteId: site.getId(),
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
      });
      expect(messageArg1.data).to.deep.equal({
        url: 'https://abc.com/oppty-one',
        ctr: '0.12',
        siteAverageCtr: '0.25',
      });

      const [queueArg2, messageArg2] = context.sqs.sendMessage.secondCall.args;
      expect(queueArg2).to.equal('spacecat-to-mystique');
      expect(messageArg2).to.include({
        type: 'guidance:high-organic-low-ctr',
        siteId: site.getId(),
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
      });
      expect(messageArg2.data).to.deep.equal({
        url: 'https://abc.com/oppty-two',
        ctr: '0.08',
        siteAverageCtr: '0.22',
      });
    });

    it('not sends SQS messages if no high-organic-low-ctr opportunities exist', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [
          { type: 'rageclick', page: 'https://abc.com/rageclick-page' },
          { type: 'high-inorganic-high-bounce-rate', page: 'https://abc.com/bounce-page' },
        ],
      });

      await generateOpportunityAndSuggestions(context);

      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('should not send SQS messages if audit failed', async () => {
      context.audit.getAuditResult.returns({
        experimentationOpportunities: [],
      });
      context.audit.isError = true;
      await generateOpportunityAndSuggestions(context);
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });
  });

  describe('Additional URLs Processing', () => {
    describe('Successfully process additional URLs', () => {
      it('should use custom URLs when provided and create opportunities for all URLs', async () => {
        const domain = 'https://abc.com';
        const customUrl1 = 'https://abc.com/page1';
        const customUrl2 = 'https://abc.com/page2';

        context.data = `${customUrl1},${customUrl2}`;
        context.rumApiClient.query = sinon.stub().resolves([]);

        const result = await experimentOpportunitiesAuditRunner(domain, context);

        expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
        expect(context.rumApiClient.query).to.have.been.calledOnce;
        expect(context.rumApiClient.query).to.have.been.calledWith(
          'high-organic-low-ctr',
          sinon.match({
            domain: 'https://abc.com',
            interval: 7,
            granularity: 'hourly',
            maxOpportunities: 1000,
          }),
        );

        expect(result.auditResult.experimentationOpportunities).to.have.length(2);

        const opptyUrls = result.auditResult.experimentationOpportunities.map(
          (oppty) => oppty.page,
        );
        expect(opptyUrls).to.include(customUrl1);
        expect(opptyUrls).to.include(customUrl2);

        // Check that we have the right URLs
        result.auditResult.experimentationOpportunities.forEach((oppty) => {
          expect(oppty.type).to.equal('high-organic-low-ctr');
          expect([customUrl1, customUrl2]).to.include(oppty.page);
        });
      });

      it('should handle mixed URLs with and without RUM data', async () => {
        const domain = 'https://abc.com';
        const urlWithRumData = 'https://abc.com/page1';
        const urlWithoutRumData = 'https://abc.com/page2';

        const mockOpportunities = {
          'high-organic-low-ctr': [
            {
              page: urlWithRumData,
              pageViews: 5000,
              trackedPageKPIValue: '0.02',
              trackedKPISiteAverage: '0.035',
              type: 'high-organic-low-ctr',
            },
          ],
          rageclick: [],
          'high-inorganic-high-bounce-rate': [],
        };

        const mockQueryResult = [
          {
            page: urlWithRumData,
            pageViews: 5000,
            trackedPageKPIValue: '0.02',
            trackedKPISiteAverage: '0.035',
            type: 'high-organic-low-ctr',
          },
        ];

        context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);
        context.rumApiClient.query = sinon.stub().resolves(mockQueryResult);
        context.data = `${urlWithRumData},${urlWithoutRumData}`;

        const result = await experimentOpportunitiesAuditRunner(domain, context);
        expect(context.rumApiClient.query).to.have.been.calledWith(
          'high-organic-low-ctr',
          sinon.match({
            domain: 'https://abc.com',
            interval: 7,
            granularity: 'hourly',
            maxOpportunities: 1000,
          }),
        );
        expect(result.auditResult.experimentationOpportunities).to.have.length(2);

        const opptyUrls = result.auditResult.experimentationOpportunities.map(
          (oppty) => oppty.page,
        );
        expect(opptyUrls).to.include(urlWithRumData);
        expect(opptyUrls).to.include(urlWithoutRumData);

        const realOpportunity = result.auditResult.experimentationOpportunities.find(
          (op) => op.page === urlWithRumData,
        );
        expect(realOpportunity.pageViews).to.equal(5000);
        expect(realOpportunity.trackedPageKPIValue).to.equal('0.02');

        const emptyOpportunity = result.auditResult.experimentationOpportunities.find(
          (op) => op.page === urlWithoutRumData,
        );
        expect(emptyOpportunity.type).to.equal('high-organic-low-ctr');
        expect(emptyOpportunity.page).to.equal(urlWithoutRumData);
        // Should not have RUM data properties
        expect(emptyOpportunity.pageViews).to.be.undefined;
        expect(emptyOpportunity.trackedPageKPIValue).to.be.undefined;
      });

      it('should only return high-organic-low-ctr opportunities when using custom URLs', async () => {
        const domain = 'https://abc.com';
        const customUrl = 'https://abc.com/page1';

        const mockOpportunities = {
          'high-organic-low-ctr': [
            {
              page: customUrl,
              pageViews: 5000,
              type: 'high-organic-low-ctr',
            },
          ],
          rageclick: [
            {
              page: customUrl,
              type: 'rageclick',
              metrics: [{ samples: 100 }],
            },
          ],
          'high-inorganic-high-bounce-rate': [
            {
              page: customUrl,
              type: 'high-inorganic-high-bounce-rate',
            },
          ],
        };

        // Mock query method to return the high-organic-low-ctr opportunity
        const mockQueryResult = [
          {
            page: customUrl,
            pageViews: 5000,
            type: 'high-organic-low-ctr',
          },
        ];

        context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);
        context.rumApiClient.query = sinon.stub().resolves(mockQueryResult);
        context.data = customUrl;

        const result = await experimentOpportunitiesAuditRunner(domain, context);

        expect(result.auditResult.experimentationOpportunities).to.have.length(1);
        expect(result.auditResult.experimentationOpportunities[0].type).to.equal('high-organic-low-ctr');
        expect(result.auditResult.experimentationOpportunities[0].page).to.equal(customUrl);
      });
    });

    describe('Successfully process without additional URLs', () => {
      // Integration test - tests full runAuditAndScrapeStep flow
      it('should work normally when no custom URLs provided', async () => {
        const auditData = await runAuditAndScrapeStep(context);
        expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
        expect(auditData.auditResult.experimentationOpportunities).to.exist;
        expect(auditData.auditResult.experimentationOpportunities).to.be.an('array');
        expect(auditData.auditResult.experimentationOpportunities).to.have.length(5);

        const opportunityTypes = auditData.auditResult.experimentationOpportunities.map(
          (op) => op.type,
        );
        expect(opportunityTypes).to.include('rageclick');
        expect(opportunityTypes).to.include('high-organic-low-ctr');

        expect(auditData).to.have.property('type', 'experimentation-opportunities');
        expect(auditData).to.have.property('urls');
        expect(auditData).to.have.property('siteId');
      });

      // Unit tests for edge cases
      it('should handle empty custom URLs array', async () => {
        const domain = 'https://abc.com';

        context.data = '';

        const result = await experimentOpportunitiesAuditRunner(domain, context);
        expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
        expect(result.auditResult.experimentationOpportunities).to.exist;
      });

      it('should handle null additionalData', async () => {
        const domain = 'https://abc.com';

        context.data = null;

        const result = await experimentOpportunitiesAuditRunner(domain, context);
        expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
        expect(result.auditResult.experimentationOpportunities).to.exist;
      });

      it('should handle undefined data', async () => {
        const domain = 'https://abc.com';

        context.data = undefined;

        const result = await experimentOpportunitiesAuditRunner(domain, context);
        expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
        expect(result.auditResult.experimentationOpportunities).to.exist;
      });

      it('should handle undefined experimentationOpportunities in urls field', async () => {
        context.rumApiClient.queryMulti = sinon.stub().resolves({
          rageclick: [
            {
              type: 'rageclick',
              page: 'https://abc.com/rage1',
              metrics: [{ samples: 100 }],
            },
          ],
          'high-organic-low-ctr': [],
          'high-inorganic-high-bounce-rate': [
            {
              type: 'high-inorganic-high-bounce-rate',
              page: 'https://abc.com/bounce1',
            },
          ],
        });

        const auditData = await runAuditAndScrapeStep(context);

        expect(auditData.urls).to.deep.equal([]);
        expect(auditData.auditResult.experimentationOpportunities).to.be.an('array');
        expect(auditData.auditResult.experimentationOpportunities).to.have.length(2);

        const highOrganicOpportunities = auditData.auditResult.experimentationOpportunities.filter(
          (op) => op.type === 'high-organic-low-ctr',
        );
        expect(highOrganicOpportunities).to.have.length(0);
      });
    });

    describe('Edge cases and error handling', () => {
      it('should create opportunities with no RUM data for custom URLs', async () => {
        const domain = 'https://abc.com';
        const customUrl1 = 'https://abc.com/new-page1';
        const customUrl2 = 'https://abc.com/new-page2';

        context.rumApiClient.queryMulti = sinon.stub().resolves({
          rageclick: [],
          'high-organic-low-ctr': [],
          'high-inorganic-high-bounce-rate': [],
        });
        context.rumApiClient.query = sinon.stub().resolves([]);
        context.data = `${customUrl1},${customUrl2}`;
        const result = await experimentOpportunitiesAuditRunner(domain, context);

        expect(context.rumApiClient.query).to.have.been.calledWith(
          'high-organic-low-ctr',
          sinon.match({
            domain: 'https://abc.com',
            interval: 7,
            granularity: 'hourly',
            maxOpportunities: 1000,
          }),
        );
        expect(result.auditResult.experimentationOpportunities).to.have.length(2);

        const opptyUrls = result.auditResult.experimentationOpportunities.map(
          (oppty) => oppty.page,
        );
        expect(opptyUrls).to.include(customUrl1);
        expect(opptyUrls).to.include(customUrl2);

        result.auditResult.experimentationOpportunities.forEach((op) => {
          expect(op.type).to.equal('high-organic-low-ctr');
          expect(op.page).to.match(/https:\/\/abc\.com\/new-page[12]/);
          expect(op.pageViews).to.be.undefined;
          expect(op.trackedPageKPIValue).to.be.undefined;
        });
      });
    });
  });

  describe('processCustomUrls Helper Function', () => {
    it('should process custom URLs and return combined opportunities', async () => {
      const customUrls = ['https://abc.com/page1', 'https://abc.com/page2'];
      const mockRumData = [
        {
          page: 'https://abc.com/page1',
          pageViews: 1000,
          trackedPageKPIValue: '0.02',
          type: 'high-organic-low-ctr',
        },
      ];
      const mockRumApiClient = {
        query: sinon.stub().resolves(mockRumData),
      };
      const mockOptions = {
        domain: 'https://abc.com',
        interval: 7,
        granularity: 'hourly',
      };
      const mockContext = {
        log: {
          info: sinon.stub(),
        },
      };

      const result = await processCustomUrls(
        customUrls,
        mockRumApiClient,
        mockOptions,
        mockContext,
      );
      expect(mockRumApiClient.query).to.have.been.calledWith(
        'high-organic-low-ctr',
        { ...mockOptions, maxOpportunities: 1000 },
      );
      expect(result).to.have.length(2);

      const urlWithRum = result.find((op) => op.page === 'https://abc.com/page1');
      expect(urlWithRum.pageViews).to.equal(1000);
      expect(urlWithRum.trackedPageKPIValue).to.equal('0.02');

      const urlWithoutRum = result.find((op) => op.page === 'https://abc.com/page2');
      expect(urlWithoutRum.type).to.equal('high-organic-low-ctr');
      expect(urlWithoutRum.pageViews).to.be.undefined;
    });

    it('should handle URL parsing with spaces and duplicates', async () => {
      context.data = 'https://abc.com/page1, https://abc.com/page2 ,https://abc.com/page1';
      context.rumApiClient.query = sinon.stub().resolves([]);
      const result = await experimentOpportunitiesAuditRunner('https://abc.com', context);
      expect(result.auditResult.experimentationOpportunities).to.have.length(2);
      const urls = result.auditResult.experimentationOpportunities.map((op) => op.page);
      expect(urls).to.include('https://abc.com/page1');
      expect(urls).to.include('https://abc.com/page2');
    });
  });

  describe('Audit Runner Functions', () => {
    describe('getHighOrganicLowCtrOpportunity', () => {
      it('should filter and return only high-organic-low-ctr opportunities', () => {
        const mixedOpportunities = [
          {
            page: 'https://abc.com/page1',
            pageViews: 5000,
            trackedPageKPIValue: '0.02',
            type: 'high-organic-low-ctr',
          },
          {
            page: 'https://abc.com/page1',
            samples: 100,
            type: 'rageclick',
            metrics: [{ samples: 100 }],
          },
          {
            page: 'https://abc.com/page2',
            trackedPageKPIValue: '0.05',
            type: 'high-organic-low-ctr',
          },
        ];

        const result = getHighOrganicLowCtrOpportunity(mixedOpportunities);

        expect(result).to.have.length(2);
        expect(result[0].type).to.equal('high-organic-low-ctr');
        expect(result[1].type).to.equal('high-organic-low-ctr');
        expect(result[0].page).to.equal('https://abc.com/page1');
        expect(result[1].page).to.equal('https://abc.com/page2');
      });

      it('should return empty array when no high-organic-low-ctr opportunities exist', () => {
        const nonHighOrganicOpportunities = [
          {
            page: 'https://abc.com/page1',
            type: 'rageclick',
            samples: 100,
          },
          {
            page: 'https://abc.com/page2',
            type: 'high-inorganic-high-bounce-rate',
          },
        ];

        const result = getHighOrganicLowCtrOpportunity(nonHighOrganicOpportunities);

        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
      });

      it('should handle null or undefined input gracefully', () => {
        expect(getHighOrganicLowCtrOpportunity(null)).to.be.undefined;
        expect(getHighOrganicLowCtrOpportunity(undefined)).to.be.undefined;
        expect(getHighOrganicLowCtrOpportunity([])).to.have.length(0);
      });
    });

    describe('processRageClickOpportunities', () => {
      it('should process rage click opportunities with opportunityImpact', async () => {
        const mockOpportunities = {
          rageclick: [
            {
              type: 'rageclick',
              page: 'https://abc.com/rage-page',
              metrics: [
                { samples: 50 },
                { samples: 75 },
                { samples: 25 },
              ],
            },
          ],
          'high-organic-low-ctr': [],
        };

        context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);

        const result = await experimentOpportunitiesAuditRunner('https://abc.com', context);

        expect(result.auditResult.experimentationOpportunities).to.have.length(1);
        expect(result.auditResult.experimentationOpportunities[0]).to.have.property('opportunityImpact', 75);
      });

      it('should handle rage click opportunities with missing samples', async () => {
        const mockOpportunities = {
          rageclick: [
            {
              type: 'rageclick',
              page: 'https://abc.com/rage-page',
              metrics: [
                { samples: 50 },
                {}, // no samples property
                { samples: null },
              ],
            },
          ],
        };

        context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);

        const result = await experimentOpportunitiesAuditRunner('https://abc.com', context);

        expect(result.auditResult.experimentationOpportunities[0]).to.have.property('opportunityImpact', 50);
      });

      it('should handle empty metrics array for rage click', async () => {
        const mockOpportunities = {
          rageclick: [
            {
              type: 'rageclick',
              page: 'https://abc.com/rage-page',
              metrics: [],
            },
          ],
        };

        context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);

        const result = await experimentOpportunitiesAuditRunner('https://abc.com', context);

        expect(result.auditResult.experimentationOpportunities[0]).to.have.property('opportunityImpact', 0);
      });

      it('should handle multiple rage click opportunities', async () => {
        const mockOpportunities = {
          rageclick: [
            {
              type: 'rageclick',
              page: 'https://abc.com/rage-page1',
              metrics: [{ samples: 100 }],
            },
            {
              type: 'rageclick',
              page: 'https://abc.com/rage-page2',
              metrics: [{ samples: 200 }],
            },
          ],
        };

        context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);

        const result = await experimentOpportunitiesAuditRunner('https://abc.com', context);

        expect(result.auditResult.experimentationOpportunities).to.have.length(2);
        expect(result.auditResult.experimentationOpportunities[0]).to.have.property('opportunityImpact', 100);
        expect(result.auditResult.experimentationOpportunities[1]).to.have.property('opportunityImpact', 200);
      });

      it('should not process non-rage-click opportunities for opportunityImpact', async () => {
        const mockOpportunities = {
          'high-organic-low-ctr': [
            {
              type: 'high-organic-low-ctr',
              page: 'https://abc.com/organic-page',
              metrics: [{ samples: 100 }],
            },
          ],
        };

        context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);

        const result = await experimentOpportunitiesAuditRunner('https://abc.com', context);

        expect(result.auditResult.experimentationOpportunities[0]).to.not.have.property('opportunityImpact');
      });
    });

    describe('generateOpportunityAndSuggestions Edge Cases', () => {
      it('should handle audit result with undefined experimentationOpportunities', async () => {
        context.audit.getAuditResult.returns({
          experimentationOpportunities: undefined,
        });

        await generateOpportunityAndSuggestions(context);

        expect(context.sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle audit result with empty experimentation opportunities', async () => {
        context.audit.getAuditResult.returns({
          experimentationOpportunities: [],
        });

        await generateOpportunityAndSuggestions(context);

        expect(context.sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle audit result with no high-organic-low-ctr opportunities', async () => {
        context.audit.getAuditResult.returns({
          experimentationOpportunities: [
            {
              type: 'rageclick',
              page: 'https://abc.com/rage1',
            },
            {
              type: 'high-inorganic-high-bounce-rate',
              page: 'https://abc.com/bounce1',
            },
          ],
        });

        await generateOpportunityAndSuggestions(context);

        expect(context.sqs.sendMessage).to.not.have.been.called;
      });

      it('should filter and process only high-organic-low-ctr opportunities', async () => {
        context.audit.getAuditResult.returns({
          experimentationOpportunities: [
            {
              type: 'high-organic-low-ctr',
              page: 'https://abc.com/organic1',
              trackedPageKPIValue: '0.05',
              trackedKPISiteAverage: '0.10',
            },
            {
              type: 'rageclick',
              page: 'https://abc.com/rage1',
            },
            {
              type: 'high-organic-low-ctr',
              page: 'https://abc.com/organic2',
              trackedPageKPIValue: '0.03',
              trackedKPISiteAverage: '0.08',
            },
            {
              type: 'high-inorganic-high-bounce-rate',
              page: 'https://abc.com/bounce1',
            },
          ],
        });

        await generateOpportunityAndSuggestions(context);

        expect(context.sqs.sendMessage).to.have.been.calledTwice;

        const [queue1, message1] = context.sqs.sendMessage.firstCall.args;
        expect(queue1).to.equal('spacecat-to-mystique');
        expect(message1).to.include({
          type: 'guidance:high-organic-low-ctr',
          siteId: site.getId(),
          auditId: audit.getId(),
          deliveryType: site.getDeliveryType(),
        });
        expect(message1.data).to.deep.equal({
          url: 'https://abc.com/organic1',
          ctr: '0.05',
          siteAverageCtr: '0.10',
        });

        const [queue2, message2] = context.sqs.sendMessage.secondCall.args;
        expect(queue2).to.equal('spacecat-to-mystique');
        expect(message2.data).to.deep.equal({
          url: 'https://abc.com/organic2',
          ctr: '0.03',
          siteAverageCtr: '0.08',
        });
      });

      it('should include timestamp in messages', async () => {
        const beforeTime = Date.now();

        context.audit.getAuditResult.returns({
          experimentationOpportunities: [
            {
              type: 'high-organic-low-ctr',
              page: 'https://abc.com/page1',
              trackedPageKPIValue: '0.02',
              trackedKPISiteAverage: '0.05',
            },
          ],
        });

        await generateOpportunityAndSuggestions(context);

        const afterTime = Date.now();
        const [, message] = context.sqs.sendMessage.firstCall.args;

        expect(message.time).to.be.a('string');
        const messageTime = new Date(message.time).getTime();
        expect(messageTime).to.be.at.least(beforeTime);
        expect(messageTime).to.be.at.most(afterTime);
      });
    });
  });
});
