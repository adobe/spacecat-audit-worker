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
import { handler, postProcessor } from '../../src/experimentation-opportunities/experimentation-opportunities.js';
import { MockContextBuilder } from '../shared.js';
import opportunitiesData from '../fixtures/opportunitiesdata.json' with { type: 'json' };

use(sinonChai);

describe('Opportunities Tests', () => {
  const url = 'https://abc.com';
  const mockDate = '2023-11-27T12:30:01.124Z';

  let clock;
  let context;
  let processEnvCopy;
  let messageBodyJson;
  let sandbox;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach('setup', () => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });
    messageBodyJson = {
      type: '404',
      url: 'https://abc.com',
      auditContext: {
        finalUrl: 'abc.com',
      },
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
        },
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      })
      .build(messageBodyJson);
    processEnvCopy = { ...process.env };
    process.env = {
      ...process.env,
      ...context.env,
    };
  });

  afterEach(() => {
    process.env = processEnvCopy;
    nock.cleanAll();
    clock.restore();
    sinon.restore();
  });

  it('fetch bundles for base url > process > send opportunities', async () => {
    nock('https://secretsmanager.us-east-1.amazonaws.com/')
      .post('/', (body) => body.SecretId === '/helix-deploy/spacecat-services/customer-secrets/abc_com/ci')
      .reply(200, {
        SecretString: JSON.stringify({
          RUM_DOMAIN_KEY: 'abc_dummy_key',
        }),
      });
    nock('https://abc.com')
      .get('/')
      .reply(200);
    context.rumApiClient = {
      queryMulti: sinon.stub().resolves(opportunitiesData),
    };
    const site = {
      getBaseURL: () => 'https://abc.com',
      getId: () => '056f9dbe-e9e1-4d80-8bfb-c9785a873b6a',
    };
    const auditData = await handler(url, context, site);

    const expected = Object.values(opportunitiesData).flatMap((data) => data);
    expected.find((opportunity) => opportunity.type === 'high-organic-low-ctr').opportunityImpact = 1286;

    expect(context.rumApiClient.queryMulti).calledWith([
      'rageclick',
      'high-organic-low-ctr',
    ], {
      domain: 'https://abc.com',
      domainkey: 'abc_dummy_key',
      interval: 30,
      granularity: 'hourly',
    });
    expect(
      auditData.auditResult.experimentationOpportunities,
    ).to.deep.equal(expected);
  });
});

