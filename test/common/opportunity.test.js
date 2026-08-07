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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import chaiAsPromised from 'chai-as-promised';

use(sinonChai);
use(chaiAsPromised);

describe('convertToOpportunity — RESOLVED fallback', () => {
  let sandbox;
  let convertToOpportunity;
  let checkGoogleConnectionStub;

  const siteId = 'site-id';
  const auditId = 'audit-id';
  const auditType = 'broken-backlinks';

  const makeOpp = (type, updatedAt = '2024-01-01T00:00:00Z') => ({
    getType: () => type,
    getUpdatedAt: () => updatedAt,
    setStatus: sandbox.stub().resolves(),
    setAuditId: sandbox.stub(),
    getData: sandbox.stub().returns({}),
    setData: sandbox.stub(),
    setUpdatedBy: sandbox.stub(),
    setScopeType: sandbox.stub(),
    setScopeId: sandbox.stub(),
    save: sandbox.stub().resolves(),
    getId: () => `opp-${updatedAt}`,
  });

  const makeContext = ({ newOpps = [], resolvedOpps = [], createStub } = {}) => {
    const create = createStub ?? sandbox.stub().resolves(makeOpp(auditType));
    return {
      dataAccess: {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub()
            .onFirstCall().resolves(newOpps)
            .onSecondCall()
            .resolves(resolvedOpps),
          create,
        },
      },
      log: { error: sandbox.stub(), info: sandbox.stub(), debug: sandbox.stub() },
    };
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    checkGoogleConnectionStub = sandbox.stub().resolves(true);
    ({ convertToOpportunity } = await esmock('../../src/common/opportunity.js', {
      '../../src/common/opportunity-utils.js': {
        checkGoogleConnection: checkGoogleConnectionStub,
      },
    }));
  });

  afterEach(() => sandbox.restore());

  it('reopens the matching RESOLVED opportunity and saves it without creating a new one', async () => {
    const resolved = makeOpp(auditType);
    const createStub = sandbox.stub();
    const context = makeContext({ resolvedOpps: [resolved], createStub });

    const result = await convertToOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: {} }),
      auditType,
    );

    expect(resolved.setStatus).to.have.been.calledOnce;
    expect(resolved.save).to.have.been.calledOnce;
    expect(createStub).to.not.have.been.called;
    expect(result.getId()).to.equal(resolved.getId());
  });

  it('picks the most recently updated RESOLVED opportunity when multiple match', async () => {
    const older = makeOpp(auditType, '2023-01-01T00:00:00Z');
    const newer = makeOpp(auditType, '2024-06-01T00:00:00Z');
    const context = makeContext({ resolvedOpps: [older, newer] });

    await convertToOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: {} }),
      auditType,
    );

    expect(newer.setStatus).to.have.been.calledOnce;
    expect(older.setStatus).to.not.have.been.called;
  });

  it('reopens a RESOLVED opportunity when comparisonFn returns true', async () => {
    const resolved = makeOpp(auditType);
    const createStub = sandbox.stub();
    const context = makeContext({ resolvedOpps: [resolved], createStub });
    const comparisonFn = sandbox.stub().returns(true);

    await convertToOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: {} }),
      auditType,
      {},
      comparisonFn,
    );

    expect(comparisonFn).to.have.been.called;
    expect(resolved.setStatus).to.have.been.calledOnce;
    expect(createStub).to.not.have.been.called;
  });

  it('does not reopen a RESOLVED opportunity when comparisonFn returns false', async () => {
    const resolved = makeOpp(auditType);
    const createStub = sandbox.stub().resolves(makeOpp(auditType));
    const context = makeContext({ resolvedOpps: [resolved], createStub });
    const comparisonFn = sandbox.stub().returns(false);

    await convertToOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: {} }),
      auditType,
      {},
      comparisonFn,
    );

    expect(resolved.setStatus).to.not.have.been.called;
    expect(createStub).to.have.been.calledOnce;
  });

  it('creates a new opportunity when RESOLVED opportunities exist but none match the type', async () => {
    const wrongType = makeOpp('other-audit-type');
    const createStub = sandbox.stub().resolves(makeOpp(auditType));
    const context = makeContext({ resolvedOpps: [wrongType], createStub });

    await convertToOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: {} }),
      auditType,
    );

    expect(wrongType.setStatus).to.not.have.been.called;
    expect(createStub).to.have.been.calledOnce;
  });

  it('creates a new opportunity when no NEW or RESOLVED opportunities exist', async () => {
    const createStub = sandbox.stub().resolves(makeOpp(auditType));
    const context = makeContext({ createStub });

    await convertToOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: {} }),
      auditType,
    );

    expect(createStub).to.have.been.calledOnce;
  });
});

