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
import { ok } from '@adobe/spacecat-shared-http-utils';
import sinonChai from 'sinon-chai';
import { FORM_OPPORTUNITY_TYPES } from '../../../../src/forms-opportunities/constants.js';
import handler from '../../../../src/forms-opportunities/quality-handlers/quality-handler.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

describe('Quality Handler', () => {
  let logStub;
  let dataAccessStub;
  let context;
  let message;

  beforeEach(() => {
    logStub = {
      info: sinon.stub(),
      error: sinon.stub(),
    };
    dataAccessStub = {
      Opportunity: {
        allBySiteId: sinon.stub().resolves([]),
        create: sinon.stub(),
      },
    };
    context = {
      log: logStub,
      dataAccess: dataAccessStub,
    };
    message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://example.com',
        form_source: '.form',
        form_quality_metrics: { metric1: 'value1', metric2: 'value2' },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update existing opportunities', async () => {
    const existingOpportunity = {
      getData: sinon.stub().returns({ form: 'https://example.com', formsource: '.form' }),
      getType: sinon.stub().returns(FORM_OPPORTUNITY_TYPES.LOW_CONVERSION),
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub().resolvesThis(),
      setUpdatedBy: sinon.stub(),
    };
    dataAccessStub.Opportunity.allBySiteId.resolves([existingOpportunity]);

    await handler(message, context);

    expect(existingOpportunity.setAuditId).to.be.calledWith('audit-id');
    expect(existingOpportunity.setData).to.be.calledWith({
      form: 'https://example.com', formsource: '.form', metric1: 'value1', metric2: 'value2',
    });
    expect(existingOpportunity.setUpdatedBy).to.be.calledWith('system');
    expect(existingOpportunity.save).to.be.calledOnce;
  });

  it('should return ok response', async () => {
    const response = await handler(message, context);
    expect(response.status).to.equal(ok().status);
  });

  it('should log an error if opportunity fetching fails', async () => {
    dataAccessStub.Opportunity.allBySiteId.rejects(new Error('fetch error'));

    try {
      await handler(message, context);
    } catch (error) {
      expect(error.message).to.deep.equal('fetch error');
    }
  });
});
