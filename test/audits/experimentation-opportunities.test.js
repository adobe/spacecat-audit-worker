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
    site = {
      getBaseURL: () => 'https://abc.com',
      getId: () => '056f9dbe-e9e1-4d80-8bfb-c9785a873b6a',
      getDeliveryType: () => 'aem_edge',
    };
    audit = {
      getId: () => auditDataMock.id,
      getAuditType: () => 'experimentation-opportunities',
      getFullAuditRef: () => url,
      getAuditResult: sinon.stub(),
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
        },
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        audit,
        site,
        finalUrl: url,
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

  it('should run the organic keywords step', async () => {
    audit.getAuditResult.returns(auditDataMock.auditResult);
    const stepResult = organicKeywordsStep(context);
    expect(
      stepResult,
    ).to.deep.equal({
      type: 'organic-keywords',
      siteId: site.getId(),
      pageUrl: 'https://abc.com/abc-adoption/account',
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
      siteAgerageCtr: '0.25',
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
      siteAgerageCtr: '0.22',
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