describe('persistOffsiteOpportunity', () => {
  let sandbox;
  let persistOffsiteOpportunity;
  let checkGoogleConnectionStub;

  const siteId = 'test-site-id';
  const auditId = 'test-audit-id-2';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    checkGoogleConnectionStub = sandbox.stub().resolves(true);
    ({ persistOffsiteOpportunity } = await esmock('../../src/common/offsite-refresh.js', {
      '../../src/common/opportunity-utils.js': {
        checkGoogleConnection: checkGoogleConnectionStub,
      },
    }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  const buildExistingOpportunity = (existingData) => ({
    getType: () => 'cited-analysis',
    getData: sandbox.stub().returns(existingData),
    setAuditId: sandbox.stub(),
    // SITES-49175 — self-heal legacy NULL-scope rows on every audit touch
    setScopeType: sandbox.stub(),
    setScopeId: sandbox.stub(),
    setData: sandbox.stub(),
    setUpdatedBy: sandbox.stub(),
    save: sandbox.stub().resolves(),
    getId: () => 'existing-opp-id',
  });

  it('replaces dashboard/performance data wholesale on refresh, dropping fields absent from the latest run', async () => {
    const existingData = {
      dataSources: ['ai-search'],
      dashboard: { sentiment: 'negative', sov: 0.1 },
      fullAnalysis: { suggestions: ['old'] },
    };
    const existingOpportunity = buildExistingOpportunity(existingData);

    const context = {
      dataAccess: {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([existingOpportunity]),
        },
      },
      log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
    };

    const createOpportunityData = () => ({
      data: {
        dataSources: ['ai-search'],
        dashboard: { sentiment: 'positive', sov: 0.42 },
      },
    });

    const auditUrl = 'https://example.com';
    const auditData = { siteId, id: auditId };

    const result = await persistOffsiteOpportunity(
      auditUrl,
      auditData,
      context,
      createOpportunityData,
      'cited-analysis',
      { opportunityData: {}, existingOpportunity },
    );

    expect(result.getId()).to.equal('existing-opp-id');
    // fullAnalysis is absent from the latest mapped data, so it must disappear — not
    // linger merged in from the prior run. setData is called with exactly the new data.
    expect(existingOpportunity.setData).to.have.been.calledWith({
      dataSources: ['ai-search'],
      dashboard: { sentiment: 'positive', sov: 0.42 },
    });
    expect(existingOpportunity.setData.firstCall.args[0]).to.not.have.property('fullAnalysis');
  });

  it('applies the same wholesale-replace behavior for reddit-analysis and youtube-analysis', async () => {
    for (const auditType of ['reddit-analysis', 'youtube-analysis']) {
      const existingOpportunity = buildExistingOpportunity({
        dashboard: { sov: 0.1 },
        staleTopic: { id: 'old-only-field' },
      });
      existingOpportunity.getType = () => auditType;

      const context = {
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([existingOpportunity]),
          },
        },
        log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
      };

      const createOpportunityData = () => ({ data: { dashboard: { sov: 0.77 } } });

      // eslint-disable-next-line no-await-in-loop
      await persistOffsiteOpportunity(
        'https://example.com',
        { siteId, id: auditId },
        context,
        createOpportunityData,
        auditType,
        { existingOpportunity },
      );

      expect(existingOpportunity.setData).to.have.been.calledWith({
        dashboard: { sov: 0.77 },
      });
      expect(existingOpportunity.setData.firstCall.args[0]).to.not.have.property('staleTopic');
    }
  });

  it('rejects non-offsite audit types before mutating an opportunity', async () => {
    const existingOpportunity = buildExistingOpportunity({ staleField: 'must-survive' });
    const context = {
      dataAccess: { Opportunity: { create: sandbox.stub() } },
      log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
    };

    await expect(persistOffsiteOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: { newField: 'new' } }),
      'prerender',
      { existingOpportunity },
    )).to.be.rejectedWith('Unsupported offsite audit type: prerender');

    expect(existingOpportunity.setAuditId).to.not.have.been.called;
    expect(existingOpportunity.setData).to.not.have.been.called;
    expect(existingOpportunity.save).to.not.have.been.called;
  });

  it('requires callers to provide the pre-resolved target explicitly', async () => {
    const createOpportunityData = sandbox.stub();
    const context = {
      dataAccess: { Opportunity: { create: sandbox.stub() } },
      log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
    };

    await expect(persistOffsiteOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      createOpportunityData,
      'cited-analysis',
      { opportunityData: {} },
    )).to.be.rejectedWith('existingOpportunity must be explicitly provided');

    expect(createOpportunityData).to.not.have.been.called;
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
  });

  [undefined, false, 0].forEach((invalidTarget) => {
    it(`rejects invalid explicit target ${String(invalidTarget)}`, async () => {
      const createOpportunityData = sandbox.stub();
      const context = {
        dataAccess: { Opportunity: { create: sandbox.stub() } },
        log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
      };

      await expect(persistOffsiteOpportunity(
        'https://example.com',
        { siteId, id: auditId },
        context,
        createOpportunityData,
        'cited-analysis',
        { opportunityData: {}, existingOpportunity: invalidTarget },
      )).to.be.rejectedWith('existingOpportunity must be an opportunity or null');

      expect(createOpportunityData).to.not.have.been.called;
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });
  });

  it('removes GSC from mapped data when the site has no Google connection', async () => {
    checkGoogleConnectionStub.resolves(false);
    const existingOpportunity = buildExistingOpportunity({ staleField: 'old' });
    const context = {
      dataAccess: { Opportunity: { create: sandbox.stub() } },
      log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
    };

    await persistOffsiteOpportunity(
      'https://example.com',
      { siteId, id: auditId },
      context,
      () => ({ data: { dataSources: ['GSC', 'Site'] } }),
      'cited-analysis',
      { existingOpportunity },
    );

    expect(existingOpportunity.setData).to.have.been.calledWith({
      dataSources: ['Site'],
    });
  });

  describe('pre-resolved existingOpportunity (bypasses the internal query)', () => {
    it('uses a provided existingOpportunity directly without querying allBySiteIdAndStatus', async () => {
      const existingOpportunity = buildExistingOpportunity({ dashboard: { sov: 0.1 } });
      const allBySiteIdAndStatusStub = sandbox.stub().resolves([]);
      const context = {
        dataAccess: { Opportunity: { allBySiteIdAndStatus: allBySiteIdAndStatusStub } },
        log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
      };
      const createOpportunityData = () => ({ data: { dashboard: { sov: 0.77 } } });

      const result = await persistOffsiteOpportunity(
        'https://example.com',
        { siteId, id: auditId },
        context,
        createOpportunityData,
        'cited-analysis',
        { existingOpportunity },
      );

      expect(result.getId()).to.equal('existing-opp-id');
      expect(allBySiteIdAndStatusStub).to.not.have.been.called;
      expect(existingOpportunity.setData).to.have.been.calledWith({ dashboard: { sov: 0.77 } });
    });

    it('forces creation when existingOpportunity is explicitly null, without querying', async () => {
      const allBySiteIdAndStatusStub = sandbox.stub().resolves([]);
      const createStub = sandbox.stub().resolves({ getId: () => 'new-opp-id' });
      const context = {
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: allBySiteIdAndStatusStub, create: createStub },
        },
        log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
      };
      const createOpportunityData = () => ({ data: { dashboard: { sov: 0.77 } }, status: 'IGNORED' });

      const result = await persistOffsiteOpportunity(
        'https://example.com',
        { siteId, id: auditId },
        context,
        createOpportunityData,
        'cited-analysis',
        { existingOpportunity: null },
      );

      expect(result.getId()).to.equal('new-opp-id');
      expect(allBySiteIdAndStatusStub).to.not.have.been.called;
      expect(createStub).to.have.been.calledOnce;
      // Status is baked into the single create write — never a separate, later save().
      expect(createStub.firstCall.args[0]).to.have.property('status', 'IGNORED');
    });

    it('logs audit context and rethrows when creation fails', async () => {
      const createStub = sandbox.stub().rejects(new Error('create failed'));
      const context = {
        dataAccess: { Opportunity: { create: createStub } },
        log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
      };

      await expect(persistOffsiteOpportunity(
        'https://example.com',
        { siteId, id: auditId },
        context,
        () => ({ data: {}, status: 'IGNORED' }),
        'cited-analysis',
        { existingOpportunity: null },
      )).to.be.rejectedWith('create failed');

      expect(context.log.error).to.have.been.calledWith(
        sinon.match(new RegExp(`${siteId}.*${auditId}.*create failed`)),
      );
    });
  });

  describe('atomic status on create', () => {
    it('includes the mapper-provided status in the Opportunity.create() payload', async () => {
      const createStub = sandbox.stub().resolves({ getId: () => 'new-opp-id' });
      const context = {
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: createStub,
          },
        },
        log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
      };
      const createOpportunityData = () => ({ data: {}, status: 'IGNORED' });

      await persistOffsiteOpportunity(
        'https://example.com',
        { siteId, id: auditId },
        context,
        createOpportunityData,
        'cited-analysis',
        { existingOpportunity: null },
      );

      expect(createStub.firstCall.args[0]).to.have.property('status', 'IGNORED');
    });

    it('omits status from the create payload when the mapper does not provide one', async () => {
      const createStub = sandbox.stub().resolves({ getId: () => 'new-opp-id' });
      const context = {
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: createStub,
          },
        },
        log: { info: sandbox.spy(), error: sandbox.spy(), debug: sandbox.spy() },
      };
      const createOpportunityData = () => ({ data: {} });

      await persistOffsiteOpportunity(
        'https://example.com',
        { siteId, id: auditId },
        context,
        createOpportunityData,
        'cited-analysis',
        { existingOpportunity: null },
      );

      expect(createStub.firstCall.args[0]).to.not.have.property('status');
    });
  });
});