describe('Opportunities postProcessor', () => {
  let sandbox;
  let context;
  let existingOpportunity;
  let auditData;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: {
        Opportunity: {
          allBySiteId: sandbox.stub(),
          create: sandbox.stub(),
        },
      },
    };

    existingOpportunity = {
      getType: () => 'high-organic-low-ctr',
      getData: () => ({ page: 'https://example.com/page1' }),
      getStatus: () => 'NEW',
      remove: sandbox.stub().resolves(),
    };

    auditData = {
      id: 'test-audit-id',
      siteId: 'test-site-id',
      auditResult: {
        experimentationOpportunities: [
          {
            type: 'high-organic-low-ctr',
            page: 'https://example.com/page1',
            recommendations: [{
              type: 'guidance',
              insight: 'The primary CTAs "Buy now" and "Free Trial" are not visually prominent and may not stand out to users, especially those coming from visually engaging platforms like TikTok.',
              recommendation: 'Enhance the visual prominence of the CTAs by using contrasting colors, larger buttons, and more white space around them.',
            }],
            pageViews: 1000,
            samples: 10,
            screenshot: null,
            metrics: { test: 'metric' },
            trackedKPISiteAverage: 0.23,
            trackedPageKPIName: 'test-kpi',
            trackedPageKPIValue: 0.09,
            opportunityImpact: 100,
          },
          {
            type: 'high-organic-low-ctr',
            page: 'https://example.com/page2',
            // No recommendations
            pageViews: 1000,
          },
        ],
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process high-organic-low-ctr opportunities with recommendations only', async () => {
    context.dataAccess.Opportunity.allBySiteId.resolves([]);
    context.dataAccess.Opportunity.create.resolves();
    const rumOpportunity = auditData.auditResult.experimentationOpportunities[0];

    await postProcessor('https://example.com', auditData, context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.create).to.have.been.calledWith({
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/Doc.aspx?sourcedoc=%7B19613D9B-93D4-4112-B7C8-DBE0D9DCC55B%7D&file=Experience_Success_Studio_High_Organic_Traffic_Low_CTR_Runbook.docx&action=default&mobileredirect=true',
      type: 'high-organic-low-ctr',
      origin: 'AUTOMATION',
      title: 'page with high organic traffic but low click through rate detected',
      description: 'Adjusting the wording, images and/or layout on the page to resonate more with a specific audience should increase the overall engagement on the page and ultimately bump conversion.',
      status: 'NEW',
      guidance: {
        recommendations: rumOpportunity.recommendations,
      },
      tags: ['Engagement'],
      data: {
        page: rumOpportunity.page,
        pageViews: rumOpportunity.pageViews,
        samples: rumOpportunity.samples,
        screenshot: null,
        trackedKPISiteAverage: rumOpportunity.trackedKPISiteAverage,
        trackedPageKPIName: rumOpportunity.trackedPageKPIName,
        trackedPageKPIValue: rumOpportunity.trackedPageKPIValue,
        opportunityImpact: rumOpportunity.opportunityImpact,
        metrics: rumOpportunity.metrics,
      },
    });
    // const createArg = context.dataAccess.Opportunity.create.firstCall.args[0];
    // expect(createArg.type).to.equal('high-organic-low-ctr');
    // expect(createArg.data.page).to.equal('https://example.com/page1');
  });

  it('should skip high-organic-low-ctr opportunities without recommendations', async () => {
    context.dataAccess.Opportunity.allBySiteId.resolves([]);
    context.dataAccess.Opportunity.create.resolves();

    await postProcessor('https://example.com', {
      ...auditData,
      auditResult: {
        experimentationOpportunities: [
          {
            type: 'high-organic-low-ctr',
            page: 'https://example.com/page2',
            // No recommendations
          },
        ],
      },
    }, context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
  });

  it('should remove high-organic-low-ctr opportunity and recreate if status is NEW', async () => {
    context.dataAccess.Opportunity.allBySiteId.resolves([existingOpportunity]);
    context.dataAccess.Opportunity.create.resolves();

    await postProcessor('https://example.com', auditData, context);

    expect(existingOpportunity.remove).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
  });

  it('should skip removal of high-organic-low-ctr opportunity if existing opportunity status is not NEW', async () => {
    const nonNewOpportunity = {
      ...existingOpportunity,
      getStatus: () => 'IN_PROGRESS',
    };
    context.dataAccess.Opportunity.allBySiteId.resolves([nonNewOpportunity]);

    await postProcessor('https://example.com', auditData, context);

    expect(nonNewOpportunity.remove).to.not.have.been.called;
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
  });

  it('should handle errors during opportunity processing', async () => {
    context.dataAccess.Opportunity.allBySiteId.resolves([]);
    context.dataAccess.Opportunity.create.rejects(new Error('Test error'));

    await postProcessor('https://example.com', auditData, context);

    expect(context.log.error).to.have.been.calledWith(
      sinon.match(/Error creating\/updating opportunity entity/),
    );
  });

  it('should process multiple opportunities in parallel', async () => {
    const multipleOpportunities = {
      ...auditData,
      auditResult: {
        experimentationOpportunities: [
          {
            type: 'high-organic-low-ctr',
            page: 'https://example.com/page1',
            recommendations: ['rec1'],
            pageViews: 1000,
          },
          {
            type: 'high-organic-low-ctr',
            page: 'https://example.com/page2',
            recommendations: ['rec2'],
            pageViews: 2000,
          },
        ],
      },
    };

    context.dataAccess.Opportunity.allBySiteId.resolves([]);
    context.dataAccess.Opportunity.create.resolves();

    await postProcessor('https://example.com', multipleOpportunities, context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledTwice;
  });
});
