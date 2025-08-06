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
import { ok } from '@adobe/spacecat-shared-http-utils';
import handler from '../../../../src/forms-opportunities/form-details-handler/detect-form-details.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

describe('Detect Form Details Handler', () => {
  let logStub;
  let dataAccessStub;
  let sqsStub;
  let context;
  let message;
  let siteStub;

  beforeEach(() => {
    logStub = {
      info: sinon.stub(),
      error: sinon.stub(),
    };
    siteStub = {
      getDeliveryType: sinon.stub().returns('testDeliveryType'),
    };
    dataAccessStub = {
      Opportunity: {
        allBySiteId: sinon.stub().resolves([
          {
            getType: () => 'testOpportunityType',
            getData: () => ({ form: 'testUrl', formsource: 'testFormSource' }),
            getSiteId: () => 'testSiteId',
            getAuditId: () => 'testAuditId',
            getDeliveryType: () => 'testDeliveryType',
            setAuditId: sinon.stub(),
            setUpdatedBy: sinon.stub(),
            setData: sinon.stub(),
            save: sinon.stub().resolvesThis(),
          },
        ]),
      },
    };
    sqsStub = {
      sendMessage: sinon.stub(),
    };
    context = {
      log: logStub,
      dataAccess: dataAccessStub,
      sqs: sqsStub,
      site: siteStub,
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'mockQueue' },
    };
    message = {
      auditId: 'testAuditId',
      siteId: 'testSiteId',
      data: {
        url: 'testUrl',
        form_source: 'testFormSource',
        form_details: { detailKey: 'detailValue' },
        opportunity_type: 'testOpportunityType',
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update existing opportunity', async () => {
    await handler(message, context);

    // Directly access the resolved value
    const opportunities = await dataAccessStub.Opportunity.allBySiteId();
    const opportunity = opportunities[0];

    expect(opportunity.setData).to.have.been.calledWith(sinon.match.object);
    expect(opportunity.save).to.have.been.calledOnce;
  });

  it('should send message to mystique', async () => {
    await handler(message, context);

    expect(sqsStub.sendMessage).to.have.been.calledWith('mockQueue', sinon.match.object);
  });

  it('should log opportunity sent to mystique', async () => {
    await handler(message, context);

    expect(logStub.info).to.have.been.calledWith(sinon.match.string);
  });

  it('should return ok response', async () => {
    const response = await handler(message, context);
    expect(response.status).to.equal(ok().status);
  });

  it('should handle errors when fetching opportunities', async () => {
    dataAccessStub.Opportunity.allBySiteId.rejects(new Error('fetch error'));

    try {
      await handler(message, context);
    } catch (error) {
      expect(error.message).to.equal('fetch error');
    }
  });

  it('should set correct values in mystiqueMessage', async () => {
    // Explicitly mock the values returned by getData
    dataAccessStub.Opportunity.allBySiteId.resolves([
      {
        getType: () => 'testOpportunityType',
        getData: () => ({
          form: 'testUrl',
          trackedFormKPIValue: 5,
          metrics: { key: 'value' },
          formNavigation: { source: 'testSource', text: 'testText' },
          formsource: 'testFormSource',
        }),
        data: { // Directly include the data property
          form: 'testUrl',
          trackedFormKPIValue: 5,
          metrics: { key: 'value' },
          formNavigation: { source: 'testSource', text: 'testText' },
          formsource: 'testFormSource',
        },
        getSiteId: () => 'testSiteId',
        getAuditId: () => 'testAuditId',
        getDeliveryType: () => 'testDeliveryType',
        setAuditId: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        setData: sinon.stub(),
        save: sinon.stub().resolvesThis(),
      },
    ]);

    await handler(message, context);

    const expectedData = {
      url: 'testUrl',
      cr: 5,
      metrics: { key: 'value' },
      cta_source: 'testSource',
      cta_text: 'testText',
      form_source: 'testFormSource',
    };

    expect(sqsStub.sendMessage).to.have.been.calledWith(
      'mockQueue',
      sinon.match({
        data: expectedData,
      }),
    );
  });
});
