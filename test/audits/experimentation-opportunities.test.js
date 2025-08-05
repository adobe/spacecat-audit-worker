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
} from '../../src/experimentation-opportunities/handler.js';
import { parseCustomUrls } from '../../src/utils/url-utils.js';

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

  it('should enable the imports if organic-keywords import is not enabled', async () => {
    context.audit.getAuditResult.returns({
      experimentationOpportunities: [
        { type: 'high-organic-low-ctr', page: 'https://abc.com/page1' },
      ],
    });
    const result = await organicKeywordsStep(context);

    // Assert
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
    // Assert
    expect(context.site.getConfig().enableImport).not.to.have.been.called;
    expect(context.site.getConfig().disableImport).not.to.have.been.called;
    expect(context.site.save).not.to.have.been.called;
    expect(result).to.have.property('urlConfigs');
    expect(result.urlConfigs[0]).to.deep.include({ url: 'https://abc.com/page2', geo: 'us' });
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

  it('should run the import all traffic step', async () => {
    const stepResult = importAllTrafficStep(context);
    expect(stepResult).to.deep.equal({
      type: 'all-traffic',
      siteId: site.getId(),
    });
  });

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

  describe('Custom URLs Functionality', () => {
    it('should use custom URLs for audit when provided', async () => {
      context.auditContext = {
        additionalData: ['https://abc.com/page1', 'https://abc.com/page2'],
      };

      const auditData = await runAuditAndScrapeStep(context);

      expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
      expect(auditData.auditResult.experimentationOpportunities).to.have.length(2);
      expect(auditData.auditResult.experimentationOpportunities[0].page).to.equal('https://abc.com/page1');
      expect(auditData.auditResult.experimentationOpportunities[1].page).to.equal('https://abc.com/page2');
      expect(auditData.auditResult.experimentationOpportunities[0]).to.have.property('pageViews');
      expect(auditData.auditResult.experimentationOpportunities[0]).to.have.property('trackedPageKPIValue');
    });

    it('should combine real RUM data with empty data for custom URLs', async () => {
      const mockOpportunities = {
        'high-organic-low-ctr': [
          {
            page: 'https://abc.com/page1',
            pageViews: 5000,
            trackedPageKPIValue: '0.02',
            trackedKPISiteAverage: '0.035',
            type: 'high-organic-low-ctr',
          },
        ],
      };

      context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);
      context.auditContext = {
        additionalData: ['https://abc.com/page1', 'https://abc.com/page2'],
      };

      const auditData = await runAuditAndScrapeStep(context);
      expect(auditData.auditResult.experimentationOpportunities).to.have.length(2);

      const realOpportunity = auditData.auditResult.experimentationOpportunities.find(
        (op) => op.page === 'https://abc.com/page1',
      );
      expect(realOpportunity.pageViews).to.equal(5000);
      expect(realOpportunity.trackedPageKPIValue).to.equal('0.02');

      const emptyOpportunity = auditData.auditResult.experimentationOpportunities.find(
        (op) => op.page === 'https://abc.com/page2',
      );
      expect(emptyOpportunity.pageViews).to.be.null;
      expect(emptyOpportunity.trackedPageKPIValue).to.equal('');
      expect(emptyOpportunity.trackedKPISiteAverage).to.equal('');
    });

    it('should work normally when no custom URLs provided', async () => {
      const auditData = await runAuditAndScrapeStep(context);
      expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
      expect(auditData.auditResult.experimentationOpportunities).to.exist;
    });

    it('should handle empty custom URLs array', async () => {
      context.auditContext = {
        additionalData: [],
      };

      await runAuditAndScrapeStep(context);
      expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
    });

    it('should handle null additionalData', async () => {
      context.auditContext = {
        additionalData: null,
      };

      await runAuditAndScrapeStep(context);
      expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
    });

    it('should handle undefined auditContext', async () => {
      context.auditContext = undefined;

      await runAuditAndScrapeStep(context);
      expect(context.rumApiClient.queryMulti).to.have.been.calledOnce;
    });

    it('should generate empty data when no RUM data exists for custom URLs', async () => {
      context.rumApiClient.queryMulti = sinon.stub().resolves({});
      context.auditContext = {
        additionalData: ['https://abc.com/new-page1', 'https://abc.com/new-page2'],
      };

      const auditData = await runAuditAndScrapeStep(context);
      expect(auditData.auditResult.experimentationOpportunities).to.have.length(2);
      auditData.auditResult.experimentationOpportunities.forEach((op) => {
        expect(op.type).to.equal('high-organic-low-ctr');
        expect(op.pageViews).to.be.null;
        expect(op.trackedPageKPIValue).to.equal('');
        expect(op.trackedKPISiteAverage).to.equal('');
        expect(op.samples).to.be.null;
        expect(op.metrics).to.be.null;
        expect(op.screenshot).to.equal('');
        expect(op.trackedPageKPIName).to.equal('Click Through Rate');
      });
    });

    it('should handle comma-separated URLs in additionalData', async () => {
      context.auditContext = {
        additionalData: ['/page1,/page2', '/page3'],
      };

      const auditData = await runAuditAndScrapeStep(context);
      expect(auditData.auditResult.experimentationOpportunities).to.have.length(3);
      expect(auditData.auditResult.experimentationOpportunities[0].page).to.equal('https://abc.com/page1');
      expect(auditData.auditResult.experimentationOpportunities[1].page).to.equal('https://abc.com/page2');
      expect(auditData.auditResult.experimentationOpportunities[2].page).to.equal('https://abc.com/page3');
    });

    it('should normalize relative URLs to full URLs', async () => {
      context.auditContext = {
        additionalData: ['/relative-page1', 'relative-page2'],
      };

      const auditData = await runAuditAndScrapeStep(context);
      expect(auditData.auditResult.experimentationOpportunities).to.have.length(2);
      expect(auditData.auditResult.experimentationOpportunities[0].page).to.equal('https://abc.com/relative-page1');
      expect(auditData.auditResult.experimentationOpportunities[1].page).to.equal('https://abc.com/relative-page2');
    });

    it('should filter out non-high-organic-low-ctr opportunities when using custom URLs', async () => {
      const mockOpportunities = {
        'high-organic-low-ctr': [
          {
            page: 'https://abc.com/page1',
            pageViews: 5000,
            trackedPageKPIValue: '0.02',
            type: 'high-organic-low-ctr',
          },
        ],
        rageclick: [
          {
            page: 'https://abc.com/page1',
            samples: 100,
            type: 'rageclick',
            metrics: [{ samples: 100 }],
          },
        ],
      };

      context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);
      context.auditContext = {
        additionalData: ['https://abc.com/page1'],
      };

      const auditData = await runAuditAndScrapeStep(context);
      expect(auditData.auditResult.experimentationOpportunities).to.have.length(1);
      expect(auditData.auditResult.experimentationOpportunities[0].type).to.equal('high-organic-low-ctr');
    });

    it('should handle whitespace and empty strings in additionalData', async () => {
      context.auditContext = {
        additionalData: [' /page1 ', '', '  ', '/page2,, /page3  '],
      };

      const auditData = await runAuditAndScrapeStep(context);
      expect(auditData.auditResult.experimentationOpportunities).to.have.length(3);
      expect(auditData.auditResult.experimentationOpportunities[0].page).to.equal('https://abc.com/page1');
      expect(auditData.auditResult.experimentationOpportunities[1].page).to.equal('https://abc.com/page2');
      expect(auditData.auditResult.experimentationOpportunities[2].page).to.equal('https://abc.com/page3');
    });
  });

  describe('experimentOpportunitiesAuditRunner Function', () => {
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

    it('should return correct structure without custom URLs', async () => {
      const result = await experimentOpportunitiesAuditRunner('https://abc.com', context);

      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', 'https://abc.com');
      expect(result.auditResult).to.have.property('experimentationOpportunities');
    });

    it('should log correct messages for custom URLs with mixed data', async () => {
      const mockOpportunities = {
        'high-organic-low-ctr': [
          {
            page: 'https://abc.com/page1',
            type: 'high-organic-low-ctr',
            pageViews: 1000,
          },
        ],
      };

      context.rumApiClient.queryMulti = sinon.stub().resolves(mockOpportunities);
      const customUrls = ['https://abc.com/page1', 'https://abc.com/page2'];

      const result = await experimentOpportunitiesAuditRunner('https://abc.com', context, customUrls);

      expect(result.auditResult.experimentationOpportunities).to.have.length(2);
      // Should have one real opportunity and one empty opportunity
      const realOpportunity = result.auditResult.experimentationOpportunities.find(
        (op) => op.pageViews === 1000,
      );
      const emptyOpportunity = result.auditResult.experimentationOpportunities.find(
        (op) => op.pageViews === null,
      );

      expect(realOpportunity).to.exist;
      expect(emptyOpportunity).to.exist;
      expect(emptyOpportunity.page).to.equal('https://abc.com/page2');
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

      // Check first message
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

      // Check second message
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

  describe('parseCustomUrls Function', () => {
    const domain = 'https://example.com';

    it('should return null for empty or invalid input', () => {
      expect(parseCustomUrls(null, domain)).to.be.null;
      expect(parseCustomUrls(undefined, domain)).to.be.null;
      expect(parseCustomUrls([], domain)).to.be.null;
      expect(parseCustomUrls([''], domain)).to.be.null;
      expect(parseCustomUrls(['   '], domain)).to.be.null;
      expect(parseCustomUrls(['', '  ', ''], domain)).to.be.null;
    });

    it('should handle single relative URL', () => {
      const result = parseCustomUrls(['/page1'], domain);
      expect(result).to.deep.equal(['https://example.com/page1']);
    });

    it('should handle multiple relative URLs', () => {
      const result = parseCustomUrls(['/page1', '/page2'], domain);
      expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
    });

    it('should handle comma-separated URLs', () => {
      const result = parseCustomUrls(['/page1,/page2,/page3'], domain);
      expect(result).to.deep.equal([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
      ]);
    });

    it('should handle mixed relative and full URLs', () => {
      const result = parseCustomUrls(['/page1', 'https://example.com/page2'], domain);
      expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
    });

    it('should handle URLs without leading slash', () => {
      const result = parseCustomUrls(['page1', 'page2'], domain);
      expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
    });

    it('should remove duplicates', () => {
      const result = parseCustomUrls(['/page1', '/page1', '/page2'], domain);
      expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
    });

    it('should remove duplicates after normalization', () => {
      const result = parseCustomUrls(['/page1', 'page1', 'https://example.com/page1'], domain);
      expect(result).to.deep.equal(['https://example.com/page1']);
    });

    it('should trim whitespace', () => {
      const result = parseCustomUrls([' /page1 ', '  /page2  '], domain);
      expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
    });

    it('should handle domain with trailing slash', () => {
      const result = parseCustomUrls(['/page1'], 'https://example.com/');
      expect(result).to.deep.equal(['https://example.com/page1']);
    });

    it('should preserve full URLs from different domains', () => {
      const result = parseCustomUrls(['https://other.com/page1', '/page2'], domain);
      expect(result).to.deep.equal(['https://other.com/page1', 'https://example.com/page2']);
    });

    it('should handle HTTP URLs', () => {
      const result = parseCustomUrls(['http://other.com/page1', '/page2'], domain);
      expect(result).to.deep.equal(['http://other.com/page1', 'https://example.com/page2']);
    });

    it('should handle complex paths', () => {
      const result = parseCustomUrls(['/products/category/item', '/blog/2024/article'], domain);
      expect(result).to.deep.equal([
        'https://example.com/products/category/item',
        'https://example.com/blog/2024/article',
      ]);
    });

    it('should return relative URLs unchanged when no domain provided', () => {
      const result = parseCustomUrls(['/page1', '/page2'], null);
      expect(result).to.deep.equal(['/page1', '/page2']);
    });

    it('should handle empty entries in comma-separated values', () => {
      const result = parseCustomUrls(['/page1,,/page2, ,/page3'], domain);
      expect(result).to.deep.equal([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
      ]);
    });

    it('should handle mixed comma-separated and array entries', () => {
      const result = parseCustomUrls(['/page1,/page2', '/page3', 'page4,page5'], domain);
      expect(result).to.deep.equal([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
        'https://example.com/page4',
        'https://example.com/page5',
      ]);
    });

    it('should handle URLs with query parameters', () => {
      const result = parseCustomUrls(['/page1?param=value', '/page2?a=1&b=2'], domain);
      expect(result).to.deep.equal([
        'https://example.com/page1?param=value',
        'https://example.com/page2?a=1&b=2',
      ]);
    });

    it('should handle URLs with fragments', () => {
      const result = parseCustomUrls(['/page1#section', '/page2#top'], domain);
      expect(result).to.deep.equal([
        'https://example.com/page1#section',
        'https://example.com/page2#top',
      ]);
    });

    it('should handle not-a-string input that passes array check', () => {
      const result = parseCustomUrls('not-an-array', domain);
      expect(result).to.be.null;
    });
  });
});
