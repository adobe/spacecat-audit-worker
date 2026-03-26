/*
 * Copyright 2026 Adobe. All rights reserved.
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
import esmock from 'esmock';

use(sinonChai);

describe('CWV Trends Opportunity Handler', () => {
  let sandbox;
  let syncSuggestionsStub;
  let opportunityHandler;
  let mockOpportunity;
  let OpportunityMock;
  let allBySiteIdAndStatusStub;
  let createStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    syncSuggestionsStub = sandbox.stub().resolves();
    allBySiteIdAndStatusStub = sandbox.stub();
    createStub = sandbox.stub();

    mockOpportunity = {
      getId: () => 'opp-123',
      getType: () => 'generic-opportunity',
      getTitle: () => 'Mobile Web Performance Trends Report',
      getData: () => ({ deviceType: 'mobile' }),
      setAuditId: sandbox.spy(),
      setData: sandbox.spy(),
      setUpdatedBy: sandbox.spy(),
      save: sandbox.stub().resolves(),
    };

    OpportunityMock = {
      allBySiteIdAndStatus: allBySiteIdAndStatusStub,
      create: createStub,
    };

    const module = await esmock('../../../src/cwv-trends-audit/opportunity-handler.js', {
      '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
    });

    opportunityHandler = module.default;
  });

  afterEach(() => { sandbox.restore(); });

  function makeContext() {
    return {
      dataAccess: { Opportunity: OpportunityMock },
      log: { info: sandbox.spy(), error: sandbox.spy() },
    };
  }

  function makeAuditData(deviceType = 'mobile') {
    return {
      siteId: 'site-1',
      id: 'audit-1',
      auditResult: {
        metadata: { deviceType },
        trendData: [{ date: '2025-11-01', good: 2, needsImprovement: 1, poor: 3 }],
        summary: { totalUrls: 6 },
        urlDetails: [{ url: 'https://ex.com/p1', pageviews: 5000 }],
      },
    };
  }

  it('creates a new generic-opportunity when none exists', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(mockOpportunity);

    await opportunityHandler('https://ex.com', makeAuditData(), makeContext());

    expect(createStub).to.have.been.calledOnce;
    const createArgs = createStub.firstCall.args[0];
    expect(createArgs.type).to.equal('generic-opportunity');
    expect(createArgs.siteId).to.equal('site-1');
    expect(createArgs.title).to.equal('Mobile Web Performance Trends Report');
  });

  it('updates existing generic-opportunity when found by title', async () => {
    allBySiteIdAndStatusStub.resolves([mockOpportunity]);

    await opportunityHandler('https://ex.com', makeAuditData(), makeContext());

    expect(createStub).to.not.have.been.called;
    expect(mockOpportunity.setAuditId).to.have.been.calledWith('audit-1');
    expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(mockOpportunity.save).to.have.been.calledOnce;
  });

  it('does not match opportunities with wrong type', async () => {
    const wrongTypeOppty = {
      ...mockOpportunity,
      getType: () => 'cwv-trends-audit',
      getTitle: () => 'Mobile Web Performance Trends Report',
    };
    allBySiteIdAndStatusStub.resolves([wrongTypeOppty]);
    createStub.resolves(mockOpportunity);

    await opportunityHandler('https://ex.com', makeAuditData(), makeContext());

    expect(createStub).to.have.been.calledOnce;
  });

  it('does not match opportunities with wrong title', async () => {
    const wrongTitleOppty = {
      ...mockOpportunity,
      getTitle: () => 'Desktop Web Performance Trends Report',
    };
    allBySiteIdAndStatusStub.resolves([wrongTitleOppty]);
    createStub.resolves(mockOpportunity);

    await opportunityHandler('https://ex.com', makeAuditData(), makeContext());

    expect(createStub).to.have.been.calledOnce;
  });

  it('matches desktop opportunity by title', async () => {
    const desktopOppty = {
      ...mockOpportunity,
      getTitle: () => 'Desktop Web Performance Trends Report',
    };
    allBySiteIdAndStatusStub.resolves([desktopOppty]);

    await opportunityHandler('https://ex.com', makeAuditData('desktop'), makeContext());

    expect(createStub).to.not.have.been.called;
    expect(desktopOppty.setAuditId).to.have.been.calledWith('audit-1');
  });

  it('defaults to mobile title for unknown device type', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(mockOpportunity);

    await opportunityHandler('https://ex.com', makeAuditData('unknown'), makeContext());

    const createArgs = createStub.firstCall.args[0];
    expect(createArgs.title).to.equal('Mobile Web Performance Trends Report');
  });

  it('creates single suggestion with full audit result', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(mockOpportunity);
    const auditData = makeAuditData('desktop');

    await opportunityHandler('https://ex.com', auditData, makeContext());

    expect(syncSuggestionsStub).to.have.been.calledOnce;
    const args = syncSuggestionsStub.firstCall.args[0];
    expect(args.opportunity).to.equal(mockOpportunity);
    expect(args.newData).to.deep.equal([auditData.auditResult]);
  });

  it('maps single suggestion with full audit result data', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(mockOpportunity);
    const auditData = makeAuditData();

    await opportunityHandler('https://ex.com', auditData, makeContext());

    const { mapNewSuggestion, buildKey } = syncSuggestionsStub.firstCall.args[0];
    const suggestion = mapNewSuggestion(auditData.auditResult);
    expect(suggestion.opportunityId).to.equal('opp-123');
    expect(suggestion.type).to.equal('CONTENT_UPDATE');
    expect(suggestion.rank).to.equal(6);
    expect(suggestion.data.suggestionValue).to.be.a('string');
    expect(JSON.parse(suggestion.data.suggestionValue)).to.deep.equal(auditData.auditResult);
    expect(buildKey()).to.equal('mobile-report');
  });

  it('returns auditData', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(mockOpportunity);
    const auditData = makeAuditData();

    const result = await opportunityHandler('https://ex.com', auditData, makeContext());
    expect(result).to.equal(auditData);
  });

  it('throws when fetching opportunities fails', async () => {
    allBySiteIdAndStatusStub.rejects(new Error('DB error'));

    try {
      await opportunityHandler('https://ex.com', makeAuditData(), makeContext());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).to.include('Failed to fetch opportunities');
    }
  });

  it('throws when creating opportunity fails', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.rejects(new Error('Create failed'));

    try {
      await opportunityHandler('https://ex.com', makeAuditData(), makeContext());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).to.equal('Create failed');
    }
  });

  it('throws when saving opportunity fails', async () => {
    mockOpportunity.save.rejects(new Error('Save failed'));
    allBySiteIdAndStatusStub.resolves([mockOpportunity]);

    try {
      await opportunityHandler('https://ex.com', makeAuditData(), makeContext());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).to.equal('Save failed');
    }
  });
});
