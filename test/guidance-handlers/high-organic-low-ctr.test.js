/*
 * Copyright 2024 Adobe. All rights reserved.
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
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import opportunitiesAuditData from '../fixtures/experimentation-opportunities/experimentation-opportunity-audit.json' with { type: 'json' };
import guidanceMsgFromMystique from '../fixtures/experimentation-opportunities/high-organic-low-ctr-guidance.json' with { type: 'json' };
import handler from '../../src/experimentation-opportunities/guidance-high-organic-low-ctr-handler.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

describe('high-organic-low-ctr guidance handler tests', () => {
  let context;
  let Audit;
  let Opportunity;
  let Suggestion;
  let log;

  const dummyAudit = {
    getAuditResult: () => opportunitiesAuditData.auditResult,
  };

  const dummyOpportunity = {
    getId: sandbox.stub().returns('existing-oppty-id'),
    getSuggestions: sandbox.stub().resolves([]),
    getData: sandbox.stub().returns({
      page: 'https://abc.com/abc-adoption/account',
    }),
    getUpdatedBy: sandbox.stub().returns('system'),
    setAuditId: sandbox.stub(),
    setData: sandbox.stub(),
    setGuidance: sandbox.stub(),
    save: sandbox.stub().resolvesThis(),
    setUpdatedBy: sandbox.stub(),
  };

  beforeEach(async () => {
    Audit = {
      findById: sandbox.stub().resolves(dummyAudit),
    };
    Opportunity = {
      create: sandbox.stub().resolves(dummyOpportunity),
      allBySiteId: sandbox.stub().resolves([]),
    };
    Suggestion = {
      create: sandbox.stub().resolves(),
      STATUSES: SuggestionDataAccess.STATUSES,
      TYPES: SuggestionDataAccess.TYPES,
    };
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
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
    sandbox.restore();
  });

  it('should log a warning and return if no audit found', async () => {
    // Make Audit.findById return null
    Audit.findById.resolves(null);

    const message = {
      auditId: 'unknown-audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: [],
        suggestions: [],
      },
    };

    await handler(message, context);

    expect(log.warn).to.have.been.calledWithMatch(/No audit found for auditId: unknown-audit-id/);
    expect(Opportunity.allBySiteId).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('should log info and return early if no raw opportunity of the given type and URL is found', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/non-existing-page',
        guidance: [],
        suggestions: [],
      },
    };

    await handler(message, context);

    expect(log.info).to.have.been.calledWithMatch(/No raw opportunity found of type 'high-organic-low-ctr' for URL/);
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
        url: 'https://abc.com/abc-adoption/account',
        guidance: guidanceMsgFromMystique.data.guidance,
        suggestions: guidanceMsgFromMystique.data.suggestions,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.type).to.equal('high-organic-low-ctr');
    expect(createdArg.data.page).to.equal('https://abc.com/abc-adoption/account');

    expect(Suggestion.create).to.have.been.calledOnce;
    const suggestionArg = Suggestion.create.getCall(0).args[0];
    expect(suggestionArg.type).to.equal('CONTENT_UPDATE');
    expect(suggestionArg.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    expect(suggestionArg.data.variations).to.deep.equal(
      guidanceMsgFromMystique.data.suggestions,
    );
  });

  it('should create suggestion with PENDING_VALIDATION status when site requires validation', async () => {
    Opportunity.allBySiteId.resolves([]);
    context.site = { requiresValidation: true };

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: guidanceMsgFromMystique.data.guidance,
        suggestions: guidanceMsgFromMystique.data.suggestions,
      },
    };

    await handler(message, context);

    expect(Suggestion.create).to.have.been.calledOnce;
    const suggestionArg = Suggestion.create.getCall(0).args[0];
    expect(suggestionArg.status).to.equal(SuggestionDataAccess.STATUSES.PENDING_VALIDATION);
  });

  it('should update existing opportunity if found', async () => {
    Opportunity.allBySiteId.resolves([dummyOpportunity]);

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: guidanceMsgFromMystique.data.guidance,
        suggestions: guidanceMsgFromMystique.data.suggestions,
      },
    };

    await handler(message, context);

    expect(Opportunity.create).not.to.have.been.called;
    expect(dummyOpportunity.setAuditId).to.have.been.calledWith('audit-id');
    expect(dummyOpportunity.setData).to.have.been.called;
    expect(dummyOpportunity.setGuidance).to.have.been.called;
    expect(dummyOpportunity.save).to.have.been.called;
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('removes previous suggestions if any', async () => {
    const oldSuggestion = {
      remove: sandbox.stub().resolves(),
      getUpdatedBy: sandbox.stub().returns('system'),
    };
    dummyOpportunity.getSuggestions.resolves([oldSuggestion, oldSuggestion]);

    Opportunity.allBySiteId.resolves([dummyOpportunity]);

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: guidanceMsgFromMystique.data.guidance,
        suggestions: guidanceMsgFromMystique.data.suggestions,
      },
    };

    await handler(message, context);

    expect(oldSuggestion.remove).to.have.been.calledTwice;
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('returns zero opportunityImpact if pageCTR > siteAverageCTR', async () => {
    const auditResult = {
      ...opportunitiesAuditData.auditResult,
    };
    auditResult.experimentationOpportunities = auditResult.experimentationOpportunities
      .map((oppty) => {
        if (
          oppty.type === 'high-organic-low-ctr'
          && oppty.page === 'https://abc.com/abc-adoption/account'
        ) {
          return {
            ...oppty,
            trackedKPISiteAverage: 0.2,
            trackedPageKPIValue: 0.3, // bigger than site average
          };
        }
        return oppty;
      });

    const customAudit = {
      getAuditResult: () => auditResult,
    };
    Audit.findById.resolves(customAudit);

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: [],
        suggestions: [],
      },
    };

    await handler(message, context);

    const createdCallArg = Opportunity.create.getCall(0)?.args[0];
    expect(createdCallArg.data.opportunityImpact).to.equal(0);
  });

  it('should skip updating suggestions when they were manually modified', async () => {
    const manualSuggestion = {
      getUpdatedBy: sandbox.stub().returns('8DD61D5966C7AA650A495F8D@7eeb20f8631c0cb7495c06.e'),
      remove: sandbox.stub().resolves(),
    };

    const opportunityWithManualSuggestions = {
      getId: sandbox.stub().returns('oppty-with-manual-suggestions'),
      getSuggestions: sandbox.stub().resolves([manualSuggestion]),
      getData: sandbox.stub().returns({
        page: 'https://abc.com/abc-adoption/account',
      }),
      setAuditId: sandbox.stub(),
      setData: sandbox.stub(),
      setGuidance: sandbox.stub(),
      save: sandbox.stub().resolvesThis(),
      setUpdatedBy: sandbox.stub(),
    };

    Opportunity.allBySiteId.resolves([opportunityWithManualSuggestions]);

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: guidanceMsgFromMystique.data.guidance,
        suggestions: guidanceMsgFromMystique.data.suggestions,
      },
    };

    await handler(message, context);

    expect(log.debug).to.have.been.calledWithMatch(/were manually modified.*Skipping all updates to preserve data consistency/);
    expect(opportunityWithManualSuggestions.setAuditId).not.to.have.been.called;
    expect(opportunityWithManualSuggestions.setData).not.to.have.been.called;
    expect(opportunityWithManualSuggestions.setGuidance).not.to.have.been.called;
    expect(opportunityWithManualSuggestions.save).not.to.have.been.called;
    expect(manualSuggestion.remove).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('should update system-managed opportunities (updatedBy: system)', async () => {
    const systemSuggestion = {
      getUpdatedBy: sandbox.stub().returns('system'),
      remove: sandbox.stub().resolves(),
    };

    const systemOpportunity = {
      getId: sandbox.stub().returns('system-oppty-id'),
      getSuggestions: sandbox.stub().resolves([systemSuggestion]),
      getData: sandbox.stub().returns({
        page: 'https://abc.com/abc-adoption/account',
      }),
      setAuditId: sandbox.stub(),
      setData: sandbox.stub(),
      setGuidance: sandbox.stub(),
      save: sandbox.stub().resolvesThis(),
      setUpdatedBy: sandbox.stub(),
    };

    Opportunity.allBySiteId.resolves([systemOpportunity]);

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: guidanceMsgFromMystique.data.guidance,
        suggestions: guidanceMsgFromMystique.data.suggestions,
      },
    };

    await handler(message, context);

    expect(systemOpportunity.setAuditId).to.have.been.calledWith('audit-id');
    expect(systemOpportunity.setData).to.have.been.called;
    expect(systemOpportunity.setGuidance).to.have.been.called;
    expect(systemOpportunity.save).to.have.been.called;
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('should update opportunities with null/undefined updatedBy (legacy suggestions)', async () => {
    const legacySuggestion = {
      getUpdatedBy: sandbox.stub().returns(null),
      remove: sandbox.stub().resolves(),
    };

    const legacyOpportunity = {
      getId: sandbox.stub().returns('legacy-oppty-id'),
      getSuggestions: sandbox.stub().resolves([legacySuggestion]),
      getData: sandbox.stub().returns({
        page: 'https://abc.com/abc-adoption/account',
      }),
      setAuditId: sandbox.stub(),
      setData: sandbox.stub(),
      setGuidance: sandbox.stub(),
      save: sandbox.stub().resolvesThis(),
      setUpdatedBy: sandbox.stub(),
    };

    Opportunity.allBySiteId.resolves([legacyOpportunity]);

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/abc-adoption/account',
        guidance: guidanceMsgFromMystique.data.guidance,
        suggestions: guidanceMsgFromMystique.data.suggestions,
      },
    };

    await handler(message, context);

    expect(legacyOpportunity.setAuditId).to.have.been.calledWith('audit-id');
    expect(legacyOpportunity.setData).to.have.been.called;
    expect(legacyOpportunity.setGuidance).to.have.been.called;
    expect(legacyOpportunity.save).to.have.been.called;
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  describe('opportunity capacity management', () => {
    const createMockOpportunity = (id, page, pageViews, type = 'high-organic-low-ctr') => ({
      getId: sandbox.stub().returns(id),
      getType: sandbox.stub().returns(type),
      getData: sandbox.stub().returns({ page, pageViews }),
      getSuggestions: sandbox.stub().resolves([]),
      remove: sandbox.stub().resolves(),
    });

    it('should create opportunity when under capacity (< 3 existing)', async () => {
      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 5000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 6000),
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account',
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      await handler(message, context);

      expect(Opportunity.create).to.have.been.calledOnce;
      expect(Suggestion.create).to.have.been.calledOnce;
    });

    it('should replace lowest pageViews opportunity when at capacity and new has higher pageViews', async () => {
      const lowestOpportunity = createMockOpportunity('oppty-lowest', 'https://abc.com/lowest', 1000);
      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 50000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 60000),
        lowestOpportunity,
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account', // pageViews: 21450 in fixture
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      await handler(message, context);

      expect(lowestOpportunity.remove).to.have.been.calledOnce;
      expect(Opportunity.create).to.have.been.calledOnce;
      expect(log.info).to.have.been.calledWithMatch(/Replacing high-organic-low-ctr opportunity/);
    });

    it('should drop new opportunity when at capacity and new has lower pageViews', async () => {
      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 50000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 60000),
        createMockOpportunity('oppty-3', 'https://abc.com/page3', 70000),
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account', // pageViews: 21450 in fixture
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(200);
      expect(Opportunity.create).not.to.have.been.called;
      expect(Suggestion.create).not.to.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/Max opportunities \(3\) for high-organic-low-ctr already exist/);
    });

    it('should not check capacity when updating existing opportunity for same URL', async () => {
      const existingOpportunityForSameUrl = {
        getId: sandbox.stub().returns('existing-for-url'),
        getType: sandbox.stub().returns('high-organic-low-ctr'),
        getData: sandbox.stub().returns({
          page: 'https://abc.com/abc-adoption/account',
          pageViews: 1000,
        }),
        getSuggestions: sandbox.stub().resolves([]),
        setAuditId: sandbox.stub(),
        setData: sandbox.stub(),
        setGuidance: sandbox.stub(),
        save: sandbox.stub().resolvesThis(),
        setUpdatedBy: sandbox.stub(),
      };

      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 50000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 60000),
        existingOpportunityForSameUrl,
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account',
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      await handler(message, context);

      // Should update, not create
      expect(Opportunity.create).not.to.have.been.called;
      expect(existingOpportunityForSameUrl.setAuditId).to.have.been.called;
      expect(existingOpportunityForSameUrl.save).to.have.been.called;
      expect(Suggestion.create).to.have.been.calledOnce;
    });

    it('should only count high-organic-low-ctr opportunities for capacity check', async () => {
      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 50000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 60000),
        createMockOpportunity('oppty-3', 'https://abc.com/page3', 70000, 'rageclick'), // different type
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account',
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      await handler(message, context);

      // Should create since only 2 high-organic-low-ctr exist (rageclick doesn't count)
      expect(Opportunity.create).to.have.been.calledOnce;
    });

    it('should handle existing opportunities with undefined pageViews (treat as 0)', async () => {
      const opptyWithNoPageViews = createMockOpportunity('oppty-no-views', 'https://abc.com/no-views', undefined);
      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 50000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 60000),
        opptyWithNoPageViews,
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account', // pageViews: 21450 in fixture
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      await handler(message, context);

      // Should replace the one with undefined pageViews (treated as 0)
      expect(opptyWithNoPageViews.remove).to.have.been.calledOnce;
      expect(Opportunity.create).to.have.been.calledOnce;
    });

    it('should handle new opportunity with undefined pageViews (treat as 0)', async () => {
      // Create audit result where the opportunity has no pageViews
      const auditResultWithNoPageViews = {
        experimentationOpportunities: [
          {
            type: 'high-organic-low-ctr',
            page: 'https://abc.com/abc-adoption/account',
            trackedPageKPIName: 'Click Through Rate',
            trackedKPISiteAverage: '0.24',
            trackedPageKPIValue: '0.14',
            // pageViews intentionally omitted
            samples: 215,
            metrics: [],
          },
        ],
      };
      const customAudit = {
        getAuditResult: () => auditResultWithNoPageViews,
      };
      Audit.findById.resolves(customAudit);

      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 50000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 60000),
        createMockOpportunity('oppty-3', 'https://abc.com/page3', 1000),
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account',
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      const result = await handler(message, context);

      // New opportunity has pageViews=0, lowest existing has 1000
      // Should drop the new opportunity
      expect(result.status).to.equal(200);
      expect(Opportunity.create).not.to.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/pageViews: 0.*has lower pageViews/);
    });

    it('should remove suggestions when removing opportunity for replacement', async () => {
      const suggestionToRemove = { remove: sandbox.stub().resolves() };
      const lowestOpportunity = {
        getId: sandbox.stub().returns('oppty-lowest'),
        getType: sandbox.stub().returns('high-organic-low-ctr'),
        getData: sandbox.stub().returns({ page: 'https://abc.com/lowest', pageViews: 1000 }),
        getSuggestions: sandbox.stub().resolves([suggestionToRemove, suggestionToRemove]),
        remove: sandbox.stub().resolves(),
      };
      const existingOpportunities = [
        createMockOpportunity('oppty-1', 'https://abc.com/page1', 50000),
        createMockOpportunity('oppty-2', 'https://abc.com/page2', 60000),
        lowestOpportunity,
      ];
      Opportunity.allBySiteId.resolves(existingOpportunities);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account',
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      await handler(message, context);

      expect(suggestionToRemove.remove).to.have.been.calledTwice;
      expect(lowestOpportunity.remove).to.have.been.calledOnce;
    });
  });
});
