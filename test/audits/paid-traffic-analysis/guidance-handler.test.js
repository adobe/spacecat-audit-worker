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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

use(sinonChai);
use(chaiAsPromised);

// Mock tagMappings module
const mockTagMappings = {
  mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
    if (opportunityType === 'paid-traffic') {
      return ['Paid Traffic', 'Engagement'];
    }
    return currentTags || [];
  }),
};

let handler;

describe('Paid-traffic-analysis guidance handler', () => {
  let sandbox;
  let context;
  let Audit;
  let Opportunity;
  let Suggestion;

  const siteId = 'site-123';
  const auditId = 'audit-abc';
  const newOpportunityId = 'oppty-new';

  const guidancePayload = [{
    body: {
      reports: [
        {
          reportType: 'PAID_CAMPAIGN_PERFORMANCE',
          recommendations: [
            { markdown: 'Improve ad targeting for channel A' },
            { markdown: 'Reduce spend on low-performing channel B' },
          ],
        },
        {
          reportType: 'PAGE_TYPE_PERFORMANCE',
          recommendations: [
            { markdown: 'Optimize hero for campaign LP' },
          ],
        },
      ],
    },
  }];

  let dummyAudit;

  let createdOpportunity;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Import handler with mocked tagMappings
    handler = await esmock(
      '../../../src/paid-traffic-analysis/guidance-handler.js',
      {
        '../common/tagMappings.js': mockTagMappings,
      },
    );

    dummyAudit = {
      getAuditId: () => auditId,
      getAuditResult: () => ({
        siteId, week: 2, month: 1, year: 2025, temporalCondition: 'year=2025 AND month=1 AND week=2',
      }),
    };

    Audit = {
      findById: sandbox.stub().resolves(dummyAudit),
    };

    createdOpportunity = {
      getId: () => newOpportunityId,
      getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
      getType: () => 'paid-traffic',
    };

    Opportunity = {
      create: sandbox.stub().resolves(createdOpportunity),
      allBySiteId: sandbox.stub().resolves([]),
    };

    Suggestion = {
      create: sandbox.stub().resolves(),
      STATUSES: SuggestionDataAccess.STATUSES,
      TYPES: SuggestionDataAccess.TYPES,
    };

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
        url: 'https://example.com', guidance: [], year: 2025, week: 2,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('creates opportunity and AI_INSIGHTS suggestions with rank', async () => {
    // Use default dummyAudit.getAuditResult() week=2, month=1, year=2025
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg).to.include({ siteId, type: 'paid-traffic' });
    expect(createdArg.data).to.include({ year: 2025, week: 2 });
    expect(createdArg.title).to.equal('Paid Traffic Weekly Report – Week 2 / 2025');

    // Suggestions created for each section
    expect(Suggestion.create.callCount).to.equal(2);

    const firstSug = Suggestion.create.getCall(0).args[0];
    expect(firstSug).to.include({
      opportunityId: newOpportunityId, type: 'AI_INSIGHTS', rank: 1, status: 'NEW',
    });
    expect(firstSug.data.parentReport).to.equal('PAID_CAMPAIGN_PERFORMANCE');
    expect(firstSug.data.recommendations).to.have.length(2);
    expect(firstSug.data.recommendations[0]).to.have.property('recommendation', 'Improve ad targeting for channel A');

    const secondSug = Suggestion.create.getCall(1).args[0];
    expect(secondSug.data.parentReport).to.equal('PAGE_TYPE_PERFORMANCE');
    expect(secondSug.data.recommendations).to.have.length(1);
  });

  it('creates monthly opportunity when only month is provided', async () => {
    // Override audit result to monthly-only
    dummyAudit.getAuditResult = () => ({
      siteId, month: 12, year: 2024, temporalCondition: 'year=2024 AND month=12',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.data).to.include({ year: 2024, month: 12 });
    expect(createdArg.data).to.not.have.property('week');
    expect(createdArg.title).to.equal('Paid Traffic Monthly Report – Month 12 / 2024');
  });

  it('prefers week in title when both week and month are provided', async () => {
    // Override audit result to include both week and month
    dummyAudit.getAuditResult = () => ({
      siteId, week: 2, month: 1, year: 2025, temporalCondition: 'year=2025 AND month=1 AND week=2',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.title).to.equal('Paid Traffic Weekly Report – Week 2 / 2025');
    // Data retains both if present
    expect(createdArg.data).to.include({ week: 2, month: 1 });
  });

  it('handles guidance with missing reports array by creating no suggestions', async () => {
    // body has no reports array -> mapToAIInsightsSuggestions should return []
    const nonArrayGuidance = [{ body: { foo: 'bar' } }];
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: nonArrayGuidance,
      },
    };

    await handler(message, context);

    // Opportunity still created
    expect(Opportunity.create).to.have.been.calledOnce;
    // No suggestions created
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('handles empty guidance array (no recommendations) by creating no suggestions', async () => {
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: [],
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('handles section without recommendations by using empty list', async () => {
    // One section has no recommendations array
    const guidanceMissingRecs = [{
      body: {
        reports: [
          { reportType: 'PAID_CHANNEL_PERFORMANCE', recommendations: [{ markdown: 'A' }] },
          { reportType: 'PAGE_TYPE_PERFORMANCE' }, // no recommendations -> [] branch
        ],
      },
    }];

    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidanceMissingRecs,
      },
    };

    await handler(message, context);

    // Two suggestions created (one per section)
    expect(Suggestion.create.callCount).to.equal(2);
    const second = Suggestion.create.getCall(1).args[0];
    expect(second.data.parentReport).to.equal('PAGE_TYPE_PERFORMANCE');
    expect(second.data.recommendations).to.be.an('array').that.has.length(0);
  });

  it('creates weekly opportunity when month is undefined (nullish coalescing path)', async () => {
    // Only week/year provided; month is undefined
    dummyAudit.getAuditResult = () => ({
      siteId, week: 7, year: 2025, temporalCondition: 'year=2025 AND week=7',
    });

    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.title).to.equal('Paid Traffic Weekly Report – Week 7 / 2025');
    expect(createdArg.data).to.include({ year: 2025, week: 7 });
    expect(createdArg.data).to.not.have.property('month');
  });

  it('ignores previous paid-traffic opportunities after creation', async () => {
    const old1 = {
      getType: () => 'paid-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-1',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ week: '1' }),
      getTitle: () => 'Old PT Oppty',
    };
    const old2 = {
      getType: () => 'paid-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old-2',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getData: () => ({ month: '12' }),
      getTitle: () => 'Old PT Oppty 2',
    };
    Opportunity.allBySiteId.resolves([old1, old2]);

    // Override audit result for ignore scenario
    dummyAudit.getAuditResult = () => ({
      siteId, week: 2, year: 2025, month: 1, temporalCondition: 'year=2025 AND month=1 AND week=2',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(old1.setStatus).to.have.been.calledWith('IGNORED');
    expect(old2.setStatus).to.have.been.calledWith('IGNORED');
  });

  it('does not ignore previous if suggestion creation fails', async () => {
    Suggestion.create.onFirstCall().rejects(new Error('boom'));

    const old = {
      getType: () => 'paid-traffic',
      getStatus: () => 'NEW',
      getId: () => 'old',
      setStatus: sandbox.stub().resolves(),
      setUpdatedBy: sandbox.stub(),
      getData: () => ({}),
      getTitle: () => 'Old',
    };
    Opportunity.allBySiteId.resolves([old]);

    // Override audit result for failure path
    dummyAudit.getAuditResult = () => ({
      siteId, week: 2, year: 2025, month: 1, temporalCondition: 'year=2025 AND month=1 AND week=2',
    });
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await expect(handler(message, context)).to.be.rejected;

    expect(old.setStatus).to.not.have.been.called;
  });

  it('creates suggestions with status NEW regardless of site validation requirement', async () => {
    // See SITES-38066: Traffic analysis reports should be automatically approved
    context.site = { requiresValidation: true };
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    expect(firstCall).to.have.property('status', 'NEW');
  });

  it('creates suggestions with status NEW for paid traffic reports even when requiresValidation is true', async () => {
    // Set requiresValidation to true - but should still be NEW for reports
    context.site = { requiresValidation: true };
    const message = {
      auditId,
      siteId,
      data: {
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    // Paid traffic reports should always be NEW, regardless of requiresValidation
    expect(firstCall).to.have.property('status', 'NEW');
  });

  it('creates suggestions with PENDING_VALIDATION when opportunity is not a paid traffic report and requiresValidation is true', async () => {
    // Mock an opportunity with a different type (not paid-traffic)
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
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    // Non-report opportunities should use requiresValidation logic
    expect(firstCall).to.have.property('status', 'PENDING_VALIDATION');
  });

  it('creates suggestions with NEW when opportunity is not a paid traffic report and requiresValidation is false', async () => {
    // Mock an opportunity with a different type (not paid-traffic)
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
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    // Non-report opportunities should use requiresValidation logic
    expect(firstCall).to.have.property('status', 'NEW');
  });

  it('creates suggestions with NEW when opportunity getType returns undefined and requiresValidation is true', async () => {
    // Mock an opportunity where getType returns undefined
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
        url: 'https://example.com', guidance: guidancePayload,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.called;
    const firstCall = Suggestion.create.getCall(0).args[0];
    // When getType() returns undefined, !== 'paid-traffic' is true, but we still check requiresValidation
    expect(firstCall).to.have.property('status', 'PENDING_VALIDATION');
  });

  describe('buildPaidTrafficTitle coverage', () => {
    it('should build monthly title when week is null and month is provided', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, month: 6, year: 2024, week: null, temporalCondition: 'year=2024 AND month=6',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.title).to.equal('Paid Traffic Monthly Report – Month 6 / 2024');
      expect(createdArg.data).to.include({ year: 2024, month: 6 });
      expect(createdArg.data).to.not.have.property('week');
    });

    it('should build monthly title when week is undefined and month is provided', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, month: 6, year: 2024, temporalCondition: 'year=2024 AND month=6',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.title).to.equal('Paid Traffic Monthly Report – Month 6 / 2024');
    });
  });

  describe('ignorePreviousOpportunitiesForPeriod coverage', () => {
    it('should call ignorePreviousOpportunitiesForPeriod after opportunity creation', async () => {
      const oldOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-1',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1 }),
        getTitle: () => 'Old PT Oppty',
      };
      Opportunity.allBySiteId.resolves([oldOppty]);

      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Opportunity.allBySiteId).to.have.been.calledWith(siteId);
      expect(oldOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(oldOppty.setUpdatedBy).to.have.been.calledWith('system');
      expect(oldOppty.save).to.have.been.called;
      expect(logStub.debug).to.have.been.calledWithMatch(/Setting existing paid-traffic opportunity/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Ignored \d+ existing paid-traffic opportunities/);
    });

    it('should handle opportunities with different statuses', async () => {
      const newOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-new',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: '1' }),
        getTitle: () => 'Old PT Oppty',
      };
      const approvedOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'APPROVED',
        getId: () => 'old-approved',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: '1' }),
        getTitle: () => 'Old PT Oppty Approved',
      };
      Opportunity.allBySiteId.resolves([newOppty, approvedOppty]);

      dummyAudit.getAuditResult = () => ({
        siteId, week: 2, year: 2025, temporalCondition: 'year=2025 AND week=2',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      // Only NEW opportunities should be ignored
      expect(newOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(approvedOppty.setStatus).to.not.have.been.called;
    });

    it('should handle opportunities with missing week and month data', async () => {
      const opptyNoData = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-no-data',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({}),
        getTitle: () => 'Old PT Oppty',
      };
      Opportunity.allBySiteId.resolves([opptyNoData]);

      dummyAudit.getAuditResult = () => ({
        siteId, week: 2, year: 2025, temporalCondition: 'year=2025 AND week=2',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(opptyNoData.setStatus).to.have.been.calledWith('IGNORED');
      expect(logStub.debug).to.have.been.calledWithMatch(/Setting existing paid-traffic opportunity/);
    });

    it('should log debug message when ignoring opportunities', async () => {
      const oldOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-1',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1, month: 1 }),
        getTitle: () => 'Old PT Oppty',
      };
      Opportunity.allBySiteId.resolves([oldOppty]);

      dummyAudit.getAuditResult = () => ({
        siteId, week: 2, year: 2025, temporalCondition: 'year=2025 AND week=2',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Ignored \d+ existing paid-traffic opportunities/);
    });
  });

  describe('handler full flow coverage', () => {
    it('should log debug messages throughout the handler flow', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Message received for guidance:traffic-analysis/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Finished mapping/);
    });

    it('should handle notFound when audit is missing', async () => {
      Audit.findById.resolves(null);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      const result = await handler(message, context);

      expect(logStub.warn).to.have.been.calledWithMatch(/No audit found for auditId/);
      expect(Opportunity.create).not.to.have.been.called;
    });

    it('should handle period with week and month both null', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, year: 2024, temporalCondition: 'year=2024',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.title).to.equal('Paid Traffic Monthly Report – Month undefined / 2024');
      expect(createdArg.data).to.include({ year: 2024 });
    });

    it('should call opportunity.getId() in log message', async () => {
      const opptyWithGetId = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => 'paid-traffic',
        getId: sandbox.stub().returns(newOpportunityId),
      };
      Opportunity.create.resolves(opptyWithGetId);

      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Finished mapping/);
      expect(opptyWithGetId.getId).to.have.been.called;
    });

    it('should handle opportunity without getId method', async () => {
      const opptyWithoutGetId = {
        getTitle: () => 'Paid Traffic Weekly Report – Week 2 / 2025',
        getType: () => 'paid-traffic',
      };
      Opportunity.create.resolves(opptyWithoutGetId);

      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Finished mapping/);
    });

    it('should handle empty guidance array', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: [],
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should handle guidance with null body', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: [{ body: null }],
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should handle guidance with body but no reports array', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: [{ body: { foo: 'bar' } }],
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should handle ignorePreviousOpportunitiesForPeriod with no candidates', async () => {
      Opportunity.allBySiteId.resolves([]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(logStub.debug).to.have.been.calledWithMatch(/Ignored 0 existing paid-traffic opportunities/);
    });

    it('should handle ignorePreviousOpportunitiesForPeriod excluding new opportunity ID', async () => {
      const oldOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => newOpportunityId, // Same as newly created
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1 }),
        getTitle: () => 'Old PT Oppty',
      };
      Opportunity.allBySiteId.resolves([oldOppty]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      // Should not ignore the newly created opportunity
      expect(oldOppty.setStatus).to.not.have.been.called;
    });

    it('should handle ignorePreviousOpportunitiesForPeriod with opportunities having different types', async () => {
      const paidTrafficOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-1',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1 }),
        getTitle: () => 'Old PT Oppty',
      };
      const otherTypeOppty = {
        getType: () => 'other-type',
        getStatus: () => 'NEW',
        getId: () => 'old-2',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({}),
        getTitle: () => 'Other Oppty',
      };
      Opportunity.allBySiteId.resolves([paidTrafficOppty, otherTypeOppty]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      // Only paid-traffic opportunities should be ignored
      expect(paidTrafficOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(otherTypeOppty.setStatus).to.not.have.been.called;
    });

    it('should handle ignorePreviousOpportunitiesForPeriod with opportunities having different statuses', async () => {
      const newOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-new',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1 }),
        getTitle: () => 'Old PT Oppty',
      };
      const ignoredOppty = {
        getType: () => 'paid-traffic',
        getStatus: () => 'IGNORED',
        getId: () => 'old-ignored',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1 }),
        getTitle: () => 'Old PT Oppty Ignored',
      };
      Opportunity.allBySiteId.resolves([newOppty, ignoredOppty]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      // Only NEW opportunities should be ignored
      expect(newOppty.setStatus).to.have.been.calledWith('IGNORED');
      expect(ignoredOppty.setStatus).to.not.have.been.called;
    });

    it('should handle mapToAIInsightsSuggestions with empty reports array', async () => {
      const emptyReportsGuidance = [{
        body: {
          reports: [],
        },
      }];
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: emptyReportsGuidance,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should handle mapToAIInsightsSuggestions with null root', async () => {
      const nullRootGuidance = [null];
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: nullRootGuidance,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should handle mapToAIInsightsSuggestions with null body', async () => {
      const nullBodyGuidance = [{
        body: null,
      }];
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: nullBodyGuidance,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should handle mapToAIInsightsSuggestions with non-array reports', async () => {
      const nonArrayReportsGuidance = [{
        body: {
          reports: 'not-an-array',
        },
      }];
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: nonArrayReportsGuidance,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should handle mapToAIInsightsSuggestions with section without recommendations', async () => {
      const noRecsGuidance = [{
        body: {
          reports: [
            {
              reportType: 'PAID_CAMPAIGN_PERFORMANCE',
            },
          ],
        },
      }];
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: noRecsGuidance,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).to.have.been.calledOnce;
      const suggestion = Suggestion.create.getCall(0).args[0];
      expect(suggestion.data.recommendations).to.be.an('array').that.has.length(0);
    });

    it('should handle mapToAIInsightsSuggestions with section with non-array recommendations', async () => {
      const nonArrayRecsGuidance = [{
        body: {
          reports: [
            {
              reportType: 'PAID_CAMPAIGN_PERFORMANCE',
              recommendations: 'not-an-array',
            },
          ],
        },
      }];
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: nonArrayRecsGuidance,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).to.have.been.calledOnce;
      const suggestion = Suggestion.create.getCall(0).args[0];
      expect(suggestion.data.recommendations).to.be.an('array').that.has.length(0);
    });

    it('should handle mapToPaidOpportunity with both week and month', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, week: 5, month: 3, year: 2025, temporalCondition: 'year=2025 AND month=3 AND week=5',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.data).to.include({ year: 2025, week: 5, month: 3 });
      expect(createdArg.title).to.equal('Paid Traffic Weekly Report – Week 5 / 2025');
    });

    it('should handle mapToPaidOpportunity with only week', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, week: 10, year: 2024, temporalCondition: 'year=2024 AND week=10',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.data).to.include({ year: 2024, week: 10 });
      expect(createdArg.data).to.not.have.property('month');
      expect(createdArg.title).to.equal('Paid Traffic Weekly Report – Week 10 / 2024');
    });

    it('should handle mapToPaidOpportunity with only month', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, month: 8, year: 2024, temporalCondition: 'year=2024 AND month=8',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.data).to.include({ year: 2024, month: 8 });
      expect(createdArg.data).to.not.have.property('week');
      expect(createdArg.title).to.equal('Paid Traffic Monthly Report – Month 8 / 2024');
    });

    it('should handle mapToPaidOpportunity with week as 0', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, week: 0, year: 2024, temporalCondition: 'year=2024 AND week=0',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.data).to.include({ year: 2024, week: 0 });
      expect(createdArg.title).to.equal('Paid Traffic Weekly Report – Week 0 / 2024');
    });

    it('should handle mapToPaidOpportunity with month as 0', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, month: 0, year: 2024, temporalCondition: 'year=2024 AND month=0',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      const createdArg = Opportunity.create.getCall(0).args[0];
      expect(createdArg.data).to.include({ year: 2024, month: 0 });
      expect(createdArg.title).to.equal('Paid Traffic Monthly Report – Month 0 / 2024');
    });

    it('should handle ignorePreviousOpportunitiesForPeriod with multiple opportunities', async () => {
      const oppty1 = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-1',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1 }),
        getTitle: () => 'Old PT Oppty 1',
      };
      const oppty2 = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-2',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 2 }),
        getTitle: () => 'Old PT Oppty 2',
      };
      const oppty3 = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-3',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ month: 1 }),
        getTitle: () => 'Old PT Oppty 3',
      };
      Opportunity.allBySiteId.resolves([oppty1, oppty2, oppty3]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(oppty1.setStatus).to.have.been.calledWith('IGNORED');
      expect(oppty2.setStatus).to.have.been.calledWith('IGNORED');
      expect(oppty3.setStatus).to.have.been.calledWith('IGNORED');
      expect(logStub.debug).to.have.been.calledWithMatch(/Ignored 3 existing paid-traffic opportunities/);
    });

    it('should handle ignorePreviousOpportunitiesForPeriod with opportunity having null data', async () => {
      const opptyNullData = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-null-data',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => null,
        getTitle: () => 'Old PT Oppty',
      };
      Opportunity.allBySiteId.resolves([opptyNullData]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(opptyNullData.setStatus).to.have.been.calledWith('IGNORED');
      expect(logStub.debug).to.have.been.calledWithMatch(/Setting existing paid-traffic opportunity/);
    });

    it('should handle ignorePreviousOpportunitiesForPeriod with opportunity having undefined week and month', async () => {
      const opptyUndefined = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-undefined',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: undefined, month: undefined }),
        getTitle: () => 'Old PT Oppty',
      };
      Opportunity.allBySiteId.resolves([opptyUndefined]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(opptyUndefined.setStatus).to.have.been.calledWith('IGNORED');
      expect(logStub.debug).to.have.been.calledWithMatch(/Setting existing paid-traffic opportunity.*week=undefined.*month=undefined/);
    });

    it('should execute ignorePreviousOpportunitiesForPeriod function with all code paths', async () => {
      const oppty1 = {
        getType: () => 'paid-traffic',
        getStatus: () => 'NEW',
        getId: () => 'old-1',
        setStatus: sandbox.stub().resolves(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
        getData: () => ({ week: 1 }),
        getTitle: () => 'Old PT Oppty 1',
      };
      Opportunity.allBySiteId.resolves([oppty1]);
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Opportunity.allBySiteId).to.have.been.calledWith(siteId);
      expect(oppty1.setStatus).to.have.been.calledWith('IGNORED');
      expect(oppty1.setUpdatedBy).to.have.been.calledWith('system');
      expect(oppty1.save).to.have.been.called;
      expect(logStub.debug).to.have.been.calledWithMatch(/Setting existing paid-traffic opportunity id=old-1/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Ignored 1 existing paid-traffic opportunities/);
    });

    it('should execute mapToPaidOpportunity function with all parameters', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      // Verify mapToPaidOpportunity was called by checking the created entity
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.siteId).to.equal(siteId);
      expect(createCall.type).to.equal('paid-traffic');
      expect(createCall.origin).to.equal('ESS_OPS');
      expect(createCall.data.dataSources).to.include('RUM');
    });

    it('should execute mapToAIInsightsSuggestions function with all parameters', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).to.have.been.called;
      // Verify mapToAIInsightsSuggestions was called by checking suggestions
      const firstSug = Suggestion.create.getCall(0).args[0];
      expect(firstSug.opportunityId).to.equal(newOpportunityId);
      expect(firstSug.type).to.equal('AI_INSIGHTS');
      expect(firstSug.rank).to.equal(1);
    });

    it('should execute all handler lines including period derivation', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Message received for guidance:traffic-analysis handler/);
      expect(Opportunity.create).to.have.been.calledOnce;
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.data.year).to.equal(2025);
      expect(createCall.data.week).to.equal(2);
    });

    it('should execute mergeTagsWithHardcodedTags call', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(mockTagMappings.mergeTagsWithHardcodedTags).to.have.been.calledWith('paid-traffic', sinon.match.array);
    });

    it('should execute handler with suggestions.length > 0 path', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Suggestion.create).to.have.been.called;
      const firstCall = Suggestion.create.getCall(0).args[0];
      expect(firstCall.status).to.equal('NEW');
    });

    it('should execute handler with suggestions.length === 0 path', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: [],
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).not.to.have.been.called;
    });

    it('should execute handler with opportunity.getType() !== paid-traffic path', async () => {
      const nonPaidTrafficOppty = {
        getId: () => newOpportunityId,
        getTitle: () => 'Some Other Opportunity',
        getType: () => 'generic-opportunity',
      };
      Opportunity.create.resolves(nonPaidTrafficOppty);
      context.site = { requiresValidation: true };
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Suggestion.create).to.have.been.called;
      const firstCall = Suggestion.create.getCall(0).args[0];
      expect(firstCall.status).to.equal('PENDING_VALIDATION');
    });

    it('should execute handler with requiresValidation false path', async () => {
      context.site = { requiresValidation: false };
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(Suggestion.create).to.have.been.called;
      const firstCall = Suggestion.create.getCall(0).args[0];
      expect(firstCall.status).to.equal('NEW');
    });

    it('should execute handler with period.week != null path in log message', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, week: 3, year: 2025, temporalCondition: 'year=2025 AND week=3',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Finished mapping.*W3\/Y2025/);
    });

    it('should execute handler with period.week == null path in log message', async () => {
      dummyAudit.getAuditResult = () => ({
        siteId, month: 6, year: 2024, temporalCondition: 'year=2024 AND month=6',
      });
      const message = {
        auditId,
        siteId,
        data: {
          url: 'https://example.com', guidance: guidancePayload,
        },
      };

      await handler(message, context);

      expect(logStub.debug).to.have.been.calledWithMatch(/Finished mapping.*M6\/Y2024/);
    });
  });
});
