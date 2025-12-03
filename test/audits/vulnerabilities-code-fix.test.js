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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import handler from '../../src/vulnerabilities-code-fix/handler.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Vulnerabilities Code-Fix Handler Tests', function () {
  let sandbox;
  let context;
  let message;
  let site;
  let audit;
  let opportunity;
  let suggestion;

  const siteId = 'site-123';
  const auditId = 'audit-123';
  const opportunityId = 'opp-123';
  const suggestionId = 'sugg-123';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    message = {
      siteId,
      auditId,
      data: {
        opportunityId,
        patches: [
          {
            suggestionId,
            patch: 'some-patch-content',
          },
        ],
      },
    };

    site = {
      getId: () => siteId,
    };

    audit = {
      getId: () => auditId,
    };

    opportunity = {
      getId: () => opportunityId,
      getSiteId: () => siteId,
    };

    suggestion = {
      getId: () => suggestionId,
      getData: () => ({ some: 'data' }),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves(site),
          },
          Audit: {
            findById: sandbox.stub().resolves(audit),
          },
          Opportunity: {
            findById: sandbox.stub().resolves(opportunity),
          },
          Suggestion: {
            findById: sandbox.stub().resolves(suggestion),
          },
        },
      })
      .build(message);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully process valid patches', async () => {
    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.dataAccess.Suggestion.findById).to.have.been.calledWith(suggestionId);
    expect(suggestion.setData).to.have.been.calledOnce;
    expect(suggestion.save).to.have.been.calledOnce;
    expect(context.log.debug).to.have.been.calledWith(sinon.match(/Message received/));
  });

  it('should return not found if site does not exist', async () => {
    context.dataAccess.Site.findById.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(404);
    expect(response.headers.get('x-error')).to.equal('Site not found');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Site not found/));
  });

  it('should return not found if audit does not exist', async () => {
    context.dataAccess.Audit.findById.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(404);
    expect(response.headers.get('x-error')).to.equal('Audit not found');
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/No audit found/));
  });

  it('should return not found if opportunity does not exist', async () => {
    context.dataAccess.Opportunity.findById.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(404);
    expect(response.headers.get('x-error')).to.equal('Opportunity not found');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Opportunity not found/));
  });

  it('should return bad request if site ID mismatch', async () => {
    opportunity.getSiteId = () => 'other-site-id';

    const response = await handler(message, context);

    expect(response.status).to.equal(400);
    expect(response.headers.get('x-error')).to.equal('Site ID mismatch');
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Site ID mismatch/));
  });

  it('should skip patch processing if suggestion not found', async () => {
    context.dataAccess.Suggestion.findById.resolves(null);

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Suggestion not found/));
    expect(suggestion.setData).to.not.have.been.called;
    expect(suggestion.save).to.not.have.been.called;
  });

  it('should process multiple patches where some suggestions are missing', async () => {
    const suggestion2Id = 'sugg-456';
    const suggestion2 = {
      getId: () => suggestion2Id,
      getData: () => ({ some: 'data' }),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    message.data.patches.push({
      suggestionId: suggestion2Id,
      patch: 'patch-2',
    });

    context.dataAccess.Suggestion.findById.withArgs(suggestionId).resolves(null);
    context.dataAccess.Suggestion.findById.withArgs(suggestion2Id).resolves(suggestion2);

    const response = await handler(message, context);

    expect(response.status).to.equal(200);
    // First suggestion missing
    expect(context.log.error).to.have.been.calledWith(sinon.match(/Suggestion not found for ID: sugg-123/));
    
    // Second suggestion found and processed
    expect(suggestion2.setData).to.have.been.calledOnce;
    expect(suggestion2.save).to.have.been.calledOnce;
  });
});

