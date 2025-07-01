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

import { expect } from 'chai';
import sinon from 'sinon';
import handler from '../../src/geo-brand-presence/guidance-geo-brand-presence-handler.js';

describe('geo-brand-presence guidance handler', () => {
  let context;
  let Audit;
  let Opportunity;
  let Suggestion;
  let log;
  let dummyAudit;
  let dummyOpportunity;

  beforeEach(() => {
    Audit = {
      findById: sinon.stub(),
    };
    dummyAudit = { auditId: 'audit-id' };
    Audit.findById.resolves(dummyAudit);
    dummyOpportunity = {
      getId: sinon.stub().returns('existing-oppty-id'),
      getSuggestions: sinon.stub().resolves([]),
      getData: sinon.stub().returns({ subType: 'guidance:geo-brand-presence' }),
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      save: sinon.stub().resolvesThis(),
      setUpdatedBy: sinon.stub(),
    };
    Opportunity = {
      create: sinon.stub().resolves(dummyOpportunity),
      allBySiteId: sinon.stub().resolves([]),
    };
    Suggestion = {
      create: sinon.stub().resolves(),
    };
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    context = {
      log,
      dataAccess: {
        Audit,
        Opportunity,
        Suggestion,
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should log a warning and return if no audit found', async () => {
    Audit.findById.resolves(null);
    const message = {
      auditId: 'unknown-audit-id',
      siteId: 'site-id',
      data: {
        suggestions: [],
      },
    };
    await handler(message, context);
    expect(log.warn).to.have.been.calledWithMatch(/No audit found for auditId: unknown-audit-id/);
    expect(Opportunity.allBySiteId).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('should create a new opportunity if no existing opportunity is found', async () => {
    Opportunity.allBySiteId.resolves([]);
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        suggestions: [
          {
            url: 'https://adobe.com/page1',
            q: ['q1'],
            name: 'n',
            previewImage: 'img',
            screenshotUrl: 'ss',
          },
        ],
      },
    };
    await handler(message, context);
    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.type).to.equal('generic-opportunity');
    expect(createdArg.data.subType).to.equal('guidance:geo-brand-presence');
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('should update existing opportunity if found', async () => {
    Opportunity.allBySiteId.resolves([dummyOpportunity]);
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        suggestions: [
          {
            url: 'https://adobe.com/page1',
            q: ['q1'],
            name: 'n',
            previewImage: 'img',
            screenshotUrl: 'ss',
          },
        ],
      },
    };
    await handler(message, context);
    expect(Opportunity.create).not.to.have.been.called;
    expect(dummyOpportunity.setAuditId).to.have.been.calledWith('audit-id');
    expect(dummyOpportunity.setData).to.have.been.called;
    expect(dummyOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(dummyOpportunity.save).to.have.been.called;
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('removes previous suggestions if any', async () => {
    const oldSuggestion = { remove: sinon.stub().resolves() };
    dummyOpportunity.getSuggestions.resolves([oldSuggestion, oldSuggestion]);
    Opportunity.allBySiteId.resolves([dummyOpportunity]);
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        suggestions: [
          {
            url: 'https://adobe.com/page1',
            q: ['q1'],
            name: 'n',
            previewImage: 'img',
            screenshotUrl: 'ss',
          },
        ],
      },
    };
    await handler(message, context);
    expect(oldSuggestion.remove).to.have.been.calledTwice;
    expect(Suggestion.create).to.have.been.calledOnce;
  });
});
