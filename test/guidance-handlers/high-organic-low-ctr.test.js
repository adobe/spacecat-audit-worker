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
import esmock from 'esmock';
import opportunitiesAuditData from '../fixtures/experimentation-opportunities/experimentation-opportunity-audit.json' with { type: 'json' };
import guidanceMsgFromMystique from '../fixtures/experimentation-opportunities/high-organic-low-ctr-guidance.json' with { type: 'json' };

use(sinonChai);

// Mock tagMappings module
const mockTagMappings = {
  mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
    if (opportunityType === 'high-organic-low-ctr') {
      return ['Low CTR', 'Engagement'];
    }
    return currentTags || [];
  }),
};

let handler;

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
    // Import handler with mocked tagMappings
    handler = await esmock(
      '../../src/experimentation-opportunities/guidance-high-organic-low-ctr-handler.js',
      {
        '@adobe/spacecat-shared-utils': mockTagMappings,
      },
    );

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

    const result = await handler(message, context);

    expect(log.warn).to.have.been.calledWith('No audit found for auditId: unknown-audit-id');
    expect(result.status).to.equal(404);
    expect(Opportunity.allBySiteId).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('should log info and return early if no raw opportunity of the given type and URL is found', async () => {
    const auditResult = {
      experimentationOpportunities: [],
    };
    const customAudit = {
      getAuditResult: () => auditResult,
    };
    Audit.findById.resolves(customAudit);

    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        url: 'https://abc.com/non-existing-page',
        guidance: [],
        suggestions: [],
      },
    };

    const result = await handler(message, context);

    expect(log.info).to.have.been.calledWith('No raw opportunity found of type \'high-organic-low-ctr\' for URL: https://abc.com/non-existing-page. Nothing to process.');
    expect(result.status).to.equal(404);
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
    expect(suggestionArg.data.variations).to.deep.equal(
      guidanceMsgFromMystique.data.suggestions,
    );
  });

  it('should update existing opportunity if found', async () => {
    const existingSuggestion = {
      remove: sandbox.stub().resolves(),
      getUpdatedBy: sandbox.stub().returns('system'),
    };
    dummyOpportunity.getSuggestions.resolves([existingSuggestion]);
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

    expect(log.debug).to.have.been.calledWith('Existing Opportunity found for page: https://abc.com/abc-adoption/account. Updating it with new data.');
    expect(Opportunity.create).not.to.have.been.called;
    expect(dummyOpportunity.setAuditId).to.have.been.calledWith('audit-id');
    expect(dummyOpportunity.setData).to.have.been.called;
    expect(dummyOpportunity.setGuidance).to.have.been.called;
    expect(dummyOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(dummyOpportunity.save).to.have.been.called;
    expect(existingSuggestion.remove).to.have.been.called;
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

  describe('update existing opportunity path coverage', () => {
    it('should update existing opportunity with new audit data', async () => {
      Opportunity.allBySiteId.resolves([dummyOpportunity]);

      const message = {
        auditId: 'new-audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account',
          guidance: guidanceMsgFromMystique.data.guidance,
          suggestions: guidanceMsgFromMystique.data.suggestions,
        },
      };

      await handler(message, context);

      expect(dummyOpportunity.setAuditId).to.have.been.calledWith('new-audit-id');
      expect(dummyOpportunity.setData).to.have.been.called;
      expect(dummyOpportunity.setGuidance).to.have.been.called;
      expect(dummyOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(dummyOpportunity.save).to.have.been.called;
      expect(log.debug).to.have.been.calledWithMatch(/Existing Opportunity found for page.*Updating it with new data/);
    });

    it('should merge existing data with new entity data', async () => {
      const existingData = {
        page: 'https://abc.com/abc-adoption/account',
        existingField: 'existing-value',
      };
      dummyOpportunity.getData.returns(existingData);
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

      const setDataCall = dummyOpportunity.setData.getCall(0).args[0];
      expect(setDataCall).to.include(existingData);
      expect(setDataCall).to.include({ page: 'https://abc.com/abc-adoption/account' });
    });

    it('should delete all previous suggestions before creating new ones', async () => {
      const oldSuggestion1 = {
        remove: sandbox.stub().resolves(),
        getUpdatedBy: sandbox.stub().returns('system'),
      };
      const oldSuggestion2 = {
        remove: sandbox.stub().resolves(),
        getUpdatedBy: sandbox.stub().returns('system'),
      };
      dummyOpportunity.getSuggestions.resolves([oldSuggestion1, oldSuggestion2]);
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

      expect(oldSuggestion1.remove).to.have.been.called;
      expect(oldSuggestion2.remove).to.have.been.called;
      expect(Suggestion.create).to.have.been.calledOnce;
    });

    it('should create suggestion with PENDING_VALIDATION status when site requires validation', async () => {
      Opportunity.allBySiteId.resolves([dummyOpportunity]);
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

      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.status).to.equal(SuggestionDataAccess.STATUSES.PENDING_VALIDATION);
    });

    it('should create suggestion with NEW status when site does not require validation', async () => {
      Opportunity.allBySiteId.resolves([dummyOpportunity]);
      context.site = { requiresValidation: false };

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

      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.status).to.equal(SuggestionDataAccess.STATUSES.NEW);
    });
  });

  describe('missing lines coverage', () => {
    it('should execute log.warn and return notFound when audit is not found', async () => {
      Audit.findById.resolves(null);

      const message = {
        auditId: 'non-existent-audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/abc-adoption/account',
          guidance: [],
          suggestions: [],
        },
      };

      const result = await handler(message, context);

      expect(log.warn).to.have.been.calledWith('No audit found for auditId: non-existent-audit-id');
      expect(result.status).to.equal(404);
    });

    it('should execute log.info and return notFound when auditOpportunity is not found', async () => {
      const auditResult = {
        experimentationOpportunities: [],
      };
      const customAudit = {
        getAuditResult: () => auditResult,
      };
      Audit.findById.resolves(customAudit);

      const message = {
        auditId: 'audit-id',
        siteId: 'site-id',
        data: {
          url: 'https://abc.com/non-existent-page',
          guidance: [],
          suggestions: [],
        },
      };

      const result = await handler(message, context);

      expect(log.info).to.have.been.calledWithMatch(/No raw opportunity found of type 'high-organic-low-ctr' for URL: https:\/\/abc.com\/non-existent-page/);
      expect(result.status).to.equal(404);
    });

    it('should execute all lines in existing opportunity update path', async () => {
      const existingSuggestion = {
        remove: sandbox.stub().resolves(),
        getUpdatedBy: sandbox.stub().returns('system'),
      };
      dummyOpportunity.getSuggestions.resolves([existingSuggestion]);
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

      expect(log.debug).to.have.been.calledWith('Existing Opportunity found for page: https://abc.com/abc-adoption/account. Updating it with new data.');
      expect(dummyOpportunity.setAuditId).to.have.been.calledWith('audit-id');
      expect(dummyOpportunity.setData).to.have.been.called;
      expect(dummyOpportunity.setGuidance).to.have.been.called;
      expect(dummyOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(dummyOpportunity.save).to.have.been.called;
      expect(existingSuggestion.remove).to.have.been.called;
    });

    it('should execute existing opportunity update path with multiple suggestions to remove', async () => {
      const suggestion1 = {
        remove: sandbox.stub().resolves(),
        getUpdatedBy: sandbox.stub().returns('system'),
      };
      const suggestion2 = {
        remove: sandbox.stub().resolves(),
        getUpdatedBy: sandbox.stub().returns('system'),
      };
      dummyOpportunity.getSuggestions.resolves([suggestion1, suggestion2]);
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

      expect(log.debug).to.have.been.calledWith('Existing Opportunity found for page: https://abc.com/abc-adoption/account. Updating it with new data.');
      expect(suggestion1.remove).to.have.been.called;
      expect(suggestion2.remove).to.have.been.called;
      expect(Suggestion.create).to.have.been.calledOnce;
    });

    it('should execute existing opportunity update path with empty suggestions array', async () => {
      dummyOpportunity.getSuggestions.resolves([]);
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

      expect(log.debug).to.have.been.calledWith('Existing Opportunity found for page: https://abc.com/abc-adoption/account. Updating it with new data.');
      expect(dummyOpportunity.setAuditId).to.have.been.calledWith('audit-id');
      expect(dummyOpportunity.setData).to.have.been.called;
      expect(dummyOpportunity.setGuidance).to.have.been.called;
      expect(dummyOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(dummyOpportunity.save).to.have.been.called;
      expect(Suggestion.create).to.have.been.calledOnce;
    });
  });
});
