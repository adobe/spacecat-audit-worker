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
import chaiAsPromised from 'chai-as-promised';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import handler from '../../../src/email-traffic-analysis/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Email-traffic-analysis guidance handler', () => {
  let sandbox;
  let context;
  let Audit;
  let Opportunity;
  let Suggestion;

  const siteId = 'site-123';
  const auditId = 'audit-abc';
  const newOpportunityId = 'oppty-new';

  const guidancePayload = [
    {
      body: {
        reports: [
          {
            reportType: 'EMAIL_CAMPAIGN_PERFORMANCE',
            recommendations: [
              { markdown: 'Improve email targeting for segment A' },
              { markdown: 'Reduce frequency for low-engagement segment B' },
            ],
          },
          {
            reportType: 'PAGE_TYPE_PERFORMANCE',
            recommendations: [{ markdown: 'Optimize landing page for email campaigns' }],
          },
        ],
      },
    },
  ];

  let dummyAudit;

  let createdOpportunity;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    dummyAudit = {
      getAuditId: () => auditId,
      getAuditResult: () => ({
        siteId,
        week: 2,
        month: 1,
        year: 2025,
        temporalCondition: 'year=2025 AND month=1 AND week=2',
      }),
    };

    Audit = {
      findById: sandbox.stub().resolves(dummyAudit),
    };

    createdOpportunity = {
      getId: () => newOpportunityId,
      getTitle: () => 'Email Traffic Weekly Report – Week 2 / 2025',
      getType: () => 'email-traffic',
    };

    Opportunity = {
      create: sandbox.stub().resolves(createdOpportunity),
      allBySiteId: sandbox.stub().resolves([]),
    };

    Suggestion = {
      create: sandbox.stub().resolves(),
      saveMany: sandbox.stub().resolves(),
      STATUSES: SuggestionDataAccess.STATUSES,
      TYPES: SuggestionDataAccess.TYPES,
    };

    Opportunity.saveMany = sandbox.stub().resolves();

    context = {
      log: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: { Audit, Opportunity, Suggestion },
      site: { requiresValidation: true },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns early when audit not found', async () => {
    Audit.findById.resolves(null);

    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: [],
        year: 2025,
        week: 2,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('creates opportunity and AI_INSIGHTS suggestions with rank', async () => {
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg).to.include({ siteId, type: 'email-traffic' });
    expect(createdArg.data).to.include({ year: 2025, week: 2 });
    expect(createdArg.title).to.equal('Email Traffic Weekly Report – Week 2 / 2025');

    expect(Suggestion.create.callCount).to.equal(2);

    const firstSug = Suggestion.create.getCall(0).args[0];
    expect(firstSug).to.include({
      opportunityId: newOpportunityId,
      type: 'AI_INSIGHTS',
      rank: 1,
      status: 'NEW',
    });
    expect(firstSug.data.parentReport).to.equal('EMAIL_CAMPAIGN_PERFORMANCE');
    expect(firstSug.data.recommendations).to.have.length(2);
    expect(firstSug.data.recommendations[0]).to.have.property('recommendation', 'Improve email targeting for segment A');

    const secondSug = Suggestion.create.getCall(1).args[0];
    expect(secondSug.data.parentReport).to.equal('PAGE_TYPE_PERFORMANCE');
    expect(secondSug.data.recommendations).to.have.length(1);
  });

  it('creates monthly opportunity when only month is provided', async () => {
    dummyAudit.getAuditResult = () => ({
      siteId,
      month: 12,
      year: 2024,
      temporalCondition: 'year=2024 AND month=12',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.data).to.include({ year: 2024, month: 12 });
    expect(createdArg.data).to.not.have.property('week');
    expect(createdArg.title).to.equal('Email Traffic Monthly Report – Month 12 / 2024');
  });

  it('prefers week in title when both week and month are provided', async () => {
    dummyAudit.getAuditResult = () => ({
      siteId,
      week: 2,
      month: 1,
      year: 2025,
      temporalCondition: 'year=2025 AND month=1 AND week=2',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.title).to.equal('Email Traffic Weekly Report – Week 2 / 2025');
    expect(createdArg.data).to.include({ week: 2, month: 1 });
  });

  it('handles guidance with missing reports array by creating no suggestions', async () => {
    const nonArrayGuidance = [{ body: { foo: 'bar' } }];
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: nonArrayGuidance,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('handles empty guidance array (no recommendations) by creating no suggestions', async () => {
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: [],
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('handles section without recommendations by using empty list', async () => {
    const guidanceMissingRecs = [
      {
        body: {
          reports: [
            { reportType: 'EMAIL_CHANNEL_PERFORMANCE', recommendations: [{ markdown: 'A' }] },
            { reportType: 'PAGE_TYPE_PERFORMANCE' },
          ],
        },
      },
    ];

    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidanceMissingRecs,
      },
    };

    await handler(message, context);

    expect(Suggestion.create.callCount).to.equal(2);
    const second = Suggestion.create.getCall(1).args[0];
    expect(second.data.parentReport).to.equal('PAGE_TYPE_PERFORMANCE');
    expect(second.data.recommendations).to.be.an('array').that.has.length(0);
  });

  it('creates weekly opportunity when month is undefined (nullish coalescing path)', async () => {
    dummyAudit.getAuditResult = () => ({
      siteId,
      week: 7,
      year: 2025,
      temporalCondition: 'year=2025 AND week=7',
    });

    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.title).to.equal('Email Traffic Weekly Report – Week 7 / 2025');
    expect(createdArg.data).to.include({ year: 2025, week: 7 });
    expect(createdArg.data).to.not.have.property('month');
  });

  it('ignores previous email-traffic opportunities after creation', async () => {
    const old1 = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-1',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ week: '1' }),
      getTitle: () => 'Old ET Oppty',
    };
    const old2 = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-2',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ month: '12' }),
      getTitle: () => 'Old ET Oppty 2',
    };
    Opportunity.allBySiteId.resolves([old1, old2]);

    dummyAudit.getAuditResult = () => ({
      siteId,
      week: 2,
      year: 2025,
      month: 1,
      temporalCondition: 'year=2025 AND month=1 AND week=2',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(old1.setStatus).to.have.been.calledWith('IGNORED');
    expect(old2.setStatus).to.not.have.been.called;
  });

  it('ignores only month-based previous opportunities when new opportunity is monthly', async () => {
    const old1 = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-1',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ week: 1 }),
      getTitle: () => 'Old Weekly ET Oppty',
    };
    const old2 = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-2',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ month: 11 }),
      getTitle: () => 'Old Monthly ET Oppty',
    };
    Opportunity.allBySiteId.resolves([old1, old2]);

    dummyAudit.getAuditResult = () => ({
      siteId,
      month: 12,
      year: 2024,
      temporalCondition: 'year=2024 AND month=12',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(old1.setStatus).to.not.have.been.called;
    expect(old2.setStatus).to.have.been.calledWith('IGNORED');
  });

  it('does not ignore weekly opportunities (with both week and month) when creating monthly', async () => {
    const weeklyWithMonth = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-weekly',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ week: 8, month: 2, year: 2026 }),
      getTitle: () => 'Email Traffic Weekly Report – Week 8 / 2026',
    };
    const monthlyOld = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-monthly',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ month: 12, year: 2025 }),
      getTitle: () => 'Email Traffic Monthly Report – Month 12 / 2025',
    };
    Opportunity.allBySiteId.resolves([weeklyWithMonth, monthlyOld]);

    dummyAudit.getAuditResult = () => ({
      siteId,
      month: 1,
      year: 2026,
      temporalCondition: 'year=2026 AND month=1',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(weeklyWithMonth.setStatus).to.not.have.been.called;
    expect(monthlyOld.setStatus).to.have.been.calledWith('IGNORED');
  });

  it('does not ignore any opportunities when period has neither week nor month', async () => {
    const old1 = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-1',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => null,
      getTitle: () => 'Old Weekly',
    };
    Opportunity.allBySiteId.resolves([old1]);

    dummyAudit.getAuditResult = () => ({
      siteId,
      year: 2025,
      temporalCondition: 'year=2025',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(old1.setStatus).to.not.have.been.called;
  });

  it('does not ignore previous if suggestion creation fails', async () => {
    Suggestion.create.onFirstCall().rejects(new Error('boom'));

    const old = {
      getType: () => 'email-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      getData: () => ({}),
      getTitle: () => 'Old',
    };
    Opportunity.allBySiteId.resolves([old]);

    dummyAudit.getAuditResult = () => ({
      siteId,
      week: 2,
      year: 2025,
      month: 1,
      temporalCondition: 'year=2025 AND month=1 AND week=2',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await expect(handler(message, context)).to.be.rejected;

    expect(old.setStatus).to.not.have.been.called;
  });

  it('creates suggestions with status NEW regardless of site validation requirement', async () => {
    context.site = { requiresValidation: true };
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    expect(firstCall).to.have.property('status', 'NEW');
  });

  it('creates suggestions with status NEW for email traffic reports even when requiresValidation is true', async () => {
    context.site = { requiresValidation: true };
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    expect(firstCall).to.have.property('status', 'NEW');
  });

  it('creates suggestions with PENDING_VALIDATION when opportunity is not an email traffic report and requiresValidation is true', async () => {
    const nonReportOpportunity = {
      getId: () => newOpportunityId,
      getTitle: () => 'Some Other Opportunity',
      getType: () => 'generic-opportunity',
    };
    Opportunity.create.resolves(nonReportOpportunity);

    context.site = { requiresValidation: true };
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    expect(firstCall).to.have.property('status', 'PENDING_VALIDATION');
  });

  it('creates suggestions with NEW when opportunity is not an email traffic report and requiresValidation is false', async () => {
    const nonReportOpportunity = {
      getId: () => newOpportunityId,
      getTitle: () => 'Some Other Opportunity',
      getType: () => 'generic-opportunity',
    };
    Opportunity.create.resolves(nonReportOpportunity);

    context.site = { requiresValidation: false };
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    expect(firstCall).to.have.property('status', 'NEW');
  });

  it('creates suggestions with PENDING_VALIDATION when opportunity getType returns undefined and requiresValidation is true', async () => {
    const opportunityWithoutType = {
      getId: () => newOpportunityId,
      getTitle: () => 'Some Opportunity',
      getType: () => undefined,
    };
    Opportunity.create.resolves(opportunityWithoutType);

    context.site = { requiresValidation: true };
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com',
        guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    expect(firstCall).to.have.property('status', 'PENDING_VALIDATION');
  });
});
