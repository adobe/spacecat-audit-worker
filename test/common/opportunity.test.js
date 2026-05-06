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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('convertToOpportunity', () => {
  let convertToOpportunity;
  let Opportunity;
  let checkGoogleConnectionStub;
  let context;
  let auditData;
  let createOpportunityData;

  const auditUrl = 'https://example.com/page';
  const auditType = 'semantic-value-visibility';
  const opportunityInstance = {
    runbook: '',
    origin: 'AUTOMATION',
    title: 'Test title',
    description: 'Test description',
    guidance: {},
    tags: ['isElmo', 'semantic-value-visibility'],
    data: { dataSources: ['site'] },
  };

  beforeEach(async () => {
    checkGoogleConnectionStub = sinon.stub().resolves(true);

    Opportunity = {
      allBySiteIdAndStatus: sinon.stub(),
      create: sinon.stub(),
    };

    context = {
      log: { error: sinon.stub(), info: sinon.stub() },
      dataAccess: { Opportunity },
    };

    auditData = { siteId: 'site-123', id: 'audit-456' };
    createOpportunityData = sinon.stub().returns(opportunityInstance);

    ({ convertToOpportunity } = await esmock(
      '../../src/common/opportunity.js',
      {
        '../../src/common/opportunity-utils.js': {
          checkGoogleConnection: checkGoogleConnectionStub,
        },
      },
    ));
  });

  afterEach(() => sinon.restore());

  describe('CREATE path — no existing opportunity', () => {
    beforeEach(() => {
      Opportunity.allBySiteIdAndStatus.resolves([]);
      Opportunity.create.resolves({ getId: () => 'new-oppty-1' });
    });

    it('creates opportunity with tags', async () => {
      await convertToOpportunity(auditUrl, auditData, context, createOpportunityData, auditType);

      expect(Opportunity.create).to.have.been.calledOnce;
      const created = Opportunity.create.firstCall.args[0];
      expect(created.tags).to.deep.equal(['isElmo', 'semantic-value-visibility']);
    });
  });

  describe('UPDATE path — existing opportunity found', () => {
    let existingOpportunity;

    beforeEach(() => {
      existingOpportunity = {
        getType: sinon.stub().returns(auditType),
        getData: sinon.stub().returns({ dataSources: ['site'] }),
        setAuditId: sinon.stub(),
        setData: sinon.stub(),
        setTags: sinon.stub(),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);
    });

    it('calls setTags with tags from the opportunity mapper', async () => {
      await convertToOpportunity(auditUrl, auditData, context, createOpportunityData, auditType);

      expect(existingOpportunity.setTags).to.have.been.calledOnceWith(['isElmo', 'semantic-value-visibility']);
    });

    it('saves after setting tags', async () => {
      await convertToOpportunity(auditUrl, auditData, context, createOpportunityData, auditType);

      expect(existingOpportunity.setTags).to.have.been.calledBefore(existingOpportunity.save);
    });

    it('does not call setTags when mapper returns no tags', async () => {
      createOpportunityData.returns({ ...opportunityInstance, tags: [] });

      await convertToOpportunity(auditUrl, auditData, context, createOpportunityData, auditType);

      expect(existingOpportunity.setTags).not.to.have.been.called;
    });

    it('does not call setTags when mapper returns undefined tags', async () => {
      createOpportunityData.returns({ ...opportunityInstance, tags: undefined });

      await convertToOpportunity(auditUrl, auditData, context, createOpportunityData, auditType);

      expect(existingOpportunity.setTags).not.to.have.been.called;
    });
  });
});
