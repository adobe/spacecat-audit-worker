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
  let OpportunityMock;
  let allBySiteIdAndStatusStub;
  let createStub;

  function makeMockOpportunity(title = 'Mobile Web Performance Trends Report') {
    return {
      getId: () => 'opp-123',
      getType: () => 'generic-opportunity',
      getTitle: () => title,
      getData: () => ({ deviceType: 'mobile' }),
      setAuditId: sandbox.spy(),
      setData: sandbox.spy(),
      setUpdatedBy: sandbox.spy(),
      save: sandbox.stub().resolves(),
    };
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    syncSuggestionsStub = sandbox.stub().resolves();
    allBySiteIdAndStatusStub = sandbox.stub();
    createStub = sandbox.stub();

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

  function makeDeviceResult(deviceType = 'mobile') {
    return {
      metadata: { deviceType, domain: 'ex.com', startDate: '2025-11-01', endDate: '2025-11-28' },
      trendData: [{ date: '2025-11-01', good: 2, needsImprovement: 1, poor: 3 }],
      summary: { totalUrls: 6 },
      urlDetails: [{ url: 'https://ex.com/p1', pageviews: 5000 }],
    };
  }

  function makeAuditData(deviceTypes = ['mobile', 'desktop']) {
    return {
      siteId: 'site-1',
      id: 'audit-1',
      auditResult: deviceTypes.map((dt) => makeDeviceResult(dt)),
    };
  }

  it('creates generic-opportunity for both mobile and desktop', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(makeMockOpportunity());

    await opportunityHandler('https://ex.com', makeAuditData(), makeContext());

    expect(createStub).to.have.been.calledTwice;
    const mobileArgs = createStub.firstCall.args[0];
    const desktopArgs = createStub.secondCall.args[0];
    expect(mobileArgs.type).to.equal('generic-opportunity');
    expect(mobileArgs.status).to.equal('NEW');
    expect(mobileArgs.title).to.equal('Mobile Web Performance Trends Report');
    expect(desktopArgs.type).to.equal('generic-opportunity');
    expect(desktopArgs.status).to.equal('NEW');
    expect(desktopArgs.title).to.equal('Desktop Web Performance Trends Report');
  });

  it('updates existing opportunities when found by type and title', async () => {
    const mobileOppty = makeMockOpportunity('Mobile Web Performance Trends Report');
    const desktopOppty = makeMockOpportunity('Desktop Web Performance Trends Report');
    allBySiteIdAndStatusStub.resolves([mobileOppty, desktopOppty]);

    await opportunityHandler('https://ex.com', makeAuditData(), makeContext());

    expect(createStub).to.not.have.been.called;
    expect(mobileOppty.setAuditId).to.have.been.calledWith('audit-1');
    expect(mobileOppty.setData).to.have.been.calledOnce;
    const mobileSetDataArg = mobileOppty.setData.firstCall.args[0];
    expect(mobileSetDataArg).to.have.property('deviceType', 'mobile');
    expect(mobileSetDataArg).to.have.property('dataSources').that.deep.equals(['RUM']);
    expect(mobileOppty.save).to.have.been.calledOnce;
    expect(desktopOppty.setAuditId).to.have.been.calledWith('audit-1');
    expect(desktopOppty.setData).to.have.been.calledOnce;
    const desktopSetDataArg = desktopOppty.setData.firstCall.args[0];
    expect(desktopSetDataArg).to.have.property('dataSources').that.deep.equals(['RUM']);
    expect(desktopOppty.save).to.have.been.calledOnce;
  });

  it('does not match opportunities with wrong type', async () => {
    const wrongTypeOppty = {
      ...makeMockOpportunity(),
      getType: () => 'cwv-trends-audit',
    };
    allBySiteIdAndStatusStub.resolves([wrongTypeOppty]);
    createStub.resolves(makeMockOpportunity());

    await opportunityHandler('https://ex.com', makeAuditData(['mobile']), makeContext());

    expect(createStub).to.have.been.calledOnce;
  });

  it('does not match opportunities with wrong title', async () => {
    const wrongTitleOppty = makeMockOpportunity('Desktop Web Performance Trends Report');
    allBySiteIdAndStatusStub.resolves([wrongTitleOppty]);
    createStub.resolves(makeMockOpportunity());

    await opportunityHandler('https://ex.com', makeAuditData(['mobile']), makeContext());

    expect(createStub).to.have.been.calledOnce;
  });

  it('defaults to mobile title for unknown device type', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(makeMockOpportunity());

    const auditData = {
      siteId: 'site-1',
      id: 'audit-1',
      auditResult: [makeDeviceResult('unknown')],
    };

    await opportunityHandler('https://ex.com', auditData, makeContext());

    const createArgs = createStub.firstCall.args[0];
    expect(createArgs.title).to.equal('Mobile Web Performance Trends Report');
  });

  it('syncs suggestions for each device type', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    const mockOppty = makeMockOpportunity();
    createStub.resolves(mockOppty);

    await opportunityHandler('https://ex.com', makeAuditData(), makeContext());

    expect(syncSuggestionsStub).to.have.been.calledTwice;

    const mobileArgs = syncSuggestionsStub.firstCall.args[0];
    expect(mobileArgs.opportunity).to.equal(mockOppty);
    expect(mobileArgs.newData[0].metadata.deviceType).to.equal('mobile');

    const desktopArgs = syncSuggestionsStub.secondCall.args[0];
    expect(desktopArgs.newData[0].metadata.deviceType).to.equal('desktop');
  });

  it('maps suggestion with full audit result data', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    const mockOppty = makeMockOpportunity();
    createStub.resolves(mockOppty);

    await opportunityHandler('https://ex.com', makeAuditData(['mobile']), makeContext());

    const { mapNewSuggestion, buildKey } = syncSuggestionsStub.firstCall.args[0];
    const deviceResult = makeDeviceResult('mobile');
    const suggestion = mapNewSuggestion(deviceResult);
    expect(suggestion.opportunityId).to.equal('opp-123');
    expect(suggestion.type).to.equal('CONTENT_UPDATE');
    expect(suggestion.rank).to.equal(6);
    expect(suggestion.data.suggestionValue).to.be.a('string');
    expect(JSON.parse(suggestion.data.suggestionValue)).to.deep.equal(deviceResult);
    expect(buildKey()).to.equal('mobile-report');
  });

  it('passes newSuggestionStatus NEW to syncSuggestions', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(makeMockOpportunity());

    await opportunityHandler('https://ex.com', makeAuditData(['mobile']), makeContext());

    const { newSuggestionStatus } = syncSuggestionsStub.firstCall.args[0];
    expect(newSuggestionStatus).to.equal('NEW');
  });

  it('mergeDataFunction replaces suggestionValue with new result', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(makeMockOpportunity());

    await opportunityHandler('https://ex.com', makeAuditData(['mobile']), makeContext());

    const { mergeDataFunction } = syncSuggestionsStub.firstCall.args[0];
    const existingData = { suggestionValue: '{"old":"data"}', otherField: 'keep' };
    const newResult = makeDeviceResult('mobile');
    const merged = mergeDataFunction(existingData, newResult);

    expect(merged.otherField).to.equal('keep');
    expect(merged.suggestionValue).to.be.a('string');
    expect(JSON.parse(merged.suggestionValue)).to.deep.equal(newResult);
  });

  it('returns auditData', async () => {
    allBySiteIdAndStatusStub.resolves([]);
    createStub.resolves(makeMockOpportunity());
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
      await opportunityHandler('https://ex.com', makeAuditData(['mobile']), makeContext());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).to.equal('Create failed');
    }
  });

  it('throws when saving opportunity fails', async () => {
    const mockOppty = makeMockOpportunity();
    mockOppty.save.rejects(new Error('Save failed'));
    allBySiteIdAndStatusStub.resolves([mockOppty]);

    try {
      await opportunityHandler('https://ex.com', makeAuditData(['mobile']), makeContext());
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).to.equal('Save failed');
    }
  });
});
