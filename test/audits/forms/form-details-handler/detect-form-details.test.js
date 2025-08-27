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
        findById: sinon.stub().resolves([
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
        form_details: [
          { url: 'testUrl1', form_source: 'formSource1', testKey: 'testValue1' },
          { url: 'testUrl2', form_source: 'formSource2', testKey: 'testValue1' },
        ],
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update existing opportunity', async () => {
    dataAccessStub.Opportunity.findById.resolves({
      getType: () => 'testOpportunityType',
      getData: () => (
        {
          form: 'testUrl1',
          formsource: 'formSource1',
          formViews: 100,
          samples: 987,
          projectedConversionValue: 8789.0,
        }
      ),
      setUpdatedBy: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    });

    message.data.form_details = [
      {
        url: 'testUrl1',
        form_source: 'formSource1',
        is_lead_gen: true,
        form_type: 'Contact Form',
        form_category: 'B2B',
        industry: 'Telecommunications',
        cpl: 94.0,
      },
    ];

    await handler(message, context);
    const opportunity = await dataAccessStub.Opportunity.findById();

    expect(opportunity.setData).to.have.been.calledWith(
      sinon.match({
        form: 'testUrl1',
        formsource: 'formSource1',
        formViews: 100,
        samples: 987,
        projectedConversionValue: 8789.0,
        formDetails: {
          is_lead_gen: true,
          form_type: 'Contact Form',
          form_category: 'B2B',
          industry: 'Telecommunications',
          cpl: 94.0,
        },
      }),
    );

    expect(opportunity.save).to.have.been.calledOnce;
  });

  it('should send message to mystique', async () => {
    dataAccessStub.Opportunity.findById.resolves({
      getType: () => 'testOpportunityType',
      getData: () => ({
        form: 'testUrl1',
        formsource: 'formSource1',
        formViews: 100,
        samples: 987,
        projectedConversionValue: 8789.0,
      }),
      setUpdatedBy: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    });

    await handler(message, context);
    expect(sqsStub.sendMessage).to.have.been.calledWith('mockQueue', sinon.match.object);
  });

  it('should log opportunity sent to mystique', async () => {
    dataAccessStub.Opportunity.findById.resolves({
      getType: () => 'testOpportunityType',
      getData: () => ({
        form: 'testUrl1',
        formsource: 'formSource1',
        formViews: 100,
        samples: 987,
        projectedConversionValue: 8789.0,
      }),
      data: { // Directly include the data property
        form: 'testUrl',
        trackedFormKPIValue: 5,
        pageViews: 20,
        formViews: 10,
        metrics: { key: 'value' },
        formNavigation: { source: 'testSource', text: 'testText' },
        formsource: 'testFormSource',
      },
      setUpdatedBy: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    });

    await handler(message, context);

    expect(logStub.info).to.have.been.calledWith(sinon.match.string);
  });

  it('should return ok response', async () => {
    dataAccessStub.Opportunity.findById.resolves({
      getType: () => 'testOpportunityType',
      getData: () => ({
        form: 'testUrl1',
        formsource: 'formSource1',
        formViews: 100,
        samples: 987,
        projectedConversionValue: 8789.0,
      }),
      setUpdatedBy: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    });

    const response = await handler(message, context);
    expect(response.status).to.equal(ok().status);
  });

  // it('should set correct values in mystiqueMessage', async () => {
  //   // Explicitly mock the values returned by getData
  //   dataAccessStub.Opportunity.allBySiteId.resolves([
  //     {
  //       getType: () => 'testOpportunityType',
  //       getData: () => ({
  //         form: 'testUrl',
  //         trackedFormKPIValue: 5,
  //         metrics: { key: 'value' },
  //         formNavigation: { source: 'testSource', text: 'testText' },
  //         formsource: 'testFormSource',
  //       }),
  //       data: { // Directly include the data property
  //         form: 'testUrl',
  //         trackedFormKPIValue: 5,
  //         pageViews: 20,
  //         formViews: 10,
  //         metrics: { key: 'value' },
  //         formNavigation: { source: 'testSource', text: 'testText' },
  //         formsource: 'testFormSource',
  //       },
  //       getSiteId: () => 'testSiteId',
  //       getAuditId: () => 'testAuditId',
  //       getDeliveryType: () => 'testDeliveryType',
  //       setAuditId: sinon.stub(),
  //       setUpdatedBy: sinon.stub(),
  //       setData: sinon.stub(),
  //       save: sinon.stub().resolvesThis(),
  //     },
  //   ]);
  //
  //   await handler(message, context);
  //
  //   const expectedData = {
  //     url: 'testUrl',
  //     cr: 5,
  //     metrics: { key: 'value' },
  //     cta_source: 'testSource',
  //     cta_text: 'testText',
  //     form_source: 'testFormSource',
  //     page_views: 20,
  //     form_views: 10,
  //   };
  //
  //   expect(sqsStub.sendMessage).to.have.been.calledWith(
  //     'mockQueue',
  //     sinon.match({
  //       data: expectedData,
  //     }),
  //   );
  // });

  it('should update accessibility data for forms-accessibility type', async () => {
    dataAccessStub.Opportunity.findById.resolves({
      getType: () => 'forms-accessibility',
      getData: () => ({
        accessibility: [
          { form: 'testUrl1', formSource: 'formSource1', a11yIssues: [] },
          { form: 'testUrl2', formSource: 'formSource2', a11yIssues: [] },
        ],
      }),
      setUpdatedBy: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    });

    message.data.form_details = [
      {
        url: 'testUrl1',
        form_source: 'formSource1',
        is_lead_gen: true,
        form_type: 'Contact Form',
        form_category: 'B2B',
        industry: 'Telecommunications',
        cpl: 94.0,
      },
    ];

    await handler(message, context);

    const opportunity = await dataAccessStub.Opportunity.findById();

    expect(opportunity.setData).to.have.been.calledWith(sinon.match({
      accessibility: sinon.match.array.deepEquals([
        {
          form: 'testUrl1',
          formSource: 'formSource1',
          a11yIssues: [],
          formDetails: {
            is_lead_gen: true,
            form_type: 'Contact Form',
            form_category: 'B2B',
            industry: 'Telecommunications',
            cpl: 94,
          },
        },
        { form: 'testUrl2', formSource: 'formSource2', a11yIssues: [] },
      ]),
    }));
    expect(opportunity.save).to.have.been.calledOnce;
  });
});
