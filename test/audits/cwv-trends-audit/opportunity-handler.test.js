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
import esmock from 'esmock';

use(sinonChai);

describe('CWV Trends Opportunity Handler', () => {
  let sandbox;
  let convertToOpportunityStub;
  let syncSuggestionsStub;
  let opportunityHandler;

  const mockOpportunity = { getId: () => 'opp-123' };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
    syncSuggestionsStub = sandbox.stub().resolves();

    const module = await esmock('../../../src/cwv-trends-audit/opportunity-handler.js', {
      '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
      '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
    });

    opportunityHandler = module.default;
  });

  afterEach(() => { sandbox.restore(); });

  it('calls convertToOpportunity with correct audit type, device type, and comparisonFn', async () => {
    const auditData = {
      auditResult: {
        metadata: { deviceType: 'mobile' },
        urlDetails: [{ url: 'https://ex.com/p1', pageviews: 5000 }],
      },
    };
    const context = { dataAccess: {}, log: { info: sinon.spy() } };

    await opportunityHandler('https://ex.com', auditData, context);

    expect(convertToOpportunityStub).to.have.been.calledOnce;
    const [, , , , auditType, props, comparisonFn] = convertToOpportunityStub.firstCall.args;
    expect(auditType).to.equal('cwv-trends-audit');
    expect(props).to.deep.equal({ deviceType: 'mobile' });
    expect(comparisonFn).to.be.a('function');
  });

  it('comparisonFn matches by opportunity title for mobile', async () => {
    const auditData = {
      auditResult: {
        metadata: { deviceType: 'mobile' },
        urlDetails: [],
      },
    };
    const context = { dataAccess: {}, log: { info: sinon.spy() } };

    await opportunityHandler('https://ex.com', auditData, context);

    const comparisonFn = convertToOpportunityStub.firstCall.args[6];
    expect(comparisonFn({ getTitle: () => 'Mobile Web Performance Trends Report' })).to.be.true;
    expect(comparisonFn({ getTitle: () => 'Desktop Web Performance Trends Report' })).to.be.false;
  });

  it('comparisonFn matches by opportunity title for desktop', async () => {
    const auditData = {
      auditResult: {
        metadata: { deviceType: 'desktop' },
        urlDetails: [],
      },
    };
    const context = { dataAccess: {}, log: { info: sinon.spy() } };

    await opportunityHandler('https://ex.com', auditData, context);

    const comparisonFn = convertToOpportunityStub.firstCall.args[6];
    expect(comparisonFn({ getTitle: () => 'Desktop Web Performance Trends Report' })).to.be.true;
    expect(comparisonFn({ getTitle: () => 'Mobile Web Performance Trends Report' })).to.be.false;
  });

  it('comparisonFn defaults to mobile title for unknown device type', async () => {
    const auditData = {
      auditResult: {
        metadata: { deviceType: 'unknown' },
        urlDetails: [],
      },
    };
    const context = { dataAccess: {}, log: { info: sinon.spy() } };

    await opportunityHandler('https://ex.com', auditData, context);

    const comparisonFn = convertToOpportunityStub.firstCall.args[6];
    expect(comparisonFn({ getTitle: () => 'Mobile Web Performance Trends Report' })).to.be.true;
  });

  it('syncs suggestions with urlDetails', async () => {
    const urlDetails = [
      { url: 'https://ex.com/p1', pageviews: 5000 },
      { url: 'https://ex.com/p2', pageviews: 3000 },
    ];
    const auditData = { auditResult: { metadata: { deviceType: 'desktop' }, urlDetails } };
    const context = { dataAccess: {}, log: { info: sinon.spy() } };

    await opportunityHandler('https://ex.com', auditData, context);

    expect(syncSuggestionsStub).to.have.been.calledOnce;
    const args = syncSuggestionsStub.firstCall.args[0];
    expect(args.opportunity).to.equal(mockOpportunity);
    expect(args.newData).to.equal(urlDetails);
  });

  it('maps suggestions correctly', async () => {
    const urlDetails = [{ url: 'https://ex.com/p1', pageviews: 5000, lcp: 2000 }];
    const auditData = { auditResult: { metadata: { deviceType: 'mobile' }, urlDetails } };
    const context = { dataAccess: {}, log: { info: sinon.spy() } };

    await opportunityHandler('https://ex.com', auditData, context);

    const { mapNewSuggestion, buildKey } = syncSuggestionsStub.firstCall.args[0];
    const suggestion = mapNewSuggestion(urlDetails[0]);
    expect(suggestion.opportunityId).to.equal('opp-123');
    expect(suggestion.type).to.equal('CONTENT_UPDATE');
    expect(suggestion.rank).to.equal(5000);
    expect(buildKey(urlDetails[0])).to.equal('https://ex.com/p1');
  });

  it('returns auditData', async () => {
    const auditData = { auditResult: { metadata: { deviceType: 'mobile' }, urlDetails: [] } };
    const context = { dataAccess: {}, log: { info: sinon.spy() } };

    const result = await opportunityHandler('https://ex.com', auditData, context);
    expect(result).to.equal(auditData);
  });
});
