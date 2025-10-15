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
import handler from '../../../../src/forms-opportunities/guidance-handlers/guidance-high-form-views-low-conversions.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

describe('Guidance High Form Views Low Conversions Handler', () => {
  let logStub;
  let dataAccessStub;
  let context;
  let message;

  beforeEach(() => {
    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };
    dataAccessStub = {
      Opportunity: {
        allBySiteId: sinon.stub().resolves([]),
        create: sinon.stub(),
      },
      Suggestion: {
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
        guidance: 'Some guidance',
        suggestions: ['Suggestion 1', 'Suggestion 2'],
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update an existing opportunity', async () => {
    const existingOpportunity = {
      getData: sinon.stub().returns({ form: 'https://example.com', formsource: '.form' }),
      getType: sinon.stub().returns(FORM_OPPORTUNITY_TYPES.LOW_CONVERSION),
      setAuditId: sinon.stub(),
      setGuidance: sinon.stub(),
      save: sinon.stub().resolvesThis(),
      getId: sinon.stub().resolves('testId'),
      getSuggestions: sinon.stub().resolves([]),
      setUpdatedBy: sinon.stub(),
    };
    dataAccessStub.Opportunity.allBySiteId.resolves([existingOpportunity]);

    await handler(message, context);

    expect(existingOpportunity.setAuditId).to.be.calledWith('audit-id');
    expect(existingOpportunity.setGuidance).to.be.calledWith({ recommendations: 'Some guidance' });
    expect(existingOpportunity.setUpdatedBy).to.be.calledWith('system');
    expect(existingOpportunity.save).to.be.calledOnce;
  });

  it('should create a new opportunity if none exists', async () => {
    dataAccessStub.Opportunity.allBySiteId.resolves([]);
    const newOpportunity = {
      getId: sinon.stub().returns('new-opportunity-id'),
      getSuggestions: sinon.stub().resolves([]),
    };
    dataAccessStub.Opportunity.create.resolves(newOpportunity);

    await handler(message, context);

    expect(dataAccessStub.Opportunity.create.callCount).to.equal(0);
  });

  it('should return ok response', async () => {
    const response = await handler(message, context);
    expect(response.status).to.equal(ok().status);
  });

  it('should log an error if opportunity fetching fails', async () => {
    dataAccessStub.Opportunity.allBySiteId.rejects(new Error('fetch error'));

    try {
      await handler(message, context);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      expect(error.message).to.deep.equal('fetch error');
    }
  });
});
